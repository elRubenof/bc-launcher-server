import { getSetupStatusRoute, setupRoute } from "@bc-launcher-server/contracts";
import { type Database, schema } from "@bc-launcher-server/db";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
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

    // One atomic batch. The setup lock's primary key makes a second setup fail, which rolls back
    // the whole batch, so of two simultaneous setups only one creates its owner.
    try {
      await db.batch([
        db.insert(schema.setupLock).values({ id: 1 }),
        db.insert(schema.admins).values({ id, username, passwordHash, role: "owner" }),
        db
          .update(schema.settings)
          .set({ name: organizationName, updatedAt: new Date() })
          .where(eq(schema.settings.id, 1)),
      ]);
    } catch (error) {
      if (await hasAdmins(db)) return setupCompleted(c);
      throw error;
    }

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
