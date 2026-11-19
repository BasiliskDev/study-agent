"use client";

import { memo, useMemo } from "react";
import { renderMarkdown } from "@/lib/markdown";

/** Markdown + KaTeX. renderMarkdown escapes any raw HTML, so model output is safe to inject. */
export const Md = memo(function Md({ src, inline, className }: { src: string; inline?: boolean; className?: string }) {
  const html = useMemo(() => renderMarkdown(src, { inline }), [src, inline]);
  const Tag = inline ? "span" : "div";
  return <Tag className={`md ${className ?? ""}`} dangerouslySetInnerHTML={{ __html: html }} />;
});
