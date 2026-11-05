import { createRoute, z } from "@hono/zod-openapi";
import { problemResponse } from "./problem";

const HttpUrl = z
  .url({ protocol: /^https?$/ })
  .max(500)
  .nullable();

export const OrganizationSettings = z
  .object({
    name: z.string(),
    description: z.string().nullable(),
    logoUrl: z.url().nullable(),
    discordUrl: z.string().nullable(),
    webUrl: z.string().nullable(),
    visibility: z.enum(["public", "private"]),
    minLauncherVersion: z.string().nullable(),
    /** This deployment's public URL (`PUBLIC_URL`), used for the download page and deep link. */
    publicUrl: z.url(),
  })
  .openapi("OrganizationSettings");

export type OrganizationSettings = z.infer<typeof OrganizationSettings>;

export const UpdateOrganizationSettings = z
  .object({
    name: z.string().trim().min(1).max(100),
    description: z.string().trim().max(500).nullable(),
    discordUrl: HttpUrl,
    webUrl: HttpUrl,
    visibility: z.enum(["public", "private"]),
    minLauncherVersion: z
      .string()
      .trim()
      .regex(/^\d+\.\d+\.\d+$/, "A version like 2.0.0")
      .nullable(),
    /**
     * When going from public to private: also add everyone who already signed in to the
     * organization's whitelist, in the same change, so nobody is left out by accident.
     */
    whitelistJoinedPlayers: z.boolean().optional(),
  })
  .openapi("UpdateOrganizationSettings");

export type UpdateOrganizationSettings = z.infer<typeof UpdateOrganizationSettings>;

const settingsResponse = {
  description: "The organization's settings.",
  content: { "application/json": { schema: OrganizationSettings } },
};

export const getSettingsRoute = createRoute({
  method: "get",
  path: "/api/admin/settings",
  summary: "The organization's settings",
  tags: ["Admin"],
  responses: {
    200: settingsResponse,
    401: problemResponse("Not signed in (`unauthenticated`)."),
  },
});

export const updateSettingsRoute = createRoute({
  method: "put",
  path: "/api/admin/settings",
  summary: "Change the organization's settings (owner and admins)",
  tags: ["Admin"],
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: UpdateOrganizationSettings } },
    },
  },
  responses: {
    200: settingsResponse,
    400: problemResponse("Invalid request."),
    401: problemResponse("Not signed in (`unauthenticated`)."),
    403: problemResponse("Only the owner and admins can do this (`forbidden`)."),
  },
});
