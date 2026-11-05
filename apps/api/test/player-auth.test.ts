import { schema } from "@bc-launcher-server/db";
import { eq } from "drizzle-orm";
import { sign } from "hono/jwt";
import { describe, expect, it } from "vitest";
import { checkChallenge, createChallenge, signPlayerToken } from "../src/auth/player-tokens";
import { MOJANG_SESSION_URL } from "../src/platform/config";
import {
  createTestApp,
  createTestPlatform,
  jsonRequest,
  mojangFetch,
  PROFILES,
  playerAuth,
  verifyPlayer,
} from "./helpers";

const NYXAR = PROFILES.Nyxar as string;

async function setup(fetchFn?: typeof fetch) {
  const platform = await createTestPlatform(fetchFn);
  const app = await createTestApp(platform);
  return { app, platform };
}

describe("player auth", () => {
  it("signs a player in with a Mojang session and records them", async () => {
    const { app, platform } = await setup();

    const challenge = await app.request("/api/v1/auth/challenge", { method: "POST" });
    expect(challenge.status).toBe(200);
    const { serverId, expiresAt } = (await challenge.json()) as Record<string, string>;
    expect(serverId).toMatch(/^[0-9a-f]{40}$/);
    expect(Date.parse(expiresAt as string)).toBeGreaterThan(Date.now());

    const res = await jsonRequest(app, "POST", "/api/v1/auth/verify", {
      username: "nyxar",
      serverId,
    });
    expect(res.status).toBe(200);
    const session = (await res.json()) as { token: string; player: unknown };
    expect(session.player).toEqual({ uuid: NYXAR, name: "Nyxar" });

    const [row] = await platform.db
      .select()
      .from(schema.players)
      .where(eq(schema.players.uuid, NYXAR));
    expect(row?.firstSeenAt).toBeInstanceOf(Date);
    expect(row?.lastSeenAt).toEqual(row?.firstSeenAt);

    const me = await app.request("/api/v1/me", {
      headers: { Authorization: `Bearer ${session.token}` },
    });
    expect(me.status).toBe(200);
    expect(await me.json()).toEqual({ uuid: NYXAR, name: "Nyxar" });
  });

  it("keeps the first access and updates the name on later sign-ins", async () => {
    const { app, platform } = await setup();
    await playerAuth(app, "Nyxar");
    const [first] = await platform.db.select().from(schema.players);
    await platform.db
      .update(schema.players)
      .set({ name: "OldName" })
      .where(eq(schema.players.uuid, NYXAR));

    await playerAuth(app, "Nyxar");
    const [again] = await platform.db.select().from(schema.players);
    expect(again?.name).toBe("Nyxar");
    expect(again?.firstSeenAt).toEqual(first?.firstSeenAt);
  });

  it("refuses forged, expired and unconfirmed challenges", async () => {
    const { app, platform } = await setup();
    const { serverId } = await createChallenge(platform.config);
    const forged = `${serverId.slice(0, 39)}${serverId.endsWith("0") ? "1" : "0"}`;
    expect(await checkChallenge(platform.config, serverId)).toBe(true);
    expect(await checkChallenge(platform.config, forged)).toBe(false);
    expect(await checkChallenge(platform.config, serverId, Date.now() + 6 * 60_000)).toBe(false);

    const res = await jsonRequest(app, "POST", "/api/v1/auth/verify", {
      username: "Nyxar",
      serverId: forged,
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "invalid_challenge" });

    const unknown = await verifyPlayer(app, "Nobody");
    expect(unknown.status).toBe(401);
    expect(await unknown.json()).toMatchObject({ code: "not_joined" });
  });

  it("answers 502 when Mojang is down", async () => {
    const { app } = await setup(async () => new Response("down", { status: 503 }));
    const res = await verifyPlayer(app, "Nyxar");
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ code: "mojang_unavailable" });
  });

  it("asks a session proxy when MOJANG_SESSION_URL points at one", async () => {
    const asked: string[] = [];
    const mojang = mojangFetch();
    const { app, platform } = await setup(async (input, init) => {
      const url = String(input);
      asked.push(new URL(url).host);
      // The proxy forwards to Mojang's session server.
      return mojang(url.replace("https://proxy.example.com/session", MOJANG_SESSION_URL), init);
    });
    platform.config.mojangSessionUrl = "https://proxy.example.com/session";

    const res = await verifyPlayer(app, "Nyxar");

    expect(res.status).toBe(200);
    expect(asked).toEqual(["proxy.example.com"]);
  });

  describe("unverified (Cloudflare without a session proxy)", () => {
    async function unverified(fetchFn?: typeof fetch) {
      const ctx = await setup(fetchFn);
      ctx.platform.config.playerAuth = "unverified";
      return ctx;
    }

    it("trusts the name, looked up on playerdb.co, without asking Mojang", async () => {
      const asked: string[] = [];
      const mojang = mojangFetch();
      const { app } = await unverified(async (input, init) => {
        asked.push(new URL(String(input)).host);
        return mojang(input, init);
      });

      const res = await verifyPlayer(app, "nyxar");

      expect(res.status).toBe(200);
      expect(((await res.json()) as { player: unknown }).player).toEqual({
        uuid: NYXAR,
        name: "Nyxar",
      });
      expect(asked).toEqual(["playerdb.co"]);
    });

    it("still needs a valid challenge and an existing name", async () => {
      const { app } = await unverified();

      const forged = await jsonRequest(app, "POST", "/api/v1/auth/verify", {
        username: "Nyxar",
        serverId: "0".repeat(40),
      });
      expect(forged.status).toBe(401);
      expect(await forged.json()).toMatchObject({ code: "invalid_challenge" });

      const unknown = await verifyPlayer(app, "Nobody");
      expect(unknown.status).toBe(401);
      expect(await unknown.json()).toMatchObject({ code: "not_joined" });
    });

    it("is announced in discovery", async () => {
      const { app } = await unverified();
      const res = await app.request("/.well-known/bc-launcher");
      expect(await res.json()).toMatchObject({ auth: { type: "unverified" } });
    });
  });

  it("refuses missing, invalid and expired tokens", async () => {
    const { app, platform } = await setup();
    await playerAuth(app, "Nyxar");
    const expired = await signPlayerToken(platform.config, NYXAR, Date.now() - 25 * 3600_000);
    // Signed with JWT_SECRET itself instead of the derived key.
    const wrongKey = await sign(
      { sub: NYXAR, exp: Math.floor(Date.now() / 1000) + 60 },
      platform.config.jwtSecret,
      "HS256",
    );

    for (const header of [
      undefined,
      "Bearer nope",
      `Bearer ${expired.token}`,
      `Bearer ${wrongKey}`,
    ]) {
      const res = await app.request("/api/v1/me", {
        headers: header ? { Authorization: header } : {},
      });
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ code: "unauthenticated" });
    }
  });

  it("serves the organization to members", async () => {
    const { app } = await setup();
    const auth = await playerAuth(app, "Nyxar");
    const res = await app.request("/api/v1/organization", { headers: auth });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      name: "BC Launcher Server",
      description: null,
      logoUrl: null,
      links: { discord: null, web: null },
    });
  });

  it("refuses non-members of a private organization, with or without a token", async () => {
    const { app, platform } = await setup();
    const auth = await playerAuth(app, "Nyxar");
    await platform.db.update(schema.settings).set({ visibility: "private" });

    const verify = await verifyPlayer(app, "Tomate_89");
    expect(verify.status).toBe(403);
    expect(await verify.json()).toMatchObject({ code: "not_member" });
    // Recorded anyway, so an admin can whitelist them.
    const players = await platform.db.select().from(schema.players);
    expect(players.map((player) => player.name).sort()).toEqual(["Nyxar", "Tomate_89"]);

    const me = await app.request("/api/v1/me", { headers: auth });
    expect(me.status).toBe(403);
    expect(await me.json()).toMatchObject({ code: "not_member" });

    await platform.db.insert(schema.orgWhitelist).values({ playerUuid: NYXAR });
    expect((await app.request("/api/v1/me", { headers: auth })).status).toBe(200);
  });

  it("treats an organization ban like not being a member until it expires", async () => {
    const { app, platform } = await setup();
    const auth = await playerAuth(app, "Nyxar");
    await platform.db
      .insert(schema.orgBlacklist)
      .values({ playerUuid: NYXAR, expiresAt: new Date(Date.now() + 60_000) });

    const me = await app.request("/api/v1/me", { headers: auth });
    expect(me.status).toBe(403);
    expect(await me.json()).toMatchObject({ code: "not_member" });
    expect((await verifyPlayer(app, "Nyxar")).status).toBe(403);

    await platform.db.update(schema.orgBlacklist).set({ expiresAt: new Date(Date.now() - 1000) });
    expect((await app.request("/api/v1/me", { headers: auth })).status).toBe(200);
  });
});
