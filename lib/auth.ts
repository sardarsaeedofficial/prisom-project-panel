/**
 * Auth helpers for Prisom Project Panel.
 *
 * Session management (cookie, HMAC signing) lives in lib/session.ts.
 * This module is a thin re-export layer kept for import-path stability.
 */

export { getSession } from "@/lib/session";
export type { SessionPayload as AuthUser } from "@/lib/session";
