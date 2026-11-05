import { getPlayerRoute, listPlayersRoute, type PlayerDetail } from "@bc-launcher-server/contracts";
import { schema } from "@bc-launcher-server/db";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { and, count, desc, eq, exists, isNull, not, or, type SQL, sql } from "drizzle-orm";
import {
  activeBan,
  instanceAccess,
  instanceWhitelisted,
  launchable,
  memberCondition,
  orgBanned,
  orgWhitelisted,
  playableBy,
} from "../access";
import type { AppEnv } from "../platform/types";
import { readPlayer } from "../players";
import { problem } from "../problem";
import { readSettings } from "../settings";

/** `%` and `_` are literal in searches (`_` is common in Minecraft names). */
const likeEscape = (value: string) => value.replace(/[\\%_]/g, (char) => `\\${char}`);

const iso = (date: Date | null) => date?.toISOString() ?? null;

export function registerPlayers(app: OpenAPIHono<AppEnv>) {
  app.openapi(listPlayersRoute, async (c) => {
    const { q, status, instance, offset, limit } = c.req.valid("query");
    const { db } = c.var.platform;
    const now = new Date();
    const { visibility } = await readSettings(db);

    const uuid = schema.players.uuid;
    const member = memberCondition(db, uuid, now, visibility);
    const banned = orgBanned(db, uuid, now);
    const instanceBans = sql<number>`(${db
      .select({ n: count() })
      .from(schema.instanceBlacklist)
      .where(
        and(
          eq(schema.instanceBlacklist.playerUuid, uuid),
          activeBan(schema.instanceBlacklist.expiresAt, now),
        ),
      )})`;

    const filters: (SQL | undefined)[] = [];
    if (q) {
      const pattern = likeEscape(q);
      filters.push(
        or(
          sql`${schema.players.name} like ${`%${pattern}%`} escape '\\'`,
          sql`${uuid} like ${`${pattern.toLowerCase()}%`} escape '\\'`,
        ),
      );
    }
    if (status === "member") filters.push(member);
    if (status === "banned") filters.push(or(banned, sql`${instanceBans} > 0`));
    if (status === "not_member") filters.push(and(not(member), not(banned)));
    if (status === "never_joined") filters.push(isNull(schema.players.firstSeenAt));
    if (instance) {
      filters.push(
        member,
        exists(
          db
            .select({ one: sql`1` })
            .from(schema.instances)
            .where(and(eq(schema.instances.id, instance), instanceAccess(db, uuid, now))),
        ),
      );
    }
    const where = and(...filters);

    const [rows, [total], [instances]] = await Promise.all([
      db
        .select({
          player: schema.players,
          status: sql<
            PlayerDetail["organization"]["status"]
          >`case when ${banned} then 'banned' when ${member} then 'member' else 'not_member' end`,
          playable: sql<number>`case when ${member} then (${db
            .select({ n: count() })
            .from(schema.instances)
            .where(playableBy(db, uuid, now))}) else 0 end`,
          instanceBans,
        })
        .from(schema.players)
        .where(where)
        .orderBy(
          sql`${schema.players.lastSeenAt} is null`,
          desc(schema.players.lastSeenAt),
          schema.players.name,
        )
        .limit(limit)
        .offset(offset),
      db.select({ n: count() }).from(schema.players).where(where),
      db.select({ n: count() }).from(schema.instances).where(launchable),
    ]);

    return c.json(
      {
        items: rows.map((row) => ({
          uuid: row.player.uuid,
          name: row.player.name,
          firstSeenAt: iso(row.player.firstSeenAt),
          lastSeenAt: iso(row.player.lastSeenAt),
          status: row.status,
          playableInstances: Number(row.playable),
          instanceBans: Number(row.instanceBans),
        })),
        total: total?.n ?? 0,
        launchableInstances: instances?.n ?? 0,
      },
      200,
    );
  });

  app.openapi(getPlayerRoute, async (c) => {
    const { uuid } = c.req.valid("param");
    const { db } = c.var.platform;
    const now = new Date();
    const player = await readPlayer(db, uuid);
    if (!player) return problem(c, 404, "not_found", "No such player");

    const banColumns = (table: typeof schema.orgBlacklist | typeof schema.instanceBlacklist) => ({
      reason: table.reason,
      expiresAt: table.expiresAt,
      createdAt: table.createdAt,
      addedBy: { id: schema.admins.id, username: schema.admins.username },
    });
    const toBan = (ban: {
      reason: string | null;
      expiresAt: Date | null;
      createdAt: Date;
      addedBy: { id: string; username: string } | null;
    }) => ({
      reason: ban.reason,
      expiresAt: iso(ban.expiresAt),
      createdAt: ban.createdAt.toISOString(),
      addedBy: ban.addedBy,
    });

    const [settings, [org], [orgBan], instances, instanceBans] = await Promise.all([
      readSettings(db),
      db
        .select({
          whitelisted: sql<number>`${orgWhitelisted(db, uuid)}`,
          member: sql<number>`${memberCondition(db, uuid, now, sql`${schema.settings.visibility}`)}`,
        })
        .from(schema.settings)
        .where(eq(schema.settings.id, 1)),
      db
        .select(banColumns(schema.orgBlacklist))
        .from(schema.orgBlacklist)
        .leftJoin(schema.admins, eq(schema.admins.id, schema.orgBlacklist.createdBy))
        .where(
          and(
            eq(schema.orgBlacklist.playerUuid, uuid),
            activeBan(schema.orgBlacklist.expiresAt, now),
          ),
        ),
      db
        .select({
          id: schema.instances.id,
          name: schema.instances.name,
          access: schema.instances.access,
          launchable: sql<number>`${launchable}`,
          whitelisted: sql<number>`${instanceWhitelisted(db, uuid, schema.instances.id)}`,
          hasAccess: sql<number>`${instanceAccess(db, uuid, now)}`,
        })
        .from(schema.instances)
        .orderBy(desc(schema.instances.createdAt)),
      db
        .select({
          instanceId: schema.instanceBlacklist.instanceId,
          ...banColumns(schema.instanceBlacklist),
        })
        .from(schema.instanceBlacklist)
        .leftJoin(schema.admins, eq(schema.admins.id, schema.instanceBlacklist.createdBy))
        .where(
          and(
            eq(schema.instanceBlacklist.playerUuid, uuid),
            activeBan(schema.instanceBlacklist.expiresAt, now),
          ),
        ),
    ]);

    const isMember = Boolean(org?.member);
    const detail: PlayerDetail = {
      uuid: player.uuid,
      name: player.name,
      firstSeenAt: iso(player.firstSeenAt),
      lastSeenAt: iso(player.lastSeenAt),
      organization: {
        visibility: settings.visibility,
        status: orgBan ? "banned" : isMember ? "member" : "not_member",
        whitelisted: Boolean(org?.whitelisted),
        ban: orgBan ? toBan(orgBan) : null,
      },
      instances: instances.map((instance) => {
        const ban = instanceBans.find((entry) => entry.instanceId === instance.id);
        return {
          id: instance.id,
          name: instance.name,
          access: instance.access,
          launchable: Boolean(instance.launchable),
          whitelisted: Boolean(instance.whitelisted),
          ban: ban ? toBan(ban) : null,
          visible: isMember && Boolean(instance.launchable) && Boolean(instance.hasAccess),
        };
      }),
    };
    return c.json(detail, 200);
  });
}
