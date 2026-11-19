"use client";

import { useState, useTransition } from "react";
import { startSync } from "@/lib/actions";
import { JobProgress } from "./JobProgress";

export function SyncButton({
  courseId,
  runningJobId,
  label = "Sync with Canvas",
}: {
  courseId?: string;
  runningJobId?: string | null;
  label?: string;
}) {
  const [jobId, setJobId] = useState<string | null>(runningJobId ?? null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [running, setRunning] = useState(!!runningJobId);

  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="row">
        <button
          className="btn"
          disabled={pending || running}
          onClick={() =>
            start(async () => {
              setError(null);
              const res = await startSync(courseId);
              if ("error" in res) setError(res.error);
              else {
                setJobId(res.jobId);
                setRunning(true);
              }
            })
          }
        >
          {running ? "Syncing…" : label}
        </button>
      </div>
      {error && <div className="notice bad">{error}</div>}
      {jobId && <JobProgress jobId={jobId} onDone={() => setRunning(false)} />}
    </div>
  );
}
