// Mirrors the API's rules (packages/contracts) so the form can explain them before submitting.
export const USERNAME_PATTERN = /^[a-z0-9][a-z0-9_.-]{2,31}$/;
export const MIN_PASSWORD_LENGTH = 8;

export function normalizeUsername(value: string) {
  return value.trim().toLowerCase();
}

export const INSTANCE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,39}$/;

/** Suggests an instance id from its name: "Serie T3" → "serie-t3". */
export function slugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
}

export function isHttpUrl(value: string) {
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}
