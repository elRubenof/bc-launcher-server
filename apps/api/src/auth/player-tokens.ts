import { sign, verify } from "hono/jwt";
import type { Config } from "../platform/types";
import { randomBytes, timingSafeEqual } from "./crypto";

/** How long a challenge's `serverId` can be used with `verify`. */
export const CHALLENGE_TTL_MS = 5 * 60 * 1000;
/** How long a player token is valid. */
export const PLAYER_TOKEN_TTL_SECONDS = 24 * 3600;

const encoder = new TextEncoder();
type HmacKey = Awaited<ReturnType<typeof importHmacKey>>;
const keys = new Map<string, Promise<HmacKey>>();

// Each use gets its own key derived from JWT_SECRET (blob URLs use `blob-urls:`), so a value signed
// for one purpose is never valid for another.
function importHmacKey(material: string) {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(material),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

function challengeKey(secret: string) {
  const material = `auth-challenge:${secret}`;
  let key = keys.get(material);
  if (!key) {
    key = importHmacKey(material);
    keys.set(material, key);
  }
  return key;
}

const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

async function challengeMac(config: Config, payload: string) {
  const key = await challengeKey(config.jwtSecret);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(payload)));
  return mac.slice(0, 8);
}

/**
 * A `serverId` for Mojang's `join`: 40 hex digits (like vanilla's) made of the expiry (seconds),
 * a random nonce and a truncated HMAC, so `verify` can check it without storing anything.
 */
export async function createChallenge(config: Config, now = Date.now()) {
  const expires = Math.floor((now + CHALLENGE_TTL_MS) / 1000);
  const payload = expires.toString(16).padStart(8, "0") + hex(randomBytes(8));
  const serverId = payload + hex(await challengeMac(config, payload));
  return { serverId, expiresAt: new Date(expires * 1000) };
}

/** Whether `serverId` came from `createChallenge` and hasn't expired. */
export async function checkChallenge(config: Config, serverId: string, now = Date.now()) {
  if (!/^[0-9a-f]{40}$/.test(serverId)) return false;
  const payload = serverId.slice(0, 24);
  const given = Uint8Array.from(serverId.slice(24).match(/../g) ?? [], (byte) =>
    Number.parseInt(byte, 16),
  );
  if (!timingSafeEqual(given, await challengeMac(config, payload))) return false;
  return Number.parseInt(payload.slice(0, 8), 16) * 1000 > now;
}

const jwtSecret = (config: Config) => `player-jwt:${config.jwtSecret}`;

/** A player token: HS256 JWT with the player's uuid as `sub`, valid for 24 hours. */
export async function signPlayerToken(config: Config, uuid: string, now = Date.now()) {
  const iat = Math.floor(now / 1000);
  const exp = iat + PLAYER_TOKEN_TTL_SECONDS;
  const token = await sign({ sub: uuid, iat, exp }, jwtSecret(config), "HS256");
  return { token, expiresAt: new Date(exp * 1000) };
}

/** The player uuid in a valid, unexpired token; `null` otherwise. */
export async function verifyPlayerToken(config: Config, token: string): Promise<string | null> {
  try {
    const payload = await verify(token, jwtSecret(config), "HS256");
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}
