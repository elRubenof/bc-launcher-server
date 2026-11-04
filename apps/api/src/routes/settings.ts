import { getSettingsRoute, updateSettingsRoute } from "@bc-launcher-server/contracts";
import { schema } from "@bc-launcher-server/db";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
import { ownerOnly } from "../auth/roles";
import type { AppEnv } from "../platform/types";
import { readSettings, toOrganizationSettings } from "../settings";

export function registerSettings(app: OpenAPIHono<AppEnv>) {
  app.openapi(getSettingsRoute, async (c) => {
    const { db, config } = c.var.platform;
    return c.json(toOrganizationSettings(await readSettings(db), config), 200);
  });

  app.openapi(updateSettingsRoute, async (c) => {
    const forbidden = ownerOnly(c);
    if (forbidden) return forbidden;

    const { db, config } = c.var.platform;
    const update = c.req.valid("json");
    const before = await readSettings(db);
    const changed = (Object.keys(update) as (keyof typeof update)[]).filter(
      (key) => update[key] !== before[key],
    );

    if (changed.length > 0) {
      await db.batch([
        db
          .update(schema.settings)
          .set({ ...update, updatedAt: new Date() })
          .where(eq(schema.settings.id, 1)),
        db.insert(schema.auditLog).values({
          adminId: c.var.admin.id,
          action:
            update.visibility !== before.visibility
              ? "org.visibility_changed"
              : "org.settings_changed",
          details: {
            changed,
            ...(changed.includes("visibility") ? { to: update.visibility } : {}),
          },
        }),
      ]);
    }

    return c.json(toOrganizationSettings(await readSettings(db), config), 200);
  });
}
