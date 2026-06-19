/**
 * lib/audit/request-context.ts
 *
 * Sprint 18: Best-effort request context capture for audit events.
 *
 * IMPORTANT:
 *  - IP and user-agent are audit metadata ONLY — never used for security decisions.
 *  - Headers are not trusted for authentication/authorization.
 *  - All capture is best-effort: missing headers result in null, not an error.
 *  - This file uses next/headers dynamic import so it is safe to import in
 *    server actions but will gracefully degrade outside request contexts.
 */

export interface AuditRequestContext {
  ipAddress: string | null;
  userAgent: string | null;
}

/**
 * Attempt to read IP address and user-agent from the current server action /
 * server component request context.
 *
 * Returns nulls if headers are unavailable (background jobs, seed scripts, etc.).
 * Never throws.
 */
export async function getAuditRequestContext(): Promise<AuditRequestContext> {
  try {
    const { headers } = await import("next/headers");
    const headerStore = await headers();

    // Prefer x-forwarded-for (set by Nginx reverse proxy) then x-real-ip.
    const forwarded = headerStore.get("x-forwarded-for");
    const realIp    = headerStore.get("x-real-ip");

    let ipAddress: string | null = null;
    if (forwarded) {
      // x-forwarded-for may be a comma-separated list; take the first entry.
      ipAddress = forwarded.split(",")[0]?.trim() ?? null;
    } else if (realIp) {
      ipAddress = realIp.trim();
    }

    // Sanitise: IPv4/IPv6 only, reject obviously bogus values
    if (ipAddress && !/^[\d.:\[\]a-fA-F]+$/.test(ipAddress)) {
      ipAddress = null;
    }

    const userAgent = headerStore.get("user-agent") ?? null;

    return {
      ipAddress: ipAddress ? ipAddress.slice(0, 45) : null,
      userAgent: userAgent ? userAgent.slice(0, 300) : null,
    };
  } catch {
    // Not in a request context, or next/headers unavailable.
    return { ipAddress: null, userAgent: null };
  }
}
