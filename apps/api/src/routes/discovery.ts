import { type DiscoveryDocument, discoveryRoute } from "@bc-launcher-server/contracts";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { AppEnv } from "../platform/types";
import { API_VERSIONS, SERVER_VERSION } from "../version";

/** Defaults until the organization's settings are stored in the database. */
function discoveryDocument(): DiscoveryDocument {
  return {
    discoveryVersion: 1,
    visibility: "public",
    name: "BC Launcher Server",
    description: null,
    logoUrl: null,
    iconUrl: null,
    links: { discord: null, web: null },
    serverVersion: SERVER_VERSION,
    apiVersions: API_VERSIONS,
    minLauncherVersion: null,
    capabilities: [],
    auth: { type: "mojang-session" },
  };
}

export function registerDiscovery(app: OpenAPIHono<AppEnv>) {
  app.openapi(discoveryRoute, (c) =>
    c.json(discoveryDocument(), 200, { "Cache-Control": "public, max-age=300" }),
  );
}
