import { readFile } from "node:fs/promises";
import path from "node:path";
import { LEGACY_SLUGS } from "@/lib/legacy";

/** Serves the original standalone drills from /artifacts unchanged. */
export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  if (!LEGACY_SLUGS.has(slug)) return new Response("not found", { status: 404 });
  const html = await readFile(path.join(process.cwd(), "../../artifacts", slug, "index.html"), "utf8");
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
