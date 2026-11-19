import "server-only";
import { createClient, type Client } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { mkdirSync } from "node:fs";
import path from "node:path";
import * as schema from "./schema";
import { DATA_DIR } from "@/lib/paths";

type DB = LibSQLDatabase<typeof schema> & { $client: Client };

const g = globalThis as unknown as { __db?: DB; __dbReady?: Promise<void> };

function open(): DB {
  mkdirSync(DATA_DIR, { recursive: true });
  const url = process.env.DATABASE_URL ?? `file:${path.join(DATA_DIR, "study.db")}`;
  const client = createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN });
  return drizzle(client, { schema }) as DB;
}

/** Shared connection, migrated on first use. Cached on globalThis so dev hot-reload doesn't reopen it. */
export async function getDb(): Promise<DB> {
  g.__db ??= open();
  g.__dbReady ??= (async () => {
    await g.__db!.$client.execute("PRAGMA foreign_keys = ON");
    await g.__db!.$client.execute("PRAGMA journal_mode = WAL").catch(() => {});
    await migrate(g.__db!, { migrationsFolder: process.env.STUDY_MIGRATIONS_DIR ?? path.join(process.cwd(), "db/migrations") });
  })();
  await g.__dbReady;
  return g.__db;
}

export { schema };
