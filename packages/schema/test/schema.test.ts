import { describe, expect, it } from "vitest";
import { ProblemSet, subjectFromCourseCode } from "../src/index.ts";

const valid = {
  title: "Sample",
  topics: ["Recursion"],
  problems: [
    { id: "p1", topic: "Recursion", difficulty: 1, type: "mc", prompt: "Base case?", options: ["A", "B"], correctIndex: 1, explanation: "B." },
    { id: "p2", topic: "Recurrences", difficulty: 2, type: "free", prompt: "Solve $T(n)=2T(n/2)+n$", steps: ["Master theorem case 2"], answer: "$\\Theta(n\\log n)$" },
    { id: "p3", topic: "Big-O", difficulty: 1, type: "flashcard", front: "Big-O", back: "Upper bound" },
  ],
};

describe("ProblemSet", () => {
  it("accepts a valid set", () => {
    expect(ProblemSet.safeParse(valid).success).toBe(true);
  });

  it("rejects an out-of-range correctIndex", () => {
    const bad = structuredClone(valid);
    (bad.problems[0] as { correctIndex: number }).correctIndex = 5;
    expect(ProblemSet.safeParse(bad).success).toBe(false);
  });

  it("rejects duplicate ids", () => {
    const bad = structuredClone(valid);
    bad.problems[1]!.id = "p1";
    expect(ProblemSet.safeParse(bad).success).toBe(false);
  });
});

describe("subjectFromCourseCode", () => {
  it.each([
    ["APMA E2000", "math"],
    ["COMSW3134_001_2026_3", "cs"],
    ["CHEM UN1403", "chem"],
    ["PHYS UN1601", "physics"],
    ["CSEE W3827", "cs"],
    ["HIST UN1010", null],
  ])("%s → %s", (code, subject) => {
    expect(subjectFromCourseCode(code)).toBe(subject);
  });
});
