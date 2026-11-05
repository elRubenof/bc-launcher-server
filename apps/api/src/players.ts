import type { Player } from "@bc-launcher-server/contracts";
import { type Database, schema } from "@bc-launcher-server/db";
import { eq, sql } from "drizzle-orm";

/**
 * Records a profile Mojang vouched for: inserts the player or updates its name. `seen` marks a
 * sign-in (first and last access); a lookup by name only refreshes the name.
 */
export function upsertPlayer(db: Database, player: Player, seen?: Date) {
  return db
    .insert(schema.players)
    .values({
      uuid: player.uuid,
      name: player.name,
      ...(seen ? { firstSeenAt: seen, lastSeenAt: seen } : {}),
    })
    .onConflictDoUpdate({
      target: schema.players.uuid,
      set: {
        name: player.name,
        ...(seen
          ? {
              firstSeenAt: sql`coalesce(${schema.players.firstSeenAt}, excluded.first_seen_at)`,
              lastSeenAt: seen,
            }
          : {}),
      },
    });
}

export async function readPlayer(db: Database, uuid: string) {
  const [row] = await db.select().from(schema.players).where(eq(schema.players.uuid, uuid));
  return row ?? null;
}
