import type { Admin } from "@bc-launcher-server/contracts";
import { type Database, schema } from "@bc-launcher-server/db";
import { and, eq, gt, lt } from "drizzle-orm";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { AppEnv } from "../platform/types";
import { randomToken, sha256Hex } from "./crypto";

/** Sessions last this long since the last use (sliding expiry). */
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Expiry is only pushed forward once this much time has passed, to avoid a write per request. */
const REFRESH_AFTER_MS = 60 * 60 * 1000;

function cookieName(c: Context<AppEnv>) {
  // `__Host-` binds the cookie to this exact origin, but requires HTTPS.
  return isHttps(c) ? "__Host-bcls_session" : "bcls_session";
}

function isHttps(c: Context<AppEnv>) {
  return c.var.platform.config.publicUrl.startsWith("https://");
}

/** Creates a session for `adminId` and sets its cookie. */
export async function startSession(c: Context<AppEnv>, adminId: string) {
  const { db } = c.var.platform;
  const token = randomToken();
  const now = Date.now();
  await db.batch([
    db.delete(schema.adminSessions).where(lt(schema.adminSessions.expiresAt, new Date(now))),
    db.insert(schema.adminSessions).values({
      id: await sha256Hex(token),
      adminId,
      expiresAt: new Date(now + SESSION_TTL_MS),
      lastUsedAt: new Date(now),
    }),
  ]);
  setCookie(c, cookieName(c), token, {
    httpOnly: true,
    secure: isHttps(c),
    sameSite: "Strict",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

/** Returns the signed-in admin and refreshes the session, or `null`. */
export async function readSession(c: Context<AppEnv>): Promise<Admin | null> {
  const token = getCookie(c, cookieName(c));
  if (!token) return null;

  const { db } = c.var.platform;
  const id = await sha256Hex(token);
  const now = Date.now();
  const [row] = await db
    .select({
      lastUsedAt: schema.adminSessions.lastUsedAt,
      admin: { id: schema.admins.id, username: schema.admins.username, role: schema.admins.role },
    })
    .from(schema.adminSessions)
    .innerJoin(schema.admins, eq(schema.admins.id, schema.adminSessions.adminId))
    .where(and(eq(schema.adminSessions.id, id), gt(schema.adminSessions.expiresAt, new Date(now))));
  if (!row) return null;

  if (now - row.lastUsedAt.getTime() > REFRESH_AFTER_MS) {
    await db
      .update(schema.adminSessions)
      .set({ lastUsedAt: new Date(now), expiresAt: new Date(now + SESSION_TTL_MS) })
      .where(eq(schema.adminSessions.id, id));
    setCookie(c, cookieName(c), token, {
      httpOnly: true,
      secure: isHttps(c),
      sameSite: "Strict",
      path: "/",
      maxAge: SESSION_TTL_MS / 1000,
    });
  }
  return row.admin;
}

/** Deletes the current session and clears its cookie. */
export async function endSession(c: Context<AppEnv>) {
  const token = getCookie(c, cookieName(c));
  if (token) {
    await c.var.platform.db
      .delete(schema.adminSessions)
      .where(eq(schema.adminSessions.id, await sha256Hex(token)));
  }
  deleteCookie(c, cookieName(c), { path: "/", secure: isHttps(c) });
}

/** Revokes every session of an admin (password change, removal). */
export async function endAllSessions(db: Database, adminId: string) {
  await db.delete(schema.adminSessions).where(eq(schema.adminSessions.adminId, adminId));
}
