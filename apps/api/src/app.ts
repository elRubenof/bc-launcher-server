import { OpenAPIHono } from "@hono/zod-openapi";
import { sql } from "drizzle-orm";
import type { AppEnv, PlatformResolver } from "./platform/types";
import { registerDiscovery } from "./routes/discovery";

export function createApp(resolvePlatform: PlatformResolver) {
  const app = new OpenAPIHono<AppEnv>();

  app.use(async (c, next) => {
    c.set("platform", resolvePlatform(c.env));
    await next();
  });

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

  return app;
}
