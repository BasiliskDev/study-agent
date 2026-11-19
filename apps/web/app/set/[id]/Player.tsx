"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Problem, ProblemCheck, ProblemSet } from "@study/schema";
import { Md } from "@/components/Md";
import { recordAttempt } from "@/lib/actions";

type Results = Record<string, boolean>;
const KEYS = "ABCDEF";

function CheckFlag({ check }: { check?: ProblemCheck }) {
  if (check?.status !== "mismatch") return null;
  return (
    <div className="notice warn small">
      <b>Answer check disagreed.</b> An independent re-solve got a different answer, so treat this key with suspicion.
      {check.note ? <div style={{ marginTop: 4 }}>{check.note}</div> : null}
    </div>
  );
}

function Meta({ p }: { p: Problem }) {
  return (
    <div className="row small muted">
      <span className="chip">{p.topic}</span>
      <span title="difficulty">{"●".repeat(p.difficulty)}{"○".repeat(3 - p.difficulty)}</span>
      {p.source && <span>· {p.source}</span>}
    </div>
  );
}

/* ---------------- practice: one problem at a time ---------------- */

function PracticeCard({ p, check, onResult }: { p: Problem; check?: ProblemCheck; onResult: (correct: boolean) => void }) {
  const [picked, setPicked] = useState<number | null>(null);
  const [hint, setHint] = useState(false);
  const [steps, setSteps] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [graded, setGraded] = useState<boolean | null>(null);

  const grade = (ok: boolean) => {
    if (graded !== null) return;
    setGraded(ok);
    onResult(ok);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input,textarea,select")) return;
      if (p.type === "mc" && picked === null) {
        const i = KEYS.indexOf(e.key.toUpperCase());
        const n = Number(e.key) - 1;
        const choice = i >= 0 ? i : n;
        if (choice >= 0 && choice < p.options.length) {
          setPicked(choice);
          grade(choice === p.correctIndex);
        }
      }
      if (p.type === "flashcard" && e.key === " ") {
        e.preventDefault();
        setFlipped((f) => !f);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (p.type === "mc") {
    const done = picked !== null;
    return (
      <div className="stage">
        <Meta p={p} />
        <Md src={p.prompt} className="q" />
        <div className="options">
          {p.options.map((o, i) => (
            <button
              key={i}
              className={`option ${done && i === p.correctIndex ? "right" : ""} ${done && i === picked && i !== p.correctIndex ? "wrong" : ""}`}
              disabled={done}
              onClick={() => {
                setPicked(i);
                grade(i === p.correctIndex);
              }}
            >
              <span className="key">{KEYS[i]}</span>
              <Md src={o} />
            </button>
          ))}
        </div>
        {done && (
          <div className={`reveal ${picked === p.correctIndex ? "good" : "bad"}`}>
            <b>{picked === p.correctIndex ? "Correct." : `Not quite. The answer is ${KEYS[p.correctIndex]}.`}</b>
            <Md src={p.explanation} />
          </div>
        )}
        <CheckFlag check={check} />
      </div>
    );
  }

  if (p.type === "flashcard") {
    return (
      <div className="stage">
        <Meta p={p} />
        <button className="flash" onClick={() => setFlipped((f) => !f)} aria-label={flipped ? "Show front" : "Show back"}>
          <Md src={flipped ? p.back : p.front} />
        </button>
        {flipped ? (
          graded === null ? (
            <div className="row">
              <button className="btn" onClick={() => grade(true)}>
                Knew it
              </button>
              <button className="btn" onClick={() => grade(false)}>
                Didn&apos;t know it
              </button>
            </div>
          ) : null
        ) : (
          <p className="muted small">Click the card or press space to flip.</p>
        )}
      </div>
    );
  }

  const all = steps >= p.steps.length;
  return (
    <div className="stage">
      <Meta p={p} />
      <Md src={p.prompt} className="q" />
      <p className="muted small">Work it out on paper, then check yourself.</p>
      {hint && p.hint && (
        <div className="reveal">
          <b>Hint</b>
          <Md src={p.hint} />
        </div>
      )}
      {steps > 0 && (
        <div className="reveal">
          <b>Solution</b>
          <ol className="steps">
            {p.steps.slice(0, steps).map((s, i) => (
              <li key={i}>
                <Md src={s} />
              </li>
            ))}
          </ol>
          {all && (
            <div className="answer">
              <span className="eyebrow">Answer</span>
              <Md src={p.answer} />
            </div>
          )}
        </div>
      )}
      <div className="row">
        {p.hint && !hint && steps === 0 && (
          <button className="btn" onClick={() => setHint(true)}>
            Hint
          </button>
        )}
        {!all && (
          <>
            <button className="btn" onClick={() => setSteps((s) => s + 1)}>
              {steps === 0 ? "First step" : "Next step"}
            </button>
            <button className="btn" onClick={() => setSteps(p.steps.length)}>
              Show solution
            </button>
          </>
        )}
        {all && graded === null && (
          <>
            <button className="btn" onClick={() => grade(true)}>
              I got it
            </button>
            <button className="btn" onClick={() => grade(false)}>
              I missed it
            </button>
          </>
        )}
      </div>
      <CheckFlag check={check} />
    </div>
  );
}

function Practice({
  set,
  checks,
  results,
  onResult,
}: {
  set: ProblemSet;
  checks: Record<string, ProblemCheck>;
  results: Results;
  onResult: (id: string, ok: boolean) => void;
}) {
  const [topic, setTopic] = useState<string | null>(null);
  const [missedOnly, setMissedOnly] = useState(false);
  const pool = useMemo(
    () => set.problems.filter((p) => (!topic || p.topic === topic) && (!missedOnly || results[p.id] === false)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [set, topic, missedOnly],
  );
  const [idx, setIdx] = useState(0);
  const [round, setRound] = useState(0); // remounts the card so a retried problem starts fresh
  const p = pool[Math.min(idx, pool.length - 1)];
  const go = useCallback((d: number) => setIdx((i) => Math.max(0, Math.min(pool.length - 1, i + d))), [pool.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input,textarea,select")) return;
      if (e.key === "ArrowRight") go(1);
      if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);

  const topics = [...new Set(set.problems.map((q) => q.topic))];
  const missed = set.problems.filter((q) => results[q.id] === false).length;

  return (
    <div className="player">
      {topics.length > 1 && (
        <div className="row">
          <button className={`chip ${!topic ? "on" : ""}`} onClick={() => (setTopic(null), setIdx(0))}>
            All topics
          </button>
          {topics.map((t) => (
            <button key={t} className={`chip ${topic === t ? "on" : ""}`} onClick={() => (setTopic(t), setIdx(0))}>
              {t}
            </button>
          ))}
        </div>
      )}
      <div className="panel stack">
        <div className="spread">
          <div className="dots" aria-label="Progress">
            {pool.map((q, i) => (
              <button
                key={q.id}
                aria-label={`Problem ${i + 1}`}
                className={`${q === p ? "cur" : ""} ${results[q.id] === true ? "ok" : results[q.id] === false ? "miss" : ""}`}
                onClick={() => setIdx(i)}
              />
            ))}
          </div>
          <span className="muted small mono">
            {pool.length ? Math.min(idx, pool.length - 1) + 1 : 0} / {pool.length}
          </span>
        </div>
        {p ? (
          <PracticeCard key={`${p.id}:${round}`} p={p} check={checks[p.id]} onResult={(ok) => onResult(p.id, ok)} />
        ) : (
          <p className="muted">Nothing here. {missedOnly ? "No missed problems left." : ""}</p>
        )}
        <div className="spread">
          <button className="btn" onClick={() => go(-1)} disabled={idx === 0}>
            ← Previous
          </button>
          <div className="row">
            {missed > 0 && (
              <button
                className={`btn ghost sm ${missedOnly ? "on" : ""}`}
                onClick={() => {
                  setMissedOnly((m) => !m);
                  setIdx(0);
                  setRound((r) => r + 1);
                }}
              >
                {missedOnly ? "Show all" : `Retry ${missed} missed`}
              </button>
            )}
          </div>
          <button className="btn primary" onClick={() => go(1)} disabled={idx >= pool.length - 1}>
            Next →
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- mock exam ---------------- */

function Exam({ set, checks, onResult }: { set: ProblemSet; checks: Record<string, ProblemCheck>; onResult: (id: string, ok: boolean) => void }) {
  const problems = set.problems.filter((p) => p.type !== "flashcard");
  const defaultMin = set.timeLimitMin ?? Math.max(10, problems.length * 4);
  const [minutes, setMinutes] = useState(defaultMin);
  const [phase, setPhase] = useState<"intro" | "running" | "review">("intro");
  const [endsAt, setEndsAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [picks, setPicks] = useState<Record<string, number>>({});
  const [selfGrade, setSelfGrade] = useState<Results>({});

  useEffect(() => {
    if (phase !== "running") return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [phase]);

  const submit = useCallback(() => {
    setPhase("review");
    for (const p of problems) if (p.type === "mc") onResult(p.id, picks[p.id] === p.correctIndex);
  }, [problems, picks, onResult]);

  const left = Math.max(0, endsAt - now);
  useEffect(() => {
    if (phase === "running" && left === 0) submit();
  }, [phase, left, submit]);

  if (!problems.length) return <div className="panel muted">This set has only flashcards.</div>;

  if (phase === "intro") {
    return (
      <div className="panel stack">
        <h2>Mock exam</h2>
        <p className="muted">
          {problems.length} problems, all on one page with the clock running. Multiple choice is graded automatically; for worked problems you
          compare against the solution and grade yourself.
        </p>
        <label style={{ maxWidth: 220 }}>
          Time limit (minutes)
          <input type="number" min={1} max={300} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} />
        </label>
        <div>
          <button
            className="btn primary"
            onClick={() => {
              setEndsAt(Date.now() + minutes * 60_000);
              setNow(Date.now());
              setPicks({});
              setSelfGrade({});
              setPhase("running");
            }}
          >
            Start exam
          </button>
        </div>
      </div>
    );
  }

  const mm = Math.floor(left / 60000);
  const ss = Math.floor((left % 60000) / 1000);
  const mcRight = problems.filter((p) => p.type === "mc" && picks[p.id] === p.correctIndex).length;
  const freeRight = Object.values(selfGrade).filter(Boolean).length;
  const freeTotal = problems.filter((p) => p.type === "free").length;

  return (
    <div className="panel stack">
      <div className="spread" style={{ position: "sticky", top: 0, background: "var(--panel)", zIndex: 1, padding: "4px 0" }}>
        {phase === "running" ? (
          <>
            <span className={`timer ${left < 5 * 60_000 ? "low" : ""}`}>
              {mm}:{String(ss).padStart(2, "0")}
            </span>
            <button className="btn primary" onClick={submit}>
              Submit
            </button>
          </>
        ) : (
          <>
            <div className="row" style={{ alignItems: "baseline" }}>
              <span className="score">
                {mcRight + freeRight}/{problems.length}
              </span>
              <span className="muted small">
                {freeTotal - Object.keys(selfGrade).length > 0 ? `grade ${freeTotal - Object.keys(selfGrade).length} worked problems below` : "final"}
              </span>
            </div>
            <button className="btn" onClick={() => setPhase("intro")}>
              Retake
            </button>
          </>
        )}
      </div>
      {problems.map((p, n) => (
        <div key={p.id} className="exam-q">
          <div className="row">
            <b className="mono">{n + 1}.</b>
            <Meta p={p} />
          </div>
          <Md src={p.prompt} className="q" />
          {p.type === "mc" && (
            <div className="options">
              {p.options.map((o, i) => {
                const review = phase === "review";
                const cls = review
                  ? i === p.correctIndex
                    ? "right"
                    : i === picks[p.id]
                      ? "wrong"
                      : ""
                  : i === picks[p.id]
                    ? "picked"
                    : "";
                return (
                  <button key={i} className={`option ${cls}`} disabled={review} onClick={() => setPicks((s) => ({ ...s, [p.id]: i }))}>
                    <span className="key">{KEYS[i]}</span>
                    <Md src={o} />
                  </button>
                );
              })}
            </div>
          )}
          {phase === "review" && p.type === "mc" && <Md src={p.explanation} className="muted" />}
          {phase === "review" && p.type === "free" && (
            <div className="reveal">
              <ol className="steps">
                {p.steps.map((s, i) => (
                  <li key={i}>
                    <Md src={s} />
                  </li>
                ))}
              </ol>
              <div className="answer">
                <span className="eyebrow">Answer</span>
                <Md src={p.answer} />
              </div>
              {selfGrade[p.id] === undefined ? (
                <div className="row">
                  <button className="btn sm" onClick={() => (setSelfGrade((s) => ({ ...s, [p.id]: true })), onResult(p.id, true))}>
                    I got it
                  </button>
                  <button className="btn sm" onClick={() => (setSelfGrade((s) => ({ ...s, [p.id]: false })), onResult(p.id, false))}>
                    I missed it
                  </button>
                </div>
              ) : (
                <span className={`chip ${selfGrade[p.id] ? "good" : "bad"}`}>{selfGrade[p.id] ? "Got it" : "Missed"}</span>
              )}
            </div>
          )}
          {phase === "review" && <CheckFlag check={checks[p.id]} />}
        </div>
      ))}
    </div>
  );
}

/* ---------------- shell ---------------- */

export function Player({
  setId,
  set,
  checks,
  initialResults,
}: {
  setId: string;
  set: ProblemSet;
  checks: Record<string, ProblemCheck>;
  initialResults: Results;
}) {
  const [mode, setMode] = useState<"practice" | "exam">(set.timeLimitMin ? "exam" : "practice");
  const [results, setResults] = useState<Results>(initialResults);
  const onResult = useCallback(
    (id: string, ok: boolean) => {
      setResults((r) => ({ ...r, [id]: ok }));
      void recordAttempt(setId, id, ok);
    },
    [setId],
  );
  const answered = Object.keys(results).length;
  const right = Object.values(results).filter(Boolean).length;

  return (
    <div className="stack">
      <div className="spread">
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={mode === "practice"} onClick={() => setMode("practice")}>
            Practice
          </button>
          <button role="tab" aria-selected={mode === "exam"} onClick={() => setMode("exam")}>
            Mock exam
          </button>
        </div>
        <span className="muted small">
          {answered ? `${right} of ${answered} answered correctly` : `${set.problems.length} problems`}
        </span>
      </div>
      {mode === "practice" ? (
        <Practice set={set} checks={checks} results={results} onResult={onResult} />
      ) : (
        <Exam set={set} checks={checks} onResult={onResult} />
      )}
    </div>
  );
}
