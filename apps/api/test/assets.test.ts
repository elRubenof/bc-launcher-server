import { DiscoveryDocument } from "@bc-launcher-server/contracts";
import { describe, expect, it } from "vitest";
import { createTestApp, createTestPlatform, setupOwner, signInAs } from "./helpers";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

async function setup() {
  const platform = await createTestPlatform();
  const app = await createTestApp(platform);
  const owner = await setupOwner(app);
  return { app, platform, owner };
}

type App = Awaited<ReturnType<typeof setup>>["app"];

const upload = (app: App, cookie: string, kind: string, body: Uint8Array, type = "image/png") =>
  app.request(`/api/admin/settings/${kind}`, {
    method: "PUT",
    headers: { Cookie: cookie, Origin: "http://localhost", "Content-Type": type },
    body,
  });

describe("organization images", () => {
  it("uploads a logo and serves it as an immutable asset", async () => {
    const { app, owner } = await setup();

    const res = await upload(app, owner, "logo", PNG);

    expect(res.status).toBe(200);
    const { logoUrl, iconUrl } = (await res.json()) as { logoUrl: string; iconUrl: null };
    expect(logoUrl).toMatch(/^http:\/\/localhost:8787\/api\/v1\/assets\/[0-9a-f]{64}$/);
    expect(iconUrl).toBeNull();

    const asset = await app.request(new URL(logoUrl).pathname);
    expect(asset.status).toBe(200);
    expect(asset.headers.get("content-type")).toBe("image/png");
    expect(asset.headers.get("cache-control")).toContain("immutable");
    expect(new Uint8Array(await asset.arrayBuffer())).toEqual(PNG);

    const discovery = DiscoveryDocument.parse(
      await (await app.request("/.well-known/bc-launcher")).json(),
    );
    expect(discovery.logoUrl).toBe(logoUrl);
  });

  it("detects the type from the bytes, not the header", async () => {
    const { app, owner } = await setup();

    const res = await upload(app, owner, "icon", new TextEncoder().encode("<svg></svg>"));

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "invalid_image" });
  });

  it("rejects images over 2 MB", async () => {
    const { app, owner } = await setup();
    const big = new Uint8Array(2 * 1024 * 1024 + 1);
    big.set(PNG);

    const res = await upload(app, owner, "logo", big);

    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ code: "image_too_large" });
  });

  it("only lets owners change the images", async () => {
    const { app, platform } = await setup();
    const editor = await signInAs(app, platform, "editor", "editor");

    expect((await upload(app, editor, "logo", PNG)).status).toBe(403);
  });

  it("removes an image", async () => {
    const { app, owner } = await setup();
    await upload(app, owner, "icon", PNG);

    const res = await app.request("/api/admin/settings/icon", {
      method: "DELETE",
      headers: { Cookie: owner, Origin: "http://localhost" },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ iconUrl: null });
  });

  it("answers 404 for unknown assets", async () => {
    const { app } = await setup();

    const res = await app.request(`/api/v1/assets/${"a".repeat(64)}`);

    expect(res.status).toBe(404);
  });
});
