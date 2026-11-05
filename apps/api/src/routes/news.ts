import {
  createNewsRoute,
  deleteNewsRoute,
  listNewsRoute,
  MAX_IMAGE_BYTES,
  type NewsItem,
  type SaveNews,
  updateNewsRoute,
  uploadImageRoute,
} from "@bc-launcher-server/contracts";
import { type Database, schema } from "@bc-launcher-server/db";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import type { Context } from "hono";
import { storeUploadedImage, upsertImageBlob } from "../images";
import { instanceExists } from "../instances";
import type { AppEnv, Config } from "../platform/types";
import { problem } from "../problem";
import { assetUrl } from "../settings";

/** Pinned first, then newest first (also the launcher's order). */
export const newsOrder = [
  desc(schema.news.pinned),
  desc(schema.news.publishedAt),
  desc(schema.news.id),
] as const;

function selectNews(db: Database) {
  return db
    .select({
      news: schema.news,
      createdBy: { id: schema.admins.id, username: schema.admins.username },
    })
    .from(schema.news)
    .leftJoin(schema.admins, eq(schema.admins.id, schema.news.createdBy));
}

type SelectedNews = Awaited<ReturnType<ReturnType<typeof selectNews>["execute"]>>[number];

function toNewsItem({ news, createdBy }: SelectedNews, config: Config): NewsItem {
  return {
    id: news.id,
    instanceId: news.instanceId,
    title: news.title,
    body: news.body,
    imageUrl: assetUrl(config, news.imageBlob),
    imageSha256: news.imageBlob,
    link: news.link,
    pinned: news.pinned,
    publishedAt: news.publishedAt.toISOString(),
    createdBy,
    createdAt: news.createdAt.toISOString(),
    updatedAt: news.updatedAt.toISOString(),
  };
}

async function readNews(c: Context<AppEnv>, instanceId: string, id: string) {
  const [row] = await selectNews(c.var.platform.db).where(
    and(eq(schema.news.id, id), eq(schema.news.instanceId, instanceId)),
  );
  return row ? toNewsItem(row, c.var.platform.config) : null;
}

/** Whether `sha256` is an uploaded image (a blob with a content type). */
async function isImage(db: Database, sha256: string) {
  const [row] = await db
    .select({ sha256: schema.blobs.sha256 })
    .from(schema.blobs)
    .where(and(eq(schema.blobs.sha256, sha256), isNotNull(schema.blobs.contentType)));
  return Boolean(row);
}

/** Checks the body; returns the column values, or a problem response. */
async function newsValues(c: Context<AppEnv>, body: SaveNews) {
  if (body.imageSha256 && !(await isImage(c.var.platform.db, body.imageSha256))) {
    return problem(c, 400, "invalid_image", "That image wasn't uploaded");
  }
  return {
    title: body.title,
    body: body.body,
    imageBlob: body.imageSha256,
    link: body.link,
    pinned: body.pinned,
    publishedAt: body.publishedAt ? new Date(body.publishedAt) : new Date(),
  };
}

const notFound = (c: Context<AppEnv>) => problem(c, 404, "not_found", "No such instance");

export function registerNews(app: OpenAPIHono<AppEnv>) {
  app.openapi(uploadImageRoute, async (c) => {
    const image = await storeUploadedImage(c, MAX_IMAGE_BYTES);
    if (image instanceof Response) return image;
    // Not referenced yet: the orphan cleanup deletes it if no news item uses it within 24 h.
    await upsertImageBlob(c.var.platform.db, image);
    return c.json(
      { sha256: image.sha256, url: assetUrl(c.var.platform.config, image.sha256) as string },
      201,
    );
  });

  app.openapi(listNewsRoute, async (c) => {
    const { id } = c.req.valid("param");
    const { db, config } = c.var.platform;
    if (!(await instanceExists(db, id))) return notFound(c);
    const rows = await selectNews(db)
      .where(eq(schema.news.instanceId, id))
      .orderBy(...newsOrder);
    return c.json(
      rows.map((row) => toNewsItem(row, config)),
      200,
    );
  });

  app.openapi(createNewsRoute, async (c) => {
    const { id: instanceId } = c.req.valid("param");
    const { db } = c.var.platform;
    if (!(await instanceExists(db, instanceId))) return notFound(c);
    const values = await newsValues(c, c.req.valid("json"));
    if (values instanceof Response) return values;

    const id = crypto.randomUUID();
    const adminId = c.var.admin.id;
    await db.batch([
      db
        .insert(schema.news)
        .values({ ...values, id, instanceId, createdBy: adminId, updatedBy: adminId }),
      db.insert(schema.auditLog).values({
        adminId,
        action: "news.created",
        target: instanceId,
        details: {
          newsId: id,
          title: values.title,
          publishedAt: values.publishedAt.toISOString(),
        },
      }),
    ]);
    return c.json((await readNews(c, instanceId, id)) as NewsItem, 201);
  });

  app.openapi(updateNewsRoute, async (c) => {
    const { id: instanceId, newsId } = c.req.valid("param");
    const { db } = c.var.platform;
    if (!(await readNews(c, instanceId, newsId))) {
      return problem(c, 404, "not_found", "No such news item");
    }
    const values = await newsValues(c, c.req.valid("json"));
    if (values instanceof Response) return values;

    const adminId = c.var.admin.id;
    await db.batch([
      db
        .update(schema.news)
        .set({ ...values, updatedBy: adminId, updatedAt: new Date() })
        .where(and(eq(schema.news.id, newsId), eq(schema.news.instanceId, instanceId))),
      db.insert(schema.auditLog).values({
        adminId,
        action: "news.updated",
        target: instanceId,
        details: { newsId, title: values.title },
      }),
    ]);
    return c.json((await readNews(c, instanceId, newsId)) as NewsItem, 200);
  });

  app.openapi(deleteNewsRoute, async (c) => {
    const { id: instanceId, newsId } = c.req.valid("param");
    const { db } = c.var.platform;
    const item = await readNews(c, instanceId, newsId);
    if (!item) return problem(c, 404, "not_found", "No such news item");
    await db.batch([
      db
        .delete(schema.news)
        .where(and(eq(schema.news.id, newsId), eq(schema.news.instanceId, instanceId))),
      db.insert(schema.auditLog).values({
        adminId: c.var.admin.id,
        action: "news.deleted",
        target: instanceId,
        details: { newsId, title: item.title },
      }),
    ]);
    return c.body(null, 204);
  });
}
