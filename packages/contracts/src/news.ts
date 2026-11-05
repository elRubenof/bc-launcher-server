import { createRoute, z } from "@hono/zod-openapi";
import { IMAGE_TYPES, MAX_IMAGE_BYTES } from "./assets";
import { Sha256 } from "./blobs";
import { playerAuth, playerAuthResponses } from "./player-auth";
import { problemResponse } from "./problem";

const InstanceIdParam = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{1,39}$/)
  .openapi({ param: { name: "id", in: "path" } });

const NewsIdParam = z.uuid().openapi({ param: { name: "newsId", in: "path" } });

const HttpUrl = z
  .url({ protocol: /^https?$/ })
  .max(500)
  .nullable();

/** A news item as the panel edits it. */
export const NewsItem = z
  .object({
    id: z.string(),
    instanceId: z.string(),
    title: z.string(),
    /** Markdown. */
    body: z.string(),
    imageUrl: z.url().nullable(),
    /** sha256 of the image, to send it back unchanged when saving. */
    imageSha256: Sha256.nullable(),
    link: z.string().nullable(),
    pinned: z.boolean(),
    /** In the future = scheduled. */
    publishedAt: z.iso.datetime(),
    createdBy: z.object({ id: z.string(), username: z.string() }).nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .openapi("NewsItem");

export type NewsItem = z.infer<typeof NewsItem>;

export const SaveNews = z
  .object({
    title: z.string().trim().min(1).max(150),
    body: z.string().max(20_000),
    /** An image uploaded with `POST /api/admin/images`, or `null` for none. */
    imageSha256: Sha256.nullable(),
    link: HttpUrl,
    pinned: z.boolean(),
    /** `null` publishes now; a future date schedules it. */
    publishedAt: z.iso.datetime().nullable(),
  })
  .openapi("SaveNews");

export type SaveNews = z.infer<typeof SaveNews>;

export const UploadedImage = z.object({ sha256: Sha256, url: z.url() }).openapi("UploadedImage");

const Binary = z.string().openapi({ type: "string", format: "binary" });
const imageContent = Object.fromEntries(IMAGE_TYPES.map((type) => [type, { schema: Binary }]));

const unauthenticated = problemResponse("Not signed in (`unauthenticated`).");
const instanceParams = z.object({ id: InstanceIdParam });
const newsParams = z.object({ id: InstanceIdParam, newsId: NewsIdParam });
const newsResponse = (description: string) => ({
  description,
  content: { "application/json": { schema: NewsItem } },
});
const saveBody = { required: true, content: { "application/json": { schema: SaveNews } } };
const invalidImage = problemResponse(
  "Invalid request, or `imageSha256` isn't an uploaded image (`invalid_image`).",
);

export const uploadImageRoute = createRoute({
  method: "post",
  path: "/api/admin/images",
  summary: "Upload an image to use in a news item",
  description: `PNG, JPEG, WebP or GIF, up to ${MAX_IMAGE_BYTES / 1024 / 1024} MB, as the raw body. Images that nothing uses are deleted after 24 hours.`,
  tags: ["Admin"],
  request: { body: { required: true, content: imageContent } },
  responses: {
    201: {
      description: "The stored image.",
      content: { "application/json": { schema: UploadedImage } },
    },
    400: problemResponse("Not a PNG, JPEG, WebP or GIF image (`invalid_image`)."),
    401: unauthenticated,
    413: problemResponse("The image is too large (`image_too_large`)."),
  },
});

export const listNewsRoute = createRoute({
  method: "get",
  path: "/api/admin/instances/{id}/news",
  summary: "An instance's news, scheduled ones included",
  description: "Pinned first, then newest first.",
  tags: ["Admin"],
  request: { params: instanceParams },
  responses: {
    200: {
      description: "The news.",
      content: { "application/json": { schema: z.array(NewsItem) } },
    },
    401: unauthenticated,
    404: problemResponse("No such instance (`not_found`)."),
  },
});

export const createNewsRoute = createRoute({
  method: "post",
  path: "/api/admin/instances/{id}/news",
  summary: "Publish or schedule a news item",
  tags: ["Admin"],
  request: { params: instanceParams, body: saveBody },
  responses: {
    201: newsResponse("The new item."),
    400: invalidImage,
    401: unauthenticated,
    404: problemResponse("No such instance (`not_found`)."),
  },
});

export const updateNewsRoute = createRoute({
  method: "put",
  path: "/api/admin/instances/{id}/news/{newsId}",
  summary: "Change a news item",
  tags: ["Admin"],
  request: { params: newsParams, body: saveBody },
  responses: {
    200: newsResponse("The updated item."),
    400: invalidImage,
    401: unauthenticated,
    404: problemResponse("No such instance or news item (`not_found`)."),
  },
});

export const deleteNewsRoute = createRoute({
  method: "delete",
  path: "/api/admin/instances/{id}/news/{newsId}",
  summary: "Delete a news item",
  tags: ["Admin"],
  request: { params: newsParams },
  responses: {
    204: { description: "Deleted." },
    401: unauthenticated,
    404: problemResponse("No such instance or news item (`not_found`)."),
  },
});

/** A published news item as the launcher shows it. */
export const LauncherNewsItem = z
  .object({
    id: z.string(),
    title: z.string(),
    /** Markdown. */
    body: z.string(),
    imageUrl: z.url().nullable(),
    link: z.string().nullable(),
    pinned: z.boolean(),
    publishedAt: z.iso.datetime(),
  })
  .openapi("LauncherNewsItem");

export type LauncherNewsItem = z.infer<typeof LauncherNewsItem>;

export const NEWS_PAGE_SIZE = 20;

export const launcherNewsRoute = createRoute({
  method: "get",
  path: "/api/v1/instances/{id}/news",
  summary: "An instance's published news",
  description: `Pinned first, then newest first, ${NEWS_PAGE_SIZE} per page; pass \`nextCursor\` as \`cursor\` for the next page. Scheduled news doesn't appear until its time.`,
  tags: ["Launcher"],
  security: playerAuth,
  request: {
    params: instanceParams,
    query: z.object({ cursor: z.string().max(200).optional() }),
  },
  responses: {
    200: {
      description: "A page of news.",
      content: {
        "application/json": {
          schema: z.object({
            items: z.array(LauncherNewsItem),
            nextCursor: z.string().nullable(),
          }),
        },
      },
    },
    400: problemResponse("Invalid request, or a cursor that isn't one of ours (`invalid_cursor`)."),
    ...playerAuthResponses,
    404: problemResponse("No such instance, or the player can't see it (`not_found`)."),
  },
});
