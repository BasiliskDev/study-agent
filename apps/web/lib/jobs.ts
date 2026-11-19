import "server-only";
import { eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { JobEvent } from "@/db/schema";

export type JobLogger = {
  id: string;
  log: (msg: string, level?: JobEvent["level"]) => Promise<void>;
};

/**
 * Start a background job. The work runs in this server process after the request returns;
 * progress is appended to jobs.log and streamed to the browser by /api/jobs/[id]/events.
 * (Hosted, this moves to a durable queue/workflow; the logger interface stays the same.)
 */
export async function startJob(
  init: { userId: string; type: "sync" | "generate"; courseId?: string },
  work: (job: JobLogger) => Promise<{ resultId?: string; usage?: Record<string, number> } | void>,
): Promise<string> {
  const db = await getDb();
  const [row] = await db.insert(schema.jobs).values(init).returning({ id: schema.jobs.id });
  const id = row!.id;

  const log: JobLogger["log"] = async (msg, level = "info") => {
    const ev: JobEvent = { t: Date.now(), level, msg };
    await db
      .update(schema.jobs)
      .set({ log: sql`json_insert(${schema.jobs.log}, '$[#]', json(${JSON.stringify(ev)}))` })
      .where(eq(schema.jobs.id, id));
  };

  void (async () => {
    try {
      const out = (await work({ id, log })) ?? {};
      await log("Done", "done");
      await db
        .update(schema.jobs)
        .set({ status: "succeeded", resultId: out.resultId, usage: out.usage, finishedAt: new Date() })
        .where(eq(schema.jobs.id, id));
    } catch (e) {
      console.error(`[job ${id}]`, e);
      await log((e as Error).message ?? String(e), "error").catch(() => {});
      await db.update(schema.jobs).set({ status: "failed", finishedAt: new Date() }).where(eq(schema.jobs.id, id));
    }
  })();

  return id;
}
