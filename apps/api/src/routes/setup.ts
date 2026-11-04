import { getSetupStatusRoute, setupRoute } from "@bc-launcher-server/contracts";
import { schema } from "@bc-launcher-server/db";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { eq, sql } from "drizzle-orm";
import { hashPassword } from "../auth/password";
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

    // One atomic batch: the owner is only inserted while there are no admins, so of two
    // simultaneous setups only one wins. The other statements only apply if this one did.
    await db.batch([
      db.run(sql`
        insert into admins (id, username, password_hash, role)
        select ${id}, ${username}, ${passwordHash}, 'owner'
        where not exists (select 1 from admins)`),
      db.run(sql`
        update settings
        set name = ${organizationName}, updated_at = cast(unixepoch('subsec') * 1000 as integer)
        where id = 1 and exists (select 1 from admins where id = ${id})`),
      db.run(sql`
        insert into audit_log (admin_id, action, target, details)
        select ${id}, 'admin.created', ${id}, ${JSON.stringify({ username, role: "owner", setup: true })}
        where exists (select 1 from admins where id = ${id})`),
    ]);

    const [owner] = await db
      .select({ id: schema.admins.id, username: schema.admins.username, role: schema.admins.role })
      .from(schema.admins)
      .where(eq(schema.admins.id, id));
    if (!owner) return setupCompleted(c);

    return c.json(owner, 201);
  });
}

async function hasAdmins(db: AppEnv["Variables"]["platform"]["db"]) {
  const [row] = await db.select({ id: schema.admins.id }).from(schema.admins).limit(1);
  return row !== undefined;
}

function setupCompleted(c: Parameters<typeof problem>[0]) {
  return problem(c, 409, "setup_completed", "Setup was already completed");
}
