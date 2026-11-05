import { applyInstanceContentRoute, getInstanceContentRoute } from "@bc-launcher-server/contracts";
import { schema } from "@bc-launcher-server/db";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
import { existingBlobs } from "../blobs";
import {
  applyContentStatements,
  contentDiff,
  pathConflict,
  readContent,
  readFiles,
} from "../content";
import { checkVersions } from "../loaders";
import type { AppEnv } from "../platform/types";
import { problem } from "../problem";
import { metadataUnavailable } from "./loaders";

export function registerContent(app: OpenAPIHono<AppEnv>) {
  app.openapi(getInstanceContentRoute, async (c) => {
    const { db } = c.var.platform;
    const [instance] = await db
      .select()
      .from(schema.instances)
      .where(eq(schema.instances.id, c.req.valid("param").id));
    if (!instance) return problem(c, 404, "not_found", "No such instance");
    return c.json(await readContent(db, instance), 200);
  });

  app.openapi(applyInstanceContentRoute, async (c) => {
    const { id } = c.req.valid("param");
    const change = c.req.valid("json");
    const { db, fetch } = c.var.platform;
    const [instance] = await db.select().from(schema.instances).where(eq(schema.instances.id, id));
    if (!instance) return problem(c, 404, "not_found", "No such instance");

    const conflict = () =>
      problem(
        c,
        409,
        "content_conflict",
        "Someone else applied a change first",
        `The instance is at content version ${instance.contentVersion}`,
      );
    const expected = change.expectedContentVersion;
    if (expected !== instance.contentVersion) return conflict();

    if (change.loader !== "vanilla" && !change.loaderVersion) {
      return problem(c, 400, "validation_error", "Invalid request", "loaderVersion: Required");
    }
    const clash = pathConflict(change);
    if (clash) return problem(c, 400, "path_conflict", "Some paths clash", clash);
    const loaderVersion = change.loader === "vanilla" ? null : change.loaderVersion;

    const versionChanged =
      change.mcVersion !== instance.mcVersion ||
      change.loader !== instance.loader ||
      loaderVersion !== instance.loaderVersion;
    if (versionChanged) {
      try {
        const invalid = await checkVersions(fetch, change.mcVersion, change.loader, loaderVersion);
        if (invalid) return problem(c, 400, "invalid_version", "Invalid version", invalid);
      } catch (error) {
        return metadataUnavailable(c, error);
      }
    }

    const wanted = [...new Set(change.files.map((file) => file.sha256))];
    const existing = await existingBlobs(db, wanted);
    const missing = wanted.filter((sha256) => !existing.has(sha256));
    if (missing.length > 0) {
      return problem(c, 409, "missing_blobs", "Some files aren't uploaded", missing.join(","));
    }

    const diff = contentDiff(await readFiles(db, id), change.files);
    const details = {
      from: expected,
      to: expected + 1,
      ...diff,
      ...(versionChanged
        ? {
            versionFrom: {
              mc: instance.mcVersion,
              loader: instance.loader,
              loaderVersion: instance.loaderVersion,
            },
            versionTo: { mc: change.mcVersion, loader: change.loader, loaderVersion },
          }
        : {}),
    };

    const statements = applyContentStatements(db, id, expected, change, c.var.admin.id, details);
    const results = await db.batch(statements);
    const bumped = results[statements.length - 1] as { contentVersion: number }[];
    if (bumped.length !== 1) {
      // Another change got in between our checks and the batch: nothing was written.
      const [now] = await db.select().from(schema.instances).where(eq(schema.instances.id, id));
      if (!now) return problem(c, 404, "not_found", "No such instance");
      instance.contentVersion = now.contentVersion;
      return conflict();
    }

    const [updated] = await db.select().from(schema.instances).where(eq(schema.instances.id, id));
    if (!updated) return problem(c, 404, "not_found", "No such instance");
    return c.json(await readContent(db, updated), 200);
  });
}
