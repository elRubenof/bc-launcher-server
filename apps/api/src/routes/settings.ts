import { getSettingsRoute, updateSettingsRoute } from "@bc-launcher-server/contracts";
import { schema } from "@bc-launcher-server/db";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { and, eq, isNotNull, not, sql } from "drizzle-orm";
import { orgWhitelisted } from "../access";
import { managersOnly } from "../auth/roles";
import type { AppEnv } from "../platform/types";
import { readSettings, toOrganizationSettings } from "../settings";

export function registerSettings(app: OpenAPIHono<AppEnv>) {
  app.openapi(getSettingsRoute, async (c) => {
    const { db, config } = c.var.platform;
    return c.json(toOrganizationSettings(await readSettings(db), config), 200);
  });

  app.openapi(updateSettingsRoute, async (c) => {
    const forbidden = managersOnly(c);
    if (forbidden) return forbidden;

    const { db, config } = c.var.platform;
    const { whitelistJoinedPlayers, ...update } = c.req.valid("json");
    const before = await readSettings(db);
    const changed = (Object.keys(update) as (keyof typeof update)[]).filter(
      (key) => update[key] !== before[key],
    );
    const goingPrivate = before.visibility === "public" && update.visibility === "private";

    if (changed.length > 0) {
      const adminId = c.var.admin.id;
      const joined = db
        .select({
          playerUuid: schema.players.uuid,
          createdBy: sql`${adminId}`.as("created_by"),
          createdAt: sql`${Date.now()}`.as("created_at"),
        })
        .from(schema.players)
        .where(
          and(isNotNull(schema.players.firstSeenAt), not(orgWhitelisted(db, schema.players.uuid))),
        );
      const imported = goingPrivate && whitelistJoinedPlayers ? await db.$count(joined) : 0;
      await db.batch([
        db
          .update(schema.settings)
          .set({ ...update, updatedAt: new Date() })
          .where(eq(schema.settings.id, 1)),
        // In the same batch: nobody who already joined is left out, not even for a moment.
        ...(imported > 0
          ? [db.insert(schema.orgWhitelist).select(joined).onConflictDoNothing()]
          : []),
        db.insert(schema.auditLog).values({
          adminId,
          action:
            update.visibility !== before.visibility
              ? "org.visibility_changed"
              : "org.settings_changed",
          details: {
            changed,
            ...(changed.includes("visibility") ? { to: update.visibility } : {}),
            ...(imported > 0 ? { whitelisted: imported } : {}),
          },
        }),
      ]);
    }

    return c.json(toOrganizationSettings(await readSettings(db), config), 200);
  });
}
