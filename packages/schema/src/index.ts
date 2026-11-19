import { z } from "zod";

/**
 * Text fields are Markdown with $inline$ and $$display$$ LaTeX. Never raw HTML:
 * the player renders Markdown with HTML disabled, so model output cannot inject markup.
 */
const md = (what: string) => z.string().min(1).describe(`${what}. Markdown; math as $...$ or $$...$$. No HTML.`);

const base = {
  id: z.string().min(1).describe("Short id unique within the set, e.g. p1, p2"),
  topic: z.string().min(1).describe("Topic name, ideally matching a topic in the course outline"),
  difficulty: z.number().int().min(1).max(3).describe("1 = warm-up, 2 = exam-typical, 3 = hardest exam-level"),
  source: z.string().optional().describe('Where this comes from, e.g. "Lecture 7 slides, p.4" or "Syllabus: Unit 3"'),
};

export const McProblem = z
  .object({
    ...base,
    type: z.literal("mc"),
    prompt: md("The question"),
    options: z.array(md("One answer choice")).min(2).max(6),
    correctIndex: z.number().int().min(0).describe("0-based index into options"),
    explanation: md("Why the correct option is right and the common distractors are wrong"),
  })
  .refine((p) => p.correctIndex < p.options.length, { message: "correctIndex must point into options", path: ["correctIndex"] });

export const FreeProblem = z.object({
  ...base,
  type: z.literal("free"),
  prompt: md("The question"),
  hint: md("A nudge that does not give the answer away").optional(),
  steps: z.array(md("One step of the worked solution")).min(1),
  answer: md("The final answer, stated concisely"),
});

export const FlashcardProblem = z.object({
  ...base,
  type: z.literal("flashcard"),
  front: md("Term, concept or question"),
  back: md("Definition or answer"),
});

export const Problem = z.discriminatedUnion("type", [McProblem, FreeProblem, FlashcardProblem]);
export type Problem = z.infer<typeof Problem>;

export const ProblemSet = z
  .object({
    title: z.string().min(1),
    summary: z.string().optional().describe("One or two sentences on what this set covers and how to use it"),
    topics: z.array(z.string()).min(1),
    timeLimitMin: z.number().int().positive().optional().describe("Set only for mock exams"),
    problems: z.array(Problem).min(1),
  })
  .refine((s) => new Set(s.problems.map((p) => p.id)).size === s.problems.length, {
    message: "problem ids must be unique",
    path: ["problems"],
  });
export type ProblemSet = z.infer<typeof ProblemSet>;

/** Result of the independent re-solve pass, keyed by problem id. Kept outside ProblemSet so the agent never writes it. */
export const ProblemCheck = z.object({
  status: z.enum(["ok", "mismatch", "unchecked"]),
  note: z.string().optional(),
});
export type ProblemCheck = z.infer<typeof ProblemCheck>;

/**
 * Per-course map of what is taught when, built by Claude from the syllabus and module structure.
 * Uses nullable rather than optional fields and no numeric bounds so it works with structured outputs.
 */
export const TopicOutline = z.object({
  units: z.array(
    z.object({
      title: z.string(),
      topics: z.array(
        z.object({
          name: z.string(),
          summary: z.string().describe("One sentence on what the topic covers"),
          materialIds: z.array(z.string()).describe("Ids of the course materials that teach this topic"),
          coveredOn: z.string().nullable().describe("ISO date (YYYY-MM-DD) the topic is taught, if known"),
        }),
      ),
    }),
  ),
  exams: z.array(
    z.object({
      name: z.string().describe('e.g. "Midterm 1"'),
      date: z.string().nullable().describe("ISO date if known"),
      unitTitles: z.array(z.string()).describe("Titles of the units this exam covers"),
      notes: z.string().nullable(),
    }),
  ),
});
export type TopicOutline = z.infer<typeof TopicOutline>;

export const SUBJECTS = ["math", "physics", "chem", "cs", "bio", "econ", "other"] as const;
export type Subject = (typeof SUBJECTS)[number];
export const SUBJECT_LABELS: Record<Subject, string> = {
  math: "Math",
  physics: "Physics",
  chem: "Chemistry",
  cs: "Computer Science",
  bio: "Biology",
  econ: "Economics",
  other: "Other",
};

const PREFIX_SUBJECT: Record<string, Subject> = {
  APMA: "math", MATH: "math", STAT: "math", IEOR: "math",
  PHYS: "physics", ASTR: "physics",
  CHEM: "chem", CHEN: "chem",
  COMS: "cs", CSEE: "cs", CSOR: "cs", CS: "cs", ELEN: "cs",
  BIOL: "bio", BIOC: "bio", BIOM: "bio",
  ECON: "econ",
};

/**
 * Guess a subject from a course code such as "APMA E2000", "COMSW3134_001_2026_3" or "CHEM UN1403".
 * Returns null when the prefix is unknown, so the caller can fall back to Claude.
 */
export function subjectFromCourseCode(code: string): Subject | null {
  const m = code.toUpperCase().match(/^[^A-Z]*([A-Z]{2,4})/);
  if (!m) return null;
  const letters = m[1]!;
  for (const len of [4, 3, 2]) {
    const hit = PREFIX_SUBJECT[letters.slice(0, len)];
    if (hit) return hit;
  }
  return null;
}
