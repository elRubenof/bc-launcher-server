import { schema } from "@bc-launcher-server/db";
import { describe, expect, it } from "vitest";
import { createTestApp, createTestPlatform, jsonRequest } from "./helpers";

const setup = { organizationName: "  Bocom  ", username: "Ruben", password: "a-long-password" };

async function createApp() {
  const platform = await createTestPlatform();
  return { platform, app: await createTestApp(platform) };
}

describe("admin setup", () => {
  it("is required while there are no admins", async () => {
    const { app } = await createApp();

    const res = await app.request("/api/admin/setup");

    expect(await res.json()).toEqual({ required: true });
  });

  it("creates the owner, names the organization and logs it", async () => {
    const { app, platform } = await createApp();

    const res = await jsonRequest(app, "POST", "/api/admin/setup", setup);

    expect(res.status).toBe(201);
    const owner = (await res.json()) as { id: string };
    expect(owner).toMatchObject({ username: "ruben", role: "owner" });

    const [admin] = await platform.db.select().from(schema.admins);
    expect(admin?.passwordHash).toMatch(/^pbkdf2-sha256\$/);
    const [settings] = await platform.db.select().from(schema.settings);
    expect(settings?.name).toBe("Bocom");
    const log = await platform.db.select().from(schema.auditLog);
    expect(log).toMatchObject([{ adminId: owner.id, action: "admin.created", target: owner.id }]);
  });

  it("can only be done once", async () => {
    const { app, platform } = await createApp();
    await jsonRequest(app, "POST", "/api/admin/setup", setup);

    const res = await jsonRequest(app, "POST", "/api/admin/setup", { ...setup, username: "other" });

    expect(res.status).toBe(409);
    expect(res.headers.get("content-type")).toBe("application/problem+json");
    expect(await res.json()).toMatchObject({ code: "setup_completed" });
    expect(await platform.db.select().from(schema.admins)).toHaveLength(1);
    expect(await (await app.request("/api/admin/setup")).json()).toEqual({ required: false });
  });

  it("lets only one of two simultaneous setups win", async () => {
    const { app, platform } = await createApp();

    const results = await Promise.all([
      jsonRequest(app, "POST", "/api/admin/setup", { ...setup, username: "first" }),
      jsonRequest(app, "POST", "/api/admin/setup", { ...setup, username: "second" }),
    ]);

    expect(results.map((res) => res.status).sort()).toEqual([201, 409]);
    expect(await platform.db.select().from(schema.admins)).toHaveLength(1);
    expect(await platform.db.select().from(schema.auditLog)).toHaveLength(1);
  });

  it("validates the request", async () => {
    const { app } = await createApp();

    const res = await jsonRequest(app, "POST", "/api/admin/setup", {
      organizationName: "",
      username: "a b",
      password: "short",
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string; detail: string };
    expect(body.code).toBe("validation_error");
    expect(body.detail).toContain("username");
  });

  it("rejects requests from another origin", async () => {
    const { app } = await createApp();

    for (const origin of [undefined, "https://evil.example"]) {
      const res = await app.request("/api/admin/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(origin ? { Origin: origin } : {}) },
        body: JSON.stringify(setup),
      });
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ code: "bad_origin" });
    }
  });
});
