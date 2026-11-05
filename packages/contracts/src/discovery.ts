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
    links: z.object({
      discord: z.url().nullable(),
      web: z.url().nullable(),
    }),
    serverVersion: z.string(),
    apiVersions: z.array(z.int().positive()),
    minLauncherVersion: z.string().nullable(),
    capabilities: z.array(z.string()),
    auth: z.object({
      /**
       * `mojang-session`: the launcher calls Mojang's `join` and the server checks `hasJoined`.
       * `unverified`: the server can't reach Mojang (Cloudflare without a session proxy) and trusts
       * the name sent to `verify`; the launcher still calls `join` and the request is the same.
       */
      type: z.enum(["mojang-session", "unverified"]),
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
