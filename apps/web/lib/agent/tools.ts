import "server-only";
import { toFile } from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { ProblemSet } from "@study/schema";
import { getDb, schema } from "@/db";
import type { ProblemSetKind } from "@/db/schema";
import { anthropic } from "../anthropic";
import type { JobLogger } from "../jobs";
import { storage } from "../storage";

const TEXT_WINDOW = 40_000;
const MAX_PDF_READS = 4;
const MAX_PDF_PAGES = 80;

import { ftsQuery, pageRange } from "./tools.pure";

export function makeLocalTools(ctx: {
  userId: string;
  courseId: string;
  kind: ProblemSetKind;
  prompt: string;
  job: JobLogger;
  onSaved: (problemSetId: string) => void;
}) {
  let pdfReads = 0;

  const searchMaterials = betaZodTool({
    name: "search_materials",
    description:
      "Full-text search over this course's synced materials (lecture PDFs, pages, syllabus). Returns the best-matching materials with snippets. Use it to find where a topic is taught.",
    inputSchema: z.object({
      query: z.string().describe("Keywords, e.g. 'lagrange multiplier constraint'"),
      limit: z.number().int().min(1).max(20).optional(),
    }),
    run: async ({ query, limit }) => {
      const match = ftsQuery(query);
      if (!match) return "Empty query.";
      const db = await getDb();
      const res = await db.$client.execute({
        sql: `SELECT material_id, title, snippet(materials_fts, 3, '[', ']', ' … ', 24) AS snip
              FROM materials_fts WHERE course_id = ? AND materials_fts MATCH ? ORDER BY rank LIMIT ?`,
        args: [ctx.courseId, match, limit ?? 8],
      });
      await ctx.job.log(`Searched materials for "${query}" (${res.rows.length} hits)`, "tool");
      if (!res.rows.length) return `No matches for "${query}".`;
      return res.rows.map((r) => `- id=${r.material_id} "${r.title}": ${r.snip}`).join("\n");
    },
  });

  const readMaterial = betaZodTool({
    name: "read_material",
    description: `Read one course material by id. Default returns extracted text (cheap; for PDFs, with '--- page N ---' markers; use pages="3-10" to read a range). Set asPdf=true to see the actual PDF pages, including equations, diagrams and tables lost in text extraction; this costs far more, so use it only for the few files that matter most (at most ${MAX_PDF_READS} per run, files up to ${MAX_PDF_PAGES} pages).`,
    inputSchema: z.object({
      id: z.string(),
      pages: z.string().optional().describe('Page range for PDFs, e.g. "4-12"'),
      asPdf: z.boolean().optional(),
    }),
    run: async ({ id, pages, asPdf }) => {
      const db = await getDb();
      const m = await db.query.materials.findFirst({
        where: and(eq(schema.materials.id, id), eq(schema.materials.courseId, ctx.courseId)),
      });
      if (!m) return `No material with id ${id} in this course.`;

      if (asPdf && m.kind === "file" && m.blobKey) {
        if (pdfReads >= MAX_PDF_READS) return `PDF read limit (${MAX_PDF_READS}) reached; use the text version.`;
        if ((m.pages ?? 0) > MAX_PDF_PAGES) return `${m.title} has ${m.pages} pages; too long to send as a PDF. Read a page range as text instead.`;
        pdfReads++;
        let fileId = m.anthropicFileId;
        if (!fileId) {
          const bytes = await storage.get(m.blobKey);
          const up = await anthropic().files.upload({
            file: await toFile(bytes, m.title.endsWith(".pdf") ? m.title : `${m.title}.pdf`, { type: "application/pdf" }),
          });
          fileId = up.id;
          await db.update(schema.materials).set({ anthropicFileId: fileId }).where(eq(schema.materials.id, m.id));
        }
        await ctx.job.log(`Reading PDF: ${m.title}`, "tool");
        return [
          { type: "document" as const, source: { type: "file" as const, file_id: fileId }, title: m.title },
          { type: "text" as const, text: `Above: "${m.title}" (material id ${m.id}).` },
        ];
      }

      let text = m.textContent ?? "";
      if (pages && m.kind === "file") text = pageRange(text, pages);
      await ctx.job.log(`Reading: ${m.title}${pages ? ` (pages ${pages})` : ""}`, "tool");
      if (!text.trim()) return `"${m.title}" has no extractable text${m.kind === "file" ? "; try asPdf=true" : ""}.`;
      const head = `# ${m.title}${m.moduleName ? ` (module: ${m.moduleName})` : ""}${m.pages ? `, ${m.pages} pages` : ""}\n\n`;
      return text.length > TEXT_WINDOW
        ? `${head}${text.slice(0, TEXT_WINDOW)}\n\n[truncated at ${TEXT_WINDOW} of ${text.length} chars; request a page range to read further]`
        : head + text;
    },
  });

  const saveProblemSet = betaZodTool({
    name: "save_problem_set",
    description:
      "Save the finished problem set. Call this exactly once, at the end, with the complete set. The input is validated; if it is rejected, fix the reported problems and call again.",
    inputSchema: ProblemSet,
    run: async (set) => {
      const db = await getDb();
      const [row] = await db
        .insert(schema.problemSets)
        .values({ courseId: ctx.courseId, title: set.title, prompt: ctx.prompt, kind: ctx.kind, data: set, jobId: ctx.job.id })
        .returning({ id: schema.problemSets.id });
      ctx.onSaved(row!.id);
      await ctx.job.log(`Saved "${set.title}" (${set.problems.length} problems)`, "tool");
      return "Saved. The run is complete; reply with one short sentence and stop.";
    },
  });

  return [searchMaterials, readMaterial, saveProblemSet] as const;
}
