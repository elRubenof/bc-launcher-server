import { base64UrlDecode, base64UrlEncode, randomBytes, timingSafeEqual } from "./crypto";

// PBKDF2-SHA256 through WebCrypto, so the same code runs on Workers and Node.
// 100k iterations is the maximum Workers allows.
const ALGORITHM = "pbkdf2-sha256";
const ITERATIONS = 100_000;
const SALT_BYTES = 16;
const HASH_BYTES = 32;

export const MIN_PASSWORD_LENGTH = 8;

async function derive(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    HASH_BYTES * 8,
  );
  return new Uint8Array(bits);
}

/** Returns `pbkdf2-sha256$<iterations>$<salt>$<hash>` (base64url). */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const hash = await derive(password, salt, ITERATIONS);
  return [ALGORITHM, ITERATIONS, base64UrlEncode(salt), base64UrlEncode(hash)].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algorithm, iterations, salt, hash] = stored.split("$");
  if (algorithm !== ALGORITHM || !iterations || !salt || !hash) return false;
  const expected = base64UrlDecode(hash);
  const actual = await derive(password, base64UrlDecode(salt), Number(iterations));
  return timingSafeEqual(actual, expected);
}
