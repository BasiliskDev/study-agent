import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { deleteProblemSet } from "@/lib/actions";
import { getUser } from "@/lib/user";
import { Player } from "./Player";

export const dynamic = "force-dynamic";

export default async function SetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getUser();
  const db = await getDb();
  const set = await db.query.problemSets.findFirst({ where: eq(schema.problemSets.id, id) });
  if (!set) notFound();
  const course = await db.query.courses.findFirst({ where: eq(schema.courses.id, set.courseId) });
  if (!course || course.userId !== user.id) notFound();

  const attempts = await db.query.attempts.findMany({
    where: eq(schema.attempts.problemSetId, id),
    orderBy: [asc(schema.attempts.answeredAt)],
  });
  const initialResults: Record<string, boolean> = {};
  for (const a of attempts) initialResults[a.problemId] = a.correct;
  const flagged = Object.values(set.checks ?? {}).filter((c) => c.status === "mismatch").length;
  const del = deleteProblemSet.bind(null, set.id);

  return (
    <div className="stack" style={{ gap: 18, maxWidth: 820, ["--subject" as string]: `var(--s-${course.subject})` }}>
      <section className="stack" style={{ gap: 8 }}>
        <div className="row small">
          <Link href="/" className="muted">
            Library
          </Link>
          <span className="muted">/</span>
          <Link href={`/course/${course.id}`} className="muted">
            {course.courseCode}
          </Link>
        </div>
        <h1>{set.data.title}</h1>
        {set.data.summary && <p className="muted">{set.data.summary}</p>}
        {set.checks && (
          <div className="row small">
            <span className={`chip ${flagged ? "warn" : "good"}`} title="Each answer was re-solved independently and compared with the key">
              {flagged ? `${flagged} answer${flagged > 1 ? "s" : ""} flagged` : "Answers checked"}
            </span>
          </div>
        )}
      </section>

      <Player setId={set.id} set={set.data} checks={set.checks ?? {}} initialResults={initialResults} />

      <details className="small">
        <summary className="muted">About this set</summary>
        <div className="stack" style={{ gap: 8, marginTop: 8 }}>
          {set.prompt && (
            <p className="muted">
              Request: <i>{set.prompt}</i>
            </p>
          )}
          <p className="muted">Created {set.createdAt.toLocaleString()}</p>
          <form action={del}>
            <button className="btn ghost danger sm">Delete this set</button>
          </form>
        </div>
      </details>
    </div>
  );
}
