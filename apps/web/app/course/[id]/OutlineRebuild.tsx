"use client";

import { useState, useTransition } from "react";
import { JobProgress } from "@/components/JobProgress";
import { rebuildOutline } from "@/lib/actions";

export function OutlineRebuild({ courseId }: { courseId: string }) {
  const [jobId, setJobId] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <>
      <button
        className="btn ghost sm"
        disabled={pending || !!jobId}
        onClick={() =>
          start(async () => {
            const res = await rebuildOutline(courseId);
            if ("jobId" in res) setJobId(res.jobId);
          })
        }
      >
        Rebuild
      </button>
      {jobId && (
        <div style={{ flexBasis: "100%" }}>
          <JobProgress jobId={jobId} onDone={() => setJobId(null)} />
        </div>
      )}
    </>
  );
}
