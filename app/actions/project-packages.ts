"use server";

/**
 * app/actions/project-packages.ts
 *
 * Sprint 9: Server actions for the safe project package manager UI.
 *
 * Safety rules (enforced here):
 *  - Every action verifies project ownership before doing anything.
 *  - confirmed:true is required for all mutating operations.
 *  - Package specifier validated server-side via validatePackageSpecifier.
 *  - All operations delegate to lib/projects/package-manager.ts.
 *  - Audit log entry written to ProjectLog after every operation.
 *  - No auto-commit, auto-push, auto-restart, auto-deploy.
 */

import { revalidatePath } from "next/cache";
import { getCurrentWorkspaceId } from "@/lib/current-workspace";
import { db } from "@/lib/db";
import { getProjectFileRoot } from "@/lib/projects/file-manager";
import {
  validatePackageSpecifier,
  getPackageInfo,
  runPackageOperation,
  getPackageDiff,
} from "@/lib/projects/package-manager";
import type {
  ProjectPackageInfo,
  PackageOperation,
  PackageOperationResult,
  PackageDiffResult,
} from "@/lib/projects/package-manager";

// ── Shared result type ────────────────────────────────────────────────────────

export type PkgActionResult<T = unknown> =
  | { ok: true;  data: T }
  | { ok: false; error: string; code?: string };

// ── Ownership guard ───────────────────────────────────────────────────────────

async function verifyOwnership(
  projectId: string,
): Promise<{ ok: true; id: string; slug: string } | { ok: false; error: string }> {
  const workspaceId = await getCurrentWorkspaceId().catch(() => null);
  if (!workspaceId) return { ok: false, error: "Not authenticated." };

  const project = await db.project.findUnique({
    where:  { id: projectId },
    select: { id: true, slug: true, workspaceId: true },
  });
  if (!project || project.workspaceId !== workspaceId) {
    return { ok: false, error: "Project not found." };
  }
  return { ok: true, id: project.id, slug: project.slug };
}

// ── Actions ───────────────────────────────────────────────────────────────────

/**
 * Read package.json and detect the package manager for a project.
 * Safe read-only operation — no confirmation required.
 */
export async function getProjectPackageInfoAction(
  projectId: string,
): Promise<PkgActionResult<ProjectPackageInfo>> {
  const auth = await verifyOwnership(projectId);
  if (!auth.ok) return { ok: false, error: auth.error, code: "FORBIDDEN" };

  const rootResult = await getProjectFileRoot(projectId);
  if (!rootResult.ok) return { ok: false, error: rootResult.error, code: "NO_ROOT" };

  return getPackageInfo(rootResult.root);
}

/**
 * Run a package install / install-dev / remove / update operation.
 *
 * Requires confirmed:true — the UI must show a confirmation modal first.
 * Validates the package specifier server-side.
 * Writes a ProjectLog audit entry.
 * Returns the operation result and git diff of package files.
 */
export async function runProjectPackageOperationAction(input: {
  projectId:        string;
  operation:        PackageOperation;
  packageSpecifier: string;
  confirmed:        boolean;
}): Promise<PkgActionResult<{ result: PackageOperationResult; diff: PackageDiffResult }>> {
  const { projectId, operation, packageSpecifier, confirmed } = input;

  if (!confirmed) {
    return {
      ok:    false,
      error: "Confirmation is required before running package operations.",
      code:  "NEEDS_CONFIRMATION",
    };
  }

  const auth = await verifyOwnership(projectId);
  if (!auth.ok) return { ok: false, error: auth.error, code: "FORBIDDEN" };

  const rootResult = await getProjectFileRoot(projectId);
  if (!rootResult.ok) return { ok: false, error: rootResult.error, code: "NO_ROOT" };
  const root = rootResult.root;

  // Server-side specifier validation
  const validation = validatePackageSpecifier(packageSpecifier);
  if (!validation.ok) {
    return { ok: false, error: validation.error, code: "INVALID_SPECIFIER" };
  }

  // Run the operation
  const opResult = await runPackageOperation(root, operation, validation.specifier);
  if (!opResult.ok) {
    return { ok: false, error: opResult.error };
  }

  // Audit log
  const logMsg = `[packages] ${operation} ${validation.specifier.display} → exit ${opResult.data.exitCode} (${opResult.data.durationMs}ms)`;
  await db.projectLog.create({
    data: {
      projectId,
      level:   opResult.data.success ? "INFO" : "WARN",
      source:  "SYSTEM",
      message: logMsg.slice(0, 1000),
    },
  }).catch(() => null);

  // Get diff after operation (non-fatal if git unavailable)
  const diffResult = await getPackageDiff(root);
  const diff: PackageDiffResult = diffResult.ok
    ? diffResult.data
    : { isGitRepo: false, changedFiles: [], packageJsonDiff: null, lockfileDiff: null };

  revalidatePath(`/projects/${projectId}`);

  return {
    ok:   true,
    data: { result: opResult.data, diff },
  };
}

/**
 * Get git diff of package files (package.json, lockfile) in a project.
 * Useful for refreshing the diff view after manual changes.
 */
export async function getProjectPackageDiffAction(
  projectId: string,
): Promise<PkgActionResult<PackageDiffResult>> {
  const auth = await verifyOwnership(projectId);
  if (!auth.ok) return { ok: false, error: auth.error, code: "FORBIDDEN" };

  const rootResult = await getProjectFileRoot(projectId);
  if (!rootResult.ok) return { ok: false, error: rootResult.error, code: "NO_ROOT" };

  const result = await getPackageDiff(rootResult.root);
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, data: result.data };
}
