import { sql } from "drizzle-orm";
import { Hono } from "hono";
import type { AppEnv, PlatformResolver } from "./platform/types";

export function createApp(resolvePlatform: PlatformResolver) {
  const app = new Hono<AppEnv>();

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

  return app;
}
