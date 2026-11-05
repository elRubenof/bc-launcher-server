import type { InstanceContent } from "@bc-launcher-server/contracts";
import { schema } from "@bc-launcher-server/db";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "../src/auth/crypto";
import { createTestApp, createTestPlatform, jsonRequest, setupOwner } from "./helpers";

async function setup() {
  const platform = await createTestPlatform();
  const app = await createTestApp(platform);
  const owner = await setupOwner(app);
  const request = (method: string, path: string, body?: unknown) =>
    jsonRequest(app, method, path, body, { Cookie: owner });
  await request("POST", "/api/admin/instances", {
    id: "serie-t3",
    name: "Serie T3",
    description: null,
    mcVersion: "1.21.1",
    loader: "fabric",
    loaderVersion: "0.16.9",
  });
  /** Uploads a file and returns its sha256. */
  const upload = async (text: string) => {
    const body = new TextEncoder().encode(text);
    const sha256 = await sha256Hex(body);
    const res = await app.request(`/api/admin/blobs/${sha256}`, {
      method: "PUT",
      headers: {
        Cookie: owner,
        Origin: "http://localhost",
        "Content-Length": String(body.byteLength),
      },
      body,
    });
    if (res.status !== 200) throw new Error(`Upload failed: ${res.status}`);
    return sha256;
  };
  const apply = (body: object) =>
    request("PUT", "/api/admin/instances/serie-t3/content", {
      expectedContentVersion: 0,
      mcVersion: "1.21.1",
      loader: "fabric",
      loaderVersion: "0.16.9",
      managedDirs: ["mods"],
      files: [],
      ...body,
    });
  return { app, platform, request, upload, apply };
}

describe("instance content", () => {
  it("starts empty with mods/ managed", async () => {
    const { request } = await setup();

    const res = await request("GET", "/api/admin/instances/serie-t3/content");

    expect(await res.json()).toEqual({
      contentVersion: 0,
      minecraft: { version: "1.21.1" },
      loader: { type: "fabric", version: "0.16.9" },
      managedDirs: ["mods"],
      files: [],
      updatedAt: null,
      updatedBy: null,
    });
  });

  it("applies a change atomically and bumps the content version", async () => {
    const { platform, request, upload, apply } = await setup();
    const sodium = await upload("sodium");
    const options = await upload("options");

    const res = await apply({
      files: [
        { path: "mods/sodium.jar", sha256: sodium, policy: "always" },
        { path: "options.txt", sha256: options, policy: "once" },
      ],
    });

    expect(res.status).toBe(200);
    const content = (await res.json()) as InstanceContent;
    expect(content).toMatchObject({
      contentVersion: 1,
      managedDirs: ["mods"],
      files: [
        { path: "mods/sodium.jar", sha256: sodium, size: 6, policy: "always" },
        { path: "options.txt", sha256: options, size: 7, policy: "once" },
      ],
      updatedBy: { username: "owner" },
    });
    const instance = await request("GET", "/api/admin/instances/serie-t3");
    expect(await instance.json()).toMatchObject({ contentVersion: 1, fileCount: 2, totalSize: 13 });

    const lithium = await upload("lithium");
    await apply({
      expectedContentVersion: 1,
      mcVersion: "1.20.1",
      loader: "forge",
      loaderVersion: "47.3.0",
      managedDirs: ["mods", "config/serie"],
      files: [
        { path: "mods/lithium.jar", sha256: lithium, policy: "always" },
        { path: "options.txt", sha256: options, policy: "always" },
      ],
    });
    const audits = await platform.db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, "instance.content_applied"));
    expect(audits.map((audit) => audit.details)).toEqual([
      {
        from: 0,
        to: 1,
        added: ["mods/sodium.jar", "options.txt"],
        changed: [],
        removed: [],
        counts: { added: 2, changed: 0, removed: 0 },
      },
      {
        from: 1,
        to: 2,
        added: ["mods/lithium.jar"],
        changed: ["options.txt"],
        removed: ["mods/sodium.jar"],
        counts: { added: 1, changed: 1, removed: 1 },
        versionFrom: { mc: "1.21.1", loader: "fabric", loaderVersion: "0.16.9" },
        versionTo: { mc: "1.20.1", loader: "forge", loaderVersion: "47.3.0" },
      },
    ]);
    const content2 = await request("GET", "/api/admin/instances/serie-t3/content");
    expect(await content2.json()).toMatchObject({
      contentVersion: 2,
      minecraft: { version: "1.20.1" },
      loader: { type: "forge", version: "47.3.0" },
      managedDirs: ["config/serie", "mods"],
    });
  });

  it("refuses a stale expected version without changing anything", async () => {
    const { request, upload, apply } = await setup();
    const sodium = await upload("sodium");
    await apply({ files: [{ path: "mods/sodium.jar", sha256: sodium, policy: "always" }] });

    const res = await apply({ files: [] });

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "content_conflict" });
    const content = await request("GET", "/api/admin/instances/serie-t3/content");
    expect(await content.json()).toMatchObject({ contentVersion: 1, files: [{ sha256: sodium }] });
  });

  it("refuses files that aren't uploaded, listing them", async () => {
    const { request, upload, apply } = await setup();
    const sodium = await upload("sodium");
    const missing = "c".repeat(64);

    const res = await apply({
      files: [
        { path: "mods/sodium.jar", sha256: sodium, policy: "always" },
        { path: "mods/lithium.jar", sha256: missing, policy: "always" },
      ],
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "missing_blobs", detail: missing });
    const content = await request("GET", "/api/admin/instances/serie-t3/content");
    expect(await content.json()).toMatchObject({ contentVersion: 0, files: [] });
  });

  it("rejects unsafe and reserved paths", async () => {
    const { upload, apply } = await setup();
    const sha256 = await upload("x");

    for (const path of [
      "../evil.jar",
      "/etc/passwd",
      "mods//a.jar",
      "mods/./a.jar",
      "mods\\a.jar",
      "C:/a.jar",
      "mods/con.txt",
      "mods/a.jar ",
      "versions/1.21.1/1.21.1.jar",
      "Libraries/x.jar",
      "",
    ]) {
      const res = await apply({ files: [{ path, sha256, policy: "always" }] });
      expect(res.status, path).toBe(400);
    }
    expect((await apply({ managedDirs: ["../mods"] })).status).toBe(400);
  });

  it("rejects paths that clash on disk", async () => {
    const { upload, apply } = await setup();
    const sha256 = await upload("x");
    const file = (path: string) => ({ path, sha256, policy: "always" });

    for (const change of [
      { files: [file("mods/A.jar"), file("mods/a.jar")] },
      { files: [file("config"), file("config/x.json")] },
      { files: [file("mods")], managedDirs: ["mods"] },
    ]) {
      const res = await apply(change);
      expect(res.status, JSON.stringify(change)).toBe(400);
      expect(await res.json()).toMatchObject({ code: "path_conflict" });
    }
  });

  it("checks changed versions", async () => {
    const { apply } = await setup();

    const res = await apply({ loaderVersion: "0.0.1" });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "invalid_version" });
  });

  it("does nothing if another change lands between the checks and the batch", async () => {
    const { platform, request, upload, apply } = await setup();
    const sodium = await upload("sodium");
    // Simulates the race: the version moves after the handler read it.
    const originalBatch = platform.db.batch.bind(platform.db);
    platform.db.batch = (async (statements: Parameters<typeof originalBatch>[0]) => {
      await platform.db
        .update(schema.instances)
        .set({ contentVersion: 5 })
        .where(eq(schema.instances.id, "serie-t3"));
      return originalBatch(statements);
    }) as unknown as typeof platform.db.batch;

    const res = await apply({
      files: [{ path: "mods/sodium.jar", sha256: sodium, policy: "always" }],
    });

    platform.db.batch = originalBatch;
    expect(res.status).toBe(409);
    const content = await request("GET", "/api/admin/instances/serie-t3/content");
    expect(await content.json()).toMatchObject({
      contentVersion: 5,
      files: [],
      managedDirs: ["mods"],
    });
    const audits = await platform.db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, "instance.content_applied"));
    expect(audits).toEqual([]);
  });
});
