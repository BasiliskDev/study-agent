import type { CanvasCourse, CanvasFile, CanvasModule, CanvasModuleItem, CanvasPage } from "./types.ts";

export class CanvasError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly path: string,
  ) {
    super(message);
    this.name = "CanvasError";
  }
  /** Canvas answers 401 (not 403) when a tab such as Files is hidden from students. */
  get isForbidden() {
    return this.status === 401 || this.status === 403;
  }
}

export interface CanvasClientOptions {
  /** Your institution's Canvas URL, e.g. https://courseworks2.columbia.edu */
  baseUrl: string;
  /** Personal access token from Canvas → Account → Settings → New access token */
  token: string;
  fetch?: typeof fetch;
  /** Max retries on rate limiting (Canvas returns 403 "Rate Limit Exceeded" or 429). */
  maxRetries?: number;
  /** Override for tests. */
  sleep?: (ms: number) => Promise<void>;
}

export function normalizeBaseUrl(raw: string): string {
  let url = raw.trim();
  if (!/^https?:\/\//i.test(url)) url = "https://" + url;
  const u = new URL(url);
  return u.origin;
}

/** Parse an RFC 5988 Link header and return the rel="next" URL, if any. */
export function nextLink(header: string | null): string | null {
  if (!header) return null;
  for (const part of header.split(",")) {
    const m = part.match(/<([^>]+)>\s*;\s*rel="?next"?/);
    if (m) return m[1]!;
  }
  return null;
}

export class CanvasClient {
  readonly baseUrl: string;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;
  private readonly maxRetries: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(opts: CanvasClientOptions) {
    this.baseUrl = normalizeBaseUrl(opts.baseUrl);
    this.token = opts.token;
    this.fetchImpl = opts.fetch ?? fetch;
    this.maxRetries = opts.maxRetries ?? 4;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  private url(path: string, query?: Record<string, string | string[] | number | undefined>): string {
    const u = new URL(path.startsWith("http") ? path : `${this.baseUrl}/api/v1${path}`);
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v === undefined) continue;
      if (Array.isArray(v)) for (const x of v) u.searchParams.append(k, x);
      else u.searchParams.set(k, String(v));
    }
    return u.toString();
  }

  private async request(url: string, init: RequestInit = {}): Promise<Response> {
    // Only ever send the token to the Canvas host itself.
    if (new URL(url).origin !== this.baseUrl) throw new Error(`Refusing to send Canvas token to ${new URL(url).origin}`);
    for (let attempt = 0; ; attempt++) {
      const res = await this.fetchImpl(url, {
        ...init,
        headers: { Authorization: `Bearer ${this.token}`, Accept: "application/json", ...init.headers },
      });
      if (res.ok || (res.status >= 300 && res.status < 400)) return res;
      const body = await res.text();
      const rateLimited = res.status === 429 || (res.status === 403 && /rate limit/i.test(body));
      if (rateLimited && attempt < this.maxRetries) {
        await this.sleep(500 * 2 ** attempt);
        continue;
      }
      const path = new URL(url).pathname;
      let msg = body.slice(0, 300);
      try {
        const j = JSON.parse(body) as { errors?: { message?: string }[]; message?: string };
        msg = j.errors?.[0]?.message ?? j.message ?? msg;
      } catch {}
      throw new CanvasError(`Canvas ${res.status} on ${path}: ${msg}`, res.status, path);
    }
  }

  async get<T>(path: string, query?: Record<string, string | string[] | number | undefined>): Promise<T> {
    const res = await this.request(this.url(path, query));
    return (await res.json()) as T;
  }

  /** GET every page of a list endpoint, following Link rel="next". */
  async list<T>(path: string, query?: Record<string, string | string[] | number | undefined>): Promise<T[]> {
    const out: T[] = [];
    let url: string | null = this.url(path, { per_page: 100, ...query });
    for (let guard = 0; url && guard < 200; guard++) {
      const res = await this.request(url);
      out.push(...((await res.json()) as T[]));
      url = nextLink(res.headers.get("link"));
    }
    return out;
  }

  // ---- endpoints ----

  getSelf() {
    return this.get<{ id: number; name: string }>("/users/self");
  }

  /** Courses the user is actively enrolled in, with term and syllabus. */
  async listCourses(): Promise<CanvasCourse[]> {
    const courses = await this.list<CanvasCourse>("/courses", {
      enrollment_state: "active",
      "include[]": ["term", "syllabus_body"],
    });
    // Restricted/concluded enrollments come back as stubs without a name.
    return courses.filter((c) => c.name && c.workflow_state !== "deleted");
  }

  getCourse(courseId: number) {
    return this.get<CanvasCourse>(`/courses/${courseId}`, { "include[]": ["term", "syllabus_body"] });
  }

  /** Modules with their items. Canvas omits inline items for large modules, so those are fetched separately. */
  async listModules(courseId: number): Promise<CanvasModule[]> {
    const modules = await this.list<CanvasModule>(`/courses/${courseId}/modules`, {
      "include[]": ["items", "content_details"],
    });
    for (const m of modules) {
      if (!m.items) {
        m.items = await this.list<CanvasModuleItem>(`/courses/${courseId}/modules/${m.id}/items`, {
          "include[]": ["content_details"],
        });
      }
    }
    return modules.sort((a, b) => a.position - b.position);
  }

  listPages(courseId: number) {
    return this.list<CanvasPage>(`/courses/${courseId}/pages`, { published: "true", sort: "created_at" });
  }

  getPage(courseId: number, pageUrl: string) {
    return this.get<CanvasPage>(`/courses/${courseId}/pages/${encodeURIComponent(pageUrl)}`);
  }

  getFile(courseId: number, fileId: number) {
    return this.get<CanvasFile>(`/courses/${courseId}/files/${fileId}`);
  }

  /**
   * All files visible to the student. When the Files tab is hidden (401), fall back to the files
   * linked from modules, which students can still open.
   */
  async listFiles(courseId: number): Promise<{ files: CanvasFile[]; via: "files" | "modules" }> {
    try {
      const files = await this.list<CanvasFile>(`/courses/${courseId}/files`, { sort: "created_at" });
      return { files: files.filter((f) => !f.hidden_for_user), via: "files" };
    } catch (e) {
      if (!(e instanceof CanvasError && e.isForbidden)) throw e;
    }
    const modules = await this.listModules(courseId);
    const ids = new Set<number>();
    for (const m of modules) for (const it of m.items ?? []) if (it.type === "File" && it.content_id) ids.add(it.content_id);
    const files: CanvasFile[] = [];
    for (const id of ids) {
      try {
        files.push(await this.getFile(courseId, id));
      } catch (e) {
        if (!(e instanceof CanvasError && e.isForbidden)) throw e; // locked file: skip
      }
    }
    return { files, via: "modules" };
  }

  /**
   * Download a file's bytes. Canvas redirects to a signed storage URL on another host;
   * the token is only sent on the first hop.
   */
  async downloadFile(file: Pick<CanvasFile, "url">): Promise<Uint8Array> {
    let res = await this.request(file.url, { redirect: "manual" });
    for (let hops = 0; res.status >= 300 && res.status < 400 && hops < 5; hops++) {
      const loc = res.headers.get("location");
      if (!loc) break;
      const next = new URL(loc, file.url).toString();
      res =
        new URL(next).origin === this.baseUrl
          ? await this.request(next, { redirect: "manual" })
          : await this.fetchImpl(next, { redirect: "follow" });
    }
    if (!res.ok) throw new CanvasError(`Download failed (${res.status})`, res.status, new URL(file.url).pathname);
    return new Uint8Array(await res.arrayBuffer());
  }
}
