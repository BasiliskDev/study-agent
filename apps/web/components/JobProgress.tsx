"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { JobEvent } from "@/db/schema";

type Status = "running" | "succeeded" | "failed";

/**
 * Streams a job's log over SSE. When the job finishes it refreshes the page, or, for a generate
 * job that produced a set, opens it.
 */
export function JobProgress({ jobId, openResult = false, onDone }: { jobId: string; openResult?: boolean; onDone?: () => void }) {
  const router = useRouter();
  const [events, setEvents] = useState<JobEvent[]>([]);
  const [status, setStatus] = useState<Status>("running");
  const logRef = useRef<HTMLDivElement>(null);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    setEvents([]);
    setStatus("running");
    const es = new EventSource(`/api/jobs/${jobId}/events`);
    es.addEventListener("log", (e) => setEvents((prev) => [...prev, JSON.parse((e as MessageEvent).data)]));
    es.addEventListener("end", (e) => {
      const { status, resultId } = JSON.parse((e as MessageEvent).data) as { status: Status; resultId: string | null };
      setStatus(status);
      es.close();
      onDoneRef.current?.();
      if (status === "succeeded" && openResult && resultId) router.push(`/set/${resultId}`);
      else router.refresh();
    });
    es.onerror = () => {
      // The browser reconnects on its own; the server replays from the start, so reset first.
      setEvents([]);
    };
    return () => es.close();
  }, [jobId, openResult, router]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [events]);

  return (
    <div className="stack" style={{ gap: 8 }} aria-live="polite">
      <div className="row small">
        {status === "running" ? <span className="spinner" aria-hidden /> : null}
        <span className={status === "failed" ? "chip bad" : status === "succeeded" ? "chip good" : "chip"}>
          {status === "running" ? "Working" : status === "succeeded" ? "Finished" : "Failed"}
        </span>
        <span className="muted">{events.at(-1)?.msg}</span>
      </div>
      {events.length > 0 && (
        <div className="joblog" ref={logRef}>
          {events.map((ev, i) => (
            <div key={i} className={ev.level}>
              <span className="muted">{new Date(ev.t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>{" "}
              {ev.msg}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
