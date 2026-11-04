import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { serveWeb } from "../src/platform/node/web";
import { createTestApp } from "./helpers";

let webDir: string;

beforeAll(async () => {
  webDir = await mkdtemp(join(tmpdir(), "bcls-web-"));
  await mkdir(join(webDir, "assets"));
  await writeFile(join(webDir, "index.html"), "<!doctype html><title>panel</title>");
  await writeFile(join(webDir, "assets", "app-abc123.js"), "console.log(1)");
});

afterAll(async () => {
  await rm(webDir, { recursive: true, force: true });
});

async function createApp() {
  const app = await createTestApp();
  expect(serveWeb(app, webDir)).toBe(true);
  return app;
}

describe("serveWeb (Node)", () => {
  it("serves the page for client-side routes", async () => {
    const app = await createApp();

    for (const path of ["/", "/admin", "/admin/login"]) {
      const res = await app.request(path);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain("<title>panel</title>");
    }
  });

  it("serves fingerprinted assets as immutable", async () => {
    const res = await (await createApp()).request("/assets/app-abc123.js");

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("immutable");
    expect(await res.text()).toBe("console.log(1)");
  });

  it("keeps API routes and API 404s as they are", async () => {
    const app = await createApp();

    expect(await (await app.request("/health")).json()).toEqual({ status: "ok" });
    expect((await app.request("/api/v1/nothing-here")).status).toBe(404);
    expect((await app.request("/.well-known/nothing-here")).status).toBe(404);
  });

  it("does nothing when there is no web build", async () => {
    const app = await createTestApp();

    expect(serveWeb(app, join(webDir, "missing"))).toBe(false);
  });
});
