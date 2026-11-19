import "server-only";
import { CanvasClient } from "@study/canvas";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { decrypt } from "./crypto";

const LOCAL_USER_ID = "local";

/**
 * The signed-in user. Locally there is exactly one; when hosted this becomes a session lookup,
 * and every query below already scopes by user id.
 */
export async function getUser() {
  const db = await getDb();
  const existing = await db.query.users.findFirst({ where: eq(schema.users.id, LOCAL_USER_ID) });
  if (existing) return existing;
  await db.insert(schema.users).values({ id: LOCAL_USER_ID }).onConflictDoNothing();
  return (await db.query.users.findFirst({ where: eq(schema.users.id, LOCAL_USER_ID) }))!;
}

export type User = Awaited<ReturnType<typeof getUser>>;

export function canvasFor(user: User): CanvasClient {
  if (!user.canvasBaseUrl || !user.canvasTokenEnc) throw new Error("Canvas is not connected. Add your token in Settings.");
  return new CanvasClient({ baseUrl: user.canvasBaseUrl, token: decrypt(user.canvasTokenEnc) });
}
