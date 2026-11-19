import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getUser } from "@/lib/user";

export const dynamic = "force-dynamic";

/** Server-sent events for a job: one "log" event per log line, then "end" with the final status. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const user = await getUser();
  const db = await getDb();
  const find = () => db.query.jobs.findFirst({ where: and(eq(schema.jobs.id, id), eq(schema.jobs.userId, user.id)) });
  if (!(await find())) return new Response("not found", { status: 404 });

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let sent = 0;
      let closed = false;
      req.signal.addEventListener("abort", () => (closed = true));
      const send = (event: string, data: unknown) => controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      while (!closed) {
        const job = await find();
        if (!job) break;
        for (; sent < job.log.length; sent++) send("log", job.log[sent]);
        if (job.status !== "running") {
          send("end", { status: job.status, resultId: job.resultId });
          break;
        }
        await new Promise((r) => setTimeout(r, 600));
      }
      try {
        controller.close();
      } catch {}
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" },
  });
}
