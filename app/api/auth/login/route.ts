import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  createSessionToken,
  SESSION_COOKIE_NAME,
  SESSION_COOKIE_OPTIONS,
} from "@/lib/session";
import { verifyPassword } from "@/lib/auth/passwords";

// ── Env-var credentials (backward-compat for pre-Sprint 32 users) ─────────────

function getEnvCredentials(): { email: string | undefined; password: string | undefined } {
  const isDev = process.env.NODE_ENV !== "production";
  return {
    email:
      process.env.PROJECT_PANEL_ADMIN_EMAIL ??
      (isDev ? "admin@prisom.dev" : undefined),
    password:
      process.env.PROJECT_PANEL_ADMIN_PASSWORD ??
      (isDev ? "PrisomAdmin@123!" : undefined),
  };
}

// ── POST /api/auth/login ──────────────────────────────────────────────────────

export async function POST(request: Request) {
  let body: { email?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { email: inputEmail, password: inputPassword } = body;

  if (!inputEmail || !inputPassword) {
    return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
  }

  const normalizedEmail = inputEmail.trim().toLowerCase();
  const INVALID_MSG     = "Invalid email or password.";

  // ── 1. Try DB-based auth (users with a passwordHash) ─────────────────────
  let sessionEmail = normalizedEmail;
  let sessionName  = "Admin";
  let dbAuthOk     = false;

  try {
    const dbUser = await db.user.findFirst({
      where:  { email: { equals: normalizedEmail, mode: "insensitive" } },
      select: {
        id: true, email: true, name: true, role: true,
        passwordHash: true, disabledAt: true,
      },
    });

    if (dbUser?.passwordHash) {
      // User has a DB password — use DB auth exclusively for this user
      const valid = await verifyPassword(inputPassword, dbUser.passwordHash);
      if (!valid) {
        return NextResponse.json({ error: INVALID_MSG }, { status: 401 });
      }
      if (dbUser.disabledAt) {
        return NextResponse.json(
          { error: "This account has been disabled. Contact your administrator." },
          { status: 403 },
        );
      }
      // Record last login non-fatally
      db.user.update({
        where: { id: dbUser.id },
        data:  { lastLoginAt: new Date() },
      }).catch(() => null);

      sessionEmail = dbUser.email;
      sessionName  = dbUser.name;
      dbAuthOk     = true;
    } else if (dbUser?.disabledAt) {
      // User exists without a password hash but is disabled
      return NextResponse.json(
        { error: "This account has been disabled. Contact your administrator." },
        { status: 403 },
      );
    }
  } catch {
    // DB unavailable — fall through to env-var auth
  }

  // ── 2. Env-var fallback (pre-Sprint 32 seed user or no DB password set) ───
  if (!dbAuthOk) {
    const creds = getEnvCredentials();

    if (!creds.email || !creds.password) {
      return NextResponse.json(
        { error: "No credentials are configured on this server. Use the Admin UI to set a password." },
        { status: 503 },
      );
    }

    const emailMatch    = normalizedEmail === creds.email.toLowerCase();
    const passwordMatch = inputPassword === creds.password;

    if (!emailMatch || !passwordMatch) {
      return NextResponse.json({ error: INVALID_MSG }, { status: 401 });
    }

    // Resolve display name from DB (optional — non-fatal)
    try {
      const dbUser = await db.user.findFirst({
        where:  { email: { equals: normalizedEmail, mode: "insensitive" } },
        select: { name: true },
      });
      if (dbUser?.name) sessionName = dbUser.name;
    } catch { /* non-fatal */ }

    sessionEmail = normalizedEmail;
  }

  const token = await createSessionToken({ email: sessionEmail, name: sessionName });

  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: token,
    ...SESSION_COOKIE_OPTIONS,
  });
  return response;
}
