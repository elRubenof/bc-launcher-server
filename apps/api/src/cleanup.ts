import { type Database, schema } from "@bc-launcher-server/db";
import { and, eq, isNotNull, isNull, lt, lte, sql } from "drizzle-orm";
import type { Platform } from "./platform/types";

export const ORPHAN_GRACE_MS = 24 * 3600 * 1000;
/** Deletions per run: Workers limit the subrequests of one invocation. */
const MAX_DELETES = 200;

const blob = schema.blobs.sha256;

/**
 * Nothing points to the blob: no instance file, instance icon or background, news image, or
 * organization logo. One `NOT EXISTS` per table (D1 allows at most 5 terms in a compound
 * `SELECT`, so a `UNION` of every source doesn't fit).
 */
const unreferenced = sql`(
  not exists (select 1 from ${schema.instanceFiles} where ${schema.instanceFiles.blobSha256} = ${blob})
  and not exists (select 1 from ${schema.instances} where ${schema.instances.backgroundBlob} = ${blob} or ${schema.instances.iconBlob} = ${blob})
  and not exists (select 1 from ${schema.news} where ${schema.news.imageBlob} = ${blob})
  and not exists (select 1 from ${schema.settings} where ${schema.settings.logoBlob} = ${blob})
)`;

/**
 * Deletes blobs that nothing has referenced for 24 hours. Each run marks newly unreferenced
 * blobs (`orphaned_at`), unmarks the ones referenced again, and deletes those marked more than
 * 24 h ago. The grace period covers launchers still downloading a previous manifest and uploads
 * whose change hasn't been applied yet. Runs hourly (cron on Cloudflare, timer on Node).
 */
export async function cleanupOrphanBlobs(
  platform: Pick<Platform, "db" | "blobs">,
  now = Date.now(),
) {
  const { db, blobs } = platform;
  const cutoff = new Date(now - ORPHAN_GRACE_MS);

  await db.batch([
    db
      .update(schema.blobs)
      .set({ orphanedAt: null })
      .where(and(isNotNull(schema.blobs.orphanedAt), sql`not ${unreferenced}`)),
    db
      .update(schema.blobs)
      .set({ orphanedAt: new Date(now) })
      .where(and(isNull(schema.blobs.orphanedAt), unreferenced)),
  ]);

  const expired = await db
    .select({ sha256: schema.blobs.sha256 })
    .from(schema.blobs)
    .where(and(lt(schema.blobs.orphanedAt, cutoff), unreferenced))
    .limit(MAX_DELETES);

  let deleted = 0;
  for (const { sha256 } of expired) {
    // Checked again in the delete itself, in case something referenced it meanwhile.
    const [row] = await db
      .delete(schema.blobs)
      .where(
        and(eq(schema.blobs.sha256, sha256), lt(schema.blobs.orphanedAt, cutoff), unreferenced),
      )
      .returning({ sha256: schema.blobs.sha256 });
    if (!row) continue;
    await blobs.delete(sha256);
    deleted++;
  }
  return { deleted, more: expired.length === MAX_DELETES };
}

/** Deletes bans whose expiry has passed (they already stopped counting). Runs with the blob cleanup. */
export async function cleanupExpiredBans(db: Database, now = new Date()) {
  await db.batch([
    db
      .delete(schema.orgBlacklist)
      .where(
        and(isNotNull(schema.orgBlacklist.expiresAt), lte(schema.orgBlacklist.expiresAt, now)),
      ),
    db
      .delete(schema.instanceBlacklist)
      .where(
        and(
          isNotNull(schema.instanceBlacklist.expiresAt),
          lte(schema.instanceBlacklist.expiresAt, now),
        ),
      ),
  ]);
}

/** The hourly maintenance: orphan blobs and expired bans. */
export async function runCleanup(platform: Pick<Platform, "db" | "blobs">, now = Date.now()) {
  await cleanupExpiredBans(platform.db, new Date(now));
  return cleanupOrphanBlobs(platform, now);
}
