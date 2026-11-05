import {
  addToInstanceWhitelistRoute,
  addToOrgWhitelistRoute,
  type BlacklistEntry,
  banFromInstanceRoute,
  banFromOrgRoute,
  listInstanceBlacklistRoute,
  listInstanceWhitelistRoute,
  listOrgBlacklistRoute,
  listOrgWhitelistRoute,
  type Player,
  removeFromInstanceWhitelistRoute,
  removeFromOrgWhitelistRoute,
  unbanFromInstanceRoute,
  unbanFromOrgRoute,
  updateInstanceAccessRoute,
  type WhitelistEntry,
} from "@bc-launcher-server/contracts";
import { type Database, schema } from "@bc-launcher-server/db";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { and, desc, eq } from "drizzle-orm";
import type { Context } from "hono";
import { activeBan } from "../access";
import { instanceExists } from "../instances";
import { describeError, MojangUnavailableError, profileByName, profileByUuid } from "../mojang";
import type { AppEnv } from "../platform/types";
import { readPlayer, upsertPlayer } from "../players";
import { problem } from "../problem";

/** `null` = the organization's lists; otherwise an instance's. */
type Scope = string | null;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Finds a player by uuid (known locally, or at Mojang) or by name (always at Mojang: names change
 * hands, so a local match could be someone else now). `null` if Mojang knows no such player.
 */
async function resolvePlayer(c: Context<AppEnv>, ref: string): Promise<Player | null> {
  const { db, fetch } = c.var.platform;
  if (UUID.test(ref)) {
    const known = await readPlayer(db, ref);
    return known ? { uuid: known.uuid, name: known.name } : profileByUuid(fetch, ref);
  }
  return profileByName(fetch, ref);
}

/** Resolves `ref` or returns the error response. */
async function resolveOrFail(c: Context<AppEnv>, ref: string) {
  try {
    const player = await resolvePlayer(c, ref);
    return player ?? problem(c, 404, "player_not_found", "No Minecraft player with that name");
  } catch (error) {
    if (!(error instanceof MojangUnavailableError)) throw error;
    console.error(`Mojang profile lookup failed: ${describeError(error)}`);
    return problem(c, 502, "mojang_unavailable", "Mojang is unavailable");
  }
}

const playerColumns = {
  uuid: schema.players.uuid,
  name: schema.players.name,
  firstSeenAt: schema.players.firstSeenAt,
};
const adminColumns = { id: schema.admins.id, username: schema.admins.username };

const listedPlayer = (player: { uuid: string; name: string; firstSeenAt: Date | null }) => ({
  uuid: player.uuid,
  name: player.name,
  joined: player.firstSeenAt !== null,
});

export async function readWhitelist(
  db: Database,
  scope: Scope,
  playerUuid?: string,
): Promise<WhitelistEntry[]> {
  const table = scope === null ? schema.orgWhitelist : schema.instanceWhitelist;
  const filters = [
    scope === null ? undefined : eq(schema.instanceWhitelist.instanceId, scope),
    playerUuid ? eq(table.playerUuid, playerUuid) : undefined,
  ];
  const rows = await db
    .select({ player: playerColumns, addedBy: adminColumns, createdAt: table.createdAt })
    .from(table)
    .innerJoin(schema.players, eq(schema.players.uuid, table.playerUuid))
    .leftJoin(schema.admins, eq(schema.admins.id, table.createdBy))
    .where(and(...filters))
    .orderBy(desc(table.createdAt));
  return rows.map((row) => ({
    player: listedPlayer(row.player),
    addedBy: row.addedBy,
    createdAt: row.createdAt.toISOString(),
  }));
}

export async function readBlacklist(
  db: Database,
  scope: Scope,
  playerUuid?: string,
  now = new Date(),
): Promise<BlacklistEntry[]> {
  const table = scope === null ? schema.orgBlacklist : schema.instanceBlacklist;
  const filters = [
    activeBan(table.expiresAt, now),
    scope === null ? undefined : eq(schema.instanceBlacklist.instanceId, scope),
    playerUuid ? eq(table.playerUuid, playerUuid) : undefined,
  ];
  const rows = await db
    .select({
      player: playerColumns,
      reason: table.reason,
      expiresAt: table.expiresAt,
      addedBy: adminColumns,
      createdAt: table.createdAt,
    })
    .from(table)
    .innerJoin(schema.players, eq(schema.players.uuid, table.playerUuid))
    .leftJoin(schema.admins, eq(schema.admins.id, table.createdBy))
    .where(and(...filters))
    .orderBy(desc(table.createdAt));
  return rows.map((row) => ({
    player: listedPlayer(row.player),
    reason: row.reason,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    addedBy: row.addedBy,
    createdAt: row.createdAt.toISOString(),
  }));
}

const instanceDetails = (scope: Scope) => (scope === null ? {} : { instance: scope });

async function addToWhitelist(c: Context<AppEnv>, scope: Scope, ref: string) {
  const { db } = c.var.platform;
  if (scope !== null && !(await instanceExists(db, scope))) {
    return problem(c, 404, "not_found", "No such instance");
  }
  const player = await resolveOrFail(c, ref);
  if (player instanceof Response) return player;
  if ((await readWhitelist(db, scope, player.uuid)).length > 0) {
    return problem(c, 409, "already_listed", "Already on the whitelist");
  }

  const createdBy = c.var.admin.id;
  try {
    await db.batch([
      upsertPlayer(db, player),
      scope === null
        ? db.insert(schema.orgWhitelist).values({ playerUuid: player.uuid, createdBy })
        : db
            .insert(schema.instanceWhitelist)
            .values({ instanceId: scope, playerUuid: player.uuid, createdBy }),
      db.insert(schema.auditLog).values({
        adminId: createdBy,
        action: "whitelist.added",
        target: player.uuid,
        details: { name: player.name, ...instanceDetails(scope) },
      }),
    ]);
  } catch (error) {
    // Added by someone else at the same time: the primary key decides.
    if ((await readWhitelist(db, scope, player.uuid)).length > 0) {
      return problem(c, 409, "already_listed", "Already on the whitelist");
    }
    throw error;
  }
  const [entry] = await readWhitelist(db, scope, player.uuid);
  return c.json(entry as WhitelistEntry, 201);
}

async function removeFromWhitelist(c: Context<AppEnv>, scope: Scope, uuid: string) {
  const { db } = c.var.platform;
  if (scope !== null && !(await instanceExists(db, scope))) {
    return problem(c, 404, "not_found", "No such instance");
  }
  const [entry] = await readWhitelist(db, scope, uuid);
  if (!entry) return problem(c, 404, "not_listed", "Not on the whitelist");
  await db.batch([
    scope === null
      ? db.delete(schema.orgWhitelist).where(eq(schema.orgWhitelist.playerUuid, uuid))
      : db
          .delete(schema.instanceWhitelist)
          .where(
            and(
              eq(schema.instanceWhitelist.instanceId, scope),
              eq(schema.instanceWhitelist.playerUuid, uuid),
            ),
          ),
    db.insert(schema.auditLog).values({
      adminId: c.var.admin.id,
      action: "whitelist.removed",
      target: uuid,
      details: { name: entry.player.name, ...instanceDetails(scope) },
    }),
  ]);
  return c.body(null, 204);
}

async function ban(
  c: Context<AppEnv>,
  scope: Scope,
  body: { player: string; reason: string | null; expiresAt: string | null },
) {
  const { db } = c.var.platform;
  if (scope !== null && !(await instanceExists(db, scope))) {
    return problem(c, 404, "not_found", "No such instance");
  }
  const expiresAt = body.expiresAt === null ? null : new Date(body.expiresAt);
  if (expiresAt && expiresAt.getTime() <= Date.now()) {
    return problem(c, 400, "invalid_expiry", "The ban must end in the future");
  }
  const player = await resolveOrFail(c, body.player);
  if (player instanceof Response) return player;

  const reason = body.reason || null;
  const createdBy = c.var.admin.id;
  // Banning again replaces the entry (also an expired one the cleanup hasn't deleted yet).
  const values = { playerUuid: player.uuid, reason, expiresAt, createdBy, createdAt: new Date() };
  const set = { reason, expiresAt, createdBy, createdAt: values.createdAt };
  await db.batch([
    upsertPlayer(db, player),
    scope === null
      ? db
          .insert(schema.orgBlacklist)
          .values(values)
          .onConflictDoUpdate({ target: schema.orgBlacklist.playerUuid, set })
      : db
          .insert(schema.instanceBlacklist)
          .values({ ...values, instanceId: scope })
          .onConflictDoUpdate({
            target: [schema.instanceBlacklist.instanceId, schema.instanceBlacklist.playerUuid],
            set,
          }),
    db.insert(schema.auditLog).values({
      adminId: createdBy,
      action: "player.banned",
      target: player.uuid,
      details: {
        name: player.name,
        ...instanceDetails(scope),
        reason,
        expiresAt: expiresAt?.toISOString() ?? null,
      },
    }),
  ]);
  const [entry] = await readBlacklist(db, scope, player.uuid);
  return c.json(entry as BlacklistEntry, 201);
}

async function unban(c: Context<AppEnv>, scope: Scope, uuid: string) {
  const { db } = c.var.platform;
  if (scope !== null && !(await instanceExists(db, scope))) {
    return problem(c, 404, "not_found", "No such instance");
  }
  const [entry] = await readBlacklist(db, scope, uuid);
  if (!entry) return problem(c, 404, "not_listed", "Not banned");
  await db.batch([
    scope === null
      ? db.delete(schema.orgBlacklist).where(eq(schema.orgBlacklist.playerUuid, uuid))
      : db
          .delete(schema.instanceBlacklist)
          .where(
            and(
              eq(schema.instanceBlacklist.instanceId, scope),
              eq(schema.instanceBlacklist.playerUuid, uuid),
            ),
          ),
    db.insert(schema.auditLog).values({
      adminId: c.var.admin.id,
      action: "player.unbanned",
      target: uuid,
      details: { name: entry.player.name, ...instanceDetails(scope) },
    }),
  ]);
  return c.body(null, 204);
}

export function registerAccessLists(app: OpenAPIHono<AppEnv>) {
  app.openapi(listOrgWhitelistRoute, async (c) =>
    c.json(await readWhitelist(c.var.platform.db, null), 200),
  );
  app.openapi(addToOrgWhitelistRoute, (c) => addToWhitelist(c, null, c.req.valid("json").player));
  app.openapi(removeFromOrgWhitelistRoute, (c) =>
    removeFromWhitelist(c, null, c.req.valid("param").uuid),
  );

  app.openapi(listOrgBlacklistRoute, async (c) =>
    c.json(await readBlacklist(c.var.platform.db, null), 200),
  );
  app.openapi(banFromOrgRoute, (c) => ban(c, null, c.req.valid("json")));
  app.openapi(unbanFromOrgRoute, (c) => unban(c, null, c.req.valid("param").uuid));

  app.openapi(listInstanceWhitelistRoute, async (c) => {
    const { id } = c.req.valid("param");
    const { db } = c.var.platform;
    if (!(await instanceExists(db, id))) return problem(c, 404, "not_found", "No such instance");
    return c.json(await readWhitelist(db, id), 200);
  });
  app.openapi(addToInstanceWhitelistRoute, (c) =>
    addToWhitelist(c, c.req.valid("param").id, c.req.valid("json").player),
  );
  app.openapi(removeFromInstanceWhitelistRoute, (c) => {
    const { id, uuid } = c.req.valid("param");
    return removeFromWhitelist(c, id, uuid);
  });

  app.openapi(listInstanceBlacklistRoute, async (c) => {
    const { id } = c.req.valid("param");
    const { db } = c.var.platform;
    if (!(await instanceExists(db, id))) return problem(c, 404, "not_found", "No such instance");
    return c.json(await readBlacklist(db, id), 200);
  });
  app.openapi(banFromInstanceRoute, (c) => ban(c, c.req.valid("param").id, c.req.valid("json")));
  app.openapi(unbanFromInstanceRoute, (c) => {
    const { id, uuid } = c.req.valid("param");
    return unban(c, id, uuid);
  });

  app.openapi(updateInstanceAccessRoute, async (c) => {
    const { id } = c.req.valid("param");
    const { access } = c.req.valid("json");
    const { db } = c.var.platform;
    const [before] = await db
      .select({ access: schema.instances.access })
      .from(schema.instances)
      .where(eq(schema.instances.id, id));
    if (!before) return problem(c, 404, "not_found", "No such instance");
    if (before.access !== access) {
      await db.batch([
        db
          .update(schema.instances)
          .set({ access, updatedAt: new Date() })
          .where(eq(schema.instances.id, id)),
        db.insert(schema.auditLog).values({
          adminId: c.var.admin.id,
          action: "instance.access_changed",
          target: id,
          details: { from: before.access, to: access },
        }),
      ]);
    }
    return c.json({ access }, 200);
  });
}
