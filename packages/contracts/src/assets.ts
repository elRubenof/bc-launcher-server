import { createRoute, z } from "@hono/zod-openapi";
import { problemResponse } from "./problem";
import { OrganizationSettings } from "./settings";

/** Image types accepted for the organization's logo and icon. SVG is not accepted. */
export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

const Binary = z.string().openapi({ type: "string", format: "binary" });
const imageContent = Object.fromEntries(IMAGE_TYPES.map((type) => [type, { schema: Binary }]));

const OrganizationImageParams = z.object({
  kind: z.enum(["logo", "icon"]).openapi({ param: { name: "kind", in: "path" } }),
});

export const uploadOrganizationImageRoute = createRoute({
  method: "put",
  path: "/api/admin/settings/{kind}",
  summary: "Upload the organization's logo or icon (owner only)",
  description: `PNG, JPEG, WebP or GIF, up to ${MAX_IMAGE_BYTES / 1024 / 1024} MB, as the raw body.`,
  tags: ["Admin"],
  request: {
    params: OrganizationImageParams,
    body: { required: true, content: imageContent },
  },
  responses: {
    200: {
      description: "The organization's settings with the new image.",
      content: { "application/json": { schema: OrganizationSettings } },
    },
    400: problemResponse("Not a PNG, JPEG, WebP or GIF image (`invalid_image`)."),
    401: problemResponse("Not signed in (`unauthenticated`)."),
    403: problemResponse("Only owners can do this (`forbidden`)."),
    413: problemResponse("The image is too large (`image_too_large`)."),
  },
});

export const deleteOrganizationImageRoute = createRoute({
  method: "delete",
  path: "/api/admin/settings/{kind}",
  summary: "Remove the organization's logo or icon (owner only)",
  tags: ["Admin"],
  request: { params: OrganizationImageParams },
  responses: {
    200: {
      description: "The organization's settings without the image.",
      content: { "application/json": { schema: OrganizationSettings } },
    },
    401: problemResponse("Not signed in (`unauthenticated`)."),
    403: problemResponse("Only owners can do this (`forbidden`)."),
  },
});

export const getAssetRoute = createRoute({
  method: "get",
  path: "/api/v1/assets/{sha256}",
  summary: "A public image (logo, icon), addressed by its sha256",
  tags: ["Launcher"],
  request: {
    params: z.object({
      sha256: z
        .string()
        .regex(/^[0-9a-f]{64}$/)
        .openapi({ param: { name: "sha256", in: "path" } }),
    }),
  },
  responses: {
    200: { description: "The image. Immutable: cache it forever.", content: imageContent },
    404: problemResponse("No such asset (`not_found`)."),
  },
});
