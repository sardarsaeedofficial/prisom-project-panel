"use server";

/**
 * app/actions/source-intake.ts
 *
 * Sprint 57: Server actions for source intake readiness reporting and GitHub import.
 *
 * Safety rules:
 *  - project.view required for report generation and export.
 *  - project.edit required for prepareGitHubImportAction (destructive).
 *  - validateGitHubImportInputAction: no DB access, no auth required (pure validation).
 *  - Never expose secrets.
 *  - Never deploy automatically.
 *  - Never run install or build automatically.
 *  - Never run database migrations.
 *  - prepareGitHubImportAction only validates and returns a plan — it does NOT run git clone.
 */

import path                          from "path";
import { promises as fs }            from "fs";
import { requireProjectPermission }  from "@/lib/auth/project-membership";
import { writeProjectAuditEvent }    from "@/lib/audit/project-audit";
import { getAuditRequestContext }    from "@/lib/audit/request-context";
import { generateSourceIntakeReport } from "@/lib/import/source-intake-readiness";
import { exportSourceIntakeReport }   from "@/lib/import/source-intake-export";
import { db }                         from "@/lib/db";
import type {
  SourceIntakeReport,
  GitHubImportValidation,
} from "@/lib/import/source-intake-types";

const STORAGE_ROOT = path.join(process.cwd(), "storage");

// ── Shared types ──────────────────────────────────────────────────────────────

type ActionResult<T = void> =
  | { ok: true;  data: T }
  | { ok: false; error: string; code?: string };

// ── Helpers ───────────────────────────────────────────────────────────────────

async function resolveProjectSourcePath(
  projectId: string,
): Promise<{ ok: true; sourcePath: string; projectName: string; slug: string } | { ok: false; error: string }> {
  const project = await db.project.findUnique({
    where:  { id: projectId },
    select: { name: true, slug: true },
  });
  if (!project) return { ok: false, error: "Project not found." };

  const slug       = project.slug;
  const sourcePath = path.join(STORAGE_ROOT, "projects", slug);

  return { ok: true, sourcePath, projectName: project.name, slug };
}

async function pathExists(p: string): Promise<boolean> {
  try { await fs.access(p); return true; } catch { return false; }
}

// ── 1. Generate source intake report ─────────────────────────────────────────

export async function generateSourceIntakeReportAction(input: {
  projectId:   string;
  sourcePath?: string;
}): Promise<ActionResult<SourceIntakeReport>> {
  const { projectId } = input;

  const auth = await requireProjectPermission(projectId, "project.view");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  let sourcePath   = input.sourcePath ?? null;
  let projectName  = projectId;

  if (!sourcePath) {
    const resolved = await resolveProjectSourcePath(projectId);
    if (!resolved.ok) return { ok: false, error: resolved.error };
    sourcePath  = resolved.sourcePath;
    projectName = resolved.projectName;
  }

  try {
    const report = await generateSourceIntakeReport({
      projectId,
      sourcePath,
      sourceType: "existing_storage",
    });

    const ctx = await getAuditRequestContext();
    void writeProjectAuditEvent({
      projectId,
      actorUserId: auth.userId,
      actorRole:   auth.role,
      action:      "source_intake.report_generated",
      category:    "publishing",
      result:      "success",
      summary:     `Source intake report generated — status: ${report.status}, blockers: ${report.blockers.length}`,
      metadata:    {
        status:        report.status,
        blockerCount:  report.blockers.length,
        warningCount:  report.warnings.length,
        packageManager: report.detected.packageManager,
        serviceCount:  report.detected.services?.length ?? 0,
      },
      ...ctx,
    }).catch(() => null);

    return { ok: true, data: report };
  } catch (err) {
    const msg = err instanceof Error ? err.message.slice(0, 300) : "Failed to generate source intake report.";
    return { ok: false, error: msg };
  }
}

// ── 2. Validate GitHub import input ──────────────────────────────────────────

const GITHUB_URL_RE =
  /^https?:\/\/github\.com\/([a-z0-9_.-]+)\/([a-z0-9_.-]+?)(\.git)?$/i;

const BRANCH_RE = /^[a-z0-9_./:-]+$/i;

export async function validateGitHubImportInputAction(input: {
  repositoryUrl: string;
  branch?:       string;
}): Promise<ActionResult<GitHubImportValidation>> {
  const { repositoryUrl, branch = "main" } = input;

  const errors:   string[] = [];
  const warnings: string[] = [];

  // Validate URL
  const match = GITHUB_URL_RE.exec(repositoryUrl.trim());
  if (!match) {
    errors.push(
      "Invalid GitHub repository URL. Expected format: https://github.com/owner/repo",
    );
  }

  // Validate branch
  const cleanBranch = branch.trim();
  if (!cleanBranch) {
    errors.push("Branch name is required.");
  } else if (!BRANCH_RE.test(cleanBranch)) {
    errors.push("Branch name contains invalid characters.");
  }

  if (errors.length > 0) {
    return {
      ok: true,
      data: {
        isValid:  false,
        branch:   cleanBranch,
        errors,
        warnings,
      },
    };
  }

  const owner    = match![1];
  const repo     = match![2].replace(/\.git$/, "");
  const cloneUrl = `https://github.com/${owner}/${repo}.git`;
  const slug     = repo.toLowerCase().replace(/[^a-z0-9-]/g, "-");
  const destPath = path.join(STORAGE_ROOT, "projects", slug);
  const alreadyExists = await pathExists(destPath);

  if (alreadyExists) {
    warnings.push(
      `Source already exists at storage/projects/${slug}. To replace it, type "REPLACE SOURCE" to confirm.`,
    );
  }

  return {
    ok: true,
    data: {
      isValid:      true,
      owner,
      repo,
      branch:       cleanBranch,
      cloneUrl,
      destPath:     `storage/projects/${slug}`,
      alreadyExists,
      errors,
      warnings,
    },
  };
}

// ── 3. Export source intake report ────────────────────────────────────────────

export async function exportSourceIntakeReportAction(input: {
  projectId:   string;
  sourcePath?: string;
}): Promise<ActionResult<{ markdown: string; filename: string }>> {
  const { projectId } = input;

  const auth = await requireProjectPermission(projectId, "project.view");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  let sourcePath  = input.sourcePath ?? null;
  let projectName = projectId;

  if (!sourcePath) {
    const resolved = await resolveProjectSourcePath(projectId);
    if (!resolved.ok) return { ok: false, error: resolved.error };
    sourcePath  = resolved.sourcePath;
    projectName = resolved.projectName;
  }

  try {
    const report   = await generateSourceIntakeReport({
      projectId,
      sourcePath,
      sourceType: "existing_storage",
    });
    const markdown = exportSourceIntakeReport(report, projectName);

    const ctx = await getAuditRequestContext();
    void writeProjectAuditEvent({
      projectId,
      actorUserId: auth.userId,
      actorRole:   auth.role,
      action:      "source_intake.report_exported",
      category:    "publishing",
      result:      "success",
      summary:     `Source intake report exported for project: ${projectName}`,
      metadata:    { status: report.status },
      ...ctx,
    }).catch(() => null);

    return { ok: true, data: { markdown, filename: "SOURCE_INTAKE_REPORT.md" } };
  } catch (err) {
    const msg = err instanceof Error ? err.message.slice(0, 300) : "Failed to export source intake report.";
    return { ok: false, error: msg };
  }
}

// ── 4. Prepare GitHub import (validate only — no git clone) ──────────────────

const REPLACE_SOURCE_PHRASE = "REPLACE SOURCE" as const;

export async function prepareGitHubImportAction(input: {
  projectId:      string;
  repositoryUrl:  string;
  branch?:        string;
  confirmation?:  typeof REPLACE_SOURCE_PHRASE;
}): Promise<ActionResult<{
  owner:         string;
  repo:          string;
  branch:        string;
  cloneUrl:      string;
  destPath:      string;
  alreadyExists: boolean;
  requiresConfirmation: boolean;
  manualCommand: string;
}>> {
  const { projectId, repositoryUrl, branch = "main", confirmation } = input;

  const auth = await requireProjectPermission(projectId, "project.edit");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  // Validate URL
  const match = GITHUB_URL_RE.exec(repositoryUrl.trim());
  if (!match) {
    return { ok: false, error: "Invalid GitHub repository URL. Expected: https://github.com/owner/repo" };
  }

  const cleanBranch = (branch ?? "main").trim();
  if (!cleanBranch || !BRANCH_RE.test(cleanBranch)) {
    return { ok: false, error: "Invalid branch name." };
  }

  const owner       = match[1];
  const repo        = match[2].replace(/\.git$/, "");
  const slug        = repo.toLowerCase().replace(/[^a-z0-9-]/g, "-");
  const cloneUrl    = `https://github.com/${owner}/${repo}.git`;
  const destAbsPath = path.join(STORAGE_ROOT, "projects", slug);
  const destPath    = `storage/projects/${slug}`;
  const alreadyExists = await pathExists(destAbsPath);

  // If source already exists, require REPLACE SOURCE confirmation
  if (alreadyExists && confirmation !== REPLACE_SOURCE_PHRASE) {
    return {
      ok: false,
      error: `Source already exists at ${destPath}. To replace it, confirm with: ${REPLACE_SOURCE_PHRASE}`,
      code: "REQUIRES_CONFIRMATION",
    };
  }

  const manualCommand = alreadyExists
    ? [
        `# Replace existing source (run on server):`,
        `rm -rf ${destAbsPath}`,
        `git clone --depth 1 --branch ${cleanBranch} ${cloneUrl} ${destAbsPath}`,
      ].join("\n")
    : [
        `# Clone repository (run on server):`,
        `git clone --depth 1 --branch ${cleanBranch} ${cloneUrl} ${destAbsPath}`,
      ].join("\n");

  const ctx = await getAuditRequestContext();
  void writeProjectAuditEvent({
    projectId,
    actorUserId: auth.userId,
    actorRole:   auth.role,
    action:      "source_intake.import_prepared",
    category:    "publishing",
    result:      "success",
    summary:     `GitHub import prepared: ${owner}/${repo}@${cleanBranch} → ${destPath}`,
    metadata:    { owner, repo, branch: cleanBranch, alreadyExists, replaced: alreadyExists },
    ...ctx,
  }).catch(() => null);

  if (alreadyExists) {
    const ctx2 = await getAuditRequestContext();
    void writeProjectAuditEvent({
      projectId,
      actorUserId: auth.userId,
      actorRole:   auth.role,
      action:      "source_intake.replace_source_requested",
      category:    "publishing",
      result:      "success",
      summary:     `REPLACE SOURCE confirmed for ${destPath}`,
      metadata:    { destPath },
      ...ctx2,
    }).catch(() => null);
  }

  return {
    ok: true,
    data: {
      owner,
      repo,
      branch:              cleanBranch,
      cloneUrl,
      destPath,
      alreadyExists,
      requiresConfirmation: false,
      manualCommand,
    },
  };
}
