import { NextResponse } from "next/server";
import { db }                      from "@/lib/db";
import { createPasswordResetToken } from "@/lib/auth/password-reset";

// Public response is intentionally ambiguous to avoid email enumeration.
const PUBLIC_OK = { ok: true, message: "If an account with that email exists, a reset link has been generated." };

export async function POST(request: Request) {
  let body: { email?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const email = body.email?.trim().toLowerCase();
  if (!email) {
    return NextResponse.json({ error: "Email is required." }, { status: 400 });
  }

  // Always return success — never reveal whether the email exists
  try {
    const user = await db.user.findFirst({
      where:  { email: { equals: email, mode: "insensitive" } },
      select: { id: true, disabledAt: true },
    });

    if (user && !user.disabledAt) {
      await createPasswordResetToken(user.id);
      // In production with email configured, send the email here.
      // If no email provider is configured, the admin can use the Admin UI
      // to generate a reset link via generateAdminResetLinkAction().
    }
  } catch {
    // Non-fatal — still return public OK to avoid leaking info
  }

  return NextResponse.json(PUBLIC_OK);
}
