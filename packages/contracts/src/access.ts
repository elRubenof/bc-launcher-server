import { createRoute, z } from "@hono/zod-openapi";
import { PlayerUuid } from "./player-auth";
import { problemResponse } from "./problem";

const InstanceIdParam = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{1,39}$/)
  .openapi({ param: { name: "id", in: "path" } });

const UuidParam = PlayerUuid.openapi({ param: { name: "uuid", in: "path" } });

/** A player in a list: they may have been added by name and never joined. */
export const ListedPlayer = z
  .object({
    uuid: PlayerUuid,
    name: z.string(),
    /** Whether they ever signed in with the launcher. */
    joined: z.boolean(),
  })
  .openapi("ListedPlayer");

const AdminRef = z.object({ id: z.string(), username: z.string() }).nullable();

export const WhitelistEntry = z
  .object({
    player: ListedPlayer,
    /** Who added them; `null` if that admin was removed or it was an automatic import. */
    addedBy: AdminRef,
    createdAt: z.iso.datetime(),
  })
  .openapi("WhitelistEntry");

export type WhitelistEntry = z.infer<typeof WhitelistEntry>;

export const BlacklistEntry = z
  .object({
    player: ListedPlayer,
    /** Only admins see it. */
    reason: z.string().nullable(),
    /** `null` = permanent. */
    expiresAt: z.iso.datetime().nullable(),
    addedBy: AdminRef,
    createdAt: z.iso.datetime(),
  })
  .openapi("BlacklistEntry");

export type BlacklistEntry = z.infer<typeof BlacklistEntry>;

/** A player by Minecraft name (looked up at Mojang) or by uuid. */
const PlayerRef = z
  .string()
  .trim()
  .regex(
    /^([A-Za-z0-9_]{1,16}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/,
    "A Minecraft name or a player uuid",
  );

export const AddToWhitelist = z.object({ player: PlayerRef }).openapi("AddToWhitelist");

export const BanPlayer = z
  .object({
    player: PlayerRef,
    reason: z.string().trim().max(500).nullable(),
    /** `null` bans permanently; otherwise a future date. */
    expiresAt: z.iso.datetime().nullable(),
  })
  .openapi("BanPlayer");

export type BanPlayer = z.infer<typeof BanPlayer>;

const unauthenticated = problemResponse("Not signed in (`unauthenticated`).");
const mojangUnavailable = problemResponse(
  "Mojang couldn't be reached to look the player up (`mojang_unavailable`).",
);
const instanceParams = z.object({ id: InstanceIdParam });
const orgEntryParams = z.object({ uuid: UuidParam });
const instanceEntryParams = z.object({ id: InstanceIdParam, uuid: UuidParam });

const json = <T extends z.ZodType>(schema: T) => ({ "application/json": { schema } });
const body = <T extends z.ZodType>(schema: T) => ({ required: true, content: json(schema) });
const whitelistList = {
  description: "The entries, newest first.",
  content: json(z.array(WhitelistEntry)),
};
const blacklistList = {
  description: "The active bans, newest first (expired ones no longer count).",
  content: json(z.array(BlacklistEntry)),
};
const newWhitelistEntry = { description: "The new entry.", content: json(WhitelistEntry) };
const newBan = { description: "The ban.", content: json(BlacklistEntry) };
const removed = { description: "Removed." };

const ADD_DESCRIPTION =
  "By Minecraft name (looked up at Mojang, so players can be added before they ever join) or uuid.";
const BAN_DESCRIPTION =
  "By Minecraft name or uuid. Banning someone already banned replaces the reason and the expiry. A ban doesn't remove anyone from a whitelist: when it ends, the player gets back the access they had.";

export const listOrgWhitelistRoute = createRoute({
  method: "get",
  path: "/api/admin/whitelist",
  summary: "The organization's whitelist (only used while it is private)",
  tags: ["Admin"],
  responses: { 200: whitelistList, 401: unauthenticated },
});

export const addToOrgWhitelistRoute = createRoute({
  method: "post",
  path: "/api/admin/whitelist",
  summary: "Add a player to the organization's whitelist",
  description: ADD_DESCRIPTION,
  tags: ["Admin"],
  request: { body: body(AddToWhitelist) },
  responses: {
    201: newWhitelistEntry,
    400: problemResponse("Invalid request."),
    401: unauthenticated,
    404: problemResponse("No Minecraft player with that name or uuid (`player_not_found`)."),
    409: problemResponse("Already on the whitelist (`already_listed`)."),
    502: mojangUnavailable,
  },
});

export const removeFromOrgWhitelistRoute = createRoute({
  method: "delete",
  path: "/api/admin/whitelist/{uuid}",
  summary: "Remove a player from the organization's whitelist",
  tags: ["Admin"],
  request: { params: orgEntryParams },
  responses: {
    204: removed,
    401: unauthenticated,
    404: problemResponse("Not on the whitelist (`not_listed`)."),
  },
});

export const listOrgBlacklistRoute = createRoute({
  method: "get",
  path: "/api/admin/blacklist",
  summary: "Players banned from the organization",
  tags: ["Admin"],
  responses: { 200: blacklistList, 401: unauthenticated },
});

export const banFromOrgRoute = createRoute({
  method: "post",
  path: "/api/admin/blacklist",
  summary: "Ban a player from the organization",
  description: `${BAN_DESCRIPTION} The launcher shows them the same as a non-member (\`not_member\`).`,
  tags: ["Admin"],
  request: { body: body(BanPlayer) },
  responses: {
    201: newBan,
    400: problemResponse(
      "Invalid request, or an expiry that isn't in the future (`invalid_expiry`).",
    ),
    401: unauthenticated,
    404: problemResponse("No Minecraft player with that name or uuid (`player_not_found`)."),
    502: mojangUnavailable,
  },
});

export const unbanFromOrgRoute = createRoute({
  method: "delete",
  path: "/api/admin/blacklist/{uuid}",
  summary: "Lift a player's organization ban",
  tags: ["Admin"],
  request: { params: orgEntryParams },
  responses: {
    204: removed,
    401: unauthenticated,
    404: problemResponse("Not banned (`not_listed`)."),
  },
});

export const listInstanceWhitelistRoute = createRoute({
  method: "get",
  path: "/api/admin/instances/{id}/whitelist",
  summary: "An instance's whitelist (only used while its access is `whitelist`)",
  tags: ["Admin"],
  request: { params: instanceParams },
  responses: {
    200: whitelistList,
    401: unauthenticated,
    404: problemResponse("No such instance (`not_found`)."),
  },
});

export const addToInstanceWhitelistRoute = createRoute({
  method: "post",
  path: "/api/admin/instances/{id}/whitelist",
  summary: "Add a player to an instance's whitelist",
  description: ADD_DESCRIPTION,
  tags: ["Admin"],
  request: { params: instanceParams, body: body(AddToWhitelist) },
  responses: {
    201: newWhitelistEntry,
    400: problemResponse("Invalid request."),
    401: unauthenticated,
    404: problemResponse(
      "No such instance (`not_found`), or no Minecraft player with that name or uuid (`player_not_found`).",
    ),
    409: problemResponse("Already on the whitelist (`already_listed`)."),
    502: mojangUnavailable,
  },
});

export const removeFromInstanceWhitelistRoute = createRoute({
  method: "delete",
  path: "/api/admin/instances/{id}/whitelist/{uuid}",
  summary: "Remove a player from an instance's whitelist",
  tags: ["Admin"],
  request: { params: instanceEntryParams },
  responses: {
    204: removed,
    401: unauthenticated,
    404: problemResponse("No such instance (`not_found`), or not on the whitelist (`not_listed`)."),
  },
});

export const listInstanceBlacklistRoute = createRoute({
  method: "get",
  path: "/api/admin/instances/{id}/blacklist",
  summary: "Players banned from an instance",
  tags: ["Admin"],
  request: { params: instanceParams },
  responses: {
    200: blacklistList,
    401: unauthenticated,
    404: problemResponse("No such instance (`not_found`)."),
  },
});

export const banFromInstanceRoute = createRoute({
  method: "post",
  path: "/api/admin/instances/{id}/blacklist",
  summary: "Ban a player from an instance",
  description: `${BAN_DESCRIPTION} The instance becomes invisible to them.`,
  tags: ["Admin"],
  request: { params: instanceParams, body: body(BanPlayer) },
  responses: {
    201: newBan,
    400: problemResponse(
      "Invalid request, or an expiry that isn't in the future (`invalid_expiry`).",
    ),
    401: unauthenticated,
    404: problemResponse(
      "No such instance (`not_found`), or no Minecraft player with that name or uuid (`player_not_found`).",
    ),
    502: mojangUnavailable,
  },
});

export const unbanFromInstanceRoute = createRoute({
  method: "delete",
  path: "/api/admin/instances/{id}/blacklist/{uuid}",
  summary: "Lift a player's instance ban",
  tags: ["Admin"],
  request: { params: instanceEntryParams },
  responses: {
    204: removed,
    401: unauthenticated,
    404: problemResponse("No such instance (`not_found`), or not banned (`not_listed`)."),
  },
});

export const InstanceAccess = z.enum(["everyone", "whitelist"]);

export const updateInstanceAccessRoute = createRoute({
  method: "put",
  path: "/api/admin/instances/{id}/access",
  summary: "Choose who can play an instance",
  description:
    "`everyone`: every member of the organization. `whitelist`: only the players on the instance's whitelist; for everyone else it is invisible. Bans win in both cases.",
  tags: ["Admin"],
  request: {
    params: instanceParams,
    body: body(z.object({ access: InstanceAccess }).openapi("UpdateInstanceAccess")),
  },
  responses: {
    200: {
      description: "Saved.",
      content: json(z.object({ access: InstanceAccess })),
    },
    400: problemResponse("Invalid request."),
    401: unauthenticated,
    404: problemResponse("No such instance (`not_found`)."),
  },
});
