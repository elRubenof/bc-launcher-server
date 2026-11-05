import { type Database, schema } from "@bc-launcher-server/db";
import { eq } from "drizzle-orm";
import { randomToken } from "../auth/crypto";

/**
 * Returns the server secret `name` from `server_secrets`, generating and storing a random one
 * (256 bits) the first time. Concurrent first calls (several requests or isolates) insert with
 * `ON CONFLICT DO NOTHING` and read back, so they all end up with the same stored value.
 */
export async function getOrCreateSecret(db: Database, name: string): Promise<string> {
  const read = async () => {
    const [row] = await db
      .select({ value: schema.serverSecrets.value })
      .from(schema.serverSecrets)
      .where(eq(schema.serverSecrets.name, name));
    return row?.value;
  };

  const existing = await read();
  if (existing) return existing;
  await db
    .insert(schema.serverSecrets)
    .values({ name, value: randomToken() })
    .onConflictDoNothing();
  const stored = await read();
  if (!stored) throw new Error(`Could not store the ${name} secret`);
  return stored;
}
