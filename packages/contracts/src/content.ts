import { createRoute, z } from "@hono/zod-openapi";
import { MAX_INSTANCE_FILES, Sha256 } from "./blobs";
import { LOADERS } from "./instances";
import { problemResponse } from "./problem";

/** Top-level folders the launcher fills itself (Minecraft and the loader); never synced. */
export const RESERVED_DIRS = ["versions", "libraries", "assets"] as const;
export const MAX_MANAGED_DIRS = 100;

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what it rejects
const FORBIDDEN_CHARS = /[\\:*?"<>|\u0000-\u001f]/;

/**
 * Why a path inside an instance folder is invalid, or `null` if it's fine. Paths are relative and
 * posix (`mods/sodium.jar`), and must be valid file names on Windows, macOS and Linux.
 */
export function instancePathError(path: string): string | null {
  if (path.length === 0 || path.length > 255) return "must have 1 to 255 characters";
  if (path.startsWith("/")) return "must be relative";
  const segments = path.split("/");
  for (const segment of segments) {
    if (segment === "" || segment === "." || segment === "..") {
      return "can't have empty, `.` or `..` parts";
    }
    if (FORBIDDEN_CHARS.test(segment))
      return "can't contain \\ : * ? \" < > | or control characters";
    if (/[. ]$/.test(segment)) return "parts can't end with a dot or a space";
    if (WINDOWS_RESERVED.test(segment)) return `\`${segment}\` is a reserved name on Windows`;
  }
  const top = (segments[0] as string).toLowerCase();
  if ((RESERVED_DIRS as readonly string[]).includes(top)) {
    return `\`${top}/\` is managed by the launcher itself`;
  }
  return null;
}

const InstancePath = z.string().superRefine((path, ctx) => {
  const error = instancePathError(path);
  if (error) ctx.addIssue({ code: "custom", message: `${path}: ${error}` });
});

export const FilePolicy = z.enum(["always", "once"]);
export type FilePolicy = z.infer<typeof FilePolicy>;

export const InstanceFile = z
  .object({
    path: z.string(),
    sha256: Sha256,
    size: z.int(),
    /** `always`: restored on every launch. `once`: copied only if the player doesn't have it. */
    policy: FilePolicy,
  })
  .openapi("InstanceFile");

export type InstanceFile = z.infer<typeof InstanceFile>;

export const InstanceContent = z
  .object({
    contentVersion: z.int(),
    minecraft: z.object({ version: z.string() }),
    loader: z.object({ type: z.enum(LOADERS), version: z.string().nullable() }),
    /** Folders where the launcher deletes whatever isn't in the content (`mods`). */
    managedDirs: z.array(z.string()),
    files: z.array(InstanceFile),
    updatedAt: z.iso.datetime().nullable(),
    updatedBy: z.object({ id: z.string(), username: z.string() }).nullable(),
  })
  .openapi("InstanceContent");

export type InstanceContent = z.infer<typeof InstanceContent>;

export const ApplyContent = z
  .object({
    /** The `contentVersion` the change was made on; `409 content_conflict` if it moved since. */
    expectedContentVersion: z.int().min(0),
    mcVersion: z.string().trim().min(1).max(50),
    loader: z.enum(LOADERS),
    loaderVersion: z.string().trim().min(1).max(100).nullable(),
    managedDirs: z.array(InstancePath).max(MAX_MANAGED_DIRS),
    files: z
      .array(z.object({ path: InstancePath, sha256: Sha256, policy: FilePolicy }))
      .max(MAX_INSTANCE_FILES),
  })
  .openapi("ApplyContent");

export type ApplyContent = z.infer<typeof ApplyContent>;

const InstanceIdParam = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{1,39}$/)
  .openapi({ param: { name: "id", in: "path" } });

const contentResponse = (description: string) => ({
  description,
  content: { "application/json": { schema: InstanceContent } },
});

export const getInstanceContentRoute = createRoute({
  method: "get",
  path: "/api/admin/instances/{id}/content",
  summary: "An instance's current content",
  tags: ["Admin"],
  request: { params: z.object({ id: InstanceIdParam }) },
  responses: {
    200: contentResponse("The content."),
    401: problemResponse("Not signed in (`unauthenticated`)."),
    404: problemResponse("No such instance (`not_found`)."),
  },
});

export const applyInstanceContentRoute = createRoute({
  method: "put",
  path: "/api/admin/instances/{id}/content",
  summary: "Replace an instance's content in one go",
  description:
    "Upload every file first (`blobs/check` + `PUT blobs/{sha256}`). The new file list, managed folders and versions replace the current ones in a single transaction and `contentVersion` goes up by one, so players get either the old content or the new one, never a mix. Changed Minecraft or loader versions are checked against the official metadata.",
  tags: ["Admin"],
  request: {
    params: z.object({ id: InstanceIdParam }),
    body: { required: true, content: { "application/json": { schema: ApplyContent } } },
  },
  responses: {
    200: contentResponse("The new content."),
    400: problemResponse(
      "Invalid request (`validation_error`), paths that clash (`path_conflict`), or versions that don't exist (`invalid_version`).",
    ),
    401: problemResponse("Not signed in (`unauthenticated`)."),
    404: problemResponse("No such instance (`not_found`)."),
    409: problemResponse(
      "Someone applied a change since `expectedContentVersion` (`content_conflict`), or some files aren't uploaded (`missing_blobs`, listed in `detail`). Nothing changed.",
    ),
    502: problemResponse(
      "The official metadata couldn't be fetched to check the versions (`metadata_unavailable`).",
    ),
  },
});
