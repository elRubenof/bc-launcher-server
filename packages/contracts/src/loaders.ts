import { createRoute, z } from "@hono/zod-openapi";
import { problemResponse } from "./problem";

export const MinecraftVersion = z
  .object({
    id: z.string(),
    type: z.enum(["release", "snapshot", "old_beta", "old_alpha"]),
    releaseTime: z.iso.datetime({ offset: true }),
  })
  .openapi("MinecraftVersion");

export type MinecraftVersion = z.infer<typeof MinecraftVersion>;

export const LoaderVersion = z
  .object({
    version: z.string(),
    /** False for betas and pre-releases. */
    stable: z.boolean(),
    /** The version to suggest: the loader's recommended one, or else the newest stable one. */
    recommended: z.boolean(),
  })
  .openapi("LoaderVersion");

export type LoaderVersion = z.infer<typeof LoaderVersion>;

const unavailable = problemResponse(
  "The official metadata couldn't be fetched (`metadata_unavailable`).",
);

export const listMinecraftVersionsRoute = createRoute({
  method: "get",
  path: "/api/admin/minecraft/versions",
  summary: "Minecraft versions, newest first (from Mojang's version manifest)",
  tags: ["Admin"],
  request: {
    query: z.object({
      /** Include snapshots and old betas/alphas. */
      all: z.enum(["true", "false"]).default("false"),
    }),
  },
  responses: {
    200: {
      description: "The versions.",
      content: {
        "application/json": { schema: z.object({ versions: z.array(MinecraftVersion) }) },
      },
    },
    401: problemResponse("Not signed in (`unauthenticated`)."),
    502: unavailable,
  },
});

export const listLoaderVersionsRoute = createRoute({
  method: "get",
  path: "/api/admin/loaders/{type}/versions",
  summary: "A loader's versions for a Minecraft version, newest first",
  description:
    "From the loader's official metadata (Fabric and Quilt meta, Forge and NeoForge maven), cached for a few minutes. Empty if the loader doesn't support that Minecraft version.",
  tags: ["Admin"],
  request: {
    params: z.object({
      type: z
        .enum(["fabric", "quilt", "forge", "neoforge"])
        .openapi({ param: { name: "type", in: "path" } }),
    }),
    query: z.object({ mc: z.string().trim().min(1).max(50) }),
  },
  responses: {
    200: {
      description: "The versions.",
      content: {
        "application/json": { schema: z.object({ versions: z.array(LoaderVersion) }) },
      },
    },
    400: problemResponse("Invalid request."),
    401: problemResponse("Not signed in (`unauthenticated`)."),
    502: unavailable,
  },
});
