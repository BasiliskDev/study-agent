import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./paths";

let key: Buffer | undefined;

/** 32-byte key from APP_SECRET, or from a secret generated once into .data/app-secret for local use. */
function getKey(): Buffer {
  if (key) return key;
  let secret = process.env.APP_SECRET;
  if (!secret) {
    const file = path.join(DATA_DIR, "app-secret");
    if (!existsSync(file)) {
      mkdirSync(DATA_DIR, { recursive: true });
      writeFileSync(file, randomBytes(32).toString("base64url"), { mode: 0o600 });
    }
    secret = readFileSync(file, "utf8").trim();
  }
  key = createHash("sha256").update(secret).digest();
  return key;
}

/** AES-256-GCM. Output: base64url(iv | tag | ciphertext). */
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", getKey(), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64url");
}

export function decrypt(blob: string): string {
  const raw = Buffer.from(blob, "base64url");
  const d = createDecipheriv("aes-256-gcm", getKey(), raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString("utf8");
}
