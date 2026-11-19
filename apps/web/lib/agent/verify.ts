import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Problem, ProblemCheck, Subject } from "@study/schema";
import { getDb, schema } from "@/db";
import { addUsage, anthropic } from "../anthropic";
import type { JobLogger } from "../jobs";

/** Cheaper model for the independent re-solve; override with STUDY_VERIFY_MODEL. */
const VERIFY_MODEL = process.env.STUDY_VERIFY_MODEL ?? "claude-sonnet-5-5";
const CHECKED_SUBJECTS: Subject[] = ["math", "physics", "chem", "cs", "econ"];

const Solved = z.object({ answers: z.array(z.object({ id: z.string(), answer: z.string() })) });
const Compared = z.object({
  checks: z.array(z.object({ id: z.string(), status: z.enum(["ok", "mismatch"]), note: z.string() })),
});

function questionOnly(p: Problem): string {
  if (p.type === "mc") return `[${p.id}] ${p.prompt}\nOptions:\n${p.options.map((o, i) => `  (${i}) ${o}`).join("\n")}`;
  if (p.type === "free") return `[${p.id}] ${p.prompt}`;
  return "";
}

function answerKey(p: Problem): string {
  if (p.type === "mc") return `[${p.id}] option (${p.correctIndex}): ${p.options[p.correctIndex]}`;
  if (p.type === "free") return `[${p.id}] ${p.answer}`;
  return "";
}

/**
 * Re-solve each checkable problem without seeing the answer key, then compare. Mismatches are
 * stored in problem_sets.checks and flagged in the player; the set itself is never edited.
 */
export async function verifyProblemSet(setId: string, subject: Subject, job: JobLogger, usage: Record<string, number>) {
  if (!CHECKED_SUBJECTS.includes(subject)) return;
  const db = await getDb();
  const set = await db.query.problemSets.findFirst({ where: eq(schema.problemSets.id, setId) });
  if (!set) return;
  const checkable = set.data.problems.filter((p) => p.type !== "flashcard");
  if (!checkable.length) return;
  await job.log(`Checking ${checkable.length} answers independently…`);

  // 1. Solve blind, with code execution for arithmetic and symbolic checks.
  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: `Solve each problem independently. Use code execution (e.g. sympy, numpy) to check any computation. For multiple choice give the option number and its text. Keep each answer short: the final result only.\n\n${checkable.map(questionOnly).join("\n\n")}`,
    },
  ];
  let solved: z.infer<typeof Solved> | null = null;
  for (let i = 0; i < 4 && !solved; i++) {
    const res = await anthropic().messages.parse({
      model: VERIFY_MODEL,
      max_tokens: 16000,
      output_config: { effort: "medium", format: zodOutputFormat(Solved) },
      tools: [{ type: "code_execution_20260521", name: "code_execution" }],
      messages,
    });
    addUsage(usage, res.usage);
    if (res.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: res.content });
      continue;
    }
    solved = res.parsed_output;
    if (!solved) throw new Error(`re-solve did not parse (stop_reason: ${res.stop_reason})`);
  }
  if (!solved) throw new Error("re-solve did not finish");

  // 2. Compare the blind answers with the key.
  const blind = new Map(solved.answers.map((a) => [a.id, a.answer]));
  const cmp = await anthropic().messages.parse({
    model: VERIFY_MODEL,
    max_tokens: 8000,
    output_config: { effort: "low", format: zodOutputFormat(Compared) },
    messages: [
      {
        role: "user",
        content: `For each problem, decide whether the answer key and an independent solution agree. Treat equivalent forms as agreeing (e.g. 1/2 and 0.5, factored vs expanded, a different but equal constant). Mark "mismatch" only when they genuinely disagree, and say in the note which one looks right and why, in one sentence.\n\n${checkable
          .map((p) => `${questionOnly(p)}\nAnswer key: ${answerKey(p)}\nIndependent solution: ${blind.get(p.id) ?? "(none)"}`)
          .join("\n\n---\n\n")}`,
      },
    ],
  });
  addUsage(usage, cmp.usage);
  const compared = cmp.parsed_output;
  if (!compared) throw new Error("comparison did not parse");

  const checks: Record<string, ProblemCheck> = {};
  for (const p of checkable) checks[p.id] = { status: "unchecked" };
  for (const c of compared.checks) if (checks[c.id]) checks[c.id] = { status: c.status, note: c.note };
  await db.update(schema.problemSets).set({ checks }).where(eq(schema.problemSets.id, setId));

  const bad = Object.values(checks).filter((c) => c.status === "mismatch").length;
  await job.log(bad ? `${bad} answer(s) flagged for review` : "All answers agreed with an independent solve", bad ? "warn" : "info");
}
