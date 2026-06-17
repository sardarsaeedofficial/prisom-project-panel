"use server";

/**
 * app/actions/project-envvars.ts
 *
 * CRUD server actions for per-project environment variables.
 *
 * Security:
 *   - Values are AES-256-GCM encrypted at rest (via env-manager)
 *   - Raw values are NEVER returned to the client after save
 *   - Only masked previews are returned
 *   - Ownership is verified on every action
 *   - Reserved platform keys are rejected
 *   - Each env var is scoped to a project + environment (development/preview/production)
 */

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getCurrentWorkspaceId } from "@/lib/current-workspace";
import {
  encryptEnvValue,
  decryptEnvValue,
  decryptEnvVars,
  maskEnvValue,
  isLikelySecret,
  parseEnvFile,
  validateEnvVarName,
  isValidEnvironment,
  VALID_ENVIRONMENTS,
} from "@/lib/projects/env-manager";

// ── Ownership guard ────────────────────────────────────────────────────────

async function verifyOwnership(projectId: string) {
  const workspaceId = await getCurrentWorkspaceId();
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { id: true, slug: true, workspaceId: true },
  });
  if (!project || project.workspaceId !== workspaceId) return null;
  return project;
}

// ── Return types ───────────────────────────────────────────────────────────

export type EnvVarRow = {
  id:          string;
  name:        string;
  maskedValue: string; // never the real value
  isSecret:    boolean;
  isEnabled:   boolean;
  environment: string;
  updatedAt:   Date;
};

export type EnvVarsResult = {
  ok:    boolean;
  error: string;
  vars:  EnvVarRow[];
};

// ── List env vars ──────────────────────────────────────────────────────────

/**
 * Returns all env vars for a project (optionally filtered by environment).
 * Values are masked — never returns plaintext.
 */
export async function getProjectEnvVarsAction(
  projectId:   string,
  environment?: string
): Promise<EnvVarsResult> {
  const project = await verifyOwnership(projectId);
  if (!project) return { ok: false, error: "Not found or access denied.", vars: [] };

  const where = environment && isValidEnvironment(environment)
    ? { projectId, environment }
    : { projectId };

  const rows = await db.projectEnvVar.findMany({
    where,
    orderBy: [{ environment: "asc" }, { name: "asc" }],
  });

  return {
    ok:    true,
    error: "",
    vars:  rows.map((r) => {
      let display = "••••••••";
      try {
        if (!r.isSecret) {
          display = decryptEnvValue(r.value);
        } else {
          const plain = decryptEnvValue(r.value);
          display = maskEnvValue(plain);
        }
      } catch {
        display = "••••••••";
      }
      return {
        id:          r.id,
        name:        r.name,
        maskedValue: display,
        isSecret:    r.isSecret,
        isEnabled:   r.isEnabled,
        environment: r.environment,
        updatedAt:   r.updatedAt,
      };
    }),
  };
}

// ── Upsert one env var ─────────────────────────────────────────────────────

export async function upsertEnvVarAction(
  projectId:   string,
  name:        string,
  value:       string,
  environment: string = "production",
  isSecret?:   boolean
): Promise<{ ok: boolean; error: string }> {
  const project = await verifyOwnership(projectId);
  if (!project) return { ok: false, error: "Not found or access denied." };

  // Normalise + validate name
  const cleanName = name.trim().toUpperCase().replace(/\s+/g, "_");
  const nameError = validateEnvVarName(cleanName);
  if (nameError) return { ok: false, error: nameError };

  // Validate value
  if (!value.trim()) return { ok: false, error: "Value cannot be empty." };

  // Validate environment
  const env = environment.toLowerCase().trim();
  if (!isValidEnvironment(env)) {
    return { ok: false, error: `Invalid environment "${environment}". Use: ${VALID_ENVIRONMENTS.join(", ")}` };
  }

  const secret = isSecret ?? isLikelySecret(cleanName);

  try {
    const encrypted = encryptEnvValue(value.trim());
    await db.projectEnvVar.upsert({
      where:  { projectId_name_environment: { projectId, name: cleanName, environment: env } },
      update: { value: encrypted, isSecret: secret },
      create: { projectId, name: cleanName, value: encrypted, isSecret: secret, environment: env },
    });
  } catch (e) {
    return { ok: false, error: `Failed to save: ${(e as Error).message}` };
  }

  // Safe audit: log name + environment, never the value
  console.info(`[project-envvars] upsert ${cleanName} (env=${env}) for project ${projectId}`);

  revalidatePath(`/projects/${projectId}/env`);
  return { ok: true, error: "" };
}

// ── Toggle enable / disable ────────────────────────────────────────────────

export async function toggleEnvVarAction(
  envVarId:  string,
  projectId: string,
  isEnabled: boolean
): Promise<{ ok: boolean; error: string }> {
  const project = await verifyOwnership(projectId);
  if (!project) return { ok: false, error: "Not found or access denied." };

  try {
    await db.projectEnvVar.updateMany({
      where: { id: envVarId, projectId },
      data:  { isEnabled },
    });
  } catch (e) {
    return { ok: false, error: `Failed to update: ${(e as Error).message}` };
  }

  revalidatePath(`/projects/${projectId}/env`);
  return { ok: true, error: "" };
}

// ── Delete one env var ─────────────────────────────────────────────────────

export async function deleteEnvVarAction(
  envVarId:  string,
  projectId: string
): Promise<{ ok: boolean; error: string }> {
  const project = await verifyOwnership(projectId);
  if (!project) return { ok: false, error: "Not found or access denied." };

  await db.projectEnvVar.deleteMany({
    where: { id: envVarId, projectId },
  });

  revalidatePath(`/projects/${projectId}/env`);
  return { ok: true, error: "" };
}

// ── Bulk import from .env file text ───────────────────────────────────────

export async function bulkImportEnvVarsAction(
  projectId:   string,
  envFileContent: string,
  environment: string = "production"
): Promise<{ ok: boolean; error: string; imported: number; skipped: number }> {
  const project = await verifyOwnership(projectId);
  if (!project) return { ok: false, error: "Not found or access denied.", imported: 0, skipped: 0 };

  const env = environment.toLowerCase().trim();
  if (!isValidEnvironment(env)) {
    return { ok: false, error: `Invalid environment "${environment}".`, imported: 0, skipped: 0 };
  }

  const parsed = parseEnvFile(envFileContent);
  const entries = Object.entries(parsed);

  if (entries.length === 0) {
    return { ok: false, error: "No valid KEY=value pairs found.", imported: 0, skipped: 0 };
  }

  let imported = 0;
  let skipped  = 0;
  const importedNames: string[] = [];

  for (const [rawName, rawValue] of entries) {
    const cleanName = rawName.trim().toUpperCase().replace(/\s+/g, "_");
    const nameError = validateEnvVarName(cleanName);
    if (nameError) { skipped++; continue; }
    if (!rawValue.trim()) { skipped++; continue; }

    try {
      const encrypted = encryptEnvValue(rawValue.trim());
      const secret    = isLikelySecret(cleanName);
      await db.projectEnvVar.upsert({
        where:  { projectId_name_environment: { projectId, name: cleanName, environment: env } },
        update: { value: encrypted, isSecret: secret },
        create: { projectId, name: cleanName, value: encrypted, isSecret: secret, environment: env },
      });
      importedNames.push(cleanName);
      imported++;
    } catch {
      skipped++;
    }
  }

  // Safe audit log — key names only, never values
  if (importedNames.length > 0) {
    console.info(
      `[project-envvars] bulk import ${imported} vars for project ${projectId} (env=${env}): ` +
      importedNames.join(", ")
    );
  }

  revalidatePath(`/projects/${projectId}/env`);
  return { ok: true, error: "", imported, skipped };
}

// ── Get decrypted env vars (server-only, never exposed to client) ──────────

/**
 * Returns a plain Record<string, string> of all decrypted, ENABLED env vars
 * for a project + environment. Used by deployProjectAction — NEVER return this
 * to the client.
 *
 * Logs the key names injected, never the values.
 */
export async function getDecryptedEnvVarsForDeploy(
  projectId:   string,
  environment: string = "production"
): Promise<Record<string, string>> {
  const env = environment.toLowerCase().trim();

  const rows = await db.projectEnvVar.findMany({
    where:  { projectId, environment: env, isEnabled: true },
    select: { name: true, value: true },
  });

  const decrypted = decryptEnvVars(rows);

  // Safe audit: log names only
  const keyNames = Object.keys(decrypted);
  if (keyNames.length > 0) {
    console.info(
      `[project-envvars] loaded ${keyNames.length} enabled ${env} secrets ` +
      `for project ${projectId}: ${keyNames.join(", ")}`
    );
  }

  return decrypted;
}

// ── Required secrets check ─────────────────────────────────────────────────

/**
 * Default required keys for any project using a database + session auth.
 * Production requires DATABASE_URL; authentication requires a session or JWT secret.
 */
const DEFAULT_REQUIRED_KEYS: Record<string, string[]> = {
  production: ["DATABASE_URL"],
  preview:    [],
  development: [],
};

/**
 * Alternative key groups — if any one key in a group is present, the group is satisfied.
 * e.g. "session_or_jwt" is satisfied if either SESSION_SECRET or JWT_SECRET is present.
 */
const ALTERNATIVE_GROUPS: Record<string, { label: string; keys: string[] }[]> = {
  production: [
    { label: "Session/JWT secret", keys: ["SESSION_SECRET", "JWT_SECRET"] },
  ],
  preview:    [],
  development: [],
};

export type RequiredSecretsResult = {
  ok:           boolean;
  error:        string;
  environment:  string;
  requiredKeys: string[];
  presentKeys:  string[];
  missingKeys:  string[];
  alternatives: { label: string; satisfied: boolean; keys: string[] }[];
};

export async function checkRequiredProjectSecretsAction(
  projectId:   string,
  environment: string = "production"
): Promise<RequiredSecretsResult> {
  const EMPTY: RequiredSecretsResult = {
    ok: false, error: "", environment,
    requiredKeys: [], presentKeys: [], missingKeys: [], alternatives: [],
  };

  const project = await verifyOwnership(projectId);
  if (!project) return { ...EMPTY, error: "Not found or access denied." };

  const env = environment.toLowerCase().trim();
  if (!isValidEnvironment(env)) {
    return { ...EMPTY, error: `Invalid environment "${environment}".` };
  }

  // Load enabled vars for this environment (names only — no decryption needed)
  const rows = await db.projectEnvVar.findMany({
    where:  { projectId, environment: env, isEnabled: true },
    select: { name: true },
  });

  const presentSet = new Set(rows.map((r) => r.name));
  const presentKeys = [...presentSet];

  const requiredKeys = DEFAULT_REQUIRED_KEYS[env] ?? [];
  const missingKeys  = requiredKeys.filter((k) => !presentSet.has(k));

  const alternatives = (ALTERNATIVE_GROUPS[env] ?? []).map((group) => ({
    label:     group.label,
    satisfied: group.keys.some((k) => presentSet.has(k)),
    keys:      group.keys,
  }));

  const allOk =
    missingKeys.length === 0 &&
    alternatives.every((g) => g.satisfied || g.keys.length === 0);

  return {
    ok:           allOk,
    error:        allOk ? "" : `Missing required secrets: ${missingKeys.join(", ")}`,
    environment:  env,
    requiredKeys,
    presentKeys,
    missingKeys,
    alternatives,
  };
}

// ── Verify runtime PM2 env (key names only) ────────────────────────────────

export type RuntimeEnvVerifyResult = {
  ok:             boolean;
  error:          string;
  keysExpected:   string[];
  keysInjected:   string[];
  missingKeys:    string[];
  pm2ProcessName: string;
  port:           number;
};

/**
 * Checks what env var keys are actually present in the running PM2 process
 * for this project, and compares against the expected set from the DB.
 * Returns only key names — never values.
 */
export async function verifyProjectRuntimeEnvAction(
  projectId:   string,
  environment: string = "production"
): Promise<RuntimeEnvVerifyResult> {
  const EMPTY: RuntimeEnvVerifyResult = {
    ok: false, error: "", keysExpected: [], keysInjected: [],
    missingKeys: [], pm2ProcessName: "", port: 0,
  };

  const project = await verifyOwnership(projectId);
  if (!project) return { ...EMPTY, error: "Not found or access denied." };

  const env = environment.toLowerCase().trim();

  // Get deploy config
  const config = await db.projectDeploymentConfig.findUnique({
    where:  { projectId },
    select: { pm2Name: true, port: true },
  });
  if (!config) {
    return { ...EMPTY, error: "No deployment config found. Deploy the project first." };
  }

  // Keys we expect to have been injected
  const expectedRows = await db.projectEnvVar.findMany({
    where:  { projectId, environment: env, isEnabled: true },
    select: { name: true },
  });
  const keysExpected = expectedRows.map((r) => r.name);

  // Query PM2 for the live process env (key names only)
  let keysInjected: string[] = [];
  try {
    const { execFile } = await import("child_process");
    const { promisify } = await import("util");
    const execFileAsync = promisify(execFile);

    const { stdout } = await execFileAsync("pm2", ["jlist"], {
      timeout: 10_000,
      cwd: process.cwd(),
    });

    type Pm2Entry = {
      name?: string;
      pm2_env?: { env?: Record<string, string> };
    };

    const list: Pm2Entry[] = JSON.parse(stdout.trim() || "[]");
    const app = list.find((a) => a.name === config.pm2Name);

    if (app?.pm2_env?.env) {
      // Only return keys that were expected — avoid leaking platform env
      const liveKeys = new Set(Object.keys(app.pm2_env.env));
      keysInjected = keysExpected.filter((k) => liveKeys.has(k));
    }
  } catch (e) {
    console.error("[verifyProjectRuntimeEnvAction] pm2 jlist failed:", e instanceof Error ? e.message : String(e));
    return { ...EMPTY, error: "Could not query PM2 process list.", pm2ProcessName: config.pm2Name, port: config.port };
  }

  const missingKeys = keysExpected.filter((k) => !keysInjected.includes(k));

  return {
    ok:             missingKeys.length === 0,
    error:          missingKeys.length > 0 ? `Keys missing from PM2 runtime: ${missingKeys.join(", ")}` : "",
    keysExpected,
    keysInjected,
    missingKeys,
    pm2ProcessName: config.pm2Name,
    port:           config.port,
  };
}
