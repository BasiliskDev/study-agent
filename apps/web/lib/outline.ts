import "server-only";
import { createHash } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { TopicOutline } from "@study/schema";
import { getDb, schema } from "@/db";
import { anthropic, MODEL } from "./anthropic";
import type { JobLogger } from "./jobs";

const EXCERPT = 700;
const BUDGET = 160_000; // characters of material listing sent to Claude

const SYSTEM = `You organize a university course's Canvas content into a topic outline that a study agent uses to decide what to quiz a student on.

From the syllabus and the ordered list of course materials:
- Group topics into units that follow the course's own sequence (usually the module order).
- Name topics specifically enough to write exam problems about ("Lagrange multipliers with one constraint", not "Optimization").
- Link every topic to the ids of the materials that teach it. Use only ids that appear in the list.
- Set coveredOn from the module unlock date or the syllabus schedule when either gives one; otherwise null.
- List every exam the syllabus mentions, with its date if given and the units it covers. If the syllabus says nothing about an exam's scope, infer it from the dates (material taught before the exam and after the previous one) and say so in notes.
- If there is no syllabus, return an empty exams list rather than inventing exams.`;

export async function materialsHash(courseId: string) {
  const db = await getDb();
  const mats = await db.query.materials.findMany({
    where: eq(schema.materials.courseId, courseId),
    columns: { id: true, title: true, position: true, contentHash: true, unlockAt: true },
    orderBy: [asc(schema.materials.position)],
  });
  return { mats, hash: createHash("sha256").update(JSON.stringify(mats)).digest("hex").slice(0, 16) };
}

/** Rebuild the course's TopicOutline if its materials changed. */
export async function buildTopicOutline(courseId: string, job?: JobLogger, force = false): Promise<"built" | "unchanged" | "empty"> {
  const db = await getDb();
  const course = await db.query.courses.findFirst({ where: eq(schema.courses.id, courseId) });
  if (!course) throw new Error("course not found");
  const { hash } = await materialsHash(courseId);
  const current = await db.query.topicOutlines.findFirst({ where: eq(schema.topicOutlines.courseId, courseId) });
  if (!force && current?.sourceHash === hash) return "unchanged";

  const mats = await db.query.materials.findMany({
    where: eq(schema.materials.courseId, courseId),
    orderBy: [asc(schema.materials.position)],
  });
  if (!mats.length) return "empty";

  let listing = "";
  for (const m of mats) {
    if (m.kind === "syllabus") continue;
    const excerpt = (m.textContent ?? "").replace(/--- page \d+ ---/g, " ").replace(/\s+/g, " ").slice(0, EXCERPT);
    const line = `<material id="${m.id}" kind="${m.kind}" module="${m.moduleName ?? ""}" unlocks="${m.unlockAt?.slice(0, 10) ?? ""}">\n${m.title}${m.pages ? ` (${m.pages} pages)` : ""}\n${excerpt}\n</material>\n`;
    if (listing.length + line.length > BUDGET) break;
    listing += line;
  }

  await job?.log(`${course.courseCode}: building topic outline with Claude…`);
  const res = await anthropic().messages.parse({
    model: MODEL,
    max_tokens: 16000,
    system: SYSTEM,
    output_config: { effort: "medium", format: zodOutputFormat(TopicOutline) },
    messages: [
      {
        role: "user",
        content: `Course: ${course.name} (${course.courseCode})${course.term ? `, ${course.term}` : ""}

<syllabus>
${course.syllabusText?.slice(0, 40_000) ?? "(no syllabus in Canvas)"}
</syllabus>

<materials>
${listing}</materials>`,
      },
    ],
  });
  if (res.stop_reason === "refusal") throw new Error("Claude declined to build the outline");
  const outline = res.parsed_output;
  if (!outline) throw new Error(`outline did not parse (stop_reason: ${res.stop_reason})`);

  // Drop ids Claude may have invented
  const valid = new Set(mats.map((m) => m.id));
  for (const u of outline.units) for (const t of u.topics) t.materialIds = t.materialIds.filter((id) => valid.has(id));

  await db
    .insert(schema.topicOutlines)
    .values({ courseId, outline, sourceHash: hash })
    .onConflictDoUpdate({ target: schema.topicOutlines.courseId, set: { outline, sourceHash: hash, createdAt: new Date() } });
  const topics = outline.units.reduce((n, u) => n + u.topics.length, 0);
  await job?.log(`${course.courseCode}: outline has ${outline.units.length} units, ${topics} topics, ${outline.exams.length} exams`);
  return "built";
}
