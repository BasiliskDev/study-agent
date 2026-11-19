/** Turn an FTS query from the model into a safe FTS5 expression: quoted terms, OR'd together. */
export function ftsQuery(q: string): string {
  const terms = q.match(/[\p{L}\p{N}]+/gu)?.slice(0, 12) ?? [];
  return terms.map((t) => `"${t}"`).join(" OR ");
}

/** Pick the "--- page N ---" sections in a page range like "3-10" or "5". */
export function pageRange(text: string, range: string): string {
  const m = range.match(/^\s*(\d+)\s*(?:-\s*(\d+))?\s*$/);
  if (!m) return text;
  const from = Number(m[1]);
  const to = Number(m[2] ?? m[1]);
  return text
    .split(/(?=--- page \d+ ---)/)
    .filter((sec) => {
      const n = Number(sec.match(/--- page (\d+) ---/)?.[1]);
      return n >= from && n <= to;
    })
    .join("");
}
