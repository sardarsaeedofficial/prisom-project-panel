#!/usr/bin/env tsx
/**
 * scripts/create-admin.ts
 *
 * Sprint 32: Emergency admin user creation / recovery script.
 *
 * Usage:
 *   pnpm admin:create --email you@example.com
 *   pnpm admin:create --email you@example.com --role OWNER --verified
 *
 * Flags:
 *   --email <email>    Required. Email address for the user.
 *   --role  <role>     OWNER | ADMIN | MEMBER  (default: ADMIN)
 *   --verified         Mark email as verified.
 *   --update           Update role/verified even if user already exists.
 *
 * Password is prompted securely (not accepted via CLI args to avoid shell history).
 *
 * Safety:
 *  - Passwords are never printed to stdout
 *  - Only creates/updates users — never deletes
 *  - Will not demote the last OWNER
 */

import * as readline from "readline";
import * as crypto   from "crypto";
import { promisify } from "util";

// ── Inline password hasher (no import path resolution needed in scripts) ───────

const scryptAsync = promisify(crypto.scrypt as (
  password: string | Buffer,
  salt:     string | Buffer,
  keylen:   number,
  options:  { N: number; r: number; p: number },
  callback: (err: Error | null, derivedKey: Buffer) => void,
) => void);

async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const key  = await scryptAsync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `${salt.toString("hex")}:${key.toString("hex")}`;
}

// ── Secure password prompt ─────────────────────────────────────────────────────

function promptSecret(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input:  process.stdin,
      output: process.stdout,
    });

    let input = "";

    process.stdout.write(prompt);

    // Disable echo
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }

    process.stdin.on("data", (char: Buffer) => {
      const c = char.toString();
      if (c === "\r" || c === "\n") {
        if (process.stdin.isTTY) process.stdin.setRawMode(false);
        process.stdout.write("\n");
        rl.close();
        resolve(input);
      } else if (c === "") { // Ctrl+C
        process.stdout.write("\n");
        process.exit(1);
      } else if (c === "") { // Backspace
        input = input.slice(0, -1);
      } else {
        input += c;
      }
    });
  });
}

// ── Arg parsing ───────────────────────────────────────────────────────────────

function parseArgs(): {
  email?:    string;
  role:      string;
  verified:  boolean;
  update:    boolean;
} {
  const args = process.argv.slice(2);
  let email:   string | undefined;
  let role     = "ADMIN";
  let verified = false;
  let update   = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--email" && args[i + 1]) {
      email = args[++i];
    } else if (args[i] === "--role" && args[i + 1]) {
      role = args[++i].toUpperCase();
    } else if (args[i] === "--verified") {
      verified = true;
    } else if (args[i] === "--update") {
      update = true;
    }
  }

  return { email, role, verified, update };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const { email, role, verified, update } = parseArgs();

  if (!email) {
    console.error("Usage: pnpm admin:create --email <email> [--role OWNER|ADMIN|MEMBER] [--verified] [--update]");
    process.exit(1);
  }

  if (!["OWNER", "ADMIN", "MEMBER"].includes(role)) {
    console.error(`Invalid role "${role}". Must be OWNER, ADMIN, or MEMBER.`);
    process.exit(1);
  }

  // Dynamic import to avoid top-level DB connection at parse time
  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient();

  const normalizedEmail = email.trim().toLowerCase();

  try {
    // Check if user exists
    const existing = await db.user.findFirst({
      where:  { email: { equals: normalizedEmail, mode: "insensitive" } },
      select: { id: true, email: true, role: true, name: true },
    });

    if (existing && !update) {
      console.log(`\nUser ${existing.email} already exists with role ${existing.role}.`);
      console.log("Pass --update to set a new password or change the role.");

      // Still prompt for password to update it
      const answer = await new Promise<string>((res) => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        rl.question("Set a new password for this user? (y/N): ", (a) => { rl.close(); res(a); });
      });
      if (answer.toLowerCase() !== "y") {
        process.exit(0);
      }
    }

    // Prompt for password
    const password1 = await promptSecret("Enter password: ");
    if (password1.length < 10) {
      console.error("\nPassword must be at least 10 characters.");
      process.exit(1);
    }
    const password2 = await promptSecret("Confirm password: ");
    if (password1 !== password2) {
      console.error("\nPasswords do not match.");
      process.exit(1);
    }

    const passwordHash = await hashPassword(password1);

    if (existing) {
      // Guard: don't demote the last OWNER
      if (existing.role === "OWNER" && role !== "OWNER") {
        const ownerCount = await db.user.count({ where: { role: "OWNER" } });
        if (ownerCount <= 1) {
          console.error("\nCannot demote the last OWNER. Set another user to OWNER first.");
          process.exit(1);
        }
      }

      await db.user.update({
        where: { id: existing.id },
        data:  {
          passwordHash,
          role:            role as "OWNER" | "ADMIN" | "MEMBER",
          emailVerifiedAt: verified ? new Date() : undefined,
          disabledAt:      null,
          disabledReason:  null,
        },
      });
      console.log(`\n✅  Updated user ${normalizedEmail} (role: ${role}${verified ? ", email verified" : ""})`);
    } else {
      await db.user.create({
        data: {
          email:           normalizedEmail,
          name:            normalizedEmail.split("@")[0],
          role:            role as "OWNER" | "ADMIN" | "MEMBER",
          passwordHash,
          emailVerifiedAt: verified ? new Date() : null,
        },
      });
      console.log(`\n✅  Created user ${normalizedEmail} (role: ${role}${verified ? ", email verified" : ""})`);
    }

    console.log("   You can now log in at your Prisom Panel URL.\n");
  } finally {
    await db.$disconnect();
  }
}

main().catch((err) => {
  console.error("\n❌  Error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
