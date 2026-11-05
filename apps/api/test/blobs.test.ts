import { schema } from "@bc-launcher-server/db";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "../src/auth/crypto";
import { createTestApp, createTestPlatform, jsonRequest, setupOwner } from "./helpers";

const bytes = (text: string) => new TextEncoder().encode(text);

async function setup() {
  const platform = await createTestPlatform();
  const app = await createTestApp(platform);
  const owner = await setupOwner(app);
  const upload = (sha256: string, body: Uint8Array, headers: Record<string, string> = {}) =>
    app.request(`/api/admin/blobs/${sha256}`, {
      method: "PUT",
      headers: {
        Cookie: owner,
        Origin: "http://localhost",
        "Content-Type": "application/octet-stream",
        "Content-Length": String(body.byteLength),
        ...headers,
      },
      body,
    });
  const check = (sha256: string[]) =>
    jsonRequest(app, "POST", "/api/admin/blobs/check", { sha256 }, { Cookie: owner });
  return { app, platform, upload, check };
}

describe("blobs", () => {
  it("reports missing blobs and stores uploads", async () => {
    const { platform, upload, check } = await setup();
    const mod = bytes("a mod");
    const sha = await sha256Hex(mod);

    expect(await (await check([sha, sha])).json()).toEqual({ missing: [sha] });

    const res = await upload(sha, mod);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sha256: sha, size: mod.byteLength });
    expect(await platform.blobs.head(sha)).toEqual({ size: mod.byteLength });

    expect(await (await check([sha])).json()).toEqual({ missing: [] });
    // Uploading it again doesn't read the body.
    expect((await upload(sha, bytes("anything"))).status).toBe(200);
  });

  it("refuses bytes that don't match the hash", async () => {
    const { platform, upload } = await setup();
    const sha = await sha256Hex(bytes("the real mod"));

    const res = await upload(sha, bytes("a tampered mod"));

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "hash_mismatch" });
    expect(await platform.blobs.head(sha)).toBeNull();
    expect(await platform.db.select().from(schema.blobs)).toEqual([]);
  });

  it("refuses files over 100 MB and requests without a length", async () => {
    const { upload } = await setup();
    const sha = "b".repeat(64);

    const big = await upload(sha, bytes("x"), { "Content-Length": "100000001" });
    expect(big.status).toBe(413);
    expect(await big.json()).toMatchObject({ code: "blob_too_large" });
  });

  it("validates hashes", async () => {
    const { upload, check } = await setup();

    expect((await check(["ABC"])).status).toBe(400);
    expect((await upload("not-a-hash", bytes("x"))).status).toBe(400);
  });

  it("keeps blobs the panel checks from the orphan cleanup", async () => {
    const { platform, upload, check } = await setup();
    const mod = bytes("kept");
    const sha = await sha256Hex(mod);
    await upload(sha, mod);
    await platform.db.update(schema.blobs).set({ orphanedAt: new Date(0) });

    await check([sha]);

    const [row] = await platform.db.select().from(schema.blobs);
    expect(row?.orphanedAt).toBeNull();
  });
});
