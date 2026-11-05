import { createRoute, z } from "@hono/zod-openapi";
import { problemResponse } from "./problem";

export const ServerUpdates = z
  .object({
    /** This server's version (`serverVersion` in discovery). */
    current: z.string(),
    /** The latest published release (`X.Y.Z`), or `null` if it couldn't be checked. */
    latest: z.string().nullable(),
    /** The latest release's page, with its notes; `null` with `latest`. */
    url: z.url().nullable(),
    /** `latest` is newer than `current`. */
    updateAvailable: z.boolean(),
  })
  .openapi("ServerUpdates");

export type ServerUpdates = z.infer<typeof ServerUpdates>;

export const getUpdatesRoute = createRoute({
  method: "get",
  path: "/api/admin/updates",
  summary: "Whether a newer server release is published",
  description:
    "Compares this server's version with the latest release on GitHub, checked at most every few hours. Owner and admins only.",
  tags: ["Admin"],
  responses: {
    200: {
      description: "The current and latest versions.",
      content: { "application/json": { schema: ServerUpdates } },
    },
    401: problemResponse("Not signed in (`unauthenticated`)."),
    403: problemResponse("Only the owner and admins can see this (`forbidden`)."),
  },
});
