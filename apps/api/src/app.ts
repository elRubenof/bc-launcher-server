import { OpenAPIHono } from "@hono/zod-openapi";
import { sql } from "drizzle-orm";
import { requireAdmin } from "./middleware/admin";
import { sameOrigin } from "./middleware/origin";
import { requirePlayer } from "./middleware/player";
import type { AppEnv, PlatformResolver } from "./platform/types";
import { problem } from "./problem";
import { registerAccessLists } from "./routes/access-lists";
import { registerActivity } from "./routes/activity";
import { registerAdmins } from "./routes/admins";
import { registerAssets } from "./routes/assets";
import { registerAuth } from "./routes/auth";
import { registerBlobs } from "./routes/blobs";
import { registerContent } from "./routes/content";
import { registerDiscovery } from "./routes/discovery";
import { registerInstances } from "./routes/instances";
import { registerLauncher } from "./routes/launcher";
import { registerLoaders } from "./routes/loaders";
import { registerNews } from "./routes/news";
import { registerPlayerAuth } from "./routes/player-auth";
import { registerPlayers } from "./routes/players";
import { registerSettings } from "./routes/settings";
import { registerSetup } from "./routes/setup";
import { registerUpdates } from "./routes/updates";

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
    c.set("platform", await resolvePlatform(c.env, c.req.url));
    await next();
  });

  app.use("/api/admin/*", sameOrigin, requireAdmin);
  // Launcher routes that need a player token. Blob downloads only need their signed URL.
  for (const path of ["/api/v1/instances", "/api/v1/instances/*"]) {
    app.use(path, requirePlayer);
  }
  app.openAPIRegistry.registerComponent("securitySchemes", "playerToken", {
    type: "http",
    scheme: "bearer",
    bearerFormat: "JWT",
    description: "The token from `POST /api/v1/auth/verify`.",
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
  registerSetup(app);
  registerAuth(app);
  registerSettings(app);
  registerAssets(app);
  registerAdmins(app);
  registerActivity(app);
  registerUpdates(app);
  // Before the instance routes: `/instances/{id}/{kind}` would also match `/content`, `/whitelist`...
  registerContent(app);
  registerAccessLists(app);
  registerNews(app);
  registerPlayers(app);
  registerInstances(app);
  registerBlobs(app);
  registerLoaders(app);
  registerPlayerAuth(app);
  registerLauncher(app);

  return app;
}
