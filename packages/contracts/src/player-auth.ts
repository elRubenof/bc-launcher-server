import { createRoute, z } from "@hono/zod-openapi";
import { problemResponse } from "./problem";

/** A Minecraft name (what Mojang accepts, plus the short legacy names). */
export const PlayerName = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_]{1,16}$/, "A Minecraft name: 1-16 letters, numbers or '_'");

/** A Mojang profile id, lowercase with dashes. */
export const PlayerUuid = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

export const Player = z
  .object({
    uuid: PlayerUuid,
    name: z.string(),
  })
  .openapi("Player");

export type Player = z.infer<typeof Player>;

export const AuthChallenge = z
  .object({
    /** Pass it as `serverId` to Mojang's `join`, then to `verify`. */
    serverId: z.string(),
    expiresAt: z.iso.datetime(),
  })
  .openapi("AuthChallenge");

export const VerifyRequest = z
  .object({
    username: PlayerName,
    serverId: z.string().regex(/^[0-9a-f]{40}$/),
  })
  .openapi("VerifyRequest");

export const PlayerSession = z
  .object({
    /** Send it as `Authorization: Bearer <token>`. Valid for 24 hours. */
    token: z.string(),
    expiresAt: z.iso.datetime(),
    player: Player,
  })
  .openapi("PlayerSession");

export type PlayerSession = z.infer<typeof PlayerSession>;

/** The organization as its members see it in the launcher. */
export const Organization = z
  .object({
    name: z.string(),
    description: z.string().nullable(),
    logoUrl: z.url().nullable(),
    links: z.object({
      discord: z.url().nullable(),
      web: z.url().nullable(),
    }),
  })
  .openapi("Organization");

export type Organization = z.infer<typeof Organization>;

/** Security requirement of the routes that need a player token. */
export const playerAuth = [{ playerToken: [] }];

/** Responses every route with a player token can give. */
export const playerAuthResponses = {
  401: problemResponse(
    "No token, or an invalid or expired one (`unauthenticated`): sign in again with `challenge` and `verify`.",
  ),
  403: problemResponse(
    "The player isn't a member of the organization (`not_member`): not on the whitelist of a private organization, or banned. Both cases look the same.",
  ),
};

export const challengeRoute = createRoute({
  method: "post",
  path: "/api/v1/auth/challenge",
  summary: "Start signing a player in",
  description:
    "Returns a `serverId` valid for 5 minutes. The launcher calls Mojang's `join` with it (the Minecraft token never leaves the launcher) and then `verify`.",
  tags: ["Launcher"],
  responses: {
    200: {
      description: "The challenge.",
      content: { "application/json": { schema: AuthChallenge } },
    },
  },
});

export const verifyRoute = createRoute({
  method: "post",
  path: "/api/v1/auth/verify",
  summary: "Finish signing a player in",
  description:
    "Checks with Mojang (`hasJoined`) that the player joined with the challenge's `serverId`. Members get a token; everyone who passes the check is recorded as a player.",
  tags: ["Launcher"],
  request: {
    body: { required: true, content: { "application/json": { schema: VerifyRequest } } },
  },
  responses: {
    200: {
      description: "Signed in.",
      content: { "application/json": { schema: PlayerSession } },
    },
    400: problemResponse("Invalid request."),
    401: problemResponse(
      "The challenge is invalid or expired (`invalid_challenge`), or Mojang says the player didn't join with it (`not_joined`).",
    ),
    403: playerAuthResponses[403],
    502: problemResponse("Mojang's session server couldn't be reached (`mojang_unavailable`)."),
  },
});

export const playerMeRoute = createRoute({
  method: "get",
  path: "/api/v1/me",
  summary: "The signed-in player",
  tags: ["Launcher"],
  security: playerAuth,
  responses: {
    200: { description: "The player.", content: { "application/json": { schema: Player } } },
    ...playerAuthResponses,
  },
});

export const playerOrganizationRoute = createRoute({
  method: "get",
  path: "/api/v1/organization",
  summary: "The organization's identity and links",
  description:
    "The launcher paints instances with their own colors and background; the organization has none.",
  tags: ["Launcher"],
  security: playerAuth,
  responses: {
    200: {
      description: "The organization.",
      content: { "application/json": { schema: Organization } },
    },
    ...playerAuthResponses,
  },
});
