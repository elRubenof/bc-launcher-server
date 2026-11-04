import type { Problem } from "@bc-launcher-server/contracts";

/** An error response from the API, with its stable `code`. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Calls the API. A `Blob`/`File` body is sent raw with its own type; anything else as JSON. */
export async function apiRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
  const raw = body instanceof Blob;
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    // The panel must see its own changes right away, even on publicly cached responses (discovery).
    cache: "no-cache",
    headers: body === undefined ? {} : { "Content-Type": raw ? body.type : "application/json" },
    ...(body === undefined ? {} : { body: raw ? body : JSON.stringify(body) }),
  });

  if (!res.ok) {
    let problem: Partial<Problem> = {};
    try {
      problem = (await res.json()) as Partial<Problem>;
    } catch {
      // Not a problem+json body (e.g. a proxy error page).
    }
    throw new ApiError(res.status, problem.code ?? "http_error", problem.title ?? res.statusText);
  }

  return (res.status === 204 ? undefined : await res.json()) as T;
}
