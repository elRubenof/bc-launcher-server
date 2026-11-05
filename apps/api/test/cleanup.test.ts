import { schema } from "@bc-launcher-server/db";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "../src/auth/crypto";
import { cleanupOrphanBlobs, ORPHAN_GRACE_MS } from "../src/cleanup";
import { createTestApp, createTestPlatform, jsonRequest, setupOwner } from "./helpers";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
const PNG2 = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 2]);
const HOUR = 3600 * 1000;

async function setup() {
  const platform = await createTestPlatform();
  const app = await createTestApp(platform);
  const owner = await setupOwner(app);
  const headers = { Cookie: owner, Origin: "http://localhost" };
  const request = (method: string, path: string, body?: unknown) =>
    jsonRequest(app, method, path, body, { Cookie: owner });
  const upload = async (text: string) => {
    const body = new TextEncoder().encode(text);
    const sha256 = await sha256Hex(body);
    await app.request(`/api/admin/blobs/${sha256}`, {
      method: "PUT",
      headers: { ...headers, "Content-Length": String(body.byteLength) },
      body,
    });
    return sha256;
  };
  const putImage = (path: string, body: Uint8Array) =>
    app.request(path, {
      method: "PUT",
      headers: { ...headers, "Content-Type": "image/png" },
      body,
    });
  await request("POST", "/api/admin/instances", {
    id: "serie-t3",
    name: "Serie T3",
    description: null,
    mcVersion: "1.21.1",
    loader: "vanilla",
    loaderVersion: null,
  });
  const exists = async (sha256: string) => (await platform.blobs.head(sha256)) !== null;
  return { platform, request, upload, putImage, exists };
}

describe("orphan blob cleanup", () => {
  it("deletes blobs only after 24 h unreferenced, keeping referenced ones", async () => {
    const { platform, request, upload, exists } = await setup();
    const used = await upload("used");
    const replaced = await upload("replaced");
    const pending = await upload("pending, never applied");
    const apply = (expected: number, sha256: string) =>
      request("PUT", "/api/admin/instances/serie-t3/content", {
        expectedContentVersion: expected,
        mcVersion: "1.21.1",
        loader: "vanilla",
        loaderVersion: null,
        managedDirs: [],
        files: [
          { path: "mods/used.jar", sha256: used, policy: "always" },
          { path: "mods/other.jar", sha256, policy: "always" },
        ],
      });
    await apply(0, replaced);
    const keep = await upload("replacement");
    await apply(1, keep);
    const t0 = Date.now();

    // First run only marks them; nothing is deleted before the grace period.
    expect((await cleanupOrphanBlobs(platform, t0)).deleted).toBe(0);
    expect((await cleanupOrphanBlobs(platform, t0 + ORPHAN_GRACE_MS - HOUR)).deleted).toBe(0);
    expect(await cleanupOrphanBlobs(platform, t0 + ORPHAN_GRACE_MS + HOUR)).toEqual({
      deleted: 2,
      more: false,
    });

    for (const sha256 of [replaced, pending]) expect(await exists(sha256)).toBe(false);
    for (const sha256 of [used, keep]) expect(await exists(sha256)).toBe(true);
    const rows = await platform.db.select({ sha256: schema.blobs.sha256 }).from(schema.blobs);
    expect(rows.map((row) => row.sha256)).not.toContain(replaced);
  });

  it("unmarks blobs that are referenced again", async () => {
    const { platform, request, upload, exists } = await setup();
    const mod = await upload("mod");
    const t0 = Date.now();
    await cleanupOrphanBlobs(platform, t0);

    await request("PUT", "/api/admin/instances/serie-t3/content", {
      expectedContentVersion: 0,
      mcVersion: "1.21.1",
      loader: "vanilla",
      loaderVersion: null,
      managedDirs: [],
      files: [{ path: "mods/mod.jar", sha256: mod, policy: "always" }],
    });
    await cleanupOrphanBlobs(platform, t0 + HOUR);

    expect((await cleanupOrphanBlobs(platform, t0 + 2 * ORPHAN_GRACE_MS)).deleted).toBe(0);
    expect(await exists(mod)).toBe(true);
  });

  it("deletes replaced logos and instance images but keeps the ones in use", async () => {
    const { platform, putImage, exists } = await setup();
    const first = await sha256Hex(PNG);
    const second = await sha256Hex(PNG2);
    await putImage("/api/admin/settings/logo", PNG);
    await putImage("/api/admin/settings/logo", PNG2);
    await putImage("/api/admin/instances/serie-t3/background", PNG2);
    const t0 = Date.now();

    await cleanupOrphanBlobs(platform, t0);
    const { deleted } = await cleanupOrphanBlobs(platform, t0 + ORPHAN_GRACE_MS + HOUR);

    // The first logo, and the default background the instance no longer uses.
    expect(deleted).toBe(2);
    expect(await exists(first)).toBe(false);
    expect(await exists(second)).toBe(true);
  });
});
