import Link from "next/link";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { SUBJECTS, SUBJECT_LABELS } from "@study/schema";
import { getDb, schema } from "@/db";
import { SyncButton } from "@/components/SyncButton";
import { loadSampleSet } from "@/lib/actions";
import { legacyFor } from "@/lib/legacy";
import { getUser } from "@/lib/user";

export const dynamic = "force-dynamic";

function ago(d: Date | null) {
  if (!d) return "never";
  const m = Math.round((Date.now() - d.getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
}

export default async function Library() {
  const user = await getUser();
  const db = await getDb();
  const courses = await db
    .select({
      course: schema.courses,
      // Table-qualified by hand: inside a subquery Drizzle renders bare column names, and "id" would bind to the inner table.
      sets: sql<number>`(select count(*) from problem_sets ps where ps.course_id = courses.id)`,
      materials: sql<number>`(select count(*) from materials m where m.course_id = courses.id)`,
    })
    .from(schema.courses)
    .where(eq(schema.courses.userId, user.id))
    .orderBy(schema.courses.courseCode);
  const runningSync = await db.query.jobs.findFirst({
    where: and(eq(schema.jobs.userId, user.id), eq(schema.jobs.type, "sync"), eq(schema.jobs.status, "running"), isNull(schema.jobs.courseId)),
    orderBy: [desc(schema.jobs.createdAt)],
  });

  const connected = !!user.canvasTokenEnc;
  const visible = courses.filter((c) => !c.course.hidden);
  const hidden = courses.filter((c) => c.course.hidden);
  const lastSync = visible.reduce<Date | null>((a, c) => (c.course.lastSyncedAt && (!a || c.course.lastSyncedAt > a) ? c.course.lastSyncedAt : a), null);

  return (
    <div className="stack" style={{ gap: 28 }}>
      <section className="spread" style={{ alignItems: "end" }}>
        <div className="stack" style={{ gap: 6 }}>
          <div className="eyebrow">{connected ? `Canvas · ${user.canvasUserName ?? "connected"} · synced ${ago(lastSync)}` : "Canvas not connected"}</div>
          <h1>Your courses</h1>
        </div>
        {connected && <SyncButton runningJobId={runningSync?.id} />}
      </section>

      {!connected && (
        <section className="panel stack">
          <h2>Connect Canvas to get started</h2>
          <p className="muted">
            Add your Canvas URL and an access token. The agent pulls each course&apos;s syllabus, modules, pages and lecture PDFs,
            files them by subject, and writes problem sets from them.
          </p>
          <div className="row">
            <Link className="btn primary" href="/settings">
              Connect Canvas
            </Link>
            <form action={loadSampleSet}>
              <button className="btn">Try a sample set</button>
            </form>
          </div>
        </section>
      )}

      {connected && visible.length === 0 && (
        <section className="panel stack">
          <h2>No courses yet</h2>
          <p className="muted">Run a sync to pull your active Canvas courses.</p>
        </section>
      )}

      {connected && visible.length > 0 && courses.every((c) => Number(c.sets) === 0) && (
        <section className="notice row">
          <span>No problem sets yet. Open a course to generate one, or</span>
          <form action={loadSampleSet}>
            <button className="btn sm">try a sample set</button>
          </form>
        </section>
      )}

      {SUBJECTS.map((subject) => {
        const group = visible.filter((c) => c.course.subject === subject);
        if (!group.length) return null;
        return (
          <section key={subject} className="subject" style={{ ["--subject" as string]: `var(--s-${subject})` }}>
            <div className="subject-head">
              <span className="subject-dot" aria-hidden />
              <h2>{SUBJECT_LABELS[subject]}</h2>
              <span className="muted small">{group.length}</span>
            </div>
            <div className="course-grid">
              {group.map(({ course, sets, materials }) => {
                const legacy = legacyFor(course).length;
                return (
                  <Link key={course.id} href={`/course/${course.id}`} className="panel course-card">
                    <div className="code">{course.courseCode}</div>
                    <h3>{course.name}</h3>
                    <div className="stats">
                      <span>
                        <b>{sets}</b> sets
                      </span>
                      <span>
                        <b>{materials}</b> materials
                      </span>
                      {legacy > 0 && (
                        <span>
                          <b>{legacy}</b> drills
                        </span>
                      )}
                    </div>
                    {course.term && <div className="muted small">{course.term}</div>}
                  </Link>
                );
              })}
            </div>
          </section>
        );
      })}

      {hidden.length > 0 && (
        <details>
          <summary className="muted small">Hidden courses ({hidden.length})</summary>
          <div className="list" style={{ marginTop: 8 }}>
            {hidden.map(({ course }) => (
              <Link key={course.id} href={`/course/${course.id}`} className="small">
                {course.courseCode} · {course.name}
              </Link>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
