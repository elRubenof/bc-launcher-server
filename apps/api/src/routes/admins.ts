import {
  type AdminListItem,
  changeAdminRoleRoute,
  createAdminRoute,
  deleteAdminRoute,
  listAdminsRoute,
  resetAdminPasswordRoute,
} from "@bc-launcher-server/contracts";
import { schema } from "@bc-launcher-server/db";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { asc, eq, sql } from "drizzle-orm";
import type { Context } from "hono";
import { hashPassword } from "../auth/password";
import { managersOnly } from "../auth/roles";
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

const roleOrder = sql`case ${schema.admins.role} when 'owner' then 0 when 'admin' then 1 else 2 end`;

export function registerAdmins(app: OpenAPIHono<AppEnv>) {
  app.openapi(listAdminsRoute, async (c) => {
    const rows = await c.var.platform.db
      .select()
      .from(schema.admins)
      .orderBy(roleOrder, asc(schema.admins.username));
    return c.json(rows.map(toListItem), 200);
  });

  app.openapi(createAdminRoute, async (c) => {
    const forbidden = managersOnly(c);
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

  app.openapi(changeAdminRoleRoute, async (c) => {
    const forbidden = managersOnly(c);
    if (forbidden) return forbidden;

    const { id } = c.req.valid("param");
    const target = await findTarget(c, id);
    if (target instanceof Response) return target;

    const { db } = c.var.platform;
    const { role } = c.req.valid("json");
    if (role === target.role) return c.json(toListItem(target), 200);

    // The new role applies to the account's next request: sessions read it from the database.
    const [updated] = await db.batch([
      db
        .update(schema.admins)
        .set({ role, updatedAt: new Date() })
        .where(eq(schema.admins.id, id))
        .returning(),
      db.insert(schema.auditLog).values({
        adminId: c.var.admin.id,
        action: "admin.role_changed",
        target: id,
        details: { username: target.username, from: target.role, to: role },
      }),
    ]);
    const row = updated[0];
    if (!row) return problem(c, 404, "not_found", "No such admin");
    return c.json(toListItem(row), 200);
  });

  app.openapi(resetAdminPasswordRoute, async (c) => {
    const forbidden = managersOnly(c);
    if (forbidden) return forbidden;

    const { id } = c.req.valid("param");
    const target = await findTarget(c, id);
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
    const forbidden = managersOnly(c);
    if (forbidden) return forbidden;

    const { id } = c.req.valid("param");
    const target = await findTarget(c, id);
    if (target instanceof Response) return target;

    const { db } = c.var.platform;
    // Sessions go with the account (ON DELETE CASCADE).
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

/**
 * The account someone can act on: never their own (they use their own password change), and never
 * the owner's. Since only the owner could otherwise act on the owner, that is the same as saying
 * nobody can.
 */
async function findTarget(c: Context<AppEnv>, id: string) {
  if (id === c.var.admin.id) {
    return problem(c, 400, "cannot_target_self", "You can't do this to your own account");
  }
  const [target] = await c.var.platform.db
    .select()
    .from(schema.admins)
    .where(eq(schema.admins.id, id));
  if (!target) return problem(c, 404, "not_found", "No such admin");
  if (target.role === "owner") {
    return problem(c, 403, "owner_protected", "Nobody can change or remove the owner");
  }
  return target;
}
