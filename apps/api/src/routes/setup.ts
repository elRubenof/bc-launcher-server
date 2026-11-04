import { getSetupStatusRoute, setupRoute } from "@bc-launcher-server/contracts";
import { type Database, schema } from "@bc-launcher-server/db";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { and, eq, exists } from "drizzle-orm";
import type { Context } from "hono";
import { hashPassword } from "../auth/password";
import { startSession } from "../auth/sessions";
import type { AppEnv } from "../platform/types";
import { problem } from "../problem";

export function registerSetup(app: OpenAPIHono<AppEnv>) {
  app.openapi(getSetupStatusRoute, async (c) => {
    return c.json({ required: !(await hasAdmins(c.var.platform.db)) }, 200);
  });

  app.openapi(setupRoute, async (c) => {
    const { db } = c.var.platform;
    const { organizationName, username, password } = c.req.valid("json");

    if (await hasAdmins(db)) return setupCompleted(c);

    const id = crypto.randomUUID();
    const passwordHash = await hashPassword(password);
    const ownerCreated = exists(
      db.select({ id: schema.admins.id }).from(schema.admins).where(eq(schema.admins.id, id)),
    );

    // One atomic batch. The single-owner unique index makes the insert a no-op if another setup
    // won the race, and the settings are only renamed if this owner was inserted.
    await db.batch([
      db
        .insert(schema.admins)
        .values({ id, username, passwordHash, role: "owner" })
        .onConflictDoNothing(),
      db
        .update(schema.settings)
        .set({ name: organizationName, updatedAt: new Date() })
        .where(and(eq(schema.settings.id, 1), ownerCreated)),
    ]);

    const [owner] = await db
      .select({ id: schema.admins.id, username: schema.admins.username, role: schema.admins.role })
      .from(schema.admins)
      .where(eq(schema.admins.id, id));
    if (!owner) return setupCompleted(c);

    await db.insert(schema.auditLog).values({
      adminId: owner.id,
      action: "admin.created",
      target: owner.id,
      details: { username, role: "owner", setup: true },
    });
    await startSession(c, owner.id);
    return c.json(owner, 201);
  });
}

async function hasAdmins(db: Database) {
  const [row] = await db.select({ id: schema.admins.id }).from(schema.admins).limit(1);
  return row !== undefined;
}

function setupCompleted(c: Context<AppEnv>) {
  return problem(c, 409, "setup_completed", "Setup was already completed");
}
