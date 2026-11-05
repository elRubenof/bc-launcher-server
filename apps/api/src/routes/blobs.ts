import { checkBlobsRoute, MAX_BLOB_BYTES, uploadBlobRoute } from "@bc-launcher-server/contracts";
import { schema } from "@bc-launcher-server/db";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
import { existingBlobs, keepBlobs } from "../blobs";
import { BlobMismatchError } from "../platform/sha256";
import type { AppEnv } from "../platform/types";
import { problem } from "../problem";

export function registerBlobs(app: OpenAPIHono<AppEnv>) {
  app.openapi(checkBlobsRoute, async (c) => {
    const { db } = c.var.platform;
    const wanted = [...new Set(c.req.valid("json").sha256)];
    const existing = await existingBlobs(db, wanted);
    await keepBlobs(db, [...existing]);
    return c.json({ missing: wanted.filter((sha256) => !existing.has(sha256)) }, 200);
  });

  app.openapi(uploadBlobRoute, async (c) => {
    const { sha256 } = c.req.valid("param");
    const { db, blobs } = c.var.platform;

    const [row] = await db.select().from(schema.blobs).where(eq(schema.blobs.sha256, sha256));
    if (row && (await blobs.head(sha256))) {
      await keepBlobs(db, [sha256]);
      return c.json({ sha256, size: row.size }, 200);
    }

    const length = c.req.header("Content-Length");
    if (!length || !/^\d+$/.test(length)) {
      return problem(c, 411, "length_required", "The request needs a Content-Length");
    }
    const size = Number(length);
    if (size > MAX_BLOB_BYTES) return problem(c, 413, "blob_too_large", "The file is too large");

    const body = c.req.raw.body ?? new Blob([]).stream();
    try {
      await blobs.put(sha256, body, size);
    } catch (error) {
      if (error instanceof BlobMismatchError) {
        return problem(c, 400, "hash_mismatch", "The file doesn't match its sha256", error.message);
      }
      throw error;
    }
    await db
      .insert(schema.blobs)
      .values({ sha256, size })
      .onConflictDoUpdate({ target: schema.blobs.sha256, set: { orphanedAt: null } });
    return c.json({ sha256, size }, 200);
  });
}
