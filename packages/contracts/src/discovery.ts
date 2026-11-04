import { createRoute, z } from "@hono/zod-openapi";

/**
 * `GET /.well-known/bc-launcher`. Unversioned: this format must never break.
 * Breaking changes need a new `discoveryVersion`.
 */
export const DiscoveryDocument = z
  .object({
    discoveryVersion: z.literal(1),
    visibility: z.enum(["public", "private"]),
    name: z.string(),
    description: z.string().nullable(),
    logoUrl: z.url().nullable(),
    iconUrl: z.url().nullable(),
    links: z.object({
      discord: z.url().nullable(),
      web: z.url().nullable(),
    }),
    serverVersion: z.string(),
    apiVersions: z.array(z.int().positive()),
    minLauncherVersion: z.string().nullable(),
    capabilities: z.array(z.string()),
    auth: z.object({
      type: z.literal("mojang-session"),
    }),
  })
  .openapi("DiscoveryDocument");

export type DiscoveryDocument = z.infer<typeof DiscoveryDocument>;

export const discoveryRoute = createRoute({
  method: "get",
  path: "/.well-known/bc-launcher",
  summary: "Organization discovery document",
  tags: ["Discovery"],
  responses: {
    200: {
      description: "Public identity and capabilities of this organization's server.",
      content: { "application/json": { schema: DiscoveryDocument } },
    },
  },
});
