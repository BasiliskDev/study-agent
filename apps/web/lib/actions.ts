"use server";

import { CanvasClient, normalizeBaseUrl } from "@study/canvas";
import { ProblemSet, SUBJECTS, type Subject } from "@study/schema";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { getDb, schema } from "@/db";
import { generateProblemSet, type GenerateRequest } from "./agent/generate";
import { encrypt } from "./crypto";
import { startJob } from "./jobs";
import { syncAll } from "./sync";
import { getUser } from "./user";

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

export async function saveCanvasSettings(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const user = await getUser();
  const rawUrl = String(form.get("baseUrl") ?? "").trim();
  const token = String(form.get("token") ?? "").trim();
  if (!rawUrl) return { ok: false, error: "Enter your Canvas URL." };
  let baseUrl: string;
  try {
    baseUrl = normalizeBaseUrl(rawUrl);
  } catch {
    return { ok: false, error: "That doesn't look like a URL." };
  }
  if (!token && !user.canvasTokenEnc) return { ok: false, error: "Paste an access token." };

  // Test before saving. An empty token field keeps the saved token.
  const { decrypt } = await import("./crypto");
  const useToken = token || decrypt(user.canvasTokenEnc!);
  try {
    const me = await new CanvasClient({ baseUrl, token: useToken, maxRetries: 1 }).getSelf();
    const db = await getDb();
    await db
      .update(schema.users)
      .set({ canvasBaseUrl: baseUrl, canvasUserName: me.name, ...(token ? { canvasTokenEnc: encrypt(token) } : {}) })
      .where(eq(schema.users.id, user.id));
    revalidatePath("/", "layout");
    return { ok: true, message: `Connected as ${me.name}.` };
  } catch (e) {
    return { ok: false, error: `Canvas rejected the connection: ${(e as Error).message}` };
  }
}

export async function disconnectCanvas() {
  const user = await getUser();
  const db = await getDb();
  await db.update(schema.users).set({ canvasTokenEnc: null, canvasUserName: null }).where(eq(schema.users.id, user.id));
  revalidatePath("/", "layout");
}

export async function startSync(courseId?: string): Promise<{ jobId: string } | { error: string }> {
  const user = await getUser();
  if (!user.canvasTokenEnc) return { error: "Connect Canvas in Settings first." };
  const jobId = await startJob({ userId: user.id, type: "sync", courseId }, (job) => syncAll(user, job, { courseId }));
  return { jobId };
}

export async function startGenerate(courseId: string, req: GenerateRequest): Promise<{ jobId: string } | { error: string }> {
  const user = await getUser();
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    return { error: "Set ANTHROPIC_API_KEY in apps/web/.env.local and restart the dev server." };
  }
  if (req.kind === "custom" && !req.prompt.trim()) return { error: "Describe what you want to practice." };
  if (req.kind === "exam_prep" && !req.exam.trim()) return { error: "Pick or name an exam." };
  const count = Math.max(3, Math.min(40, Math.round(req.count || 12)));
  const jobId = await startJob({ userId: user.id, type: "generate", courseId }, (job) =>
    generateProblemSet(user, courseId, { ...req, count }, job),
  );
  return { jobId };
}

async function ownCourse(courseId: string) {
  const user = await getUser();
  const db = await getDb();
  const course = await db.query.courses.findFirst({
    where: and(eq(schema.courses.id, courseId), eq(schema.courses.userId, user.id)),
  });
  if (!course) throw new Error("course not found");
  return { db, course };
}

export async function setCourseSubject(courseId: string, subject: Subject) {
  if (!SUBJECTS.includes(subject)) return;
  const { db } = await ownCourse(courseId);
  await db.update(schema.courses).set({ subject, subjectLocked: true }).where(eq(schema.courses.id, courseId));
  revalidatePath("/", "layout");
}

export async function setCourseHidden(courseId: string, hidden: boolean) {
  const { db } = await ownCourse(courseId);
  await db.update(schema.courses).set({ hidden }).where(eq(schema.courses.id, courseId));
  revalidatePath("/", "layout");
}

export async function rebuildOutline(courseId: string): Promise<{ jobId: string } | { error: string }> {
  const user = await getUser();
  await ownCourse(courseId);
  const { buildTopicOutline } = await import("./outline");
  const jobId = await startJob({ userId: user.id, type: "sync", courseId }, async (job) => {
    await buildTopicOutline(courseId, job, true);
  });
  return { jobId };
}

async function ownSet(setId: string) {
  const user = await getUser();
  const db = await getDb();
  const set = await db.query.problemSets.findFirst({ where: eq(schema.problemSets.id, setId) });
  if (!set) throw new Error("set not found");
  const course = await db.query.courses.findFirst({ where: eq(schema.courses.id, set.courseId) });
  if (course?.userId !== user.id) throw new Error("set not found");
  return { db, set };
}

export async function recordAttempt(setId: string, problemId: string, correct: boolean) {
  const { db, set } = await ownSet(setId);
  if (!set.data.problems.some((p) => p.id === problemId)) return;
  await db.insert(schema.attempts).values({ problemSetId: setId, problemId, correct, answeredAt: new Date() });
}

export async function deleteProblemSet(setId: string) {
  const { db, set } = await ownSet(setId);
  await db.delete(schema.problemSets).where(eq(schema.problemSets.id, setId));
  revalidatePath(`/course/${set.courseId}`);
  redirect(`/course/${set.courseId}`);
}

/**
 * Load the hand-converted sample set (W3134 questions from the original drill) so the player can be
 * tried before Canvas or the Claude API is set up. Attaches to a matching synced course, or a local sample course.
 */
export async function loadSampleSet() {
  const user = await getUser();
  const db = await getDb();
  const raw = JSON.parse(await readFile(path.join(process.cwd(), "seed/w3134-sample.json"), "utf8"));
  const data = ProblemSet.parse(raw);
  const all = await db.query.courses.findMany({ where: eq(schema.courses.userId, user.id) });
  let course = all.find((c) => /3134/.test(c.courseCode + c.name));
  if (!course) {
    [course] = await db
      .insert(schema.courses)
      .values({ userId: user.id, canvasId: -3134, name: "Data Structures (sample)", courseCode: "COMS W3134", subject: "cs" })
      .onConflictDoUpdate({ target: [schema.courses.userId, schema.courses.canvasId], set: { hidden: false } })
      .returning();
  }
  const [row] = await db
    .insert(schema.problemSets)
    .values({ courseId: course!.id, title: data.title, kind: "custom", prompt: "Sample set", data })
    .returning({ id: schema.problemSets.id });
  redirect(`/set/${row!.id}`);
}
