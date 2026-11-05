import type { ServerUpdates } from "@bc-launcher-server/contracts";
import type { Platform } from "./platform/types";
import { SERVER_VERSION } from "./version";

/**
 * GitHub answers this with a redirect to `/releases/tag/vX.Y.Z` of the latest published release
 * (no drafts or prereleases). Reading the redirect avoids the API's per-IP rate limit, which
 * Workers would share with every other Worker behind the same address.
 */
export const LATEST_RELEASE_URL = "https://github.com/elRubenof/bc-launcher-server/releases/latest";

const CHECK_TTL = 6 * 3600_000;
const RETRY_TTL = 30 * 60_000;

type Latest = { version: string; url: string } | null;
let cache: { latest: Latest; expires: number } | undefined;

/** Forgets the cached check (tests). */
export function resetUpdatesCache() {
  cache = undefined;
}

async function fetchLatest(platform: Platform): Promise<Latest> {
  try {
    const res = await platform.fetch(LATEST_RELEASE_URL, {
      method: "HEAD",
      redirect: "manual",
      signal: AbortSignal.timeout(5000),
    });
    const location = res.headers.get("location");
    if (!location) return null;
    const url = new URL(location, LATEST_RELEASE_URL);
    const match = /\/releases\/tag\/v(\d+\.\d+\.\d+)$/.exec(url.pathname);
    return match?.[1] ? { version: match[1], url: url.href } : null;
  } catch {
    return null;
  }
}

/** `a` > `b` for `X.Y.Z` versions. */
export function isNewer(a: string, b: string): boolean {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff > 0;
  }
  return false;
}

/**
 * The current version and the latest release, checked at most every 6 hours (30 minutes after a
 * failed check). A failure is never an error: `latest` is just `null`.
 */
export async function checkUpdates(
  platform: Platform,
  current = SERVER_VERSION,
  now = Date.now(),
): Promise<ServerUpdates> {
  if (!cache || cache.expires <= now) {
    const latest = await fetchLatest(platform);
    cache = { latest, expires: now + (latest ? CHECK_TTL : RETRY_TTL) };
  }
  const { latest } = cache;
  return {
    current,
    latest: latest?.version ?? null,
    url: latest?.url ?? null,
    updateAvailable: latest ? isNewer(latest.version, current) : false,
  };
}
