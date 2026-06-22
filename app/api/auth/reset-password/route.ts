import { NextResponse }                  from "next/server";
import { validateAndConsumeResetToken }  from "@/lib/auth/password-reset";
import { validatePasswordStrength }      from "@/lib/auth/passwords";

export async function POST(request: Request) {
  let body: { token?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { token, password } = body;

  if (!token || !password) {
    return NextResponse.json({ error: "Token and password are required." }, { status: 400 });
  }

  const strength = validatePasswordStrength(password);
  if (!strength.ok) {
    return NextResponse.json({ error: strength.errors.join(" ") }, { status: 422 });
  }

  const result = await validateAndConsumeResetToken(token, password);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
