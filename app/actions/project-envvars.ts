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
  id:        string;
  name:      string;
  maskedValue: string; // never the real value
  isSecret:  boolean;
  updatedAt: Date;
};

export type EnvVarsResult = {
  ok:    boolean;
  error: string;
  vars:  EnvVarRow[];
};

// ── List env vars ──────────────────────────────────────────────────────────

export async function getProjectEnvVarsAction(
  projectId: string
): Promise<EnvVarsResult> {
  const project = await verifyOwnership(projectId);
  if (!project) return { ok: false, error: "Not found or access denied.", vars: [] };

  const rows = await db.projectEnvVar.findMany({
    where:   { projectId },
    orderBy: { name: "asc" },
  });

  return {
    ok:    true,
    error: "",
    vars:  rows.map((r) => {
      let display = "••••••••";
      try {
        if (!r.isSecret) {
          // Non-secret vars (e.g. PUBLIC_URL, NODE_ENV): show plaintext
          display = decryptEnvValue(r.value);
        } else {
          // Secret vars: show only a masked preview
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
        updatedAt:   r.updatedAt,
      };
    }),
  };
}

// ── Upsert one env var ─────────────────────────────────────────────────────

export async function upsertEnvVarAction(
  projectId: string,
  name: string,
  value: string,
  isSecret?: boolean
): Promise<{ ok: boolean; error: string }> {
  const project = await verifyOwnership(projectId);
  if (!project) return { ok: false, error: "Not found or access denied." };

  const cleanName = name.trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_");
  if (!cleanName || !/^[A-Z_][A-Z0-9_]*$/.test(cleanName)) {
    return { ok: false, error: `Invalid env var name: "${name}". Use UPPER_SNAKE_CASE.` };
  }
  if (!value.trim()) {
    return { ok: false, error: "Value cannot be empty." };
  }

  const secret = isSecret ?? isLikelySecret(cleanName);

  try {
    const encrypted = encryptEnvValue(value.trim());
    await db.projectEnvVar.upsert({
      where:  { projectId_name: { projectId, name: cleanName } },
      update: { value: encrypted, isSecret: secret },
      create: { projectId, name: cleanName, value: encrypted, isSecret: secret },
    });
  } catch (e) {
    return { ok: false, error: `Failed to save: ${(e as Error).message}` };
  }

  revalidatePath(`/projects/${projectId}/env`);
  return { ok: true, error: "" };
}

// ── Delete one env var ─────────────────────────────────────────────────────

export async function deleteEnvVarAction(
  envVarId: string,
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
  projectId: string,
  envFileContent: string
): Promise<{ ok: boolean; error: string; imported: number; skipped: number }> {
  const project = await verifyOwnership(projectId);
  if (!project) return { ok: false, error: "Not found or access denied.", imported: 0, skipped: 0 };

  const parsed = parseEnvFile(envFileContent);
  const entries = Object.entries(parsed);

  if (entries.length === 0) {
    return { ok: false, error: "No valid KEY=value pairs found.", imported: 0, skipped: 0 };
  }

  let imported = 0;
  let skipped  = 0;

  for (const [rawName, rawValue] of entries) {
    const name = rawName.trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_");
    if (!name || !/^[A-Z_][A-Z0-9_]*$/.test(name)) { skipped++; continue; }
    if (!rawValue.trim()) { skipped++; continue; }

    try {
      const encrypted = encryptEnvValue(rawValue.trim());
      const secret    = isLikelySecret(name);
      await db.projectEnvVar.upsert({
        where:  { projectId_name: { projectId, name } },
        update: { value: encrypted, isSecret: secret },
        create: { projectId, name, value: encrypted, isSecret: secret },
      });
      imported++;
    } catch {
      skipped++;
    }
  }

  revalidatePath(`/projects/${projectId}/env`);
  return { ok: true, error: "", imported, skipped };
}

// ── Get decrypted env vars (server-only, never exposed to client) ──────────

/**
 * Returns a plain Record<string, string> of all decrypted env vars for a project.
 * Used by deployProjectAction — NEVER return this to the client.
 */
export async function getDecryptedEnvVarsForDeploy(
  projectId: string
): Promise<Record<string, string>> {
  const rows = await db.projectEnvVar.findMany({
    where:  { projectId },
    select: { name: true, value: true },
  });
  return decryptEnvVars(rows);
}
