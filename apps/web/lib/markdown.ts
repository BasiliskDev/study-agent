import katex from "katex";
import { Marked } from "marked";

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const marked = new Marked({
  gfm: true,
  breaks: false,
  renderer: {
    // Model output is untrusted: any raw HTML is shown as text, never rendered.
    html({ text }) {
      return escapeHtml(text);
    },
    link({ href, text }) {
      const safe = /^https?:\/\//i.test(href) ? href : "#";
      return `<a href="${escapeHtml(safe)}" target="_blank" rel="noopener noreferrer">${escapeHtml(text)}</a>`;
    },
    image({ text }) {
      return escapeHtml(text);
    },
  },
});

function tex(src: string, display: boolean): string {
  try {
    return katex.renderToString(src, { displayMode: display, throwOnError: false, strict: "ignore", trust: false, output: "html" });
  } catch {
    return escapeHtml(src);
  }
}

/**
 * Markdown with $inline$ / $$display$$ (and \( \) / \[ \]) LaTeX → HTML string.
 * Code spans and fences are protected first so "$" in code is left alone; math is swapped for
 * placeholders before Markdown parsing so "_" and "*" inside formulas aren't treated as emphasis.
 */
export function renderMarkdown(src: string, opts: { inline?: boolean } = {}): string {
  // Code is set aside verbatim and put back before Markdown parsing, so marked still formats it.
  const code: string[] = [];
  const holdCode = (m: string) => `\u0001${code.push(m) - 1}\u0001`;
  // Rendered math is set aside until after Markdown parsing.
  const stash: string[] = [];
  const hold = (html: string) => `\u0000${stash.push(html) - 1}\u0000`;

  let s = src
    .replace(/(^|\n)(```|~~~)[^\n]*\n[\s\S]*?\n\2(?=\n|$)/g, holdCode)
    .replace(/`[^`\n]+`/g, holdCode);

  s = s
    .replace(/\$\$([\s\S]+?)\$\$/g, (_m, t: string) => hold(tex(t.trim(), true)))
    .replace(/\\\[([\s\S]+?)\\\]/g, (_m, t: string) => hold(tex(t.trim(), true)))
    .replace(/\\\(([\s\S]+?)\\\)/g, (_m, t: string) => hold(tex(t.trim(), false)))
    // $...$ inline: not "$5 and $10" (no space just inside the delimiters, no digit right after the closing $)
    .replace(/(^|[^\\$])\$(?!\s)([^$\n]+?)(?<!\s)\$(?!\d)/g, (_m, pre: string, t: string) => pre + hold(tex(t, false)));

  s = s.replace(/\u0001(\d+)\u0001/g, (_m, i) => code[Number(i)]!);
  let html = opts.inline ? (marked.parseInline(s) as string) : (marked.parse(s) as string);
  html = html.replace(/\u0000(\d+)\u0000/g, (_m, i) => stash[Number(i)]!);
  return html;
}
