/**
 * Lightweight HTTP-only cookie session using HMAC-SHA256.
 *
 * Uses the Web Crypto API (`crypto.subtle`) so it works in both:
 *   - Next.js Edge runtime (middleware)
 *   - Node.js runtime (server components, route handlers)
 *
 * No additional npm packages required.
 */

export const SESSION_COOKIE_NAME = "prisom_session";
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days

export interface SessionPayload {
  email: string;
  name: string;
  /** Unix epoch seconds — issued-at */
  iat: number;
  /** Unix epoch seconds — expires */
  exp: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getSecret(): string {
  const s = process.env.SESSION_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!s && process.env.NODE_ENV === "production") {
    throw new Error(
      "SESSION_SECRET (or NEXTAUTH_SECRET) must be set in production"
    );
  }
  return s ?? "dev-only-insecure-session-secret-change-me";
}

/** Safe base64url encode from a plain string */
function b64url(input: string): string {
  return btoa(input)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

/** Safe base64url decode to a plain string */
function unb64url(input: string): string {
  const padded = input + "=".repeat((4 - (input.length % 4)) % 4);
  return atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * Create a signed session token: `base64url(payload).base64url(hmac)`
 */
export async function createSessionToken(
  payload: Omit<SessionPayload, "iat" | "exp">
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const full: SessionPayload = {
    ...payload,
    iat: now,
    exp: now + COOKIE_MAX_AGE_SECONDS,
  };
  const data = b64url(JSON.stringify(full));
  const key = await hmacKey(getSecret());
  const sigBuf = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(data)
  );
  const sig = b64url(String.fromCharCode(...new Uint8Array(sigBuf)));
  return `${data}.${sig}`;
}

/**
 * Verify a session token and return the payload, or null if invalid/expired.
 */
export async function verifySessionToken(
  token: string
): Promise<SessionPayload | null> {
  try {
    const dotIdx = token.lastIndexOf(".");
    if (dotIdx < 0) return null;

    const data = token.slice(0, dotIdx);
    const sig = token.slice(dotIdx + 1);

    const key = await hmacKey(getSecret());
    const sigBytes = Uint8Array.from(unb64url(sig), (c) => c.charCodeAt(0));
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      sigBytes,
      new TextEncoder().encode(data)
    );
    if (!valid) return null;

    const payload = JSON.parse(unb64url(data)) as SessionPayload;
    if (Math.floor(Date.now() / 1000) > payload.exp) return null;

    return payload;
  } catch {
    return null;
  }
}

/**
 * Read the session in **Server Components** and **Route Handlers**.
 * Uses `next/headers` (Node.js runtime only — not Edge middleware).
 */
export async function getSession(): Promise<SessionPayload | null> {
  // Dynamic import keeps `next/headers` out of the Edge middleware bundle.
  const { cookies } = await import("next/headers");
  const store = await cookies();
  const token = store.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

/**
 * Read the session inside **middleware** (Edge runtime).
 * Reads directly from the incoming `NextRequest` cookies.
 */
export async function getSessionFromRequest(
  req: import("next/server").NextRequest
): Promise<SessionPayload | null> {
  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

/** Cookie options to use when setting the session cookie. */
export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  maxAge: COOKIE_MAX_AGE_SECONDS,
  path: "/",
};
