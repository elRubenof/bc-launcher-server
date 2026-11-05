import { base64UrlDecode, base64UrlEncode, timingSafeEqual } from "./auth/crypto";
import type { Config } from "./platform/types";

/**
 * Blob URLs are valid for 6 to 12 hours: the expiry is the end of the next 6-hour window, so
 * every manifest served in the same window carries the same URLs (cacheable) and a launcher that
 * gets `304 Not Modified` within the window can still use the URLs it already has.
 */
export const URL_WINDOW_SECONDS = 6 * 3600;

const encoder = new TextEncoder();
type HmacKey = Awaited<ReturnType<typeof importHmacKey>>;
const keys = new Map<string, Promise<HmacKey>>();

function importHmacKey(secret: string) {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(`blob-urls:${secret}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

function signingKey(secret: string) {
  let key = keys.get(secret);
  if (!key) {
    key = importHmacKey(secret);
    keys.set(secret, key);
  }
  return key;
}

async function signature(config: Config, sha256: string, expires: number) {
  const key = await signingKey(config.jwtSecret);
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(`${sha256}.${expires}`));
  return new Uint8Array(mac);
}

/** The window of `now` (ms): manifests served in it share their URLs and ETag. */
export function urlWindow(now = Date.now()) {
  return Math.floor(now / 1000 / URL_WINDOW_SECONDS);
}

export async function signedBlobUrl(config: Config, sha256: string, now = Date.now()) {
  const expires = (urlWindow(now) + 2) * URL_WINDOW_SECONDS;
  const sig = base64UrlEncode(await signature(config, sha256, expires));
  return `${config.publicUrl}/api/v1/blobs/${sha256}?exp=${expires}&sig=${sig}`;
}

export type SignatureCheck = "valid" | "invalid" | "expired";

export async function checkBlobSignature(
  config: Config,
  sha256: string,
  expires: number,
  sig: string,
  now = Date.now(),
): Promise<SignatureCheck> {
  let given: Uint8Array;
  try {
    given = base64UrlDecode(sig);
  } catch {
    return "invalid";
  }
  if (!timingSafeEqual(given, await signature(config, sha256, expires))) return "invalid";
  return expires * 1000 > now ? "valid" : "expired";
}
