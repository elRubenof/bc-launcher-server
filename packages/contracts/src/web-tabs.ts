/**
 * Web tab rules, without imports so the panel validates tabs exactly like the API without bundling
 * zod (exported as `@bc-launcher-server/contracts/web-tabs`).
 */

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

/** Whether a tab URL is http(s) once filled in and has no other placeholders. */
export function isWebTabUrl(url: string) {
  const filled = withSamplePlayer(url);
  if (/[{}]/.test(filled)) return false;
  try {
    const { protocol } = new URL(filled);
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}
