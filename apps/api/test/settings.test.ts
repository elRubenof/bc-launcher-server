import { DiscoveryDocument, OrganizationSettings } from "@bc-launcher-server/contracts";
import { schema } from "@bc-launcher-server/db";
import { describe, expect, it } from "vitest";
import { createTestApp, createTestPlatform, jsonRequest, setupOwner, signInAs } from "./helpers";

const update = {
  name: "Bocom Series",
  description: "Series y eventos",
  discordUrl: "https://discord.gg/bocom",
  webUrl: null,
  visibility: "private",
  minLauncherVersion: "2.0.0",
};

async function setup() {
  const platform = await createTestPlatform();
  const app = await createTestApp(platform);
  const owner = await setupOwner(app);
  return { app, platform, owner };
}

describe("organization settings", () => {
  it("are readable by any admin", async () => {
    const { app, platform } = await setup();
    const editor = await signInAs(app, platform, "editor", "editor");

    const res = await app.request("/api/admin/settings", { headers: { Cookie: editor } });

    expect(res.status).toBe(200);
    expect(OrganizationSettings.parse(await res.json())).toMatchObject({
      name: "Bocom",
      visibility: "public",
      logoUrl: null,
      publicUrl: "http://localhost:8787",
    });
  });

  it("are changed by an owner, logged, and reflected in discovery", async () => {
    const { app, platform, owner } = await setup();

    const res = await jsonRequest(app, "PUT", "/api/admin/settings", update, { Cookie: owner });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject(update);
    const discovery = DiscoveryDocument.parse(
      await (await app.request("/.well-known/bc-launcher")).json(),
    );
    expect(discovery).toMatchObject({
      name: "Bocom Series",
      visibility: "private",
      links: { discord: "https://discord.gg/bocom", web: null },
      minLauncherVersion: "2.0.0",
    });
    const log = await platform.db.select().from(schema.auditLog);
    expect(log.at(-1)).toMatchObject({
      action: "org.visibility_changed",
      details: { to: "private" },
    });
  });

  it("can't be changed by an editor", async () => {
    const { app, platform } = await setup();
    const editor = await signInAs(app, platform, "editor", "editor");

    const res = await jsonRequest(app, "PUT", "/api/admin/settings", update, { Cookie: editor });

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "forbidden" });
  });

  it("reject invalid links and versions", async () => {
    const { app, owner } = await setup();

    for (const invalid of [
      { discordUrl: "javascript:alert(1)" },
      { webUrl: "not a url" },
      { minLauncherVersion: "2.0" },
      { name: " " },
    ]) {
      const res = await jsonRequest(
        app,
        "PUT",
        "/api/admin/settings",
        { ...update, ...invalid },
        { Cookie: owner },
      );
      expect(res.status).toBe(400);
    }
  });

  it("don't log anything when nothing changed", async () => {
    const { app, platform, owner } = await setup();
    await jsonRequest(app, "PUT", "/api/admin/settings", update, { Cookie: owner });
    const before = await platform.db.select().from(schema.auditLog);

    await jsonRequest(app, "PUT", "/api/admin/settings", update, { Cookie: owner });

    expect(await platform.db.select().from(schema.auditLog)).toHaveLength(before.length);
  });
});
