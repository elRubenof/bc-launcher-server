import type { LauncherInstance, Manifest } from "@bc-launcher-server/contracts";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "../src/auth/crypto";
import { checkBlobSignature, signedBlobUrl, URL_WINDOW_SECONDS } from "../src/signed-urls";
import { createTestApp, createTestPlatform, jsonRequest, playerAuth, setupOwner } from "./helpers";

const NEW_INSTANCE = {
  id: "serie-t3",
  name: "Serie T3",
  description: null,
  mcVersion: "1.21.1",
  loader: "fabric",
  loaderVersion: "0.16.9",
};

async function setup() {
  const platform = await createTestPlatform();
  const app = await createTestApp(platform);
  const owner = await setupOwner(app);
  const request = (method: string, path: string, body?: unknown) =>
    jsonRequest(app, method, path, body, { Cookie: owner });
  await request("POST", "/api/admin/instances", NEW_INSTANCE);
  const mod = new TextEncoder().encode("sodium");
  const sha256 = await sha256Hex(mod);
  await app.request(`/api/admin/blobs/${sha256}`, {
    method: "PUT",
    headers: { Cookie: owner, Origin: "http://localhost", "Content-Length": "6" },
    body: mod,
  });
  const applyContent = () =>
    request("PUT", "/api/admin/instances/serie-t3/content", {
      expectedContentVersion: 0,
      mcVersion: "1.21.1",
      loader: "fabric",
      loaderVersion: "0.16.9",
      managedDirs: ["mods"],
      files: [{ path: "mods/sodium.jar", sha256, policy: "always" }],
    });
  const player = await playerAuth(app, "Nyxar");
  const launcher = (path: string, headers: Record<string, string> = {}) =>
    app.request(path, { headers: { ...player, ...headers } });
  return { app, platform, request, applyContent, launcher, sha256 };
}

describe("launcher API", () => {
  it("hides instances without content and inactive ones", async () => {
    const { app, launcher, request, applyContent } = await setup();

    const empty = await launcher("/api/v1/instances");
    expect(await empty.json()).toEqual({ instances: [] });
    expect((await launcher("/api/v1/instances/serie-t3/manifest")).status).toBe(404);

    await applyContent();
    const listed = (await (await launcher("/api/v1/instances")).json()) as {
      instances: LauncherInstance[];
    };
    expect(listed.instances.map((instance) => instance.id)).toEqual(["serie-t3"]);

    await request("PUT", "/api/admin/instances/serie-t3", {
      name: "Serie T3",
      description: null,
      mapUrl: null,
      discordUrl: null,
      webUrl: null,
      serverAddress: null,
      recommendedRamMb: null,
      isActive: false,
    });
    expect(await (await launcher("/api/v1/instances")).json()).toEqual({ instances: [] });
    expect((await launcher("/api/v1/instances/serie-t3/manifest")).status).toBe(404);
  });

  it("falls back to the organization's links", async () => {
    const { app, launcher, request, applyContent } = await setup();
    await applyContent();
    await request("PUT", "/api/admin/settings", {
      name: "Bocom",
      description: null,
      discordUrl: "https://discord.gg/bocom",
      webUrl: "https://bocom.example",
      visibility: "public",
      minLauncherVersion: null,
    });
    await request("PUT", "/api/admin/instances/serie-t3", {
      name: "Serie T3",
      description: null,
      mapUrl: null,
      discordUrl: null,
      webUrl: "https://t3.example",
      serverAddress: "play.example",
      recommendedRamMb: 6144,
      isActive: true,
    });

    const { instances } = (await (await launcher("/api/v1/instances")).json()) as {
      instances: LauncherInstance[];
    };

    expect(instances[0]).toMatchObject({
      discordUrl: "https://discord.gg/bocom",
      webUrl: "https://t3.example",
      serverAddress: "play.example",
      contentVersion: 1,
    });
  });

  it("serves the manifest with signed URLs and an ETag", async () => {
    const { app, launcher, applyContent, sha256 } = await setup();
    await applyContent();

    const res = await launcher("/api/v1/instances/serie-t3/manifest");

    expect(res.status).toBe(200);
    const manifest = (await res.json()) as Manifest;
    expect(manifest).toMatchObject({
      contentVersion: 1,
      minecraft: { version: "1.21.1" },
      loader: { type: "fabric", version: "0.16.9" },
      server: { address: null },
      managedDirs: ["mods"],
      files: [{ path: "mods/sodium.jar", sha256, size: 6, policy: "always" }],
    });

    const etag = res.headers.get("etag") as string;
    expect(etag).toMatch(/^"1\.\d+"$/);
    const again = await launcher("/api/v1/instances/serie-t3/manifest", { "If-None-Match": etag });
    expect(again.status).toBe(304);

    const url = new URL(manifest.files[0]?.url as string);
    expect(url.origin).toBe("http://localhost:8787");
    const blob = await app.request(url.pathname + url.search);
    expect(blob.status).toBe(200);
    expect(await blob.text()).toBe("sodium");
    expect(blob.headers.get("cache-control")).toContain("immutable");
  });

  it("refuses tampered and expired blob URLs", async () => {
    const { app, platform, sha256 } = await setup();
    const url = new URL(await signedBlobUrl(platform.config, sha256));
    const other = "d".repeat(64);

    const tampered = await app.request(`/api/v1/blobs/${other}${url.search}`);
    expect(tampered.status).toBe(403);
    expect(await tampered.json()).toMatchObject({ code: "invalid_signature" });
    expect((await app.request(`/api/v1/blobs/${sha256}?exp=1&sig=abc`)).status).toBe(403);
    expect((await app.request(`/api/v1/blobs/${sha256}`)).status).toBe(400);

    const exp = Number(url.searchParams.get("exp"));
    const sig = url.searchParams.get("sig") as string;
    expect(await checkBlobSignature(platform.config, sha256, exp, sig)).toBe("valid");
    expect(await checkBlobSignature(platform.config, sha256, exp, sig, exp * 1000 + 1)).toBe(
      "expired",
    );
  });

  it("keeps URLs valid for 6 to 12 hours and stable within a window", async () => {
    const { platform, sha256 } = await setup();
    const window = URL_WINDOW_SECONDS * 1000;
    const start = Math.floor(Date.now() / window) * window;

    const first = new URL(await signedBlobUrl(platform.config, sha256, start));
    const last = new URL(await signedBlobUrl(platform.config, sha256, start + window - 1));

    expect(first.href).toBe(last.href);
    expect(Number(first.searchParams.get("exp")) * 1000 - start).toBe(2 * window);
  });
});
