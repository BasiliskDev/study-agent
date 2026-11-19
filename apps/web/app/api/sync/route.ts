import { startSync } from "@/lib/actions";

/**
 * POST /api/sync[?courseId=…] starts a Canvas sync and returns { jobId }.
 * For scripts and scheduled syncs (e.g. a cron hitting this hourly); the UI uses the server action directly.
 * Local-only for now: when hosted, this needs the same auth as the rest of the app.
 */
export async function POST(req: Request) {
  const courseId = new URL(req.url).searchParams.get("courseId") ?? undefined;
  const res = await startSync(courseId);
  return Response.json(res, { status: "error" in res ? 400 : 202 });
}
