import "server-only";
import { createHash } from "node:crypto";
import { and, eq, notInArray } from "drizzle-orm";
import { CanvasError, htmlToText, pdfToText, type CanvasClient, type CanvasFile, type CanvasModule } from "@study/canvas";
import { SUBJECTS, subjectFromCourseCode, type Subject } from "@study/schema";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { anthropic, SMALL_MODEL } from "./anthropic";
import type { JobLogger } from "./jobs";
import { buildTopicOutline } from "./outline";
import { storage } from "./storage";
import { canvasFor, type User } from "./user";

const MAX_FILE_BYTES = 40 * 1024 * 1024;
const sha = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);
const isPdf = (f: CanvasFile) => /pdf/i.test(f["content-type"]) || /\.pdf$/i.test(f.filename);

async function classifySubject(name: string, code: string): Promise<Subject> {
  const guess = subjectFromCourseCode(code) ?? subjectFromCourseCode(name);
  if (guess) return guess;
  try {
    const res = await anthropic().messages.parse({
      model: SMALL_MODEL,
      max_tokens: 200,
      output_config: { format: zodOutputFormat(z.object({ subject: z.enum(SUBJECTS) })) },
      messages: [{ role: "user", content: `Which subject is this university course? Name: "${name}". Code: "${code}".` }],
    });
    return res.parsed_output?.subject ?? "other";
  } catch {
    return "other";
  }
}

/** Run up to `n` async tasks at a time. */
async function pool<T>(items: T[], n: number, fn: (item: T) => Promise<void>) {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(n, queue.length) }, async () => {
    for (let it = queue.shift(); it !== undefined; it = queue.shift()) await fn(it);
  }));
}

export async function syncAll(user: User, job: JobLogger, opts: { courseId?: string } = {}) {
  const canvas = canvasFor(user);
  const db = await getDb();

  await job.log("Fetching courses from Canvas…");
  const remote = await canvas.listCourses();
  await job.log(`Found ${remote.length} active courses`);

  for (const c of remote) {
    const existing = await db.query.courses.findFirst({
      where: and(eq(schema.courses.userId, user.id), eq(schema.courses.canvasId, c.id)),
    });
    const fields = { name: c.name, courseCode: c.course_code, term: c.term?.name ?? null, syllabusText: htmlToText(c.syllabus_body) || null };
    if (existing) {
      await db.update(schema.courses).set(fields).where(eq(schema.courses.id, existing.id));
    } else {
      const subject = await classifySubject(c.name, c.course_code);
      await db.insert(schema.courses).values({ userId: user.id, canvasId: c.id, subject, ...fields });
    }
  }

  const local = await db.query.courses.findMany({ where: eq(schema.courses.userId, user.id) });
  const activeIds = new Set(remote.map((c) => c.id));
  const targets = local.filter((c) => activeIds.has(c.canvasId) && !c.hidden && (!opts.courseId || c.id === opts.courseId));

  for (const course of targets) {
    await job.log(`${course.courseCode}: syncing materials`);
    try {
      await syncCourse(canvas, course, job);
    } catch (e) {
      await job.log(`${course.courseCode}: ${(e as Error).message}`, "warn");
      continue;
    }
    try {
      const outline = await buildTopicOutline(course.id, job);
      if (outline === "unchanged") await job.log(`${course.courseCode}: topic outline is up to date`);
    } catch (e) {
      await job.log(`${course.courseCode}: could not build topic outline: ${(e as Error).message}`, "warn");
    }
  }
}

type Course = typeof schema.courses.$inferSelect;
type MaterialRow = typeof schema.materials.$inferInsert;

async function syncCourse(canvas: CanvasClient, course: Course, job: JobLogger) {
  const db = await getDb();
  const seen: string[] = [];

  const upsert = async (m: Omit<MaterialRow, "courseId">) => {
    const [row] = await db
      .insert(schema.materials)
      .values({ ...m, courseId: course.id })
      .onConflictDoUpdate({
        target: [schema.materials.courseId, schema.materials.kind, schema.materials.canvasKey],
        set: { ...m },
      })
      .returning({ id: schema.materials.id });
    seen.push(row!.id);
    if (m.textContent !== undefined) {
      await db.$client.execute({ sql: "DELETE FROM materials_fts WHERE material_id = ?", args: [row!.id] });
      if (m.textContent) {
        await db.$client.execute({
          sql: "INSERT INTO materials_fts (material_id, course_id, title, body) VALUES (?, ?, ?, ?)",
          args: [row!.id, course.id, m.title, m.textContent],
        });
      }
    }
    return row!.id;
  };

  const existing = await db.query.materials.findMany({ where: eq(schema.materials.courseId, course.id) });
  const prev = new Map(existing.map((m) => [`${m.kind}:${m.canvasKey}`, m]));

  // Syllabus
  if (course.syllabusText) {
    await upsert({ kind: "syllabus", canvasKey: "syllabus", title: "Syllabus", position: -1, textContent: course.syllabusText, contentHash: sha(course.syllabusText) });
  }

  // Module structure: where each page/file sits and when it unlocks
  let modules: CanvasModule[] = [];
  try {
    modules = await canvas.listModules(course.canvasId);
  } catch (e) {
    if (!(e instanceof CanvasError && e.isForbidden)) throw e;
  }
  const placement = new Map<string, { moduleName: string; position: number; unlockAt: string | null }>();
  for (const m of modules) {
    for (const it of m.items ?? []) {
      const key = it.type === "File" ? `file:${it.content_id}` : it.type === "Page" ? `page:${it.page_url}` : null;
      if (key && !placement.has(key)) {
        placement.set(key, {
          moduleName: m.name,
          position: m.position * 1000 + it.position,
          unlockAt: it.content_details?.unlock_at ?? m.unlock_at ?? null,
        });
      }
    }
  }

  // Pages
  let pageUrls = [...placement.keys()].filter((k) => k.startsWith("page:")).map((k) => k.slice(5));
  try {
    const all = await canvas.listPages(course.canvasId);
    pageUrls = [...new Set([...pageUrls, ...all.filter((p) => !p.locked_for_user).map((p) => p.url)])];
  } catch (e) {
    if (!(e instanceof CanvasError && e.isForbidden)) throw e; // Pages tab hidden: module pages only
  }
  let pagesChanged = 0;
  await pool(pageUrls, 4, async (url) => {
    const where = placement.get(`page:${url}`);
    try {
      const p = await canvas.getPage(course.canvasId, url);
      const old = prev.get(`page:${url}`);
      const unchanged = old?.sourceVersion === p.updated_at;
      const text = unchanged ? undefined : htmlToText(p.body);
      if (!unchanged) pagesChanged++;
      await upsert({
        kind: "page",
        canvasKey: url,
        title: p.title,
        moduleName: where?.moduleName ?? null,
        position: where?.position ?? 900_000,
        unlockAt: where?.unlockAt ?? null,
        sourceVersion: p.updated_at,
        ...(text !== undefined ? { textContent: text, contentHash: sha(text) } : {}),
      });
    } catch (e) {
      if (!(e instanceof CanvasError && e.isForbidden)) throw e;
    }
  });

  // Files (PDFs are downloaded and their text extracted)
  const { files, via } = await canvas.listFiles(course.canvasId);
  const pdfs = files.filter((f) => isPdf(f) && !f.locked_for_user);
  if (via === "modules") await job.log(`${course.courseCode}: Files tab hidden; using files linked from modules`);
  let downloaded = 0;
  await pool(pdfs, 3, async (f) => {
    const key = String(f.id);
    const where = placement.get(`file:${f.id}`);
    const old = prev.get(`file:${key}`);
    const base = {
      kind: "file" as const,
      canvasKey: key,
      title: f.display_name,
      moduleName: where?.moduleName ?? null,
      position: where?.position ?? 950_000,
      unlockAt: where?.unlockAt ?? null,
      contentType: f["content-type"],
      sizeBytes: f.size,
    };
    if (old && old.sourceVersion === f.updated_at && old.blobKey) {
      await upsert(base);
      return;
    }
    if (f.size > MAX_FILE_BYTES) {
      await job.log(`${course.courseCode}: skipping ${f.display_name} (${Math.round(f.size / 1e6)} MB)`, "warn");
      return;
    }
    try {
      const bytes = await canvas.downloadFile(f);
      const blobKey = `${course.id}/${f.id}.pdf`;
      await storage.put(blobKey, bytes);
      let text = "";
      let pages: number | null = null;
      try {
        ({ text, pages } = await pdfToText(bytes));
      } catch {
        await job.log(`${course.courseCode}: could not read text from ${f.display_name}`, "warn");
      }
      downloaded++;
      await job.log(`${course.courseCode}: ${f.display_name}${pages ? ` (${pages} pages)` : ""}`);
      await upsert({
        ...base,
        blobKey,
        pages,
        textContent: text,
        contentHash: createHash("sha256").update(bytes).digest("hex").slice(0, 16),
        sourceVersion: f.updated_at,
        anthropicFileId: null, // content changed: re-upload to Claude on next use
      });
    } catch (e) {
      if (e instanceof CanvasError && e.isForbidden) return;
      await job.log(`${course.courseCode}: failed to download ${f.display_name}: ${(e as Error).message}`, "warn");
      if (old) seen.push(old.id); // keep the previous copy
    }
  });

  // Drop materials that disappeared from Canvas
  const gone = await db.query.materials.findMany({
    where: and(eq(schema.materials.courseId, course.id), seen.length ? notInArray(schema.materials.id, seen) : undefined),
  });
  for (const m of gone) {
    await db.$client.execute({ sql: "DELETE FROM materials_fts WHERE material_id = ?", args: [m.id] });
    if (m.blobKey) await storage.delete(m.blobKey);
    await db.delete(schema.materials).where(eq(schema.materials.id, m.id));
  }

  await db.update(schema.courses).set({ lastSyncedAt: new Date() }).where(eq(schema.courses.id, course.id));
  await job.log(
    `${course.courseCode}: ${pageUrls.length} pages (${pagesChanged} updated), ${pdfs.length} PDFs (${downloaded} downloaded)${gone.length ? `, ${gone.length} removed` : ""}`,
  );
}
