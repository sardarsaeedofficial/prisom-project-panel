/**
 * lib/migration/portability-patch-apply.ts
 *
 * Sprint 25: Applies a PortabilityPatchPlan to disk.
 *
 * Safety guarantees:
 *   - Every path is re-validated against the project root before write
 *   - "update" ops verify the current file content matches the plan's `before`
 *     (conflict detection — if file changed between plan and apply, abort)
 *   - "create" ops fail if the file already exists (prevents overwrite surprise)
 *   - Never writes to .env, node_modules, lock files (validated by safety layer)
 *   - Writes are atomic: write to a temp file, then rename
 */

import path   from "path";
import { promises as fs } from "fs";
import crypto from "crypto";
import { validatePatchPath } from "./portability-patch-safety";
import type { PortabilityPatchPlan, ApplyPatchResult } from "./portability-patch-types";

// ── Apply ─────────────────────────────────────────────────────────────────────

export async function applyPortabilityPatch(
  plan:      PortabilityPatchPlan,
  sourceDir: string,
): Promise<ApplyPatchResult> {
  const result: ApplyPatchResult = {
    patchId:          plan.id,
    filesCreated:     0,
    filesUpdated:     0,
    requiredSecrets:  plan.requiredSecrets,
    requiredPackages: plan.requiredPackages,
    manualSteps:      plan.manualSteps,
    errors:           [],
    ok:               false,
  };

  for (const pf of plan.files) {
    // ── 1. Validate path ───────────────────────────────────────────────────
    const pathCheck = validatePatchPath(pf.path, sourceDir);
    if (!pathCheck.ok) {
      result.errors.push(`Path validation failed for ${pf.path}: ${pathCheck.error}`);
      continue;
    }
    const absPath = pathCheck.absPath;

    // ── 2. Operation: CREATE ───────────────────────────────────────────────
    if (pf.operation === "create") {
      // Do not overwrite existing files silently
      try {
        await fs.access(absPath);
        result.errors.push(
          `Cannot create ${pf.path}: file already exists. Delete it first or re-plan.`,
        );
        continue;
      } catch {
        // File does not exist — proceed
      }

      // Ensure parent directory exists
      const parentDir = path.dirname(absPath);
      try {
        await fs.mkdir(parentDir, { recursive: true });
      } catch (err) {
        result.errors.push(
          `Cannot create directory for ${pf.path}: ${err instanceof Error ? err.message : String(err)}`,
        );
        continue;
      }

      // Atomic write
      const written = await atomicWrite(absPath, pf.after);
      if (written.ok) {
        result.filesCreated++;
      } else {
        result.errors.push(`Write failed for ${pf.path}: ${written.error}`);
      }
      continue;
    }

    // ── 3. Operation: UPDATE ───────────────────────────────────────────────
    if (pf.operation === "update") {
      // Conflict detection: verify current content matches plan's `before`
      let currentContent: string;
      try {
        currentContent = await fs.readFile(absPath, "utf8");
      } catch {
        result.errors.push(`Cannot read ${pf.path} for update — file may have been moved.`);
        continue;
      }

      if (pf.before !== undefined && currentContent !== pf.before) {
        result.errors.push(
          `Conflict in ${pf.path}: file changed since patch was planned. Re-plan and re-apply.`,
        );
        continue;
      }

      // Atomic write
      const written = await atomicWrite(absPath, pf.after);
      if (written.ok) {
        result.filesUpdated++;
      } else {
        result.errors.push(`Write failed for ${pf.path}: ${written.error}`);
      }
    }
  }

  result.ok = result.errors.length === 0 && (result.filesCreated + result.filesUpdated) > 0;
  return result;
}

// ── Atomic write helper ───────────────────────────────────────────────────────

async function atomicWrite(
  destPath: string,
  content:  string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const tmpPath = destPath + ".tmp_" + crypto.randomBytes(4).toString("hex");
  try {
    await fs.writeFile(tmpPath, content, "utf8");
    await fs.rename(tmpPath, destPath);
    return { ok: true };
  } catch (err) {
    // Clean up temp file on failure
    await fs.unlink(tmpPath).catch(() => null);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
