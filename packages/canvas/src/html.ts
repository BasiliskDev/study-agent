const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…",
  rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", times: "×", deg: "°", plusmn: "±", middot: "·",
};

const tex = (latex: string) => ` $${latex}$ `;

/** Canvas page / syllabus HTML → readable plain text that keeps paragraph, list, table and math structure. */
export function htmlToText(html: string | null | undefined): string {
  if (!html) return "";
  let s = html
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    // Canvas equation images carry the LaTeX in data-equation-content (newer) or alt (older)
    .replace(/<img[^>]*data-equation-content="([^"]*)"[^>]*>/gi, (_m, t: string) => tex(t))
    .replace(/<img[^>]*class="[^"]*equation_image[^"]*"[^>]*alt="([^"]*)"[^>]*>/gi, (_m, t: string) => tex(t))
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<\/(td|th)>/gi, " | ")
    .replace(/<h([1-6])[^>]*>/gi, (_m, n: string) => "\n\n" + "#".repeat(Number(n)) + " ")
    .replace(/<\/(p|div|h[1-6]|tr|table|ul|ol|section|blockquote|pre)>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  s = s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e.startsWith("#")) {
      const code = e[1]?.toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
  return s
    .split("\n")
    .map((l) => l.replace(/[ \t ]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
