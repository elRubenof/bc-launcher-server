import { DiscoveryDocument } from "@bc-launcher-server/contracts";
import { schema } from "@bc-launcher-server/db";
import { describe, expect, it } from "vitest";
import { createTestApp, createTestPlatform, setupOwner } from "./helpers";

describe("GET /.well-known/bc-launcher", () => {
  it("returns a valid discovery document with the defaults", async () => {
    const res = await (await createTestApp()).request("/.well-known/bc-launcher");

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=300");

    const body = DiscoveryDocument.parse(await res.json());
    expect(body).toMatchObject({
      discoveryVersion: 1,
      visibility: "public",
      name: "BC Launcher Server",
      apiVersions: [1],
      auth: { type: "mojang-session" },
    });
    expect(body.serverVersion).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("reflects the organization's settings", async () => {
    const platform = await createTestPlatform();
    const app = await createTestApp(platform);
    await setupOwner(app);
    await platform.db.update(schema.settings).set({
      visibility: "private",
      description: "Series y eventos",
      discordUrl: "https://discord.gg/example",
      minLauncherVersion: "2.0.0",
    });

    const body = DiscoveryDocument.parse(
      await (await app.request("/.well-known/bc-launcher")).json(),
    );

    expect(body).toMatchObject({
      name: "Bocom",
      visibility: "private",
      description: "Series y eventos",
      links: { discord: "https://discord.gg/example", web: null },
      minLauncherVersion: "2.0.0",
    });
  });
});
