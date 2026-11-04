import { createRoute, z } from "@hono/zod-openapi";
import { problemResponse } from "./problem";

export const ActivityEntry = z
  .object({
    id: z.int(),
    /** Stable action code, e.g. `admin.created`, `org.visibility_changed`. */
    action: z.string(),
    target: z.string().nullable(),
    details: z.record(z.string(), z.unknown()).nullable(),
    createdAt: z.iso.datetime(),
    /** Who did it; `null` for an admin that was removed since. */
    admin: z.object({ id: z.string(), username: z.string() }).nullable(),
  })
  .openapi("ActivityEntry");

export type ActivityEntry = z.infer<typeof ActivityEntry>;

export const ActivityPage = z
  .object({
    items: z.array(ActivityEntry),
    /** Pass as `before` to get the next (older) page; `null` when there is none. */
    nextBefore: z.int().nullable(),
  })
  .openapi("ActivityPage");

export const listActivityRoute = createRoute({
  method: "get",
  path: "/api/admin/activity",
  summary: "The audit log, newest first",
  tags: ["Admin"],
  request: {
    query: z.object({
      adminId: z.string().optional(),
      /** Action prefix: `admin`, `org`, ... */
      type: z
        .string()
        .regex(/^[a-z_]+$/)
        .optional(),
      before: z.coerce.number().int().positive().optional(),
      limit: z.coerce.number().int().min(1).max(100).default(50),
    }),
  },
  responses: {
    200: {
      description: "A page of entries.",
      content: { "application/json": { schema: ActivityPage } },
    },
    400: problemResponse("Invalid request."),
    401: problemResponse("Not signed in (`unauthenticated`)."),
  },
});
