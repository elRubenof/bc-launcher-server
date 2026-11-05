import { DEFAULT_INSTANCE_COLORS, type Instance } from "@bc-launcher-server/contracts";
import { schema } from "@bc-launcher-server/db";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createTestApp, createTestPlatform, jsonRequest, setupOwner, signInAs } from "./helpers";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9, 9]);

const NEW_INSTANCE = {
  id: "serie-t3",
  name: "Serie T3",
  description: "Tercera temporada",
  mcVersion: "1.21.1",
  loader: "fabric",
  loaderVersion: "0.16.9",
} as const;

async function setup() {
  const platform = await createTestPlatform();
  const app = await createTestApp(platform);
  const owner = await setupOwner(app);
  const as = (cookie: string) => ({ Cookie: cookie });
  const request = (method: string, path: string, body?: unknown, cookie = owner) =>
    jsonRequest(app, method, path, body, as(cookie));
  return { app, platform, owner, request };
}

const UPDATE = {
  name: "Serie T3 (final)",
  description: null,
  mapUrl: "https://map.example/t3",
  discordUrl: null,
  webUrl: "https://bocom.example",
  serverAddress: "play.bocom.example:25565",
  recommendedRamMb: 6144,
  isActive: false,
};

describe("instances", () => {
  it("creates an instance with the default appearance, no content and mods/ managed", async () => {
    const { app, platform, request } = await setup();

    const res = await request("POST", "/api/admin/instances", NEW_INSTANCE);

    expect(res.status).toBe(201);
    const instance = (await res.json()) as Instance;
    expect(instance).toMatchObject({
      id: "serie-t3",
      name: "Serie T3",
      colors: DEFAULT_INSTANCE_COLORS,
      iconUrl: null,
      access: "everyone",
      isActive: true,
      minecraft: { version: "1.21.1" },
      loader: { type: "fabric", version: "0.16.9" },
      contentVersion: 0,
      fileCount: 0,
    });

    const background = await app.request(new URL(instance.backgroundUrl).pathname);
    expect(background.status).toBe(200);
    expect(background.headers.get("content-type")).toBe("image/webp");

    const dirs = await platform.db.select().from(schema.instanceManagedDirs);
    expect(dirs).toEqual([{ instanceId: "serie-t3", path: "mods" }]);
    const [audit] = await platform.db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, "instance.created"));
    expect(audit?.target).toBe("serie-t3");
  });

  it("rejects invalid and duplicate ids", async () => {
    const { request } = await setup();

    for (const id of ["Serie", "-serie", "a", "a".repeat(41), "serie_t3", "../x"]) {
      const res = await request("POST", "/api/admin/instances", { ...NEW_INSTANCE, id });
      expect(res.status, id).toBe(400);
    }

    expect((await request("POST", "/api/admin/instances", NEW_INSTANCE)).status).toBe(201);
    const duplicate = await request("POST", "/api/admin/instances", NEW_INSTANCE);
    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toMatchObject({ code: "instance_exists" });
  });

  it("requires a loader version except for vanilla", async () => {
    const { request } = await setup();

    const fabric = { ...NEW_INSTANCE, loaderVersion: null };
    expect((await request("POST", "/api/admin/instances", fabric)).status).toBe(400);

    const vanilla = { ...NEW_INSTANCE, loader: "vanilla", loaderVersion: "ignored" };
    const res = await request("POST", "/api/admin/instances", vanilla);
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ loader: { type: "vanilla", version: null } });
  });

  it("lists instances newest first", async () => {
    const { request } = await setup();
    await request("POST", "/api/admin/instances", NEW_INSTANCE);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await request("POST", "/api/admin/instances", { ...NEW_INSTANCE, id: "serie-t4" });

    const res = await request("GET", "/api/admin/instances");

    expect(((await res.json()) as Instance[]).map((instance) => instance.id)).toEqual([
      "serie-t4",
      "serie-t3",
    ]);
  });

  it("updates the details and logs what changed", async () => {
    const { platform, request } = await setup();
    await request("POST", "/api/admin/instances", NEW_INSTANCE);

    const res = await request("PUT", "/api/admin/instances/serie-t3", UPDATE);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject(UPDATE);
    const [audit] = await platform.db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, "instance.updated"));
    expect(audit?.details).toEqual({
      changed: [
        "name",
        "description",
        "mapUrl",
        "webUrl",
        "serverAddress",
        "recommendedRamMb",
        "isActive",
      ],
    });
  });

  it("validates links and the server address", async () => {
    const { request } = await setup();
    await request("POST", "/api/admin/instances", NEW_INSTANCE);

    for (const bad of [
      { mapUrl: "javascript:alert(1)" },
      { serverAddress: "play.example:25565:1" },
      { recommendedRamMb: 512 },
    ]) {
      const res = await request("PUT", "/api/admin/instances/serie-t3", { ...UPDATE, ...bad });
      expect(res.status, JSON.stringify(bad)).toBe(400);
    }
  });

  it("changes the colors, normalized to uppercase", async () => {
    const { request } = await setup();
    await request("POST", "/api/admin/instances", NEW_INSTANCE);
    const colors = {
      primary: "#2f9e8f",
      primaryDark: "#237A6E",
      background: "#0F1E1C",
      text: "#FFFFFF",
    };

    const res = await request("PUT", "/api/admin/instances/serie-t3/appearance", { colors });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ colors: { ...colors, primary: "#2F9E8F" } });
    const bad = await request("PUT", "/api/admin/instances/serie-t3/appearance", {
      colors: { ...colors, text: "white" },
    });
    expect(bad.status).toBe(400);
  });

  it("uploads an icon and a background, and resets the background", async () => {
    const { app, owner, request } = await setup();
    const created = (await (
      await request("POST", "/api/admin/instances", NEW_INSTANCE)
    ).json()) as Instance;
    const upload = (kind: string) =>
      app.request(`/api/admin/instances/serie-t3/${kind}`, {
        method: "PUT",
        headers: { Cookie: owner, Origin: "http://localhost", "Content-Type": "image/png" },
        body: PNG,
      });

    const icon = (await (await upload("icon")).json()) as Instance;
    expect(icon.iconUrl).toMatch(/\/api\/v1\/assets\/[0-9a-f]{64}$/);
    const background = (await (await upload("background")).json()) as Instance;
    expect(background.backgroundUrl).toBe(icon.iconUrl);

    const reset = await request("DELETE", "/api/admin/instances/serie-t3/background");
    expect(((await reset.json()) as Instance).backgroundUrl).toBe(created.backgroundUrl);
    const removed = await request("DELETE", "/api/admin/instances/serie-t3/icon");
    expect(((await removed.json()) as Instance).iconUrl).toBeNull();
  });

  it("deletes an instance with its files and managed dirs", async () => {
    const { platform, request } = await setup();
    await request("POST", "/api/admin/instances", NEW_INSTANCE);

    const res = await request("DELETE", "/api/admin/instances/serie-t3");

    expect(res.status).toBe(204);
    expect((await request("GET", "/api/admin/instances/serie-t3")).status).toBe(404);
    expect(await platform.db.select().from(schema.instanceManagedDirs)).toEqual([]);
    expect((await request("DELETE", "/api/admin/instances/serie-t3")).status).toBe(404);
  });

  it("lets editors manage instances", async () => {
    const { app, platform, request } = await setup();
    const editor = await signInAs(app, platform, "editor", "editor");

    const res = await request("POST", "/api/admin/instances", NEW_INSTANCE, editor);

    expect(res.status).toBe(201);
  });

  it("answers 404 for unknown instances and needs a session", async () => {
    const { app, request } = await setup();

    expect((await request("GET", "/api/admin/instances/nope")).status).toBe(404);
    expect((await request("PUT", "/api/admin/instances/nope", UPDATE)).status).toBe(404);
    expect((await app.request("/api/admin/instances")).status).toBe(401);
  });
});
