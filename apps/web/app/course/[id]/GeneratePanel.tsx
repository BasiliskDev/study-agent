"use client";

import { useState, useTransition } from "react";
import type { TopicOutline } from "@study/schema";
import { JobProgress } from "@/components/JobProgress";
import { startGenerate } from "@/lib/actions";

type Mode = "exam_prep" | "auto" | "custom";

export function GeneratePanel({
  courseId,
  exams,
  runningJobId,
  disabled,
}: {
  courseId: string;
  exams: TopicOutline["exams"];
  runningJobId?: string;
  disabled: boolean;
}) {
  const upcoming = exams.find((e) => !e.date || e.date >= new Date().toISOString().slice(0, 10));
  const [mode, setMode] = useState<Mode>(exams.length ? "exam_prep" : "auto");
  const [exam, setExam] = useState(upcoming?.name ?? exams[0]?.name ?? "");
  const [timed, setTimed] = useState(false);
  const [extra, setExtra] = useState("");
  const [prompt, setPrompt] = useState("");
  const [days, setDays] = useState(14);
  const [count, setCount] = useState(12);
  const [jobId, setJobId] = useState<string | null>(runningJobId ?? null);
  const [running, setRunning] = useState(!!runningJobId);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      setError(null);
      const req =
        mode === "auto"
          ? { kind: "auto" as const, days, count }
          : mode === "custom"
            ? { kind: "custom" as const, prompt, count }
            : { kind: "exam_prep" as const, exam, timed, extra: extra.trim() || undefined, count };
      const res = await startGenerate(courseId, req);
      if ("error" in res) setError(res.error);
      else {
        setJobId(res.jobId);
        setRunning(true);
      }
    });
  };

  if (disabled) return <p className="muted small">Sync this course first so the agent has material to work from.</p>;

  return (
    <form onSubmit={submit} className="stack" style={{ gap: 14 }}>
      <div className="tabs" role="tablist">
        {(
          [
            ["exam_prep", "Exam prep"],
            ["auto", "Recent material"],
            ["custom", "Ask for anything"],
          ] as const
        ).map(([m, label]) => (
          <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => setMode(m)}>
            {label}
          </button>
        ))}
      </div>

      {mode === "exam_prep" && (
        <>
          <label>
            Exam
            {exams.length ? (
              <select value={exam} onChange={(e) => setExam(e.target.value)}>
                {exams.map((x) => (
                  <option key={x.name} value={x.name}>
                    {x.name}
                    {x.date ? ` (${x.date})` : ""}
                  </option>
                ))}
              </select>
            ) : (
              <input type="text" value={exam} onChange={(e) => setExam(e.target.value)} placeholder="e.g. Midterm 2" />
            )}
          </label>
          <label>
            Anything to focus on? <span className="hint">Optional</span>
            <input type="text" value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="e.g. heavy on Lagrange multipliers; I'm weak at polar coordinates" />
          </label>
          <label className="row" style={{ display: "flex", fontWeight: 400 }}>
            <input type="checkbox" checked={timed} onChange={(e) => setTimed(e.target.checked)} /> Timed mock exam
          </label>
        </>
      )}

      {mode === "auto" && (
        <label>
          Cover material from the last
          <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={7}>week</option>
            <option value={14}>2 weeks</option>
            <option value={28}>4 weeks</option>
          </select>
        </label>
      )}

      {mode === "custom" && (
        <label>
          What do you want to practice?
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="e.g. Hard triple-integral setup problems in spherical coordinates, like the ones from Lecture 18"
          />
        </label>
      )}

      <div className="spread">
        <label className="row" style={{ display: "flex", fontWeight: 400 }}>
          About
          <input type="number" min={3} max={40} value={count} onChange={(e) => setCount(Number(e.target.value))} style={{ width: 72 }} />
          problems
        </label>
        <button className="btn primary" disabled={pending || running}>
          {running ? "Generating…" : "Generate"}
        </button>
      </div>
      {error && <div className="notice bad">{error}</div>}
      {jobId && <JobProgress jobId={jobId} openResult onDone={() => setRunning(false)} />}
      {!jobId && <p className="muted small">Takes a minute or two. The agent reads your course materials, writes the set, then checks the answers.</p>}
    </form>
  );
}
