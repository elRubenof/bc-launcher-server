import {
  challengeRoute,
  playerMeRoute,
  playerOrganizationRoute,
  verifyRoute,
} from "@bc-launcher-server/contracts";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { isMember } from "../access";
import { checkChallenge, createChallenge, signPlayerToken } from "../auth/player-tokens";
import { describeError, hasJoined, MojangUnavailableError } from "../mojang";
import type { AppEnv } from "../platform/types";
import { upsertPlayer } from "../players";
import { problem } from "../problem";
import { assetUrl, readSettings } from "../settings";

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

    let profile: Awaited<ReturnType<typeof hasJoined>>;
    try {
      profile = await hasJoined(c.var.platform.fetch, username, serverId);
    } catch (error) {
      if (!(error instanceof MojangUnavailableError)) throw error;
      console.error(`hasJoined failed: ${describeError(error)}`);
      return problem(c, 502, "mojang_unavailable", "Mojang's session server is unavailable");
    }
    if (!profile) return problem(c, 401, "not_joined", "Mojang didn't confirm the sign-in");

    // Recorded even if not a member, so admins can find them to add them to a whitelist.
    await upsertPlayer(db, profile, new Date());
    if (!(await isMember(db, profile.uuid))) {
      return problem(c, 403, "not_member", "You don't have access to this organization");
    }
    const { token, expiresAt } = await signPlayerToken(config, profile.uuid);
    return c.json({ token, expiresAt: expiresAt.toISOString(), player: profile }, 200, {
      "Cache-Control": "no-store",
    });
  });

  app.openapi(playerMeRoute, (c) => c.json(c.var.player, 200));

  app.openapi(playerOrganizationRoute, async (c) => {
    const { db, config } = c.var.platform;
    const settings = await readSettings(db);
    return c.json(
      {
        name: settings.name,
        description: settings.description,
        logoUrl: assetUrl(config, settings.logoBlob),
        iconUrl: assetUrl(config, settings.iconBlob),
        links: { discord: settings.discordUrl, web: settings.webUrl },
      },
      200,
      { "Cache-Control": "private, no-cache" },
    );
  });
}
