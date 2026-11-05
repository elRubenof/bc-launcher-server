import { createRoute, z } from "@hono/zod-openapi";
import { problemResponse } from "./problem";
import { OrganizationSettings } from "./settings";

/** Image types accepted for the organization's logo and news images. SVG is not accepted. */
export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

const Binary = z.string().openapi({ type: "string", format: "binary" });
const imageContent = Object.fromEntries(IMAGE_TYPES.map((type) => [type, { schema: Binary }]));

export const uploadOrganizationImageRoute = createRoute({
  method: "put",
  path: "/api/admin/settings/logo",
  summary: "Upload the organization's logo (owner and admins)",
  description: `PNG, JPEG, WebP or GIF, up to ${MAX_IMAGE_BYTES / 1024 / 1024} MB, as the raw body.`,
  tags: ["Admin"],
  request: {
    body: { required: true, content: imageContent },
  },
  responses: {
    200: {
      description: "The organization's settings with the new image.",
      content: { "application/json": { schema: OrganizationSettings } },
    },
    400: problemResponse("Not a PNG, JPEG, WebP or GIF image (`invalid_image`)."),
    401: problemResponse("Not signed in (`unauthenticated`)."),
    403: problemResponse("Only the owner and admins can do this (`forbidden`)."),
    413: problemResponse("The image is too large (`image_too_large`)."),
  },
});

export const deleteOrganizationImageRoute = createRoute({
  method: "delete",
  path: "/api/admin/settings/logo",
  summary: "Remove the organization's logo (owner and admins)",
  tags: ["Admin"],
  responses: {
    200: {
      description: "The organization's settings without the image.",
      content: { "application/json": { schema: OrganizationSettings } },
    },
    401: problemResponse("Not signed in (`unauthenticated`)."),
    403: problemResponse("Only the owner and admins can do this (`forbidden`)."),
  },
});

export const getAssetRoute = createRoute({
  method: "get",
  path: "/api/v1/assets/{sha256}",
  summary:
    "A public image (logo, instance icon or background, news image), addressed by its sha256",
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
