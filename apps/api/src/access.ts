import { type Database, schema } from "@bc-launcher-server/db";
import { and, eq, exists, gt, isNull, not, or, type SQL, sql } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";

/** A ban counts while it has no expiry or its expiry is still ahead. */
export const activeBan = (expiresAt: SQLiteColumn, now: Date) =>
  or(isNull(expiresAt), gt(expiresAt, now)) as SQL;

/** Whether the player is banned from the organization (an active `org_blacklist` entry). */
export const orgBanned = (db: Database, playerUuid: SQL | string, now: Date) =>
  exists(
    db
      .select({ one: sql`1` })
      .from(schema.orgBlacklist)
      .where(
        and(
          eq(schema.orgBlacklist.playerUuid, playerUuid),
          activeBan(schema.orgBlacklist.expiresAt, now),
        ),
      ),
  );

/** Whether the player is on the organization's whitelist. */
export const orgWhitelisted = (db: Database, playerUuid: SQL | string) =>
  exists(
    db
      .select({ one: sql`1` })
      .from(schema.orgWhitelist)
      .where(eq(schema.orgWhitelist.playerUuid, playerUuid)),
  );

/**
 * Organization membership: not banned, and the organization is public or the player is on its
 * whitelist. `visibility` is the settings column or a known value.
 */
export const memberCondition = (
  db: Database,
  playerUuid: SQL | string,
  now: Date,
  visibility: SQL | "public" | "private",
) =>
  and(
    not(orgBanned(db, playerUuid, now)),
    or(sql`${visibility} = 'public'`, orgWhitelisted(db, playerUuid)),
  ) as SQL;

/** Whether the player is a member of the organization right now. */
export async function isMember(db: Database, playerUuid: string, now = new Date()) {
  const [row] = await db
    .select({ id: schema.settings.id })
    .from(schema.settings)
    .where(
      and(
        eq(schema.settings.id, 1),
        memberCondition(db, playerUuid, now, sql`${schema.settings.visibility}`),
      ),
    );
  return Boolean(row);
}
