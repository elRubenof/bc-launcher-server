import { listLoaderVersionsRoute, listMinecraftVersionsRoute } from "@bc-launcher-server/contracts";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Context } from "hono";
import { loaderVersions, MetadataUnavailableError, minecraftVersions } from "../loaders";
import type { AppEnv } from "../platform/types";
import { problem } from "../problem";

/** `502 metadata_unavailable` for upstream failures; anything else is rethrown. */
export function metadataUnavailable(c: Context<AppEnv>, error: unknown) {
  if (!(error instanceof MetadataUnavailableError)) throw error;
  console.warn(error.message, error.cause);
  return problem(c, 502, "metadata_unavailable", "The official metadata couldn't be fetched");
}

export function registerLoaders(app: OpenAPIHono<AppEnv>) {
  app.openapi(listMinecraftVersionsRoute, async (c) => {
    const { all } = c.req.valid("query");
    try {
      const versions = await minecraftVersions(c.var.platform.fetch);
      return c.json(
        { versions: all === "true" ? versions : versions.filter((v) => v.type === "release") },
        200,
      );
    } catch (error) {
      return metadataUnavailable(c, error);
    }
  });

  app.openapi(listLoaderVersionsRoute, async (c) => {
    const { type } = c.req.valid("param");
    const { mc } = c.req.valid("query");
    try {
      return c.json({ versions: await loaderVersions(c.var.platform.fetch, type, mc) }, 200);
    } catch (error) {
      return metadataUnavailable(c, error);
    }
  });
}
