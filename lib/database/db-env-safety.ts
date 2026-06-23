/**
 * lib/database/db-env-safety.ts
 *
 * Sprint 45: Check project env vars for database readiness.
 *
 * Safety rules:
 *  - Real values are never returned or logged
 *  - maskedPreview exposes host only (user:password stripped)
 *  - Values are only decrypted server-side; results never serialized
 */

import { db }               from "@/lib/db";
import { decryptEnvValue }  from "@/lib/projects/env-manager";
import type { DatabaseEnvFinding } from "./db-readiness-types";

// ── Env var definitions ───────────────────────────────────────────────────────

type EnvVarDef = {
  name:     string;
  required: boolean;
  purpose:  string;
};

export const DB_ENV_VAR_DEFS: EnvVarDef[] = [
  { name: "DATABASE_URL",               required: true,  purpose: "Primary database connection URL" },
  { name: "DIRECT_URL",                 required: false, purpose: "Direct connection URL (bypasses pooler)" },
  { name: "SHADOW_DATABASE_URL",        required: false, purpose: "Prisma shadow database for migrations" },
  { name: "POSTGRES_URL",               required: false, purpose: "Vercel/Neon pooled connection" },
  { name: "POSTGRES_PRISMA_URL",        required: false, purpose: "Vercel Postgres for Prisma" },
  { name: "POSTGRES_URL_NON_POOLING",   required: false, purpose: "Direct non-pooling connection" },
  { name: "MONGODB_URI",                required: false, purpose: "MongoDB connection URI" },
  { name: "SUPABASE_URL",               required: false, purpose: "Supabase project URL" },
  { name: "SUPABASE_SERVICE_ROLE_KEY",  required: false, purpose: "Supabase service role key" },
  { name: "SUPABASE_ANON_KEY",          required: false, purpose: "Supabase anonymous key" },
];

/** Env var names that are considered DB-primary (at least one should be set). */
export const PRIMARY_DB_KEYS = ["DATABASE_URL", "MONGODB_URI", "SUPABASE_URL"];

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Builds a masked preview like `postgresql://***@host.neon.tech:5432/db`.
 * Returns undefined if the value can't be parsed as a URL.
 */
function maskDatabaseUrl(raw: string): string | undefined {
  try {
    const url = new URL(raw);
    url.username = "***";
    url.password = "";
    // new URL removes password but leaves ":@" if username is set
    return url.toString().replace(/:@/, "@");
  } catch {
    return undefined;
  }
}

function isPlaceholderValue(raw: string): boolean {
  if (!raw || raw.trim() === "") return true;
  const lower = raw.toLowerCase().trim();
  return (
    lower === "your_database_url_here" ||
    lower === "your-database-url" ||
    lower.startsWith("postgres://user:password@") ||
    lower.startsWith("mongodb://localhost:27017/mydb") ||
    lower.includes("placeholder") ||
    lower.includes("your-") ||
    lower.includes("example.com") ||
    lower.includes("localhost") ||
    lower.includes("127.0.0.1")
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Checks which DB env vars are present and configured in the project vault.
 * Only returns findings for vars that are either required or present.
 */
export async function getDbEnvFindings(
  projectId: string,
): Promise<DatabaseEnvFinding[]> {
  const envVars = await db.projectEnvVar.findMany({
    where:  { projectId, environment: "production" },
    select: { name: true, value: true, isEnabled: true },
  });

  const envMap = new Map(envVars.map((e) => [e.name, e]));
  const findings: DatabaseEnvFinding[] = [];

  for (const def of DB_ENV_VAR_DEFS) {
    const record = envMap.get(def.name);

    if (!record) {
      // Only include optional vars if they're a primary DB key
      if (!def.required && !PRIMARY_DB_KEYS.includes(def.name)) continue;
      findings.push({
        name:            def.name,
        required:        def.required,
        presentInVault:  false,
        valueConfigured: false,
        purpose:         def.purpose,
      });
      continue;
    }

    let raw = "";
    let decryptOk = false;
    try {
      raw = decryptEnvValue(record.value);
      decryptOk = true;
    } catch {
      // Treat failed decrypt as misconfigured
    }

    const isPlaceholder = !decryptOk || isPlaceholderValue(raw);

    let maskedPreview: string | undefined;
    if (decryptOk && !isPlaceholder) {
      maskedPreview = maskDatabaseUrl(raw);
    }

    findings.push({
      name:            def.name,
      required:        def.required,
      presentInVault:  true,
      valueConfigured: !isPlaceholder && record.isEnabled,
      maskedPreview,
      purpose:         def.purpose,
    });
  }

  return findings;
}

/**
 * Returns the decrypted DATABASE_URL for the connection test.
 * Never returns this value to the client.
 */
export async function getDecryptedDbUrl(
  projectId: string,
): Promise<string | null> {
  const KEYS = ["DATABASE_URL", "POSTGRES_URL", "POSTGRES_PRISMA_URL", "MONGODB_URI"];
  for (const key of KEYS) {
    const row = await db.projectEnvVar.findFirst({
      where:  { projectId, name: key, environment: "production", isEnabled: true },
      select: { value: true },
    });
    if (!row) continue;
    try {
      const url = decryptEnvValue(row.value);
      if (url && url.trim() && !isPlaceholderValue(url.trim())) {
        return url.trim();
      }
    } catch {
      // skip
    }
  }
  return null;
}
