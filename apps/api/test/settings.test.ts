import { DiscoveryDocument, OrganizationSettings } from "@bc-launcher-server/contracts";
import { schema } from "@bc-launcher-server/db";
import { describe, expect, it } from "vitest";
import {
  createTestApp,
  createTestPlatform,
  jsonRequest,
  playerAuth,
  setupOwner,
  signInAs,
  verifyPlayer,
} from "./helpers";

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

  it("can be changed by an admin", async () => {
    const { app, platform } = await setup();
    const admin = await signInAs(app, platform, "alex", "admin");

    const res = await jsonRequest(app, "PUT", "/api/admin/settings", update, { Cookie: admin });

    expect(res.status).toBe(200);
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

  it("can whitelist everyone who already joined when going private", async () => {
    const { app, platform, owner } = await setup();
    const nyxar = await playerAuth(app, "Nyxar");
    await playerAuth(app, "Tomate_89");
    // Added by name, never joined: not imported.
    await jsonRequest(
      app,
      "POST",
      "/api/admin/blacklist",
      { player: "GrieferX", reason: null, expiresAt: null },
      { Cookie: owner },
    );

    const res = await jsonRequest(
      app,
      "PUT",
      "/api/admin/settings",
      { ...update, whitelistJoinedPlayers: true },
      { Cookie: owner },
    );
    expect(res.status).toBe(200);

    const whitelist = await platform.db.select().from(schema.orgWhitelist);
    expect(whitelist).toHaveLength(2);
    expect((await app.request("/api/v1/instances", { headers: nyxar })).status).toBe(200);
    expect((await verifyPlayer(app, "Tomate_89")).status).toBe(200);
    expect((await verifyPlayer(app, "GrieferX")).status).toBe(403);

    const { items } = (await (
      await app.request("/api/admin/activity", { headers: { Cookie: owner } })
    ).json()) as { items: { action: string; details: Record<string, unknown> }[] };
    expect(items[0]).toMatchObject({
      action: "org.visibility_changed",
      details: { to: "private", whitelisted: 2 },
    });
  });

  it("doesn't touch the whitelist unless asked or already private", async () => {
    const { app, platform, owner } = await setup();
    await playerAuth(app, "Nyxar");
    await jsonRequest(app, "PUT", "/api/admin/settings", update, { Cookie: owner });
    await jsonRequest(
      app,
      "PUT",
      "/api/admin/settings",
      { ...update, whitelistJoinedPlayers: true },
      { Cookie: owner },
    );
    expect(await platform.db.select().from(schema.orgWhitelist)).toEqual([]);
  });
});
