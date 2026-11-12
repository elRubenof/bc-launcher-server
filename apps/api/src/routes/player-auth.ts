import { challengeRoute, verifyRoute } from "@bc-launcher-server/contracts";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { isMember } from "../access";
import { checkChallenge, createChallenge, signPlayerToken } from "../auth/player-tokens";
import { describeError, hasJoined, MojangUnavailableError, profileByName } from "../mojang";
import type { AppEnv } from "../platform/types";
import { upsertPlayer } from "../players";
import { problem } from "../problem";

export function registerPlayerAuth(app: OpenAPIHono<AppEnv>) {
  app.openapi(challengeRoute, async (c) => {
    const { serverId, expiresAt } = await createChallenge(c.var.platform.config);
    return c.json({ serverId, expiresAt: expiresAt.toISOString() }, 200, {
      "Cache-Control": "no-store",
    });
  });

  app.openapi(verifyRoute, async (c) => {
    const { username, serverId } = c.req.valid("json");
    const { db, config } = c.var.platform;
    if (!(await checkChallenge(config, serverId))) {
      return problem(c, 401, "invalid_challenge", "The challenge is invalid or expired");
    }

    // `unverified` (Cloudflare without a session proxy): the name is trusted and only looked up,
    // so anyone can claim any name. Chosen by configuration, never as a fallback when Mojang fails.
    const verified = config.playerAuth === "mojang-session";
    let profile: Awaited<ReturnType<typeof hasJoined>>;
    try {
      profile = verified
        ? await hasJoined(c.var.platform.fetch, config.mojangSessionUrl, username, serverId)
        : await profileByName(c.var.platform.fetch, username);
    } catch (error) {
      if (!(error instanceof MojangUnavailableError)) throw error;
      console.error(`${verified ? "hasJoined" : "Profile lookup"} failed: ${describeError(error)}`);
      return problem(c, 502, "mojang_unavailable", "Mojang's session server is unavailable");
    }
    if (!profile) return problem(c, 401, "not_joined", "Mojang didn't confirm the sign-in");

    // Non-members aren't recorded: a private organization only lists who could get in. Signing in
    // doesn't count as an access either (the launcher renews tokens in the background); the
    // launcher reports real ones with `presence`.
    if (!(await isMember(db, profile.uuid))) {
      return problem(c, 403, "not_member", "You don't have access to this organization");
    }
    await upsertPlayer(db, profile);
    const { token, expiresAt } = await signPlayerToken(config, profile.uuid);
    return c.json({ token, expiresAt: expiresAt.toISOString(), player: profile }, 200, {
      "Cache-Control": "no-store",
    });
  });
}
