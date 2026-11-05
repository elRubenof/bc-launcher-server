import { getUpdatesRoute } from "@bc-launcher-server/contracts";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { managersOnly } from "../auth/roles";
import type { AppEnv } from "../platform/types";
import { checkUpdates } from "../updates";

export function registerUpdates(app: OpenAPIHono<AppEnv>) {
  app.openapi(getUpdatesRoute, async (c) => {
    const denied = managersOnly(c);
    if (denied) return denied;
    return c.json(await checkUpdates(c.var.platform), 200);
  });
}
