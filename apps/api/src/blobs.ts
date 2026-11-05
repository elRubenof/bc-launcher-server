import { type Database, schema } from "@bc-launcher-server/db";
import { and, inArray, isNotNull, sql } from "drizzle-orm";

// Lists of hashes go in as one JSON parameter (`json_each`): D1 allows only 100 bound
// parameters per statement, and a content change can list thousands of files.
const jsonList = (values: string[]) =>
  sql`(select value from json_each(${JSON.stringify(values)}))`;

/** The hashes in `sha256s` that are in the `blobs` table. */
export async function existingBlobs(db: Database, sha256s: string[]): Promise<Set<string>> {
  if (sha256s.length === 0) return new Set();
  const rows = await db
    .select({ sha256: schema.blobs.sha256 })
    .from(schema.blobs)
    .where(inArray(schema.blobs.sha256, jsonList(sha256s)));
  return new Set(rows.map((row) => row.sha256));
}

/** Gives these blobs another 24 h before the orphan cleanup can delete them. */
export async function keepBlobs(db: Database, sha256s: string[]) {
  if (sha256s.length === 0) return;
  await db
    .update(schema.blobs)
    .set({ orphanedAt: null })
    .where(
      and(isNotNull(schema.blobs.orphanedAt), inArray(schema.blobs.sha256, jsonList(sha256s))),
    );
}
