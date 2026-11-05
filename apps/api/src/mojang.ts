import type { Player } from "@bc-launcher-server/contracts";
import { MOJANG_SESSION_URL } from "./platform/config";

const PROFILES_API = "https://api.mojang.com/users/profiles/minecraft";
/**
 * playerdb.co mirrors Mojang's profiles. It answers from Cloudflare Workers, which Mojang's
 * `api.mojang.com` and `sessionserver.mojang.com` refuse (403), so lookups try it first.
 */
const PLAYERDB_API = "https://playerdb.co/api/player/minecraft";
const USER_AGENT = "bc-launcher-server (+https://github.com/elRubenof/bc-launcher-server)";

/** Mojang couldn't be reached or answered with an error. */
export class MojangUnavailableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "MojangUnavailableError";
  }
}

/** `0123…` (32 hex digits, as Mojang returns them) → lowercase with dashes. */
export function dashedUuid(id: string): string {
  const hex = id.replaceAll("-", "").toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(hex)) throw new MojangUnavailableError(`Unexpected profile id ${id}`);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** One line for the logs: the message and its cause (the Workers log viewer drops both). */
export function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  return error.cause ? `${error.message} (${describeError(error.cause)})` : error.message;
}

/** Fetches a profile (`{id, name}`); `null` when Mojang says there is none (204 or 404). */
async function fetchProfile(fetchFn: typeof fetch, url: string): Promise<Player | null> {
  let res: Response;
  try {
    res = await fetchFn(url, { headers: { Accept: "application/json" } });
  } catch (error) {
    throw new MojangUnavailableError(`Couldn't reach ${new URL(url).host}`, { cause: error });
  }
  if (res.status === 204 || res.status === 404) return null;
  if (!res.ok) {
    // The start of the body says who refused (a firewall page, a rate limit message...).
    const body = (await res.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 200);
    throw new MojangUnavailableError(
      `${new URL(url).host} answered ${res.status}${body ? `: ${body}` : ""}`,
    );
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch (error) {
    throw new MojangUnavailableError("Mojang sent invalid JSON", { cause: error });
  }
  const { id, name } = (body ?? {}) as { id?: unknown; name?: unknown };
  if (typeof id !== "string" || typeof name !== "string") {
    throw new MojangUnavailableError("Mojang sent an unexpected profile");
  }
  return { uuid: dashedUuid(id), name };
}

/** Looks a profile up on playerdb.co by name or uuid; `null` when there is no such player. */
async function fetchPlayerDb(fetchFn: typeof fetch, ref: string): Promise<Player | null> {
  const url = `${PLAYERDB_API}/${encodeURIComponent(ref)}`;
  let res: Response;
  try {
    res = await fetchFn(url, { headers: { Accept: "application/json", "User-Agent": USER_AGENT } });
  } catch (error) {
    throw new MojangUnavailableError("Couldn't reach playerdb.co", { cause: error });
  }
  let body: {
    code?: unknown;
    success?: unknown;
    data?: { player?: { id?: unknown; username?: unknown } };
  };
  try {
    body = (await res.json()) as typeof body;
  } catch (error) {
    throw new MojangUnavailableError(`playerdb.co answered ${res.status} without JSON`, {
      cause: error,
    });
  }
  if (body.success === true) {
    const { id, username } = body.data?.player ?? {};
    if (typeof id !== "string" || typeof username !== "string") {
      throw new MojangUnavailableError("playerdb.co sent an unexpected profile");
    }
    return { uuid: dashedUuid(id), name: username };
  }
  if (body.code === "minecraft.invalid_username") return null;
  throw new MojangUnavailableError(`playerdb.co answered ${res.status}: ${String(body.code)}`);
}

/** playerdb.co first and Mojang if it fails; throws only if both fail. */
async function lookUp(fetchFn: typeof fetch, ref: string, mojangUrl: string) {
  try {
    return await fetchPlayerDb(fetchFn, ref);
  } catch (playerDbError) {
    try {
      return await fetchProfile(fetchFn, mojangUrl);
    } catch (mojangError) {
      throw new MojangUnavailableError(
        `${describeError(playerDbError)}; then ${describeError(mojangError)}`,
      );
    }
  }
}

/**
 * Whether `username` joined with `serverId` (the launcher's `join`); its profile if so.
 * `sessionUrl` is Mojang's session server or a proxy of it (`MOJANG_SESSION_URL`).
 */
export function hasJoined(
  fetchFn: typeof fetch,
  sessionUrl: string,
  username: string,
  serverId: string,
) {
  const query = new URLSearchParams({ username, serverId });
  return fetchProfile(fetchFn, `${sessionUrl}/hasJoined?${query}`);
}

/** The current owner of a Minecraft name, to add players to a list before they ever join. */
export function profileByName(fetchFn: typeof fetch, name: string) {
  return lookUp(fetchFn, name, `${PROFILES_API}/${encodeURIComponent(name)}`);
}

/** A profile's current name. */
export function profileByUuid(fetchFn: typeof fetch, uuid: string) {
  const id = uuid.replaceAll("-", "");
  return lookUp(fetchFn, id, `${MOJANG_SESSION_URL}/profile/${id}`);
}
