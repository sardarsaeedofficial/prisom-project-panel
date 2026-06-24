/**
 * lib/ui/action-error-normalizer.ts
 *
 * Sprint 56: Normalize any thrown error or failed action result into a
 * user-facing message. No stack traces. No secrets.
 */

export type NormalizedError = {
  message: string;
  details?: string;
};

export function normalizeActionError(err: unknown): NormalizedError {
  if (err instanceof Error) {
    return { message: err.message.slice(0, 300) };
  }
  if (typeof err === "string") {
    return { message: err.slice(0, 300) };
  }
  if (err !== null && typeof err === "object") {
    const o = err as Record<string, unknown>;
    if (typeof o["message"] === "string") return { message: o["message"].slice(0, 300) };
    if (typeof o["error"]   === "string") return { message: o["error"].slice(0, 300) };
    if (typeof o["msg"]     === "string") return { message: o["msg"].slice(0, 300) };
  }
  return { message: "An unexpected error occurred. Please try again." };
}

/** Normalize a server action result that may return { ok: false, error } */
export function normalizeActionResult<T>(
  result: { ok: true; data: T } | { ok: false; error: string; code?: string },
): { ok: true; data: T } | { ok: false; error: NormalizedError } {
  if (result.ok) return result;
  return { ok: false, error: normalizeActionError(result.error) };
}
