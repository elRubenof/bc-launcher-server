import { Hono } from "hono";
import type { AppEnv, PlatformResolver } from "./platform/types";

export function createApp(resolvePlatform: PlatformResolver) {
  const app = new Hono<AppEnv>();

  app.use(async (c, next) => {
    c.set("platform", resolvePlatform(c.env));
    await next();
  });

  app.get("/health", (c) => c.json({ status: "ok" }));

  return app;
}
