import "server-only";
import Anthropic from "@anthropic-ai/sdk";

export const MODEL = process.env.STUDY_MODEL ?? "claude-opus-5-5";
/** Cheaper model for small classification calls. */
export const SMALL_MODEL = process.env.STUDY_SMALL_MODEL ?? "claude-haiku-5-5";

let client: Anthropic | undefined;
export function anthropic(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    throw new Error("ANTHROPIC_API_KEY is not set. Add it to apps/web/.env.local.");
  }
  client ??= new Anthropic();
  return client;
}

/** Sum usage blocks across several responses for cost logging. */
export function addUsage(total: Record<string, number>, usage: object | null | undefined) {
  for (const [k, v] of Object.entries(usage ?? {})) if (typeof v === "number") total[k] = (total[k] ?? 0) + v;
  return total;
}
