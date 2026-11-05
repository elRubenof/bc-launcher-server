import type { Player } from "@bc-launcher-server/contracts";

const SESSION_SERVER = "https://sessionserver.mojang.com/session/minecraft";
const PROFILES_API = "https://api.mojang.com/users/profiles/minecraft";

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

/** Whether `username` joined with `serverId` (the launcher's `join`); its profile if so. */
export function hasJoined(fetchFn: typeof fetch, username: string, serverId: string) {
  const query = new URLSearchParams({ username, serverId });
  return fetchProfile(fetchFn, `${SESSION_SERVER}/hasJoined?${query}`);
}

/** The current owner of a Minecraft name, to add players to a list before they ever join. */
export function profileByName(fetchFn: typeof fetch, name: string) {
  return fetchProfile(fetchFn, `${PROFILES_API}/${encodeURIComponent(name)}`);
}

/** A profile's current name. */
export function profileByUuid(fetchFn: typeof fetch, uuid: string) {
  return fetchProfile(fetchFn, `${SESSION_SERVER}/profile/${uuid.replaceAll("-", "")}`);
}
