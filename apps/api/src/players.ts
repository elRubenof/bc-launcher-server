import type { Player } from "@bc-launcher-server/contracts";
import { type Database, schema } from "@bc-launcher-server/db";
import { eq, sql } from "drizzle-orm";

/**
 * Records a profile Mojang vouched for: inserts the player or updates its name. Never touches the
 * access dates, which only `markSeen` moves.
 */
export function upsertPlayer(db: Database, player: Player) {
  return db
    .insert(schema.players)
    .values({ uuid: player.uuid, name: player.name })
    .onConflictDoUpdate({ target: schema.players.uuid, set: { name: player.name } });
}

/** The player entered one of the instances: last access, and first if unset. */
export function markSeen(db: Database, uuid: string, now: Date) {
  return db
    .update(schema.players)
    .set({
      firstSeenAt: sql`coalesce(${schema.players.firstSeenAt}, ${now.getTime()})`,
      lastSeenAt: now,
    })
    .where(eq(schema.players.uuid, uuid));
}

export async function readPlayer(db: Database, uuid: string) {
  const [row] = await db.select().from(schema.players).where(eq(schema.players.uuid, uuid));
  return row ?? null;
}
