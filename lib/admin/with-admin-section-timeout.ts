/**
 * lib/admin/with-admin-section-timeout.ts
 *
 * Sprint 42: Wraps a server-side async operation with a timeout.
 *
 * Returns a structured error when the operation exceeds timeoutMs,
 * rather than letting the promise hang indefinitely.
 *
 * Safety rules:
 *  - Never throws — always returns { ok: true, data } or { ok: false, error }
 *  - Error messages are plain text — no stack traces, no secret values
 */

export type WithTimeoutResult<T> =
  | { ok: true;  data: T }
  | { ok: false; error: string };

/**
 * Races `promise` against a timeout.
 * On timeout: returns { ok: false, error: "<label> timed out after <N>s." }
 * On rejection: returns { ok: false, error: sanitized message }
 * On success: returns { ok: true, data }
 */
export async function withTimeout<T>(
  promise:   Promise<T>,
  timeoutMs: number,
  label:     string,
): Promise<WithTimeoutResult<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`__timeout__`));
    }, timeoutMs);
  });

  try {
    const data = await Promise.race([promise, timeoutPromise]);
    clearTimeout(timer);
    return { ok: true, data };
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof Error && err.message === "__timeout__") {
      const secs = Math.round(timeoutMs / 1000);
      return { ok: false, error: `${label} timed out after ${secs}s.` };
    }
    const msg = err instanceof Error ? err.message : String(err);
    // Strip stack traces / sensitive paths from error messages
    const safe = msg.split("\n")[0].slice(0, 300);
    return { ok: false, error: `${label} failed: ${safe}` };
  }
}
