import { createMiddleware } from "hono/factory";
import { isMember } from "../access";
import { verifyPlayerToken } from "../auth/player-tokens";
import type { AppEnv } from "../platform/types";
import { readPlayer } from "../players";
import { problem } from "../problem";

/**
 * Requires a player token (`Authorization: Bearer`) and checks membership on every request, so a
 * ban or a removal from the whitelist applies at once. Sets `c.var.player`.
 */
export const requirePlayer = createMiddleware<AppEnv>(async (c, next) => {
  const { db, config } = c.var.platform;
  const header = c.req.header("Authorization");
  const token = header?.match(/^Bearer\s+(\S+)$/i)?.[1];
  const uuid = token ? await verifyPlayerToken(config, token) : null;
  const player = uuid ? await readPlayer(db, uuid) : null;
  if (!player) return problem(c, 401, "unauthenticated", "Sign in again");
  if (!(await isMember(db, player.uuid))) {
    return problem(c, 403, "not_member", "You don't have access to this organization");
  }
  c.set("player", { uuid: player.uuid, name: player.name });
  return next();
});
