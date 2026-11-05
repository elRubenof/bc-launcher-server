import type { OrganizationSettings } from "@bc-launcher-server/contracts";
import { type Database, schema } from "@bc-launcher-server/db";
import { eq } from "drizzle-orm";
import type { Config } from "./platform/types";

export type SettingsRow = typeof schema.settings.$inferSelect;

export async function readSettings(db: Database): Promise<SettingsRow> {
  const [settings] = await db.select().from(schema.settings).where(eq(schema.settings.id, 1));
  if (!settings) throw new Error("The settings row is missing; were the migrations applied?");
  return settings;
}

/** Public URL of an uploaded asset. */
export function assetUrl(config: Config, sha256: string | null): string | null {
  return sha256 ? `${config.publicUrl}/api/v1/assets/${sha256}` : null;
}

export function toOrganizationSettings(row: SettingsRow, config: Config): OrganizationSettings {
  return {
    name: row.name,
    description: row.description,
    logoUrl: assetUrl(config, row.logoBlob),
    discordUrl: row.discordUrl,
    webUrl: row.webUrl,
    visibility: row.visibility,
    minLauncherVersion: row.minLauncherVersion,
    publicUrl: config.publicUrl,
  };
}
