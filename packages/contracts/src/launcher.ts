import { createRoute, z } from "@hono/zod-openapi";
import { Sha256 } from "./blobs";
import { FilePolicy } from "./content";
import { InstanceColors, LOADERS } from "./instances";
import { problemResponse } from "./problem";

const InstanceIdParam = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{1,39}$/)
  .openapi({ param: { name: "id", in: "path" } });

/** An instance as the launcher shows it: links already fall back to the organization's. */
export const LauncherInstance = z
  .object({
    id: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    iconUrl: z.url().nullable(),
    backgroundUrl: z.url(),
    colors: InstanceColors,
    mapUrl: z.string().nullable(),
    discordUrl: z.string().nullable(),
    webUrl: z.string().nullable(),
    minecraft: z.object({ version: z.string() }),
    loader: z.object({ type: z.enum(LOADERS), version: z.string().nullable() }),
    /** `host` or `host:port`, for auto-connect. */
    serverAddress: z.string().nullable(),
    recommendedRamMb: z.int().nullable(),
    contentVersion: z.int(),
  })
  .openapi("LauncherInstance");

export type LauncherInstance = z.infer<typeof LauncherInstance>;

export const ManifestFile = z
  .object({
    path: z.string(),
    sha256: Sha256,
    size: z.int(),
    policy: FilePolicy,
    /** Signed, short-lived download URL (6 to 12 hours). Needs no auth header. */
    url: z.url(),
  })
  .openapi("ManifestFile");

export const Manifest = z
  .object({
    contentVersion: z.int(),
    minecraft: z.object({ version: z.string() }),
    /** The launcher installs the loader itself; the server never serves loader files. */
    loader: z.object({ type: z.enum(LOADERS), version: z.string().nullable() }),
    server: z.object({ address: z.string().nullable() }),
    /** Folders where anything not listed in `files` is deleted. */
    managedDirs: z.array(z.string()),
    files: z.array(ManifestFile),
  })
  .openapi("Manifest");

export type Manifest = z.infer<typeof Manifest>;

export const listLauncherInstancesRoute = createRoute({
  method: "get",
  path: "/api/v1/instances",
  summary: "The instances the player can play, newest first",
  description: "Active instances with content. Player auth and access filtering come later.",
  tags: ["Launcher"],
  responses: {
    200: {
      description: "The instances.",
      content: {
        "application/json": { schema: z.object({ instances: z.array(LauncherInstance) }) },
      },
    },
  },
});

export const getManifestRoute = createRoute({
  method: "get",
  path: "/api/v1/instances/{id}/manifest",
  summary: "What to sync into the instance folder",
  description:
    "Send the last `ETag` in `If-None-Match` to get `304` while nothing changed. The ETag changes with `contentVersion` and when the download URLs are renewed.",
  tags: ["Launcher"],
  request: { params: z.object({ id: InstanceIdParam }) },
  responses: {
    200: {
      description: "The manifest.",
      content: { "application/json": { schema: Manifest } },
    },
    304: { description: "Not modified." },
    404: problemResponse("No such instance, or the player can't see it (`not_found`)."),
  },
});

export const getBlobRoute = createRoute({
  method: "get",
  path: "/api/v1/blobs/{sha256}",
  summary: "Download a file from a manifest's signed URL",
  tags: ["Launcher"],
  request: {
    params: z.object({ sha256: Sha256.openapi({ param: { name: "sha256", in: "path" } }) }),
    query: z.object({
      exp: z.coerce.number().int().positive(),
      sig: z.string().max(100),
    }),
  },
  responses: {
    200: {
      description: "The file. Immutable.",
      content: {
        "application/octet-stream": {
          schema: z.string().openapi({ type: "string", format: "binary" }),
        },
      },
    },
    400: problemResponse("Invalid request."),
    403: problemResponse(
      "The signature is wrong (`invalid_signature`) or the URL expired (`url_expired`): fetch the manifest again.",
    ),
    404: problemResponse("No such file (`not_found`)."),
  },
});
