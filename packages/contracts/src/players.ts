import { createRoute, z } from "@hono/zod-openapi";
import { PlayerUuid } from "./player-auth";
import { problemResponse } from "./problem";

const AdminRef = z.object({ id: z.string(), username: z.string() }).nullable();

/**
 * `member`: has access to the organization. `not_member`: the organization is private and they
 * aren't on its whitelist. `banned`: banned from the organization.
 */
export const OrgStatus = z.enum(["member", "not_member", "banned"]);

export const PlayerSummary = z
  .object({
    uuid: PlayerUuid,
    name: z.string(),
    /** `null`: added to a list by name and never signed in. */
    firstSeenAt: z.iso.datetime().nullable(),
    lastSeenAt: z.iso.datetime().nullable(),
    status: OrgStatus,
    /** Active instances with content the player can play (0 unless a member). */
    playableInstances: z.int(),
    /** Instances the player is banned from right now. */
    instanceBans: z.int(),
  })
  .openapi("PlayerSummary");

export type PlayerSummary = z.infer<typeof PlayerSummary>;

export const PlayerPage = z
  .object({
    items: z.array(PlayerSummary),
    /** Players matching the filters. */
    total: z.int(),
    /** Active instances with content, to show `playableInstances` as "2 of 3". */
    launchableInstances: z.int(),
  })
  .openapi("PlayerPage");

/** `joined`: signed in at least once; `never_joined`: only added to a list by name. */
export const PlayerFilter = z.enum([
  "all",
  "member",
  "banned",
  "not_member",
  "joined",
  "never_joined",
]);

export const Ban = z
  .object({
    reason: z.string().nullable(),
    expiresAt: z.iso.datetime().nullable(),
    addedBy: AdminRef,
    createdAt: z.iso.datetime(),
  })
  .openapi("Ban");

export const PlayerDetail = z
  .object({
    uuid: PlayerUuid,
    name: z.string(),
    firstSeenAt: z.iso.datetime().nullable(),
    lastSeenAt: z.iso.datetime().nullable(),
    organization: z.object({
      visibility: z.enum(["public", "private"]),
      status: OrgStatus,
      whitelisted: z.boolean(),
      ban: Ban.nullable(),
    }),
    /** Every instance, newest first, with the player's access to it. */
    instances: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        access: z.enum(["everyone", "whitelist"]),
        /** Active and with content: shown in the launcher at all. */
        launchable: z.boolean(),
        whitelisted: z.boolean(),
        ban: Ban.nullable(),
        /** Member, launchable, and with access: the launcher shows it to them. */
        visible: z.boolean(),
      }),
    ),
  })
  .openapi("PlayerDetail");

export type PlayerDetail = z.infer<typeof PlayerDetail>;

const unauthenticated = problemResponse("Not signed in (`unauthenticated`).");

export const listPlayersRoute = createRoute({
  method: "get",
  path: "/api/admin/players",
  summary: "Players, most recently seen first",
  description:
    "Everyone who signed in with the launcher, plus players added to a list by name who never joined.",
  tags: ["Admin"],
  request: {
    query: z.object({
      /** Part of the name, or the start of the uuid. */
      q: z.string().trim().max(50).optional(),
      status: PlayerFilter.default("all"),
      /** Only players who can see this instance. */
      instance: z.string().max(40).optional(),
      offset: z.coerce.number().int().min(0).default(0),
      limit: z.coerce.number().int().min(1).max(100).default(50),
    }),
  },
  responses: {
    200: {
      description: "A page of players.",
      content: { "application/json": { schema: PlayerPage } },
    },
    400: problemResponse("Invalid request."),
    401: unauthenticated,
  },
});

export const getPlayerRoute = createRoute({
  method: "get",
  path: "/api/admin/players/{uuid}",
  summary: "A player and their access to the organization and each instance",
  tags: ["Admin"],
  request: {
    params: z.object({ uuid: PlayerUuid.openapi({ param: { name: "uuid", in: "path" } }) }),
  },
  responses: {
    200: { description: "The player.", content: { "application/json": { schema: PlayerDetail } } },
    401: unauthenticated,
    404: problemResponse("No such player (`not_found`)."),
  },
});
