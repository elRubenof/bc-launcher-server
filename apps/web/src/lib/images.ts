import type { MessageKey } from "@/i18n";
import { ApiError } from "./api";

/** The message for a failed image upload. */
export function imageErrorKey(error: unknown): MessageKey {
  if (error instanceof ApiError && error.code === "image_too_large") return "org.imageTooLarge";
  if (error instanceof ApiError && error.code === "invalid_image") return "org.imageInvalid";
  return "common.unexpectedError";
}
