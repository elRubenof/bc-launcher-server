import { OpenAPIHono } from "@hono/zod-openapi";
import { sql } from "drizzle-orm";
import { requireAdmin } from "./middleware/admin";
import { sameOrigin } from "./middleware/origin";
import type { AppEnv, PlatformResolver } from "./platform/types";
import { problem } from "./problem";
import { registerActivity } from "./routes/activity";
import { registerAdmins } from "./routes/admins";
import { registerAssets } from "./routes/assets";
import { registerAuth } from "./routes/auth";
import { registerBlobs } from "./routes/blobs";
import { registerDiscovery } from "./routes/discovery";
import { registerInstances } from "./routes/instances";
import { registerSettings } from "./routes/settings";
import { registerSetup } from "./routes/setup";

export function createApp(resolvePlatform: PlatformResolver) {
  const app = new OpenAPIHono<AppEnv>({
    defaultHook: (result, c) => {
      if (!result.success) {
        const detail = result.error.issues
          .map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`)
          .join("; ");
        return problem(c, 400, "validation_error", "Invalid request", detail);
      }
    },
  });

  app.use(async (c, next) => {
    c.set("platform", resolvePlatform(c.env));
    await next();
  });

  app.use("/api/admin/*", sameOrigin, requireAdmin);

  app.get("/health", async (c) => {
    try {
      await c.var.platform.db.run(sql`select 1`);
      return c.json({ status: "ok" });
    } catch (error) {
      console.error("Health check failed", error);
      return c.json({ status: "error" }, 503);
    }
  });

  registerDiscovery(app);
  registerSetup(app);
  registerAuth(app);
  registerSettings(app);
  registerAssets(app);
  registerAdmins(app);
  registerActivity(app);
  registerInstances(app);
  registerBlobs(app);

  return app;
}
