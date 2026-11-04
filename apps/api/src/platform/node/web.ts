import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { serveStatic } from "@hono/node-server/serve-static";
import type { Hono } from "hono";

/** `apps/web/dist` when running from source. The Docker image sets `WEB_DIR`. */
export const SOURCE_WEB_DIR = fileURLToPath(new URL("../../../../web/dist", import.meta.url));

const isApiPath = (path: string) =>
  path.startsWith("/api/") || path.startsWith("/.well-known/") || path === "/health";

/**
 * Serves the built panel and public page: static files, and `index.html` for any other GET so the
 * client-side router handles it. API paths are never answered with the page.
 * (On Cloudflare, Workers static assets do the same; see wrangler.jsonc.)
 */
export function serveWeb<E extends object>(app: Hono<E>, webDir: string): boolean {
  if (!existsSync(webDir)) return false;

  const files = serveStatic({ root: webDir });
  const page = serveStatic({ root: webDir, path: "index.html" });

  app.use("*", async (c, next) => {
    if (isApiPath(c.req.path)) return next();
    // Returns the file's response if it exists; otherwise it has already called `next()`.
    const res = await files(c, next);
    if (res instanceof Response) {
      // Vite fingerprints everything under assets/, so those files never change.
      const immutable = c.req.path.startsWith("/assets/");
      res.headers.set(
        "Cache-Control",
        immutable ? "public, max-age=31536000, immutable" : "no-cache",
      );
    }
    return res;
  });
  app.get("*", async (c, next) => {
    if (isApiPath(c.req.path)) return next();
    const res = await page(c, next);
    if (res instanceof Response) res.headers.set("Cache-Control", "no-cache");
    return res;
  });
  return true;
}
