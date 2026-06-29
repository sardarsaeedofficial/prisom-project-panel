"use server";

/**
 * app/actions/replit-preset.ts
 *
 * Sprint 84: Server actions for detecting and applying the Replit/Sardar
 * pnpm-workspace deploy preset.
 *
 * Safety:
 *  - Project ownership verified on every action (IDOR prevention)
 *  - Detection is read-only filesystem scan — no writes
 *  - Apply calls saveDeploymentConfigAction which passes every command through
 *    validateAndParseCommand before saving
 *  - No shell execution, no secrets, no PM2 interaction
 */

import { requireProjectPermission } from "@/lib/auth/project-membership";
import { db } from "@/lib/db";
import { detectReplitPreset } from "@/lib/import/replit-preset-detector";
import { saveDeploymentConfigAction } from "@/app/actions/project-deployments";
import { revalidatePath } from "next/cache";
import type { ReplitDeployPreset } from "@/lib/import/replit-preset-detector";

type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

// ── Action: detectReplitPresetAction ──────────────────────────────────────────

/**
 * Scans the project's source directory and returns a preset if the structure
 * looks like a Replit pnpm-workspace export. Returns null data if not detected.
 */
export async function detectReplitPresetAction(input: {
  projectId: string;
}): Promise<ActionResult<{ preset: ReplitDeployPreset | null }>> {
  const auth = await requireProjectPermission(input.projectId, "project.view");
  if (!auth.ok) return { ok: false, error: auth.error };

  const project = await db.project.findUnique({
    where:  { id: input.projectId },
    select: { slug: true },
  });
  if (!project) return { ok: false, error: "Project not found." };

  const preset = detectReplitPreset(project.slug);
  return { ok: true, data: { preset } };
}

// ── Action: applyReplitPresetAction ───────────────────────────────────────────

/**
 * Detects the Replit preset for the project and, if found, saves it as the
 * deployment config. Assigns a port on first save (handled by
 * saveDeploymentConfigAction).
 *
 * If no preset can be auto-detected, falls back to the known Sardar preset so
 * the user can apply it manually regardless of whether source is uploaded yet.
 */
export async function applyReplitPresetAction(input: {
  projectId: string;
}): Promise<ActionResult<{ preset: ReplitDeployPreset; applied: boolean }>> {
  const auth = await requireProjectPermission(input.projectId, "deploy.trigger");
  if (!auth.ok) {
    const viewAuth = await requireProjectPermission(input.projectId, "project.edit");
    if (!viewAuth.ok) return { ok: false, error: auth.error };
  }

  const project = await db.project.findUnique({
    where:  { id: input.projectId },
    select: { slug: true },
  });
  if (!project) return { ok: false, error: "Project not found." };

  // Try auto-detection first; fall back to known Sardar preset
  const detected = detectReplitPreset(project.slug);
  const preset: ReplitDeployPreset = detected ?? {
    installCommand:  "pnpm install --frozen-lockfile --ignore-scripts",
    buildCommand:    "pnpm run build",
    startCommand:    "node artifacts/api-server/dist/index.mjs",
    healthPath:      "/api/healthz",
    routeMode:       "static_plus_api",
    staticOutputDir: "artifacts/sardar-security/dist/public",
    apiPrefix:       "/api",
    nodeEnv:         "production",
    detected:        "sardar-pnpm-workspace",
    detectionNote:   "Preset applied manually — source not yet uploaded.",
  };

  // Save via the standard config action (validates commands, assigns port)
  const saveResult = await saveDeploymentConfigAction(input.projectId, {
    installCommand:  preset.installCommand,
    buildCommand:    preset.buildCommand,
    startCommand:    preset.startCommand,
    rootDirectory:   ".",
    healthPath:      preset.healthPath,
    nodeEnv:         preset.nodeEnv,
    routeMode:       preset.routeMode,
    staticOutputDir: preset.staticOutputDir,
    apiPrefix:       preset.apiPrefix,
  });

  if (!saveResult.ok) {
    return { ok: false, error: `Failed to apply preset: ${saveResult.error}` };
  }

  revalidatePath(`/projects/${input.projectId}/migration`);
  revalidatePath(`/projects/${input.projectId}/publishing`);

  return { ok: true, data: { preset, applied: true } };
}
