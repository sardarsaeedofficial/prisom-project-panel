"use server";

/**
 * app/actions/project-secrets.ts
 *
 * Sprint 22: Secrets Vault server actions.
 *
 * These complement (and in some cases supersede) project-envvars.ts for the
 * new Vault UI.  All actions:
 *   - Enforce secrets.* permissions via requireProjectPermission
 *   - Never return raw secret values to the client
 *   - Compute fingerprints before storage
 *   - Write fire-and-forget audit events (key name + fingerprint only)
 *
 * Secret values are decrypted only inside the server-side functions that need
 * them (fingerprint computation, rotation comparison). They are never serialised
 * into a returned object.
 */

import { db } from "@/lib/db";
import { requireProjectPermission } from "@/lib/auth/project-membership";
import { writeProjectAuditEvent } from "@/lib/audit/project-audit";
import { getAuditRequestContext } from "@/lib/audit/request-context";
import {
  encryptEnvValue,
  decryptEnvValue,
  maskEnvValue,
  isLikelySecret,
  isValidEnvironment,
  VALID_ENVIRONMENTS,
  validateEnvVarName,
} from "@/lib/projects/env-manager";
import { fingerprintSecret } from "@/lib/secrets/secret-fingerprint";
import { parseDotEnv, type ParsedEnvEntry } from "@/lib/secrets/env-parse";
import { validateSecretKey, validateSecretValue } from "@/lib/secrets/secret-validation";

// ── Shared ────────────────────────────────────────────────────────────────────

type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: string };

async function getProjectMeta(projectId: string) {
  return db.project.findUnique({
    where: { id: projectId },
    select: { id: true, slug: true, name: true },
  });
}

// ── DTO ───────────────────────────────────────────────────────────────────────

export type SecretDTO = {
  id:           string;
  name:         string;
  environment:  string;
  isSecret:     boolean;
  isEnabled:    boolean;
  required:     boolean;
  description:  string | null;
  source:       string;
  fingerprint:  string | null;
  maskedValue:  string;          // safe display-only
  lastRotatedAt: string | null;
  updatedAt:    string;
  createdAt:    string;
};

function toSecretDTO(r: {
  id: string; name: string; value: string; isSecret: boolean; isEnabled: boolean;
  environment: string; required: boolean; description: string | null; source: string;
  fingerprint: string | null; lastRotatedAt: Date | null; updatedAt: Date; createdAt: Date;
}): SecretDTO {
  let maskedValue = "••••••••";
  try {
    const plain = decryptEnvValue(r.value);
    maskedValue = r.isSecret ? maskEnvValue(plain) : plain;
  } catch { /* keep dots */ }

  return {
    id:           r.id,
    name:         r.name,
    environment:  r.environment,
    isSecret:     r.isSecret,
    isEnabled:    r.isEnabled,
    required:     r.required,
    description:  r.description,
    source:       r.source,
    fingerprint:  r.fingerprint,
    maskedValue,
    lastRotatedAt: r.lastRotatedAt?.toISOString() ?? null,
    updatedAt:    r.updatedAt.toISOString(),
    createdAt:    r.createdAt.toISOString(),
  };
}

// ── 1. List secrets ───────────────────────────────────────────────────────────

export type ListSecretsOutput = {
  secrets:     SecretDTO[];
  total:       number;
  environment: string;
  role:        import("@/lib/auth/project-permissions").ProjectRole;
  summary: {
    total:           number;
    enabled:         number;
    required:        number;
    requiredMissing: number;
    lastUpdatedAt:   string | null;
  };
};

export async function listProjectSecretsAction(
  projectId: string,
  environment = "production",
): Promise<ActionResult<ListSecretsOutput>> {
  const auth = await requireProjectPermission(projectId, "secrets.view");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  const env = environment.toLowerCase().trim();
  if (!isValidEnvironment(env)) {
    return { ok: false, error: `Invalid environment "${environment}".` };
  }

  const rows = await db.projectEnvVar.findMany({
    where:   { projectId, environment: env },
    orderBy: { name: "asc" },
  });

  const dtos = rows.map(toSecretDTO);

  const requiredCount   = rows.filter((r) => r.required).length;
  const requiredEnabled = rows.filter((r) => r.required && r.isEnabled).length;
  const lastUpdated     = rows.reduce<Date | null>((acc, r) => {
    return !acc || r.updatedAt > acc ? r.updatedAt : acc;
  }, null);

  return {
    ok: true,
    data: {
      secrets:     dtos,
      total:       rows.length,
      environment: env,
      role:        auth.role,
      summary: {
        total:           rows.length,
        enabled:         rows.filter((r) => r.isEnabled).length,
        required:        requiredCount,
        requiredMissing: requiredCount - requiredEnabled,
        lastUpdatedAt:   lastUpdated?.toISOString() ?? null,
      },
    },
  };
}

// ── 2. Create / upsert a secret ───────────────────────────────────────────────

export type CreateSecretInput = {
  projectId:   string;
  name:        string;
  value:       string;
  environment: string;
  description?: string;
  required?:   boolean;
  source?:     string;
  isSecret?:   boolean;
};

export async function createProjectSecretAction(
  input: CreateSecretInput,
): Promise<ActionResult<{ id: string; fingerprint: string }>> {
  const auth = await requireProjectPermission(input.projectId, "secrets.manage");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  const cleanName = input.name.trim().toUpperCase().replace(/\s+/g, "_");
  const keyResult = validateSecretKey(cleanName);
  if (!keyResult.ok) return { ok: false, error: keyResult.error };

  const valResult = validateSecretValue(input.value);
  if (!valResult.ok) return { ok: false, error: valResult.error };

  const env = input.environment.toLowerCase().trim();
  if (!isValidEnvironment(env)) {
    return { ok: false, error: `Invalid environment "${input.environment}".` };
  }

  const trimmed   = input.value.trim();
  const encrypted = encryptEnvValue(trimmed);
  const fp        = fingerprintSecret(trimmed);
  const secret    = input.isSecret ?? isLikelySecret(cleanName);

  const existing = await db.projectEnvVar.findUnique({
    where:  { projectId_name_environment: { projectId: input.projectId, name: cleanName, environment: env } },
    select: { id: true, fingerprint: true },
  });
  const isCreate = !existing;
  const fpBefore = existing?.fingerprint ?? null;

  const row = await db.projectEnvVar.upsert({
    where:  { projectId_name_environment: { projectId: input.projectId, name: cleanName, environment: env } },
    update: {
      value:       encrypted,
      isSecret:    secret,
      fingerprint: fp,
      description: input.description ?? undefined,
      required:    input.required    ?? undefined,
      source:      input.source      ?? "manual",
    },
    create: {
      projectId:   input.projectId,
      name:        cleanName,
      value:       encrypted,
      isSecret:    secret,
      environment: env,
      fingerprint: fp,
      description: input.description ?? null,
      required:    input.required    ?? false,
      source:      input.source      ?? "manual",
    },
  });

  const ctx = await getAuditRequestContext();
  void writeProjectAuditEvent({
    projectId:   input.projectId,
    actorUserId: auth.userId,
    actorRole:   auth.role,
    action:      isCreate ? "project.secret.created" : "project.secret.updated",
    category:    "env",
    result:      "success",
    targetType:  "secret",
    targetLabel: cleanName,
    summary:     isCreate
      ? `Secret created: ${cleanName} (${env})`
      : `Secret updated: ${cleanName} (${env})`,
    metadata: {
      key:             cleanName,
      environment:     env,
      required:        input.required ?? false,
      source:          input.source ?? "manual",
      fingerprintAfter: fp,
      ...(fpBefore && !isCreate ? { fingerprintBefore: fpBefore } : {}),
    },
    ...ctx,
  }).catch(() => null);

  return { ok: true, data: { id: row.id, fingerprint: fp } };
}

// ── 3. Rotate a secret ────────────────────────────────────────────────────────

export type RotateSecretInput = {
  projectId:        string;
  secretId:         string;
  newValue:         string;
  confirmationText: string;
  note?:            string;
};

export async function rotateProjectSecretAction(
  input: RotateSecretInput,
): Promise<ActionResult<{ fingerprintBefore: string | null; fingerprintAfter: string }>> {
  const auth = await requireProjectPermission(input.projectId, "secrets.rotate");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  if (input.confirmationText !== "ROTATE") {
    return { ok: false, error: 'Type "ROTATE" to confirm rotation.' };
  }

  const valResult = validateSecretValue(input.newValue);
  if (!valResult.ok) return { ok: false, error: valResult.error };

  const existing = await db.projectEnvVar.findFirst({
    where:  { id: input.secretId, projectId: input.projectId },
    select: { id: true, name: true, environment: true, fingerprint: true, isEnabled: true },
  });
  if (!existing) return { ok: false, error: "Secret not found." };

  const trimmed       = input.newValue.trim();
  const encrypted     = encryptEnvValue(trimmed);
  const fpAfter       = fingerprintSecret(trimmed);
  const fpBefore      = existing.fingerprint;

  await db.projectEnvVar.update({
    where: { id: existing.id },
    data: {
      value:         encrypted,
      fingerprint:   fpAfter,
      lastRotatedAt: new Date(),
    },
  });

  // CRITICAL: Never auto-deploy after rotation. User must redeploy manually.

  const ctx = await getAuditRequestContext();
  void writeProjectAuditEvent({
    projectId:   input.projectId,
    actorUserId: auth.userId,
    actorRole:   auth.role,
    action:      "project.secret.rotated",
    category:    "env",
    result:      "success",
    targetType:  "secret",
    targetLabel: existing.name,
    summary:     `Secret rotated: ${existing.name} (${existing.environment})${input.note ? ` — ${input.note}` : ""}`,
    metadata: {
      key:              existing.name,
      environment:      existing.environment,
      fingerprintBefore: fpBefore ?? null,
      fingerprintAfter:  fpAfter,
      ...(input.note ? { note: input.note } : {}),
    },
    ...ctx,
  }).catch(() => null);

  return { ok: true, data: { fingerprintBefore: fpBefore ?? null, fingerprintAfter: fpAfter } };
}

// ── 4. Update secret metadata (no value change) ────────────────────────────────

export type UpdateSecretMetadataInput = {
  projectId:   string;
  secretId:    string;
  description?: string | null;
  required?:   boolean;
  isEnabled?:  boolean;
};

export async function updateProjectSecretMetadataAction(
  input: UpdateSecretMetadataInput,
): Promise<ActionResult<void>> {
  const auth = await requireProjectPermission(input.projectId, "secrets.manage");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  const existing = await db.projectEnvVar.findFirst({
    where:  { id: input.secretId, projectId: input.projectId },
    select: { id: true, name: true, environment: true },
  });
  if (!existing) return { ok: false, error: "Secret not found." };

  const updateData: Record<string, unknown> = {};
  if (input.description !== undefined) updateData.description = input.description;
  if (input.required    !== undefined) updateData.required    = input.required;
  if (input.isEnabled   !== undefined) updateData.isEnabled   = input.isEnabled;

  if (Object.keys(updateData).length === 0) {
    return { ok: true, data: undefined };
  }

  await db.projectEnvVar.update({ where: { id: existing.id }, data: updateData });

  const ctx = await getAuditRequestContext();
  void writeProjectAuditEvent({
    projectId:   input.projectId,
    actorUserId: auth.userId,
    actorRole:   auth.role,
    action:      "project.secret.metadata_updated",
    category:    "env",
    result:      "success",
    targetType:  "secret",
    targetLabel: existing.name,
    summary:     `Secret metadata updated: ${existing.name} (${existing.environment})`,
    metadata:    { key: existing.name, environment: existing.environment, changedFields: Object.keys(updateData) },
    ...ctx,
  }).catch(() => null);

  return { ok: true, data: undefined };
}

// ── 5. Delete a secret ────────────────────────────────────────────────────────

export async function deleteProjectSecretAction(
  projectId: string,
  secretId:  string,
): Promise<ActionResult<void>> {
  const auth = await requireProjectPermission(projectId, "secrets.manage");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  const existing = await db.projectEnvVar.findFirst({
    where:  { id: secretId, projectId },
    select: { id: true, name: true, environment: true },
  });
  if (!existing) return { ok: false, error: "Secret not found." };

  await db.projectEnvVar.delete({ where: { id: existing.id } });

  const ctx = await getAuditRequestContext();
  void writeProjectAuditEvent({
    projectId,
    actorUserId: auth.userId,
    actorRole:   auth.role,
    action:      "project.secret.deleted",
    category:    "env",
    result:      "success",
    targetType:  "secret",
    targetLabel: existing.name,
    summary:     `Secret deleted: ${existing.name} (${existing.environment})`,
    metadata:    { key: existing.name, environment: existing.environment },
    ...ctx,
  }).catch(() => null);

  return { ok: true, data: undefined };
}

// ── 6. Preview .env import ────────────────────────────────────────────────────

export type PreviewEnvImportInput = {
  projectId:   string;
  content:     string;
  environment: string;
};

export type PreviewEnvImportEntry = ParsedEnvEntry & {
  existsInDb: boolean;
};

export async function previewEnvImportAction(
  input: PreviewEnvImportInput,
): Promise<ActionResult<{ entries: PreviewEnvImportEntry[]; environment: string }>> {
  const auth = await requireProjectPermission(input.projectId, "secrets.import");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  const env = input.environment.toLowerCase().trim();
  if (!isValidEnvironment(env)) {
    return { ok: false, error: `Invalid environment "${input.environment}".` };
  }

  // Parse entries — no values are returned, only fingerprints + previews
  const parsed = parseDotEnv(input.content);

  if (parsed.length === 0) {
    return { ok: false, error: "No valid KEY=value pairs found in the pasted content." };
  }

  // Check which keys already exist in DB (for conflict detection)
  const okKeys = parsed.filter((e) => e.status === "ok").map((e) => e.key);
  const existing = okKeys.length > 0
    ? await db.projectEnvVar.findMany({
        where:  { projectId: input.projectId, environment: env, name: { in: okKeys } },
        select: { name: true, fingerprint: true },
      })
    : [];

  const existingMap = new Map(existing.map((r) => [r.name, r.fingerprint]));

  const entries: PreviewEnvImportEntry[] = parsed.map((entry) => {
    const existsInDb = existingMap.has(entry.key);
    // Mark conflicts: key exists and fingerprint differs (value would change)
    const dbFp  = existingMap.get(entry.key);
    const isNew = !existsInDb;
    const isSame = existsInDb && dbFp === entry.fingerprint;

    return {
      ...entry,
      existsInDb,
      // Override status to "conflict" if it exists with a different value
      status:        entry.status === "ok" && existsInDb && !isSame ? "conflict" : entry.status,
      statusMessage: entry.status === "ok" && existsInDb && !isSame
        ? "Already exists — will overwrite."
        : entry.status === "ok" && existsInDb && isSame
        ? "Already configured (same value)."
        : entry.statusMessage,
      // Auto-deselect if same value already stored
      selected:      entry.status === "ok" ? (!existsInDb || !isSame) : false,
    };
  });

  const ctx = await getAuditRequestContext();
  void writeProjectAuditEvent({
    projectId:   input.projectId,
    actorUserId: auth.userId,
    actorRole:   auth.role,
    action:      "project.secret.import_previewed",
    category:    "env",
    result:      "success",
    summary:     `Import preview: ${parsed.length} entries parsed for ${env}`,
    metadata:    {
      environment:   env,
      totalParsed:   parsed.length,
      okCount:       parsed.filter((e) => e.status === "ok").length,
      blockedCount:  parsed.filter((e) => e.status.startsWith("blocked")).length,
      conflictCount: entries.filter((e) => e.status === "conflict").length,
    },
    ...ctx,
  }).catch(() => null);

  return { ok: true, data: { entries, environment: env } };
}

// ── 7. Apply .env import ──────────────────────────────────────────────────────

export type ApplyEnvImportInput = {
  projectId:       string;
  content:         string;
  environment:     string;
  selectedKeys:    string[];  // only import these key names
  overwriteExisting: boolean;
};

export async function applyEnvImportAction(
  input: ApplyEnvImportInput,
): Promise<ActionResult<{ imported: number; skipped: number; overwritten: number }>> {
  const auth = await requireProjectPermission(input.projectId, "secrets.import");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  const env = input.environment.toLowerCase().trim();
  if (!isValidEnvironment(env)) {
    return { ok: false, error: `Invalid environment "${input.environment}".` };
  }

  // Re-parse server-side — we never trust client-provided values
  const parsed = parseDotEnv(input.content);
  const selectedSet = new Set(input.selectedKeys.map((k) => k.toUpperCase()));

  const toImport = parsed.filter(
    (e) => e.status === "ok" && selectedSet.has(e.key),
  );

  if (toImport.length === 0) {
    return { ok: false, error: "No valid selected secrets to import." };
  }

  // Load existing fingerprints to detect conflicts
  const existingRows = await db.projectEnvVar.findMany({
    where:  { projectId: input.projectId, environment: env, name: { in: toImport.map((e) => e.key) } },
    select: { name: true, fingerprint: true, id: true },
  });
  const existingMap = new Map(existingRows.map((r) => [r.name, r]));

  // Re-parse with actual values to encrypt — parseDotEnv stores fingerprints, not values
  // We need to re-parse the raw content to get actual values for encryption
  const rawParsed = parseDotEnvWithValues(input.content);

  let imported  = 0;
  let skipped   = 0;
  let overwritten = 0;
  const importedKeys: string[] = [];

  for (const entry of toImport) {
    const rawValue = rawParsed[entry.key];
    if (!rawValue) { skipped++; continue; }

    const existing = existingMap.get(entry.key);
    if (existing && !input.overwriteExisting) { skipped++; continue; }

    try {
      const trimmed   = rawValue.trim();
      const encrypted = encryptEnvValue(trimmed);
      const fp        = fingerprintSecret(trimmed);
      const secret    = isLikelySecret(entry.key);

      await db.projectEnvVar.upsert({
        where:  { projectId_name_environment: { projectId: input.projectId, name: entry.key, environment: env } },
        update: { value: encrypted, fingerprint: fp, isSecret: secret, source: "import" },
        create: { projectId: input.projectId, name: entry.key, value: encrypted, fingerprint: fp, isSecret: secret, environment: env, source: "import" },
      });
      importedKeys.push(entry.key);
      if (existing) overwritten++; else imported++;
    } catch {
      skipped++;
    }
  }

  const ctx = await getAuditRequestContext();
  void writeProjectAuditEvent({
    projectId:   input.projectId,
    actorUserId: auth.userId,
    actorRole:   auth.role,
    action:      "project.secret.import_applied",
    category:    "env",
    result:      "success",
    summary:     `Import applied: ${imported} new, ${overwritten} overwritten, ${skipped} skipped (${env})`,
    metadata: {
      environment:        env,
      importAddedCount:   imported,
      importUpdatedCount: overwritten,
      importSkippedCount: skipped,
      // Key names only — safe to log
      keys:               importedKeys.slice(0, 50),
    },
    ...ctx,
  }).catch(() => null);

  return { ok: true, data: { imported, skipped, overwritten } };
}

/**
 * Internal helper: re-parse .env content with actual values (for encryption).
 * Used only server-side — values never leave this function unencrypted.
 */
function parseDotEnvWithValues(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of content.split(/\r?\n/)) {
    let trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (trimmed.startsWith("export ")) trimmed = trimmed.slice(7).trim();
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key  = trimmed.slice(0, eq).trim().toUpperCase();
    let   val  = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (key) result[key] = val;
  }
  return result;
}

// ── 8. Export safe metadata (no values) ───────────────────────────────────────

export type ExportedSecretMetadata = {
  project:     string;
  environment: string;
  exportedAt:  string;
  secrets: Array<{
    key:         string;
    configured:  boolean;
    required:    boolean;
    source:      string;
    fingerprint: string | null;
    lastUpdated: string;
    lastRotated: string | null;
    description: string | null;
  }>;
};

export async function exportProjectSecretMetadataAction(
  projectId:  string,
  environment = "production",
): Promise<ActionResult<ExportedSecretMetadata>> {
  const auth = await requireProjectPermission(projectId, "secrets.export");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  const env = environment.toLowerCase().trim();
  if (!isValidEnvironment(env)) {
    return { ok: false, error: `Invalid environment "${environment}".` };
  }

  const [project, rows] = await Promise.all([
    db.project.findUnique({ where: { id: projectId }, select: { name: true } }),
    db.projectEnvVar.findMany({
      where:   { projectId, environment: env },
      orderBy: { name: "asc" },
      select:  {
        name:         true,
        isEnabled:    true,
        required:     true,
        source:       true,
        fingerprint:  true,
        updatedAt:    true,
        lastRotatedAt: true,
        description:  true,
        // value is NOT selected — never exposed in export
      },
    }),
  ]);

  if (!project) return { ok: false, error: "Project not found." };

  const ctx = await getAuditRequestContext();
  void writeProjectAuditEvent({
    projectId,
    actorUserId: auth.userId,
    actorRole:   auth.role,
    action:      "project.secret.metadata_exported",
    category:    "env",
    result:      "success",
    summary:     `Secret metadata exported for ${env} (${rows.length} keys, no values)`,
    metadata:    { environment: env, keyCount: rows.length },
    ...ctx,
  }).catch(() => null);

  const payload: ExportedSecretMetadata = {
    project:     project.name,
    environment: env,
    exportedAt:  new Date().toISOString(),
    secrets:     rows.map((r) => ({
      key:         r.name,
      configured:  r.isEnabled,
      required:    r.required,
      source:      r.source,
      fingerprint: r.fingerprint,
      lastUpdated: r.updatedAt.toISOString(),
      lastRotated: r.lastRotatedAt?.toISOString() ?? null,
      description: r.description,
    })),
  };

  return { ok: true, data: payload };
}

// ── 9. Get required secrets checklist ─────────────────────────────────────────

export type RequiredSecretItem = {
  key:         string;
  configured:  boolean;
  required:    boolean;
  source:      string;  // "deployment" | "template" | "alert" | "default" | "manual"
  description: string | null;
};

export type RequiredSecretsChecklistOutput = {
  environment: string;
  items:       RequiredSecretItem[];
  allRequired: boolean;
  missingCount: number;
};

const DEFAULT_REQUIRED: Array<{ key: string; source: string; description: string }> = [
  { key: "DATABASE_URL",      source: "default",    description: "Primary database connection string." },
  { key: "SESSION_SECRET",    source: "default",    description: "Session signing secret (or JWT_SECRET)." },
];

export async function getRequiredSecretsChecklistAction(
  projectId:   string,
  environment  = "production",
): Promise<ActionResult<RequiredSecretsChecklistOutput>> {
  const auth = await requireProjectPermission(projectId, "secrets.view");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  const env = environment.toLowerCase().trim();

  // Load existing enabled keys
  const rows = await db.projectEnvVar.findMany({
    where:   { projectId, environment: env, isEnabled: true },
    select:  { name: true, required: true, source: true, description: true },
  });
  const presentNames = new Set(rows.map((r) => r.name));

  // Gather required from DB-marked required
  const dbRequired = rows
    .filter((r) => r.required)
    .map((r) => ({
      key:         r.name,
      source:      r.source,
      description: r.description,
    }));

  // Merge with defaults (deduplicate by key)
  const allRequired = new Map<string, { source: string; description: string | null }>();
  for (const d of DEFAULT_REQUIRED) {
    allRequired.set(d.key, { source: d.source, description: d.description });
  }
  for (const d of dbRequired) {
    allRequired.set(d.key, { source: d.source, description: d.description });
  }

  // Also add SESSION_SECRET / JWT_SECRET alternatives
  if (!presentNames.has("SESSION_SECRET") && !presentNames.has("JWT_SECRET")) {
    allRequired.set("SESSION_SECRET", { source: "default", description: "Session or JWT signing key." });
  }

  const items: RequiredSecretItem[] = [...allRequired.entries()].map(([key, meta]) => ({
    key,
    configured:  presentNames.has(key),
    required:    true,
    source:      meta.source,
    description: meta.description,
  }));

  const missingCount = items.filter((i) => !i.configured).length;

  return {
    ok: true,
    data: {
      environment: env,
      items,
      allRequired: missingCount === 0,
      missingCount,
    },
  };
}
