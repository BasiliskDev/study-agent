import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CanvasClient, CanvasError, type CanvasClientOptions } from "./client.ts";
import { htmlToText } from "./html.ts";
import { pdfToText } from "./pdf.ts";

const MAX_CHARS = 60_000;

function text(s: string) {
  return { content: [{ type: "text" as const, text: s }] };
}

/** Return a window of a long text, with a note telling the model how to read on. */
function windowed(s: string, offset = 0, max = MAX_CHARS): string {
  const slice = s.slice(offset, offset + max);
  const end = offset + slice.length;
  return end < s.length
    ? `${slice}\n\n[truncated: showing chars ${offset}-${end} of ${s.length}; call again with offset=${end} for more]`
    : slice;
}

async function guarded(fn: () => Promise<string>) {
  try {
    return text(await fn());
  } catch (e) {
    const msg = e instanceof CanvasError ? e.message : `Error: ${(e as Error).message}`;
    return { ...text(msg), isError: true };
  }
}

/**
 * A read-only Canvas MCP server for one user. The same server runs over stdio for Claude Code/Desktop
 * (see bin.ts), in-process for the web app's agent, and later over Streamable HTTP when hosted.
 */
export function createCanvasMcpServer(opts: CanvasClientOptions | { client: CanvasClient }): McpServer {
  const canvas = "client" in opts ? opts.client : new CanvasClient(opts);
  const server = new McpServer({ name: "canvas", version: "0.1.0" });
  const ro = { readOnlyHint: true, openWorldHint: true } as const;
  const courseId = z.number().int().describe("Canvas course id from list_courses");

  server.registerTool(
    "list_courses",
    {
      title: "List courses",
      description: "List the student's active Canvas courses with id, name, course code and term.",
      inputSchema: {},
      annotations: ro,
    },
    () =>
      guarded(async () => {
        const courses = await canvas.listCourses();
        return JSON.stringify(
          courses.map((c) => ({ id: c.id, name: c.name, course_code: c.course_code, term: c.term?.name ?? null })),
          null,
          1,
        );
      }),
  );

  server.registerTool(
    "get_syllabus",
    {
      title: "Get syllabus",
      description: "Get a course's syllabus page as plain text (schedule, topics, exam dates, grading).",
      inputSchema: { courseId },
      annotations: ro,
    },
    ({ courseId }) =>
      guarded(async () => {
        const c = await canvas.getCourse(courseId);
        const body = htmlToText(c.syllabus_body);
        return body ? windowed(`# ${c.name} syllabus\n\n${body}`) : "This course has no syllabus page in Canvas.";
      }),
  );

  server.registerTool(
    "list_modules",
    {
      title: "List modules",
      description:
        "List a course's modules in order with their items (pages, files, assignments). Shows what has been covered and when. File items include a fileId for get_file_text; page items include a pageUrl for get_page.",
      inputSchema: { courseId },
      annotations: ro,
    },
    ({ courseId }) =>
      guarded(async () => {
        const modules = await canvas.listModules(courseId);
        if (!modules.length) return "This course has no modules.";
        return modules
          .map((m) => {
            const head = `## ${m.name}${m.unlock_at ? ` (unlocks ${m.unlock_at.slice(0, 10)})` : ""}`;
            const items = (m.items ?? []).map((it) => {
              const ref =
                it.type === "File" ? ` [fileId=${it.content_id}]` : it.type === "Page" ? ` [pageUrl=${it.page_url}]` : "";
              const due = it.content_details?.due_at ? ` (due ${it.content_details.due_at.slice(0, 10)})` : "";
              return it.type === "SubHeader" ? `  ### ${it.title}` : `  - ${it.type}: ${it.title}${ref}${due}`;
            });
            return [head, ...items].join("\n");
          })
          .join("\n\n");
      }),
  );

  server.registerTool(
    "get_page",
    {
      title: "Get page",
      description: "Get the text of a Canvas wiki page by its pageUrl (from list_modules).",
      inputSchema: { courseId, pageUrl: z.string(), offset: z.number().int().min(0).optional() },
      annotations: ro,
    },
    ({ courseId, pageUrl, offset }) =>
      guarded(async () => {
        const p = await canvas.getPage(courseId, pageUrl);
        return windowed(`# ${p.title}\n\n${htmlToText(p.body)}`, offset);
      }),
  );

  server.registerTool(
    "list_files",
    {
      title: "List files",
      description:
        "List the files in a course (lecture slides, notes, practice exams) with id, name, type and size. Falls back to files linked from modules when the Files tab is hidden.",
      inputSchema: { courseId },
      annotations: ro,
    },
    ({ courseId }) =>
      guarded(async () => {
        const { files, via } = await canvas.listFiles(courseId);
        const rows = files.map((f) => ({
          id: f.id,
          name: f.display_name,
          type: f["content-type"],
          kb: Math.round(f.size / 1024),
          updated: f.updated_at?.slice(0, 10),
        }));
        return `${via === "modules" ? "(Files tab hidden; listing files linked from modules)\n" : ""}${JSON.stringify(rows, null, 1)}`;
      }),
  );

  server.registerTool(
    "get_file_text",
    {
      title: "Get file text",
      description:
        "Download a PDF from the course and return its extracted text, one '--- page N ---' header per page. Long files are returned in windows; pass offset to continue.",
      inputSchema: { courseId, fileId: z.number().int(), offset: z.number().int().min(0).optional() },
      annotations: ro,
    },
    ({ courseId, fileId, offset }) =>
      guarded(async () => {
        const f = await canvas.getFile(courseId, fileId);
        if (!/pdf/i.test(f["content-type"]) && !/\.pdf$/i.test(f.filename)) {
          return `"${f.display_name}" is ${f["content-type"]}; only PDFs can be read as text.`;
        }
        if (f.size > 50 * 1024 * 1024) return `"${f.display_name}" is larger than 50 MB; skipping.`;
        const { text: body, pages } = await pdfToText(await canvas.downloadFile(f));
        return windowed(`# ${f.display_name} (${pages} pages)\n\n${body}`, offset);
      }),
  );

  return server;
}
