import {
  deleteOrganizationImageRoute,
  getAssetRoute,
  MAX_IMAGE_BYTES,
  uploadOrganizationImageRoute,
} from "@bc-launcher-server/contracts";
import { schema } from "@bc-launcher-server/db";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
import { sha256Hex } from "../auth/crypto";
import { managersOnly } from "../auth/roles";
import { sniffImageType } from "../images";
import type { AppEnv } from "../platform/types";
import { problem } from "../problem";
import { readSettings, toOrganizationSettings } from "../settings";

const column = { logo: "logoBlob", icon: "iconBlob" } as const;

export function registerAssets(app: OpenAPIHono<AppEnv>) {
  app.openapi(uploadOrganizationImageRoute, async (c) => {
    const forbidden = managersOnly(c);
    if (forbidden) return forbidden;

    const { kind } = c.req.valid("param");
    const tooLarge = () => problem(c, 413, "image_too_large", "The image is too large");
    if (Number(c.req.header("Content-Length") ?? 0) > MAX_IMAGE_BYTES) return tooLarge();

    const bytes = new Uint8Array(await c.req.arrayBuffer());
    if (bytes.byteLength > MAX_IMAGE_BYTES) return tooLarge();
    const contentType = sniffImageType(bytes);
    if (!contentType) {
      return problem(c, 400, "invalid_image", "Not a PNG, JPEG, WebP or GIF image");
    }

    const { db, blobs, config } = c.var.platform;
    const sha256 = await sha256Hex(bytes);
    if (!(await blobs.head(sha256))) {
      await blobs.put(sha256, new Blob([bytes]).stream(), bytes.byteLength);
    }
    await db.batch([
      db
        .insert(schema.blobs)
        .values({ sha256, contentType, size: bytes.byteLength })
        .onConflictDoUpdate({ target: schema.blobs.sha256, set: { contentType } }),
      db
        .update(schema.settings)
        .set({ [column[kind]]: sha256, updatedAt: new Date() })
        .where(eq(schema.settings.id, 1)),
      db.insert(schema.auditLog).values({
        adminId: c.var.admin.id,
        action: `org.${kind}_changed`,
        details: { sha256 },
      }),
    ]);

    return c.json(toOrganizationSettings(await readSettings(db), config), 200);
  });

  app.openapi(deleteOrganizationImageRoute, async (c) => {
    const forbidden = managersOnly(c);
    if (forbidden) return forbidden;

    const { kind } = c.req.valid("param");
    const { db, config } = c.var.platform;
    await db.batch([
      db
        .update(schema.settings)
        .set({ [column[kind]]: null, updatedAt: new Date() })
        .where(eq(schema.settings.id, 1)),
      db.insert(schema.auditLog).values({ adminId: c.var.admin.id, action: `org.${kind}_removed` }),
    ]);
    return c.json(toOrganizationSettings(await readSettings(db), config), 200);
  });

  app.openapi(getAssetRoute, async (c) => {
    const { sha256 } = c.req.valid("param");
    const { db, blobs } = c.var.platform;
    const [asset] = await db.select().from(schema.blobs).where(eq(schema.blobs.sha256, sha256));
    // Only images are public; content files are served through signed URLs.
    const blob = asset?.contentType ? await blobs.get(sha256) : null;
    if (!asset?.contentType || !blob) return problem(c, 404, "not_found", "No such asset");

    return c.body(blob.body, 200, {
      "Content-Type": asset.contentType,
      "Content-Length": String(blob.size),
      // Content-addressed: the bytes behind a URL never change.
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    });
  });
}
