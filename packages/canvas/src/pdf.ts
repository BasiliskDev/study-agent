import { extractText, getDocumentProxy } from "unpdf";

/** Extract text from a PDF with a "--- page N ---" header per page, so problems can cite pages. */
export async function pdfToText(bytes: Uint8Array): Promise<{ text: string; pages: number }> {
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { totalPages, text } = await extractText(pdf, { mergePages: false });
  const pages = Array.isArray(text) ? text : [text];
  const body = pages
    .map((t, i) => `--- page ${i + 1} ---\n${t.replace(/[ \t]+/g, " ").trim()}`)
    .join("\n\n");
  return { text: body, pages: totalPages };
}
