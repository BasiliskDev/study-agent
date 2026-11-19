/** The hand-built drills in /artifacts, linked from the course they belong to. */
export const LEGACY_DRILLS = [
  { slug: "e2000-midterm-1-drill", title: "E2000 Midterm 1 drill", match: /E2000|APMA.?2000/i },
  { slug: "e2000-midterm-2-drill", title: "E2000 Midterm 2 drill", match: /E2000|APMA.?2000/i },
  { slug: "chem-exam-3-mo-vsepr", title: "Exam 3: MO theory, VSEPR & hybridization", match: /CHEM/i },
  { slug: "functional-group-drills", title: "Functional group drills", match: /CHEM/i },
  { slug: "w3134-exam-1-drills", title: "W3134 Exam 1 drills", match: /3134/ },
  { slug: "red-black-tree-trainer", title: "Red-black tree insertion trainer", match: /3134/ },
] as const;

export const LEGACY_SLUGS = new Set<string>(LEGACY_DRILLS.map((d) => d.slug));

export function legacyFor(course: { courseCode: string; name: string }) {
  return LEGACY_DRILLS.filter((d) => d.match.test(`${course.courseCode} ${course.name}`));
}
