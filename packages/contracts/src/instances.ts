import { createRoute, z } from "@hono/zod-openapi";
import { IMAGE_TYPES } from "./assets";
import { problemResponse } from "./problem";

/** Readable and immutable: used in URLs and as the launcher's local folder. */
export const INSTANCE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,39}$/;
export const LOADERS = ["vanilla", "fabric", "quilt", "forge", "neoforge"] as const;
export type Loader = (typeof LOADERS)[number];

/** BC Launcher's own colors: what every new instance starts with. */
export const DEFAULT_INSTANCE_COLORS = {
  primary: "#A83CBB",
  primaryDark: "#8F349D",
  background: "#23162A",
  text: "#FFFFFF",
} as const;

export const MAX_BACKGROUND_BYTES = 8 * 1024 * 1024;

const HexColor = z.string().regex(/^#[0-9A-Fa-f]{6}$/, "A color like #A83CBB");

export const InstanceColors = z
  .object({
    primary: HexColor,
    primaryDark: HexColor,
    background: HexColor,
    text: HexColor,
  })
  .openapi("InstanceColors");

export type InstanceColors = z.infer<typeof InstanceColors>;

const HttpUrl = z
  .url({ protocol: /^https?$/ })
  .max(500)
  .nullable();

export const WEB_TAB_ICONS = [
  "map",
  "trophy",
  "calendar",
  "book",
  "chart",
  "live",
  "users",
  "list",
  "form",
  "globe",
] as const;
export type WebTabIcon = (typeof WEB_TAB_ICONS)[number];

export const MAX_WEB_TABS = 5;
export const MAX_WEB_TAB_LABEL = 24;

/** Fills a tab URL's `{uuid}` and `{name}` with sample values, as the launcher does with the player's. */
export function withSamplePlayer(url: string) {
  return url
    .replaceAll("{uuid}", "069a79f4-44e9-4726-a5be-fca90e38aaf5")
    .replaceAll("{name}", "Notch");
}

function isWebTabUrl(url: string) {
  const filled = withSamplePlayer(url);
  if (/[{}]/.test(filled)) return false;
  try {
    const { protocol } = new URL(filled);
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

export const WebTab = z
  .object({
    label: z.string().trim().min(1).max(MAX_WEB_TAB_LABEL),
    url: z
      .string()
      .trim()
      .max(500)
      .refine(isWebTabUrl, "An http(s) URL; only {uuid} and {name} can go between braces")
      .openapi({
        description:
          "An http(s) URL. `{uuid}` and `{name}` are placeholders the launcher replaces with the signed-in player's uuid (lowercase with dashes) and Minecraft name.",
      }),
    icon: z.enum(WEB_TAB_ICONS),
    /** `launcher`: shown inside the tab. `browser`: opened in the system browser, the tab never becomes active. */
    openIn: z.enum(["launcher", "browser"]),
  })
  .openapi("WebTab");

export type WebTab = z.infer<typeof WebTab>;

const InstanceIdParam = z
  .string()
  .regex(INSTANCE_ID_PATTERN)
  .openapi({ param: { name: "id", in: "path" } });

export const Instance = z
  .object({
    id: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    iconUrl: z.url().nullable(),
    /** Never null: new instances get BC Launcher's default background. */
    backgroundUrl: z.url(),
    colors: InstanceColors,
    /** The launcher's web tabs, in order, between Home and Settings. */
    tabs: z.array(WebTab),
    /** The instance's own links; `null` means the launcher gets the organization's. */
    discordUrl: z.string().nullable(),
    webUrl: z.string().nullable(),
    serverAddress: z.string().nullable(),
    recommendedRamMb: z.int().nullable(),
    access: z.enum(["everyone", "whitelist"]),
    isActive: z.boolean(),
    minecraft: z.object({ version: z.string() }),
    loader: z.object({ type: z.enum(LOADERS), version: z.string().nullable() }),
    /** +1 on every applied content change; 0 = no content yet (hidden in the launcher). */
    contentVersion: z.int(),
    contentUpdatedAt: z.iso.datetime().nullable(),
    contentUpdatedBy: z.object({ id: z.string(), username: z.string() }).nullable(),
    fileCount: z.int(),
    /** Bytes of all the instance's files. */
    totalSize: z.int(),
    /**
     * Players who signed in at least once and can play it right now (members, not banned from it,
     * and on its whitelist if it has one), whether or not it is active.
     */
    playersWithAccess: z.int(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .openapi("Instance");

export type Instance = z.infer<typeof Instance>;

const LoaderVersion = z.string().trim().min(1).max(100).nullable();

export const CreateInstance = z
  .object({
    id: z.string().regex(INSTANCE_ID_PATTERN, "Lowercase letters, numbers and dashes"),
    name: z.string().trim().min(1).max(100),
    description: z.string().trim().max(500).nullable(),
    mcVersion: z.string().trim().min(1).max(50),
    loader: z.enum(LOADERS),
    /** Required unless the loader is `vanilla`. */
    loaderVersion: LoaderVersion,
  })
  .openapi("CreateInstance");

export type CreateInstance = z.infer<typeof CreateInstance>;

export const UpdateInstance = z
  .object({
    name: z.string().trim().min(1).max(100),
    description: z.string().trim().max(500).nullable(),
    discordUrl: HttpUrl,
    webUrl: HttpUrl,
    serverAddress: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9.-]{1,253}(:\d{1,5})?$/, "host or host:port")
      .nullable(),
    recommendedRamMb: z.int().min(1024).max(65536).nullable(),
    isActive: z.boolean(),
  })
  .openapi("UpdateInstance");

export type UpdateInstance = z.infer<typeof UpdateInstance>;

export const UpdateInstanceAppearance = z
  .object({ colors: InstanceColors })
  .openapi("UpdateInstanceAppearance");

export const UpdateInstanceTabs = z
  .object({ tabs: z.array(WebTab).max(MAX_WEB_TABS) })
  .openapi("UpdateInstanceTabs");

export type UpdateInstanceTabs = z.infer<typeof UpdateInstanceTabs>;

const instanceResponse = (description: string) => ({
  description,
  content: { "application/json": { schema: Instance } },
});

const unauthenticated = problemResponse("Not signed in (`unauthenticated`).");
const notFound = problemResponse("No such instance (`not_found`).");

export const listInstancesRoute = createRoute({
  method: "get",
  path: "/api/admin/instances",
  summary: "Every instance, newest first",
  tags: ["Admin"],
  responses: {
    200: {
      description: "The instances.",
      content: { "application/json": { schema: z.array(Instance) } },
    },
    401: unauthenticated,
  },
});

export const createInstanceRoute = createRoute({
  method: "post",
  path: "/api/admin/instances",
  summary: "Create an instance with BC Launcher's default appearance and no content",
  description:
    "The Minecraft and loader versions are checked against the official metadata. The new instance has `mods` as a managed folder and stays hidden in the launcher until content is applied.",
  tags: ["Admin"],
  request: {
    body: { required: true, content: { "application/json": { schema: CreateInstance } } },
  },
  responses: {
    201: instanceResponse("The new instance."),
    400: problemResponse(
      "Invalid request, or a Minecraft or loader version that doesn't exist (`invalid_version`).",
    ),
    401: unauthenticated,
    409: problemResponse("An instance with that id already exists (`instance_exists`)."),
    502: problemResponse(
      "The official metadata couldn't be fetched to check the versions (`metadata_unavailable`).",
    ),
  },
});

export const getInstanceRoute = createRoute({
  method: "get",
  path: "/api/admin/instances/{id}",
  summary: "An instance",
  tags: ["Admin"],
  request: { params: z.object({ id: InstanceIdParam }) },
  responses: {
    200: instanceResponse("The instance."),
    401: unauthenticated,
    404: notFound,
  },
});

export const updateInstanceRoute = createRoute({
  method: "put",
  path: "/api/admin/instances/{id}",
  summary: "Change an instance's details",
  tags: ["Admin"],
  request: {
    params: z.object({ id: InstanceIdParam }),
    body: { required: true, content: { "application/json": { schema: UpdateInstance } } },
  },
  responses: {
    200: instanceResponse("The updated instance."),
    400: problemResponse("Invalid request."),
    401: unauthenticated,
    404: notFound,
  },
});

export const updateInstanceAppearanceRoute = createRoute({
  method: "put",
  path: "/api/admin/instances/{id}/appearance",
  summary: "Change an instance's colors",
  tags: ["Admin"],
  request: {
    params: z.object({ id: InstanceIdParam }),
    body: {
      required: true,
      content: { "application/json": { schema: UpdateInstanceAppearance } },
    },
  },
  responses: {
    200: instanceResponse("The updated instance."),
    400: problemResponse("Invalid request."),
    401: unauthenticated,
    404: notFound,
  },
});

export const updateInstanceTabsRoute = createRoute({
  method: "put",
  path: "/api/admin/instances/{id}/tabs",
  summary: "Replace an instance's web tabs",
  description: `The full list, in the order the launcher shows them (up to ${MAX_WEB_TABS}).`,
  tags: ["Admin"],
  request: {
    params: z.object({ id: InstanceIdParam }),
    body: { required: true, content: { "application/json": { schema: UpdateInstanceTabs } } },
  },
  responses: {
    200: instanceResponse("The updated instance."),
    400: problemResponse("Invalid request."),
    401: unauthenticated,
    404: notFound,
  },
});

const Binary = z.string().openapi({ type: "string", format: "binary" });
const imageContent = Object.fromEntries(IMAGE_TYPES.map((type) => [type, { schema: Binary }]));

const InstanceImageParams = z.object({
  id: InstanceIdParam,
  kind: z.enum(["icon", "background"]).openapi({ param: { name: "kind", in: "path" } }),
});

export const uploadInstanceImageRoute = createRoute({
  method: "put",
  path: "/api/admin/instances/{id}/{kind}",
  summary: "Upload an instance's icon or background",
  description: `PNG, JPEG, WebP or GIF as the raw body: up to 2 MB for the icon, ${MAX_BACKGROUND_BYTES / 1024 / 1024} MB for the background.`,
  tags: ["Admin"],
  request: { params: InstanceImageParams, body: { required: true, content: imageContent } },
  responses: {
    200: instanceResponse("The instance with the new image."),
    400: problemResponse("Not a PNG, JPEG, WebP or GIF image (`invalid_image`)."),
    401: unauthenticated,
    404: notFound,
    413: problemResponse("The image is too large (`image_too_large`)."),
  },
});

export const deleteInstanceImageRoute = createRoute({
  method: "delete",
  path: "/api/admin/instances/{id}/{kind}",
  summary: "Remove an instance's icon, or reset its background to the default one",
  tags: ["Admin"],
  request: { params: InstanceImageParams },
  responses: {
    200: instanceResponse("The updated instance."),
    401: unauthenticated,
    404: notFound,
  },
});

export const deleteInstanceRoute = createRoute({
  method: "delete",
  path: "/api/admin/instances/{id}",
  summary: "Delete an instance and its content",
  description: "Its blobs are deleted later by the orphan cleanup if nothing else uses them.",
  tags: ["Admin"],
  request: { params: z.object({ id: InstanceIdParam }) },
  responses: {
    204: { description: "Deleted." },
    401: unauthenticated,
    404: notFound,
  },
});
