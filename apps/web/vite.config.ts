import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type ProxyOptions } from "vite";

// The API runs separately in development (`pnpm dev:worker` on :8787 by default).
const api = process.env.API_URL ?? "http://localhost:8787";

// The API only accepts admin writes from its own origin, so the dev proxy presents itself as it.
const proxy: ProxyOptions = {
  target: api,
  configure: (server) => {
    server.on("proxyReq", (req) => {
      if (req.getHeader("origin")) req.setHeader("origin", new URL(api).origin);
    });
  },
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  server: {
    proxy: {
      "/api": proxy,
      "/.well-known": proxy,
      "/health": proxy,
    },
  },
});
