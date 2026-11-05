import type { IMAGE_TYPES } from "@bc-launcher-server/contracts";
import { type Database, schema } from "@bc-launcher-server/db";
import type { Context } from "hono";
import { sha256Hex } from "./auth/crypto";
import type { AppEnv } from "./platform/types";
import { problem } from "./problem";

type ImageType = (typeof IMAGE_TYPES)[number];

const startsWith = (bytes: Uint8Array, signature: number[], offset = 0) =>
  signature.every((byte, i) => bytes[offset + i] === byte);

/** Detects the image type from its first bytes; the request's Content-Type is not trusted. */
export function sniffImageType(bytes: Uint8Array): ImageType | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return "image/gif";
  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return "image/webp";
  }
  return null;
}

/**
 * Reads an uploaded image from the raw request body and stores it in the BlobStore. Returns the
 * values for its `blobs` row (the caller inserts it in the same batch that references it), or a
 * problem response for images that are too large or not an accepted type.
 */
export async function storeUploadedImage(c: Context<AppEnv>, maxBytes: number) {
  const tooLarge = () => problem(c, 413, "image_too_large", "The image is too large");
  if (Number(c.req.header("Content-Length") ?? 0) > maxBytes) return tooLarge();

  const bytes = new Uint8Array(await c.req.arrayBuffer());
  if (bytes.byteLength > maxBytes) return tooLarge();
  const contentType = sniffImageType(bytes);
  if (!contentType) return problem(c, 400, "invalid_image", "Not a PNG, JPEG, WebP or GIF image");

  const { blobs } = c.var.platform;
  const sha256 = await sha256Hex(bytes);
  if (!(await blobs.head(sha256))) {
    await blobs.put(sha256, new Blob([bytes]).stream(), bytes.byteLength);
  }
  return { sha256, contentType, size: bytes.byteLength };
}

/** The `blobs` upsert for a stored image: marks the blob as a public image. */
export function upsertImageBlob(
  db: Database,
  image: { sha256: string; contentType: string; size: number },
) {
  return db
    .insert(schema.blobs)
    .values({ ...image, orphanedAt: null })
    .onConflictDoUpdate({
      target: schema.blobs.sha256,
      set: { contentType: image.contentType, orphanedAt: null },
    });
}
