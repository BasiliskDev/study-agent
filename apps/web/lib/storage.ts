import "server-only";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { DATA_DIR } from "./paths";

/** Blob storage for downloaded course files. Local disk now; swap for Vercel Blob / S3 when hosted. */
export interface BlobStorage {
  put(key: string, bytes: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  delete(key: string): Promise<void>;
}

const ROOT = path.join(DATA_DIR, "files");

function resolve(key: string) {
  const p = path.resolve(ROOT, key);
  if (!p.startsWith(ROOT + path.sep)) throw new Error(`bad storage key: ${key}`);
  return p;
}

export const storage: BlobStorage = {
  async put(key, bytes) {
    const p = resolve(key);
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, bytes);
  },
  async get(key) {
    return new Uint8Array(await readFile(resolve(key)));
  },
  async delete(key) {
    await rm(resolve(key), { force: true });
  },
};
