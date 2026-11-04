import {
  type AdminListItem,
  createAdminRoute,
  deleteAdminRoute,
  listAdminsRoute,
  resetAdminPasswordRoute,
} from "@bc-launcher-server/contracts";
import { schema } from "@bc-launcher-server/db";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { asc, desc, eq } from "drizzle-orm";
import type { Context } from "hono";
import { hashPassword } from "../auth/password";
import { ownerOnly } from "../auth/roles";
import type { AppEnv } from "../platform/types";
import { problem } from "../problem";

type AdminRow = typeof schema.admins.$inferSelect;

function toListItem(row: AdminRow): AdminListItem {
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export function registerAdmins(app: OpenAPIHono<AppEnv>) {
  app.openapi(listAdminsRoute, async (c) => {
    const rows = await c.var.platform.db
      .select()
      .from(schema.admins)
      // "owner" sorts after "editor", so descending puts owners first.
      .orderBy(desc(schema.admins.role), asc(schema.admins.username));
    return c.json(rows.map(toListItem), 200);
  });

  app.openapi(createAdminRoute, async (c) => {
    const forbidden = ownerOnly(c);
    if (forbidden) return forbidden;

    const { db } = c.var.platform;
    const { username, password, role } = c.req.valid("json");
    const id = crypto.randomUUID();
    const [created] = await db
      .insert(schema.admins)
      .values({ id, username, passwordHash: await hashPassword(password), role })
      .onConflictDoNothing({ target: schema.admins.username })
      .returning();
    if (!created) return problem(c, 409, "username_taken", "That username is taken");

    await db.insert(schema.auditLog).values({
      adminId: c.var.admin.id,
      action: "admin.created",
      target: id,
      details: { username, role },
    });
    return c.json(toListItem(created), 201);
  });

  app.openapi(resetAdminPasswordRoute, async (c) => {
    const forbidden = ownerOnly(c);
    if (forbidden) return forbidden;

    const { id } = c.req.valid("param");
    const target = await findOther(c, id);
    if (target instanceof Response) return target;

    const { db } = c.var.platform;
    const { password } = c.req.valid("json");
    await db.batch([
      db
        .update(schema.admins)
        .set({ passwordHash: await hashPassword(password), updatedAt: new Date() })
        .where(eq(schema.admins.id, id)),
      db.delete(schema.adminSessions).where(eq(schema.adminSessions.adminId, id)),
      db.insert(schema.auditLog).values({
        adminId: c.var.admin.id,
        action: "admin.password_reset",
        target: id,
        details: { username: target.username },
      }),
    ]);
    return c.body(null, 204);
  });

  app.openapi(deleteAdminRoute, async (c) => {
    const forbidden = ownerOnly(c);
    if (forbidden) return forbidden;

    const { id } = c.req.valid("param");
    const target = await findOther(c, id);
    if (target instanceof Response) return target;

    const { db } = c.var.platform;
    // Sessions go with the admin (ON DELETE CASCADE).
    await db.batch([
      db.delete(schema.admins).where(eq(schema.admins.id, id)),
      db.insert(schema.auditLog).values({
        adminId: c.var.admin.id,
        action: "admin.removed",
        target: id,
        details: { username: target.username, role: target.role },
      }),
    ]);
    return c.body(null, 204);
  });
}

/** The admin with `id`, unless it's the caller (they use their own password change). */
async function findOther(c: Context<AppEnv>, id: string) {
  if (id === c.var.admin.id) {
    return problem(c, 400, "cannot_target_self", "You can't do this to your own account");
  }
  const [target] = await c.var.platform.db
    .select()
    .from(schema.admins)
    .where(eq(schema.admins.id, id));
  return target ?? problem(c, 404, "not_found", "No such admin");
}
