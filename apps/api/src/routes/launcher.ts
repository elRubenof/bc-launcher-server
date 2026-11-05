import {
  getBlobRoute,
  getManifestRoute,
  type LauncherInstance,
  launcherNewsRoute,
  listLauncherInstancesRoute,
  type Manifest,
  NEWS_PAGE_SIZE,
} from "@bc-launcher-server/contracts";
import { type Database, schema } from "@bc-launcher-server/db";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { and, asc, desc, eq, lt, lte, or, sql } from "drizzle-orm";
import { playableBy } from "../access";
import { base64UrlDecode, base64UrlEncode } from "../auth/crypto";
import { readFiles } from "../content";
import type { InstanceRow } from "../instances";
import type { AppEnv, Config } from "../platform/types";
import { problem } from "../problem";
import { assetUrl, readSettings, type SettingsRow } from "../settings";
import { checkBlobSignature, signedBlobUrl, urlWindow } from "../signed-urls";
import { newsOrder } from "./news";

function toLauncherInstance(
  row: InstanceRow,
  settings: SettingsRow,
  config: Config,
): LauncherInstance {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    iconUrl: assetUrl(config, row.iconBlob),
    backgroundUrl: assetUrl(config, row.backgroundBlob) as string,
    colors: row.colors,
    tabs: row.tabs as LauncherInstance["tabs"],
    discordUrl: row.discordUrl ?? settings.discordUrl,
    webUrl: row.webUrl ?? settings.webUrl,
    minecraft: { version: row.mcVersion },
    loader: { type: row.loader, version: row.loaderVersion },
    serverAddress: row.serverAddress,
    recommendedRamMb: row.recommendedRamMb,
    contentVersion: row.contentVersion,
  };
}

/** The instance if the player can play it; instances they can't are invisible (`404`). */
async function playableInstance(db: Database, id: string, playerUuid: string) {
  const [row] = await db
    .select()
    .from(schema.instances)
    .where(and(eq(schema.instances.id, id), playableBy(db, playerUuid, new Date())));
  return row ?? null;
}

/** Where a page of news ends: the last item's position in `newsOrder`. */
type NewsCursor = [pinned: 0 | 1, publishedAt: number, id: string];

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function encodeCursor(cursor: NewsCursor) {
  return base64UrlEncode(encoder.encode(JSON.stringify(cursor)));
}

function decodeCursor(value: string): NewsCursor | null {
  try {
    const parsed: unknown = JSON.parse(decoder.decode(base64UrlDecode(value)));
    if (
      Array.isArray(parsed) &&
      parsed.length === 3 &&
      (parsed[0] === 0 || parsed[0] === 1) &&
      Number.isSafeInteger(parsed[1]) &&
      typeof parsed[2] === "string"
    ) {
      return parsed as NewsCursor;
    }
  } catch {
    // Falls through: not one of our cursors.
  }
  return null;
}

/** News after `cursor` in `newsOrder` (pinned desc, published_at desc, id desc). */
function afterCursor([pinned, publishedAt, id]: NewsCursor) {
  const date = new Date(publishedAt);
  const samePin = sql`${schema.news.pinned} = ${pinned}`;
  return or(
    sql`${schema.news.pinned} < ${pinned}`,
    and(samePin, lt(schema.news.publishedAt, date)),
    and(samePin, eq(schema.news.publishedAt, date), lt(schema.news.id, id)),
  );
}

export function registerLauncher(app: OpenAPIHono<AppEnv>) {
  app.openapi(listLauncherInstancesRoute, async (c) => {
    const { db, config } = c.var.platform;
    const [settings, rows] = await Promise.all([
      readSettings(db),
      db
        .select()
        .from(schema.instances)
        .where(playableBy(db, c.var.player.uuid, new Date()))
        .orderBy(desc(schema.instances.createdAt)),
    ]);
    return c.json(
      { instances: rows.map((row) => toLauncherInstance(row, settings, config)) },
      200,
      { "Cache-Control": "private, no-cache" },
    );
  });

  app.openapi(getManifestRoute, async (c) => {
    const { db, config } = c.var.platform;
    const instance = await playableInstance(db, c.req.valid("param").id, c.var.player.uuid);
    if (!instance) return problem(c, 404, "not_found", "No such instance");

    const now = Date.now();
    const etag = `"${instance.contentVersion}.${urlWindow(now)}"`;
    const headers = { ETag: etag, "Cache-Control": "private, no-cache" };
    if (c.req.header("If-None-Match") === etag) return c.body(null, 304, headers);

    const [files, dirs] = await Promise.all([
      readFiles(db, instance.id),
      db
        .select({ path: schema.instanceManagedDirs.path })
        .from(schema.instanceManagedDirs)
        .where(eq(schema.instanceManagedDirs.instanceId, instance.id))
        .orderBy(asc(schema.instanceManagedDirs.path)),
    ]);
    const manifest: Manifest = {
      contentVersion: instance.contentVersion,
      minecraft: { version: instance.mcVersion },
      loader: { type: instance.loader, version: instance.loaderVersion },
      server: { address: instance.serverAddress },
      managedDirs: dirs.map((dir) => dir.path),
      files: await Promise.all(
        files.map(async (file) => ({
          ...file,
          url: await signedBlobUrl(config, file.sha256, now),
        })),
      ),
    };
    return c.json(manifest, 200, headers);
  });

  app.openapi(getBlobRoute, async (c) => {
    const { sha256 } = c.req.valid("param");
    const { exp, sig } = c.req.valid("query");
    const { blobs, config } = c.var.platform;

    const check = await checkBlobSignature(config, sha256, exp, sig);
    if (check === "invalid") return problem(c, 403, "invalid_signature", "Invalid signature");
    if (check === "expired") return problem(c, 403, "url_expired", "This URL has expired");

    const blob = await blobs.get(sha256);
    if (!blob) return problem(c, 404, "not_found", "No such file");
    return c.body(blob.body, 200, {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(blob.size),
      ETag: `"${sha256}"`,
      // Content-addressed: the bytes behind a hash never change.
      "Cache-Control": "public, max-age=31536000, immutable",
    });
  });

  app.openapi(launcherNewsRoute, async (c) => {
    const { db, config } = c.var.platform;
    const { cursor: rawCursor } = c.req.valid("query");
    const cursor = rawCursor ? decodeCursor(rawCursor) : null;
    if (rawCursor && !cursor) return problem(c, 400, "invalid_cursor", "Invalid cursor");

    const instance = await playableInstance(db, c.req.valid("param").id, c.var.player.uuid);
    if (!instance) return problem(c, 404, "not_found", "No such instance");

    const rows = await db
      .select()
      .from(schema.news)
      .where(
        and(
          eq(schema.news.instanceId, instance.id),
          // Scheduled news stays hidden until its time.
          lte(schema.news.publishedAt, new Date()),
          cursor ? afterCursor(cursor) : undefined,
        ),
      )
      .orderBy(...newsOrder)
      // One extra row tells whether there is another page.
      .limit(NEWS_PAGE_SIZE + 1);

    const page = rows.slice(0, NEWS_PAGE_SIZE);
    const last = page.at(-1);
    return c.json(
      {
        items: page.map((news) => ({
          id: news.id,
          title: news.title,
          body: news.body,
          imageUrl: assetUrl(config, news.imageBlob),
          link: news.link,
          pinned: news.pinned,
          publishedAt: news.publishedAt.toISOString(),
        })),
        nextCursor:
          rows.length > NEWS_PAGE_SIZE && last
            ? encodeCursor([last.pinned ? 1 : 0, last.publishedAt.getTime(), last.id])
            : null,
      },
      200,
      { "Cache-Control": "private, no-cache" },
    );
  });
}
