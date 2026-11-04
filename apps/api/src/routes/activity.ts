import { listActivityRoute } from "@bc-launcher-server/contracts";
import { schema } from "@bc-launcher-server/db";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { and, desc, eq, like, lt, type SQL } from "drizzle-orm";
import type { AppEnv } from "../platform/types";

export function registerActivity(app: OpenAPIHono<AppEnv>) {
  app.openapi(listActivityRoute, async (c) => {
    const { adminId, type, before, limit } = c.req.valid("query");
    const filters: SQL[] = [];
    if (adminId) filters.push(eq(schema.auditLog.adminId, adminId));
    if (type) filters.push(like(schema.auditLog.action, `${type}.%`));
    if (before) filters.push(lt(schema.auditLog.id, before));

    const rows = await c.var.platform.db
      .select({
        entry: schema.auditLog,
        admin: { id: schema.admins.id, username: schema.admins.username },
      })
      .from(schema.auditLog)
      .leftJoin(schema.admins, eq(schema.admins.id, schema.auditLog.adminId))
      .where(and(...filters))
      .orderBy(desc(schema.auditLog.id))
      // One extra row tells whether there is another page.
      .limit(limit + 1);

    const page = rows.slice(0, limit);
    return c.json(
      {
        items: page.map(({ entry, admin }) => ({
          id: entry.id,
          action: entry.action,
          target: entry.target,
          details: (entry.details as Record<string, unknown> | null) ?? null,
          createdAt: entry.createdAt.toISOString(),
          admin,
        })),
        nextBefore: rows.length > limit ? (page.at(-1)?.entry.id ?? null) : null,
      },
      200,
    );
  });
}
