// No imports: the panel imports this file directly (`@bc-launcher-server/contracts/paths`) to
// validate paths exactly like the API, without bundling zod.

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
