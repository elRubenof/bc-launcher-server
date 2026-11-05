import type { Instance } from "@bc-launcher-server/contracts";
import { type Database, schema } from "@bc-launcher-server/db";
import { and, count, desc, eq, isNotNull, sql } from "drizzle-orm";
import { instanceAccess, memberCondition } from "./access";
import { base64UrlDecode, sha256Hex } from "./auth/crypto";
import { DEFAULT_BACKGROUND_BASE64, DEFAULT_BACKGROUND_TYPE } from "./default-background";
import type { BlobStore, Config } from "./platform/types";
import { assetUrl } from "./settings";

export type InstanceRow = typeof schema.instances.$inferSelect;

let defaultBackground: Promise<{ bytes: Uint8Array<ArrayBuffer>; sha256: string }> | undefined;

/**
 * Makes sure BC Launcher's default background is in the BlobStore and returns the values for its
 * `blobs` row. The caller upserts the row in the same batch that references it, so the orphan
 * cleanup can delete the default background while no instance uses it.
 */
export async function ensureDefaultBackground(blobs: BlobStore) {
  defaultBackground ??= (async () => {
    const bytes = base64UrlDecode(DEFAULT_BACKGROUND_BASE64);
    return { bytes, sha256: await sha256Hex(bytes) };
  })();
  const { bytes, sha256 } = await defaultBackground;
  if (!(await blobs.head(sha256))) {
    await blobs.put(sha256, new Blob([bytes]).stream(), bytes.byteLength);
  }
  return { sha256, contentType: DEFAULT_BACKGROUND_TYPE, size: bytes.byteLength };
}

const stats = {
  fileCount: sql<number>`(select count(*) from ${schema.instanceFiles} where ${schema.instanceFiles.instanceId} = ${schema.instances.id})`,
  totalSize: sql<number>`(select coalesce(sum(${schema.blobs.size}), 0) from ${schema.instanceFiles} join ${schema.blobs} on ${schema.blobs.sha256} = ${schema.instanceFiles.blobSha256} where ${schema.instanceFiles.instanceId} = ${schema.instances.id})`,
};

/** Joined players with access to the instance in the current row (see `access.ts`). */
function playersWithAccess(db: Database, now: Date) {
  const visibility = sql`(select ${schema.settings.visibility} from ${schema.settings} where ${schema.settings.id} = 1)`;
  return sql<number>`(${db
    .select({ n: count() })
    .from(schema.players)
    .where(
      and(
        isNotNull(schema.players.firstSeenAt),
        memberCondition(db, schema.players.uuid, now, visibility),
        instanceAccess(db, schema.players.uuid, now),
      ),
    )})`;
}

function selectInstances(db: Database) {
  return db
    .select({
      instance: schema.instances,
      updatedBy: { id: schema.admins.id, username: schema.admins.username },
      ...stats,
      playersWithAccess: playersWithAccess(db, new Date()),
    })
    .from(schema.instances)
    .leftJoin(schema.admins, eq(schema.admins.id, schema.instances.contentUpdatedBy));
}

type SelectedInstance = Awaited<ReturnType<ReturnType<typeof selectInstances>["execute"]>>[number];

function toInstance(row: SelectedInstance, config: Config): Instance {
  const { instance } = row;
  return {
    id: instance.id,
    name: instance.name,
    description: instance.description,
    iconUrl: assetUrl(config, instance.iconBlob),
    backgroundUrl: assetUrl(config, instance.backgroundBlob) as string,
    colors: instance.colors,
    // Written only through the contracts' `WebTab`, so the icons are known ones.
    tabs: instance.tabs as Instance["tabs"],
    discordUrl: instance.discordUrl,
    webUrl: instance.webUrl,
    serverAddress: instance.serverAddress,
    recommendedRamMb: instance.recommendedRamMb,
    access: instance.access,
    isActive: instance.isActive,
    minecraft: { version: instance.mcVersion },
    loader: { type: instance.loader, version: instance.loaderVersion },
    contentVersion: instance.contentVersion,
    contentUpdatedAt: instance.contentUpdatedAt?.toISOString() ?? null,
    contentUpdatedBy: row.updatedBy,
    fileCount: Number(row.fileCount),
    totalSize: Number(row.totalSize),
    playersWithAccess: Number(row.playersWithAccess),
    createdAt: instance.createdAt.toISOString(),
    updatedAt: instance.updatedAt.toISOString(),
  };
}

export async function listInstances(db: Database, config: Config): Promise<Instance[]> {
  const rows = await selectInstances(db).orderBy(desc(schema.instances.createdAt));
  return rows.map((row) => toInstance(row, config));
}

export async function readInstance(
  db: Database,
  config: Config,
  id: string,
): Promise<Instance | null> {
  const [row] = await selectInstances(db).where(eq(schema.instances.id, id));
  return row ? toInstance(row, config) : null;
}

export async function instanceExists(db: Database, id: string) {
  const [row] = await db
    .select({ id: schema.instances.id })
    .from(schema.instances)
    .where(eq(schema.instances.id, id));
  return Boolean(row);
}
