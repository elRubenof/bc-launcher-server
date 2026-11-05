import { type Database, schema } from "@bc-launcher-server/db";
import { and, eq, isNotNull, isNull, lt, lte, notInArray, sql } from "drizzle-orm";
import type { Platform } from "./platform/types";

export const ORPHAN_GRACE_MS = 24 * 3600 * 1000;
/** Deletions per run: Workers limit the subrequests of one invocation. */
const MAX_DELETES = 200;

/** Every sha256 something points to: instance files and images, news images and organization images. */
const referenced = sql`(
  select ${schema.instanceFiles.blobSha256} from ${schema.instanceFiles}
  union select ${schema.instances.backgroundBlob} from ${schema.instances}
  union select ${schema.instances.iconBlob} from ${schema.instances} where ${schema.instances.iconBlob} is not null
  union select ${schema.settings.logoBlob} from ${schema.settings} where ${schema.settings.logoBlob} is not null
  union select ${schema.settings.iconBlob} from ${schema.settings} where ${schema.settings.iconBlob} is not null
  union select ${schema.news.imageBlob} from ${schema.news} where ${schema.news.imageBlob} is not null
)`;

const unreferenced = notInArray(schema.blobs.sha256, referenced);

/**
 * Deletes blobs that nothing has referenced for 24 hours. Each run marks newly unreferenced
 * blobs (`orphaned_at`), unmarks the ones referenced again, and deletes those marked more than
 * 24 h ago. The grace period covers launchers still downloading a previous manifest and uploads
 * whose change hasn't been applied yet. Runs hourly (cron on Cloudflare, timer on Node).
 */
export async function cleanupOrphanBlobs(platform: Platform, now = Date.now()) {
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
export async function runCleanup(platform: Platform, now = Date.now()) {
  await cleanupExpiredBans(platform.db, new Date(now));
  return cleanupOrphanBlobs(platform, now);
}
