import { createRoute, z } from "@hono/zod-openapi";
import { problemResponse } from "./problem";

/** Per file: Cloudflare Workers refuse request bodies over 100 MB. */
export const MAX_BLOB_BYTES = 100_000_000;
/** Most files one content change can list. */
export const MAX_INSTANCE_FILES = 10_000;

export const Sha256 = z.string().regex(/^[0-9a-f]{64}$/, "A lowercase sha256 in hex");

export const CheckBlobs = z
  .object({ sha256: z.array(Sha256).max(MAX_INSTANCE_FILES) })
  .openapi("CheckBlobs");

export const CheckBlobsResult = z
  .object({
    /** The hashes the server doesn't have yet: upload them before applying content. */
    missing: z.array(Sha256),
  })
  .openapi("CheckBlobsResult");

export const checkBlobsRoute = createRoute({
  method: "post",
  path: "/api/admin/blobs/check",
  summary: "Which of these files the server doesn't have yet",
  description:
    "Files the server already has get another 24 h before the orphan cleanup can delete them, so they can be applied without uploading them again.",
  tags: ["Admin"],
  request: {
    body: { required: true, content: { "application/json": { schema: CheckBlobs } } },
  },
  responses: {
    200: {
      description: "The missing hashes.",
      content: { "application/json": { schema: CheckBlobsResult } },
    },
    400: problemResponse("Invalid request."),
    401: problemResponse("Not signed in (`unauthenticated`)."),
  },
});

export const UploadedBlob = z.object({ sha256: Sha256, size: z.int() }).openapi("UploadedBlob");

export const uploadBlobRoute = createRoute({
  method: "put",
  path: "/api/admin/blobs/{sha256}",
  summary: "Upload a file, addressed by its sha256",
  description: `The raw bytes, up to ${MAX_BLOB_BYTES / 1_000_000} MB, with a \`Content-Length\`. The server hashes them while storing and refuses them if they don't match. A file the server already has is not read again. Uploaded files are invisible until content that uses them is applied.`,
  tags: ["Admin"],
  request: {
    params: z.object({ sha256: Sha256.openapi({ param: { name: "sha256", in: "path" } }) }),
    body: {
      required: true,
      content: {
        "application/octet-stream": {
          schema: z.string().openapi({ type: "string", format: "binary" }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Stored (or already there).",
      content: { "application/json": { schema: UploadedBlob } },
    },
    400: problemResponse(
      "The bytes don't match the sha256 or the `Content-Length` (`hash_mismatch`).",
    ),
    401: problemResponse("Not signed in (`unauthenticated`)."),
    411: problemResponse("The request has no `Content-Length` (`length_required`)."),
    413: problemResponse("The file is too large (`blob_too_large`)."),
  },
});
