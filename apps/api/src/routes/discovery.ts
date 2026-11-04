import { type DiscoveryDocument, discoveryRoute } from "@bc-launcher-server/contracts";
import { type Database, schema } from "@bc-launcher-server/db";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
import type { AppEnv } from "../platform/types";
import { API_VERSIONS, SERVER_VERSION } from "../version";

async function discoveryDocument(db: Database): Promise<DiscoveryDocument> {
  const [settings] = await db.select().from(schema.settings).where(eq(schema.settings.id, 1));
  if (!settings) throw new Error("The settings row is missing; were the migrations applied?");

  return {
    discoveryVersion: 1,
    visibility: settings.visibility,
    name: settings.name,
    description: settings.description,
    // Logo and icon uploads come with the organization settings screen.
    logoUrl: null,
    iconUrl: null,
    links: { discord: settings.discordUrl, web: settings.webUrl },
    serverVersion: SERVER_VERSION,
    apiVersions: API_VERSIONS,
    minLauncherVersion: settings.minLauncherVersion,
    capabilities: [],
    auth: { type: "mojang-session" },
  };
}

export function registerDiscovery(app: OpenAPIHono<AppEnv>) {
  app.openapi(discoveryRoute, async (c) =>
    c.json(await discoveryDocument(c.var.platform.db), 200, {
      "Cache-Control": "public, max-age=300",
    }),
  );
}
