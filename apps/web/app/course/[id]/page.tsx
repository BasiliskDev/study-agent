import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { SUBJECT_LABELS } from "@study/schema";
import { getDb, schema } from "@/db";
import { SyncButton } from "@/components/SyncButton";
import { legacyFor } from "@/lib/legacy";
import { getUser } from "@/lib/user";
import { CourseControls } from "./CourseControls";
import { GeneratePanel } from "./GeneratePanel";
import { OutlineRebuild } from "./OutlineRebuild";

export const dynamic = "force-dynamic";

const KIND_LABEL = { auto: "Recent", custom: "Custom", exam_prep: "Exam prep" } as const;

export default async function CoursePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getUser();
  const db = await getDb();
  const course = await db.query.courses.findFirst({ where: and(eq(schema.courses.id, id), eq(schema.courses.userId, user.id)) });
  if (!course) notFound();

  const [outlineRow, sets, materials, running] = await Promise.all([
    db.query.topicOutlines.findFirst({ where: eq(schema.topicOutlines.courseId, id) }),
    db.query.problemSets.findMany({ where: eq(schema.problemSets.courseId, id), orderBy: [desc(schema.problemSets.createdAt)] }),
    db.query.materials.findMany({
      where: eq(schema.materials.courseId, id),
      columns: { id: true, kind: true, title: true, moduleName: true, pages: true, position: true },
      orderBy: [asc(schema.materials.position)],
    }),
    db.query.jobs.findMany({
      where: and(eq(schema.jobs.courseId, id), eq(schema.jobs.status, "running")),
      orderBy: [desc(schema.jobs.createdAt)],
    }),
  ]);
  const outline = outlineRow?.outline;

  // Per-topic accuracy from the latest attempt on each problem across this course's sets
  const attempts = sets.length
    ? await db.query.attempts.findMany({
        where: inArray(schema.attempts.problemSetId, sets.map((s) => s.id)),
        orderBy: [asc(schema.attempts.answeredAt)],
      })
    : [];
  const latest = new Map<string, boolean>();
  for (const a of attempts) latest.set(`${a.problemSetId}:${a.problemId}`, a.correct);
  const topicStats = new Map<string, { right: number; total: number }>();
  for (const s of sets) {
    for (const p of s.data.problems) {
      const r = latest.get(`${s.id}:${p.id}`);
      if (r === undefined) continue;
      const key = p.topic.toLowerCase();
      const t = topicStats.get(key) ?? { right: 0, total: 0 };
      t.total++;
      if (r) t.right++;
      topicStats.set(key, t);
    }
  }
  const setProgress = (setId: string, n: number) => {
    let done = 0;
    for (const k of latest.keys()) if (k.startsWith(setId + ":")) done++;
    return `${done}/${n}`;
  };

  const legacy = legacyFor(course);
  const runningGen = running.find((j) => j.type === "generate");
  const runningSync = running.find((j) => j.type === "sync");
  const byModule = new Map<string, typeof materials>();
  for (const m of materials) {
    const k = m.kind === "syllabus" ? "Syllabus" : (m.moduleName ?? (m.kind === "page" ? "Other pages" : "Other files"));
    byModule.set(k, [...(byModule.get(k) ?? []), m]);
  }

  return (
    <div className="stack" style={{ gap: 22, ["--subject" as string]: `var(--s-${course.subject})` }}>
      <section className="stack" style={{ gap: 8 }}>
        <div className="row small">
          <Link href="/" className="muted">
            Library
          </Link>
          <span className="muted">/</span>
          <span className="muted">{SUBJECT_LABELS[course.subject]}</span>
        </div>
        <div className="spread" style={{ alignItems: "end" }}>
          <div className="stack" style={{ gap: 6 }}>
            <div className="eyebrow" style={{ color: "var(--subject)" }}>
              {course.courseCode}
              {course.term ? ` · ${course.term}` : ""}
            </div>
            <h1>{course.name}</h1>
          </div>
          <CourseControls courseId={course.id} subject={course.subject} hidden={course.hidden} />
        </div>
      </section>

      <div className="grid-2">
        <div className="stack">
          <section className="panel stack">
            <h2>Generate a problem set</h2>
            <GeneratePanel courseId={course.id} exams={outline?.exams ?? []} runningJobId={runningGen?.id} disabled={materials.length === 0} />
          </section>

          <section className="panel stack" style={{ gap: 8 }}>
            <h2>Problem sets</h2>
            {sets.length === 0 ? (
              <p className="muted small">None yet. Generated sets appear here.</p>
            ) : (
              <div className="list">
                {sets.map((s) => {
                  const flagged = Object.values(s.checks ?? {}).filter((c) => c.status === "mismatch").length;
                  return (
                    <Link key={s.id} href={`/set/${s.id}`} className="set-row">
                      <div className="stack" style={{ gap: 2 }}>
                        <span className="set-title">{s.title}</span>
                        <span className="muted small">
                          {KIND_LABEL[s.kind]} · {s.data.problems.length} problems · {s.createdAt.toLocaleDateString()}
                          {s.data.timeLimitMin ? ` · ${s.data.timeLimitMin} min` : ""}
                        </span>
                      </div>
                      <div className="row">
                        {flagged > 0 && <span className="chip warn">{flagged} flagged</span>}
                        <span className="chip">{setProgress(s.id, s.data.problems.length)}</span>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </section>

          {legacy.length > 0 && (
            <section className="panel stack" style={{ gap: 8 }}>
              <h2>Earlier drills</h2>
              <div className="list">
                {legacy.map((d) => (
                  <a key={d.slug} href={`/legacy/${d.slug}`} target="_blank" rel="noreferrer" className="set-row">
                    <span className="set-title">{d.title}</span>
                    <span className="muted small">opens in a new tab ↗</span>
                  </a>
                ))}
              </div>
            </section>
          )}
        </div>

        <div className="stack">
          <section className="panel stack">
            <div className="spread">
              <h2>Topics</h2>
              {outline && <OutlineRebuild courseId={course.id} />}
            </div>
            {!outline ? (
              <p className="muted small">
                {materials.length ? "The topic outline is built after a sync (it needs the Claude API key)." : "Sync this course to build its topic outline."}
              </p>
            ) : (
              <>
                {outline.exams.length > 0 && (
                  <div className="stack" style={{ gap: 6 }}>
                    {outline.exams.map((e) => (
                      <div key={e.name} className="notice small">
                        <b>{e.name}</b>
                        {e.date ? ` · ${e.date}` : ""}
                        {e.unitTitles.length ? <div className="muted">Covers: {e.unitTitles.join(", ")}</div> : null}
                        {e.notes ? <div className="muted">{e.notes}</div> : null}
                      </div>
                    ))}
                  </div>
                )}
                <div>
                  {outline.units.map((u) => (
                    <div key={u.title} className="unit">
                      <h3>{u.title}</h3>
                      <div>
                        {u.topics.map((t) => {
                          const st = topicStats.get(t.name.toLowerCase());
                          return (
                            <div key={t.name} className="topic" title={t.summary}>
                              <span>
                                {t.name}
                                {t.coveredOn && <span className="muted small"> · {t.coveredOn.slice(5)}</span>}
                              </span>
                              {st && (
                                <span className="meter" title={`${st.right}/${st.total} correct`}>
                                  <i style={{ width: `${(100 * st.right) / st.total}%` }} />
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>

          <section className="panel stack" style={{ gap: 10 }}>
            <div className="spread">
              <h2>Materials</h2>
              <span className="muted small">{materials.length}</span>
            </div>
            {course.canvasId > 0 && <SyncButton courseId={course.id} runningJobId={runningSync?.id} label="Sync this course" />}
            {[...byModule.entries()].map(([mod, items]) => (
              <details key={mod}>
                <summary className="small">
                  {mod} <span className="muted">({items.length})</span>
                </summary>
                <ul className="small" style={{ margin: "6px 0 0", paddingLeft: 22 }}>
                  {items.map((m) => (
                    <li key={m.id}>
                      {m.title}
                      {m.pages ? <span className="muted"> · {m.pages}p</span> : null}
                    </li>
                  ))}
                </ul>
              </details>
            ))}
          </section>
        </div>
      </div>
    </div>
  );
}
