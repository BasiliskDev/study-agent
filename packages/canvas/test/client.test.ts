import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CanvasClient, htmlToText, nextLink, normalizeBaseUrl } from "../src/index.ts";
import { createCanvasMcpServer } from "../src/mcp.ts";

const BASE = "https://canvas.example.edu";

type Route = (url: URL, init: RequestInit) => Response | undefined;

/** Fake fetch: routes by pathname; records every call with its Authorization header. */
function fakeFetch(routes: Record<string, Route | object>) {
  const calls: { url: string; auth: string | null }[] = [];
  const impl = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const headers = new Headers(init.headers);
    calls.push({ url: url.toString(), auth: headers.get("authorization") });
    const route = routes[url.origin === BASE ? url.pathname : url.toString()];
    if (!route) return new Response(JSON.stringify({ errors: [{ message: "not found" }] }), { status: 404 });
    if (typeof route === "function") return (route as Route)(url, init) ?? new Response("", { status: 404 });
    return Response.json(route);
  }) as typeof fetch;
  return { impl, calls };
}

const client = (f: typeof fetch) => new CanvasClient({ baseUrl: BASE, token: "tok", fetch: f, sleep: async () => {} });

describe("helpers", () => {
  it("normalizes base URLs", () => {
    expect(normalizeBaseUrl("courseworks2.columbia.edu/")).toBe("https://courseworks2.columbia.edu");
    expect(normalizeBaseUrl("https://x.instructure.com/courses/1")).toBe("https://x.instructure.com");
  });

  it("parses Link next", () => {
    const h = `<${BASE}/api/v1/courses?page=1>; rel="current",<${BASE}/api/v1/courses?page=2&per_page=100>; rel="next"`;
    expect(nextLink(h)).toBe(`${BASE}/api/v1/courses?page=2&per_page=100`);
    expect(nextLink(`<${BASE}/x>; rel="last"`)).toBeNull();
  });

  it("converts Canvas HTML with equations to text", () => {
    const html = `<h2>Week 3</h2><p>Gradient &amp; <img class="equation_image" alt="\\nabla f" src="x"></p><ul><li>One</li><li>Two</li></ul>`;
    expect(htmlToText(html)).toBe("## Week 3\nGradient & $\\nabla f$\n\n- One\n- Two");
  });
});

describe("CanvasClient", () => {
  it("follows pagination", async () => {
    const { impl } = fakeFetch({
      "/api/v1/courses": (url) =>
        url.searchParams.get("page") === "2"
          ? Response.json([{ id: 2, name: "B", course_code: "COMS W3134" }])
          : new Response(JSON.stringify([{ id: 1, name: "A", course_code: "APMA E2000" }, { id: 9 }]), {
              headers: { link: `<${BASE}/api/v1/courses?page=2>; rel="next"` },
            }),
    });
    const courses = await client(impl).listCourses();
    expect(courses.map((c) => c.id)).toEqual([1, 2]); // nameless stub (id 9) filtered out
  });

  it("retries on rate limiting", async () => {
    let n = 0;
    const { impl } = fakeFetch({
      "/api/v1/users/self": () =>
        ++n < 3 ? new Response("403 Forbidden (Rate Limit Exceeded)", { status: 403 }) : Response.json({ id: 1, name: "T" }),
    });
    expect((await client(impl).getSelf()).name).toBe("T");
    expect(n).toBe(3);
  });

  it("throws CanvasError with Canvas's message", async () => {
    const { impl } = fakeFetch({
      "/api/v1/users/self": () =>
        new Response(JSON.stringify({ errors: [{ message: "Invalid access token." }] }), { status: 401 }),
    });
    await expect(client(impl).getSelf()).rejects.toThrow(/401.*Invalid access token/);
  });

  it("falls back to module-linked files when the Files tab is hidden", async () => {
    const { impl } = fakeFetch({
      "/api/v1/courses/5/files": () => new Response(JSON.stringify({ status: "unauthorized" }), { status: 401 }),
      "/api/v1/courses/5/modules": [
        {
          id: 1, name: "Week 1", position: 1, unlock_at: null,
          items: [
            { id: 10, module_id: 1, position: 1, title: "Lecture 1", type: "File", content_id: 100 },
            { id: 11, module_id: 1, position: 2, title: "Notes", type: "Page", page_url: "notes" },
          ],
        },
        { id: 2, name: "Week 2", position: 2, unlock_at: null, items_url: "x" }, // items omitted → fetched
      ],
      "/api/v1/courses/5/modules/2/items": [{ id: 20, module_id: 2, position: 1, title: "Lecture 2", type: "File", content_id: 200 }],
      "/api/v1/courses/5/files/100": { id: 100, display_name: "lec1.pdf", filename: "lec1.pdf", "content-type": "application/pdf", size: 10, url: `${BASE}/files/100/download`, updated_at: "" },
      "/api/v1/courses/5/files/200": () => new Response("{}", { status: 401 }), // locked → skipped
    });
    const { files, via } = await client(impl).listFiles(5);
    expect(via).toBe("modules");
    expect(files.map((f) => f.id)).toEqual([100]);
  });

  it("does not send the token to the storage host on download redirect", async () => {
    const S3 = "https://bucket.s3.amazonaws.com/abc?sig=1";
    const { impl, calls } = fakeFetch({
      "/files/100/download": () => new Response(null, { status: 302, headers: { location: S3 } }),
      [S3]: () => new Response(new Uint8Array([1, 2, 3])),
    });
    const bytes = await client(impl).downloadFile({ url: `${BASE}/files/100/download?verifier=x` });
    expect([...bytes]).toEqual([1, 2, 3]);
    expect(calls[0]!.auth).toBe("Bearer tok");
    expect(calls[1]!.auth).toBeNull();
  });

  it("refuses to send the token to another host", async () => {
    const { impl } = fakeFetch({});
    await expect(client(impl).downloadFile({ url: "https://evil.example.com/x" })).rejects.toThrow(/Refusing/);
  });
});

describe("MCP server", () => {
  it("lists tools and answers list_modules over an in-memory transport", async () => {
    const { impl } = fakeFetch({
      "/api/v1/courses/5/modules": [
        {
          id: 1, name: "Week 1: Vectors", position: 1, unlock_at: "2026-09-02T04:00:00Z",
          items: [{ id: 10, module_id: 1, position: 1, title: "Lecture 1", type: "File", content_id: 100 }],
        },
      ],
    });
    const server = createCanvasMcpServer({ client: client(impl) });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    const mcp = new Client({ name: "test", version: "0" });
    await mcp.connect(ct);

    const { tools } = await mcp.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      ["get_file_text", "get_page", "get_syllabus", "list_courses", "list_files", "list_modules"],
    );
    const res = await mcp.callTool({ name: "list_modules", arguments: { courseId: 5 } });
    const out = (res.content as { text: string }[])[0]!.text;
    expect(out).toContain("## Week 1: Vectors (unlocks 2026-09-02)");
    expect(out).toContain("- File: Lecture 1 [fileId=100]");
    await mcp.close();
  });
});
