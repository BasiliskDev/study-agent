import "server-only";
import { asc, eq } from "drizzle-orm";
import type { TopicOutline } from "@study/schema";
import { getDb, schema } from "@/db";
import type { ProblemSetKind } from "@/db/schema";
import { addUsage, anthropic, MODEL } from "../anthropic";
import type { JobLogger } from "../jobs";
import type { User } from "../user";
import { connectCanvasMcp } from "./canvasMcp";
import { makeLocalTools } from "./tools";
import { verifyProblemSet } from "./verify";

export type GenerateRequest =
  | { kind: "auto"; days: number; count: number }
  | { kind: "custom"; prompt: string; count: number }
  | { kind: "exam_prep"; exam: string; count: number; timed: boolean; extra?: string };

// Stable across runs and courses so it stays in the prompt cache.
const SYSTEM = `You are a study agent that writes practice problem sets for a university student from their own course materials in Canvas.

How to work:
1. Read the course outline and materials index in the request. Decide which topics the set must cover.
2. Ground every problem in the actual course: use search_materials and read_material to see how the instructor presents each topic: notation, the kinds of examples worked in lecture, and the level of difficulty. Read the text version first; switch to asPdf=true only for a few key files where equations or diagrams matter. Use the Canvas tools (list_modules, get_syllabus, get_page) when you need live detail the index lacks, such as exam announcements or a page that wasn't synced.
3. Write the problems. Match the course's notation and the style of its exams. Mix types: "free" for anything computed or derived (with a worked solution, one step per item, and a concise final answer), "mc" for conceptual checks (distractors should be the mistakes students actually make), "flashcard" only for definitions and facts to memorize. Order problems from warm-up to exam-level within each topic. Set source to the material a problem draws on, with a page number when you know it.
4. Check your own answers before saving: redo every computation and make sure each mc question has exactly one correct option.
5. Call save_problem_set once with the complete set, then stop.

Formatting: Markdown with LaTeX math in $...$ or $$...$$. Never HTML. Code in fenced blocks with a language tag.

Stay within what the course has covered unless the request says otherwise. If the materials are too thin to support a topic, write fewer problems on it rather than inventing course content, and say so in the set's summary.`;

function describeRequest(req: GenerateRequest, today: string): string {
  switch (req.kind) {
    case "auto":
      return `Write a practice set of about ${req.count} problems on the material taught in the last ${req.days} days (today is ${today}). Use coveredOn dates and module unlock dates to decide what counts as recent; if dates are missing, use the most recent units in course order.`;
    case "custom":
      return `Write a practice set of about ${req.count} problems for this request from the student:\n\n<request>\n${req.prompt}\n</request>`;
    case "exam_prep":
      return `Write a ${req.timed ? "timed mock exam" : "review set"} of about ${req.count} problems to prepare for **${req.exam}** (today is ${today}). Cover every topic the outline maps to this exam, weighted toward what exams in this course emphasize, and include several exam-level multi-step problems.${req.timed ? " Set timeLimitMin to a realistic time for this many problems on a real exam." : ""}${req.extra ? `\n\nThe student adds:\n<request>\n${req.extra}\n</request>` : ""}`;
  }
}

export function requestTitle(req: GenerateRequest): string {
  return req.kind === "custom" ? req.prompt : req.kind === "exam_prep" ? `${req.exam}${req.extra ? `: ${req.extra}` : ""}` : `Last ${req.days} days`;
}

export async function generateProblemSet(user: User, courseId: string, req: GenerateRequest, job: JobLogger) {
  const db = await getDb();
  const course = await db.query.courses.findFirst({ where: eq(schema.courses.id, courseId) });
  if (!course || course.userId !== user.id) throw new Error("course not found");
  const outlineRow = await db.query.topicOutlines.findFirst({ where: eq(schema.topicOutlines.courseId, courseId) });
  const mats = await db.query.materials.findMany({
    where: eq(schema.materials.courseId, courseId),
    columns: { id: true, kind: true, title: true, moduleName: true, unlockAt: true, pages: true },
    orderBy: [asc(schema.materials.position)],
  });
  if (!mats.length) throw new Error("This course has no synced materials yet. Run a sync first.");

  const today = new Date().toISOString().slice(0, 10);
  const index = mats
    .map((m) => `${m.id} | ${m.kind} | ${m.title}${m.pages ? ` (${m.pages}p)` : ""} | ${m.moduleName ?? "-"} | ${m.unlockAt?.slice(0, 10) ?? "-"}`)
    .join("\n");
  const outline: TopicOutline | null = outlineRow?.outline ?? null;

  const courseContext = `Course: ${course.name} (${course.courseCode})${course.term ? `, ${course.term}` : ""}. Canvas course id for the Canvas tools: ${course.canvasId}.

<topic_outline>
${outline ? JSON.stringify(outline) : "(no outline yet; infer topics from the materials and syllabus)"}
</topic_outline>

<materials_index columns="id | kind | title | module | unlocks">
${index}
</materials_index>`;

  let savedId: string | undefined;
  const local = makeLocalTools({
    userId: user.id,
    courseId,
    kind: req.kind,
    prompt: requestTitle(req),
    job,
    onSaved: (id) => (savedId = id),
  });
  const mcp = await connectCanvasMcp(user);
  const usage: Record<string, number> = {};

  try {
    await job.log(`Planning a ${req.kind === "exam_prep" ? "exam-prep" : req.kind} set for ${course.courseCode}…`);
    const runner = anthropic().beta.messages.toolRunner({
      model: MODEL,
      max_tokens: 64000,
      stream: true,
      max_iterations: 40,
      system: SYSTEM,
      output_config: { effort: "high" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      cache_control: { type: "ephemeral" },
      tools: [...mcp.tools, ...local],
      messages: [
        {
          role: "user",
          content: [
            // Course context first with its own breakpoint: reused by every turn of this run and by later runs on the course.
            { type: "text", text: courseContext, cache_control: { type: "ephemeral" } },
            { type: "text", text: describeRequest(req, today) },
          ],
        },
      ],
    });

    for await (const stream of runner) {
      const msg = await stream.finalMessage();
      addUsage(usage, msg.usage);
      for (const b of msg.content) {
        if (b.type === "tool_use" && b.name !== "save_problem_set" && !local.some((t) => t.name === b.name)) {
          await job.log(`Canvas: ${b.name} ${JSON.stringify(b.input)}`, "tool");
        }
      }
      if (msg.stop_reason === "refusal") throw new Error("Claude declined this request.");
      if (msg.stop_reason === "max_tokens") await job.log("A turn hit max_tokens; continuing", "warn");
    }
  } finally {
    await mcp.close().catch(() => {});
  }

  if (!savedId) throw new Error("The agent finished without saving a problem set.");

  try {
    await verifyProblemSet(savedId, course.subject, job, usage);
  } catch (e) {
    await job.log(`Answer check skipped: ${(e as Error).message}`, "warn");
  }
  return { resultId: savedId, usage };
}
