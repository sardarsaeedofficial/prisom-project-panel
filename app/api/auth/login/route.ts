import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { UserRole } from "@prisma/client";
import {
  createSessionToken,
  SESSION_COOKIE_NAME,
  SESSION_COOKIE_OPTIONS,
} from "@/lib/session";

function getAdminCredentials(): { email: string | undefined; password: string | undefined } {
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

export async function POST(request: Request) {
  let body: { email?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { email: inputEmail, password: inputPassword } = body;
  const creds = getAdminCredentials();

  if (!creds.email || !creds.password) {
    return NextResponse.json(
      { error: "Admin credentials are not configured on this server" },
      { status: 503 }
    );
  }

  if (
    !inputEmail ||
    !inputPassword ||
    inputEmail.trim().toLowerCase() !== creds.email.toLowerCase() ||
    inputPassword !== creds.password
  ) {
    // Don't reveal whether it was the email or password that was wrong
    return NextResponse.json(
      { error: "Invalid email or password" },
      { status: 401 }
    );
  }

  // Pull the display name from the DB owner user (graceful fallback if no seed yet)
  let name = "Admin";
  try {
    const dbUser = await db.user.findFirst({
      where: { role: UserRole.OWNER },
      orderBy: { createdAt: "asc" },
      select: { name: true },
    });
    if (dbUser?.name) name = dbUser.name;
  } catch {
    // DB unavailable — still allow login, just use default name
  }

  const token = await createSessionToken({ email: creds.email, name });

  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: token,
    ...SESSION_COOKIE_OPTIONS,
  });
  return response;
}
