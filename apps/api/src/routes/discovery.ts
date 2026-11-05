import { type DiscoveryDocument, discoveryRoute } from "@bc-launcher-server/contracts";
import type { Database } from "@bc-launcher-server/db";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { AppEnv, Config } from "../platform/types";
import { assetUrl, readSettings } from "../settings";
import { API_VERSIONS, SERVER_VERSION } from "../version";

async function discoveryDocument(db: Database, config: Config): Promise<DiscoveryDocument> {
  const settings = await readSettings(db);

  return {
    discoveryVersion: 1,
    visibility: settings.visibility,
    name: settings.name,
    description: settings.description,
    logoUrl: assetUrl(config, settings.logoBlob),
    links: { discord: settings.discordUrl, web: settings.webUrl },
    serverVersion: SERVER_VERSION,
    apiVersions: API_VERSIONS,
    minLauncherVersion: settings.minLauncherVersion,
    capabilities: [],
    auth: { type: config.playerAuth },
  };
}

export function registerDiscovery(app: OpenAPIHono<AppEnv>) {
  app.openapi(discoveryRoute, async (c) =>
    c.json(await discoveryDocument(c.var.platform.db, c.var.platform.config), 200, {
      "Cache-Control": "public, max-age=300",
    }),
  );
}
