// Mirrors the API's rules (packages/contracts) so the form can explain them before submitting.
export const USERNAME_PATTERN = /^[a-z0-9][a-z0-9_.-]{2,31}$/;
export const MIN_PASSWORD_LENGTH = 8;

export function normalizeUsername(value: string) {
  return value.trim().toLowerCase();
}
