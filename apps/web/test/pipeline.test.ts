/**
 * Integration test: fake Canvas over HTTP → sync into a fresh SQLite db → the agent's tools and the
 * in-process Canvas MCP bridge. Everything except the Claude API call itself.
 */
import http from "node:http";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const dataDir = mkdtempSync(path.join(os.tmpdir(), "study-test-"));
process.env.STUDY_DATA_DIR = dataDir;
process.env.DATABASE_URL = `file:${path.join(dataDir, "test.db")}`;
process.env.STUDY_MIGRATIONS_DIR = path.resolve(import.meta.dirname, "../db/migrations");
delete process.env.ANTHROPIC_API_KEY; // outline step must degrade gracefully

/** Minimal valid one-page PDF containing the given lines. */
function pdf(lines: string[]) {
  const content = `BT /F1 14 Tf 72 720 Td 18 TL ${lines.map((l) => `(${l}) Tj T*`).join(" ")} ET`;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offs: number[] = [];
  objs.forEach((o, i) => {
    offs.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const x = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

const LECTURE = pdf(["Lecture 12: Lagrange Multipliers", "Solve grad f = lambda grad g"]);
let server: http.Server;
let base = "";

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url!, base);
    if (url.pathname === "/files/501/download") {
      res.writeHead(302, { location: `${base.replace("localhost", "127.0.0.1")}/signed/501` });
      return res.end();
    }
    if (url.pathname === "/signed/501") {
      if (req.headers.authorization) return res.writeHead(400).end("token leaked");
      return res.writeHead(200, { "content-type": "application/pdf" }).end(LECTURE);
    }
    if (req.headers.authorization !== "Bearer tok") return res.writeHead(401).end("{}");
    const routes: Record<string, unknown> = {
      "/api/v1/courses": [{ id: 11, name: "Calculus IV", course_code: "APMA E2000", term: { name: "Fall 2026" }, syllabus_body: "<p>Midterm 2 covers Lagrange multipliers.</p>" }],
      "/api/v1/courses/11/modules": [
        { id: 1, name: "Week 9", position: 9, unlock_at: "2026-10-27T04:00:00Z", items: [
          { id: 91, module_id: 1, position: 1, title: "Lecture 12", type: "File", content_id: 501 },
          { id: 92, module_id: 1, position: 2, title: "Notes", type: "Page", page_url: "notes" },
        ] },
      ],
      "/api/v1/courses/11/pages": [{ page_id: 1, url: "notes", title: "Week 9 notes", updated_at: "2026-10-27" }],
      "/api/v1/courses/11/pages/notes": { page_id: 1, url: "notes", title: "Week 9 notes", updated_at: "2026-10-27", body: "<p>Extrema of xy on the unit circle.</p>" },
      "/api/v1/courses/11/files": [{ id: 501, display_name: "lecture12.pdf", filename: "lecture12.pdf", "content-type": "application/pdf", size: LECTURE.length, url: `${base}/files/501/download`, updated_at: "2026-10-27" }],
      "/api/v1/courses/11/files/501": { id: 501, display_name: "lecture12.pdf", filename: "lecture12.pdf", "content-type": "application/pdf", size: LECTURE.length, url: `${base}/files/501/download`, updated_at: "2026-10-27" },
      "/api/v1/courses/11": { id: 11, name: "Calculus IV", course_code: "APMA E2000", syllabus_body: "<p>Midterm 2 covers Lagrange multipliers.</p>" },
    };
    const body = routes[url.pathname];
    if (body === undefined) return res.writeHead(404).end("{}");
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(body));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://localhost:${(server.address() as { port: number }).port}`;
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

const events: string[] = [];
const job = { id: "test-job", log: async (msg: string) => void events.push(msg) };

describe("sync → agent tools → MCP bridge", () => {
  let courseId = "";
  let pdfId = "";

  it("syncs a course, its page and PDF", async () => {
    const { getDb, schema } = await import("@/db");
    const { encrypt } = await import("@/lib/crypto");
    const { getUser } = await import("@/lib/user");
    const { syncAll } = await import("@/lib/sync");
    const { eq } = await import("drizzle-orm");

    const db = await getDb();
    const user0 = await getUser();
    await db.update(schema.users).set({ canvasBaseUrl: base, canvasTokenEnc: encrypt("tok") }).where(eq(schema.users.id, user0.id));
    const user = await getUser();

    await syncAll(user, job as never);
    const course = (await db.query.courses.findMany())[0]!;
    courseId = course.id;
    expect(course.subject).toBe("math");
    const mats = await db.query.materials.findMany({ where: eq(schema.materials.courseId, courseId) });
    expect(mats.map((m) => m.kind).sort()).toEqual(["file", "page", "syllabus"]);
    const file = mats.find((m) => m.kind === "file")!;
    pdfId = file.id;
    expect(file.textContent).toContain("Lagrange Multipliers");
    expect(file.moduleName).toBe("Week 9");
    expect(events.some((e) => e.includes("could not build topic outline"))).toBe(true);
  });

  it("agent tools search, read and save", async () => {
    const { makeLocalTools } = await import("@/lib/agent/tools");
    let saved = "";
    const [search, read, save] = makeLocalTools({
      userId: "local", courseId, kind: "custom", prompt: "test", job: job as never, onSaved: (id) => (saved = id),
    });

    const hits = (await search!.run({ query: "lagrange multipliers" })) as string;
    expect(hits).toContain(`id=${pdfId}`);
    expect(hits).toContain("[Lagrange]");

    const text = (await read!.run({ id: pdfId, pages: "1" })) as string;
    expect(text).toContain("# lecture12.pdf (module: Week 9), 1 pages");
    expect(text).toContain("grad f = lambda grad g");
    expect(await read!.run({ id: "nope" })).toMatch(/No material/);

    const reply = await save!.run({
      title: "Lagrange practice",
      topics: ["Lagrange multipliers"],
      problems: [{ id: "p1", topic: "Lagrange multipliers", difficulty: 2, type: "free", prompt: "Maximize $xy$ on $x^2+y^2=1$.", steps: ["$\\nabla(xy)=\\lambda\\nabla(x^2+y^2)$"], answer: "$1/2$" }],
    });
    expect(reply).toMatch(/Saved/);
    expect(saved).not.toBe("");
  });

  it("exposes Canvas MCP tools to the tool runner", async () => {
    const { connectCanvasMcp } = await import("@/lib/agent/canvasMcp");
    const { getUser } = await import("@/lib/user");
    const mcp = await connectCanvasMcp(await getUser());
    try {
      expect(mcp.tools.map((t) => t.name).sort()).toEqual(["get_page", "get_syllabus", "list_modules"]);
      const listModules = mcp.tools.find((t) => t.name === "list_modules")!;
      const out = await listModules.run({ courseId: 11 });
      expect(JSON.stringify(out)).toContain("File: Lecture 12 [fileId=501]");
      const syl = await mcp.tools.find((t) => t.name === "get_syllabus")!.run({ courseId: 11 });
      expect(JSON.stringify(syl)).toContain("Midterm 2 covers Lagrange multipliers.");
    } finally {
      await mcp.close();
    }
  });
});
