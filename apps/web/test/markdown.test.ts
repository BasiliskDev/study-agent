import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../lib/markdown";
import { ftsQuery, pageRange } from "../lib/agent/tools.pure";

describe("renderMarkdown", () => {
  it("renders inline and display math", () => {
    const html = renderMarkdown("Find $x_1^2$ then\n\n$$\\int_0^1 f(x)\\,dx$$");
    expect(html).toContain('class="katex"');
    expect(html).toContain('class="katex-display"');
    expect(html).not.toContain("<em>"); // underscores inside math are not emphasis
  });

  it("escapes raw HTML from the model", () => {
    const html = renderMarkdown('Hi <img src=x onerror="alert(1)"> <script>alert(1)</script>');
    expect(html).not.toMatch(/<img|<script/);
    expect(html).toContain("&lt;script&gt;");
  });

  it("leaves dollar signs in code alone", () => {
    const html = renderMarkdown("Run `echo $HOME` and\n\n```bash\nexport A=$B$C\n```");
    expect(html).not.toContain("katex");
    expect(html).toContain("echo $HOME");
  });

  it("does not treat currency as math", () => {
    expect(renderMarkdown("It costs $5 and $10.")).not.toContain("katex");
  });

  it("neutralizes javascript: links", () => {
    expect(renderMarkdown("[x](javascript:alert(1))")).toContain('href="#"');
  });
});

describe("agent tool helpers", () => {
  it("builds a safe FTS query", () => {
    expect(ftsQuery('lagrange "multiplier" OR NEAR(x')).toBe('"lagrange" OR "multiplier" OR "OR" OR "NEAR" OR "x"');
    expect(ftsQuery("!!!")).toBe("");
  });

  it("selects a page range", () => {
    const t = "--- page 1 ---\na\n--- page 2 ---\nb\n--- page 3 ---\nc\n";
    expect(pageRange(t, "2-3")).toBe("--- page 2 ---\nb\n--- page 3 ---\nc\n");
    expect(pageRange(t, "1")).toBe("--- page 1 ---\na\n");
  });
});
