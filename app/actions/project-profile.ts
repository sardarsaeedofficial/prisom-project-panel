"use server";

/**
 * app/actions/project-profile.ts
 *
 * Sprint 71: Server actions for project migration profile detection and export.
 *
 * Safety rules:
 *  - project.view required for all actions
 *  - No secret values returned — only key names and categories
 *  - No production mutation
 *  - No nginx, PM2, DB migration, or route changes
 */

import { requireProjectPermission } from "@/lib/auth/project-membership";
import { writeProjectAuditEvent }   from "@/lib/audit/project-audit";
import { getAuditRequestContext }   from "@/lib/audit/request-context";
import { detectProjectMigrationProfile } from "@/lib/project-profiles/project-profile-service";
import { exportProjectProfileReport }    from "@/lib/project-profiles/project-profile-export";
import type { ProjectMigrationProfile }  from "@/lib/project-profiles/project-profile-types";

// ── Shared result type ────────────────────────────────────────────────────────

type ActionResult<T = void> =
  | { ok: true;  data: T }
  | { ok: false; error: string; code?: string };

// ── 1. Detect project migration profile ──────────────────────────────────────

export async function detectProjectMigrationProfileAction(input: {
  projectId: string;
}): Promise<ActionResult<ProjectMigrationProfile>> {
  const { projectId } = input;

  const auth = await requireProjectPermission(projectId, "project.view");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  try {
    const profile = await detectProjectMigrationProfile({ projectId });

    const ctx = await getAuditRequestContext();
    void writeProjectAuditEvent({
      projectId,
      actorUserId: auth.userId,
      actorRole:   auth.role,
      action:      "project_profile.detected",
      category:    "publishing",
      result:      "success",
      summary:     `Project migration profile detected: ${profile.kind} (${profile.label})`,
      metadata:    {
        kind:        profile.kind,
        isSardar:    profile.isSardar,
        isEcommerce: profile.isEcommerce,
        slug:        profile.slug ?? null,
        domain:      profile.domain ?? null,
      },
      ...ctx,
    }).catch(() => null);

    return { ok: true, data: profile };
  } catch (err) {
    const msg = err instanceof Error ? err.message.slice(0, 300) : "Failed to detect project profile.";
    return { ok: false, error: msg };
  }
}

// ── 2. Export project profile report ─────────────────────────────────────────

export async function exportProjectProfileReportAction(input: {
  projectId: string;
}): Promise<ActionResult<{ markdown: string; filename: string }>> {
  const { projectId } = input;

  const auth = await requireProjectPermission(projectId, "project.view");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  try {
    const profile  = await detectProjectMigrationProfile({ projectId });
    const markdown = exportProjectProfileReport(profile);

    const ctx = await getAuditRequestContext();
    void writeProjectAuditEvent({
      projectId,
      actorUserId: auth.userId,
      actorRole:   auth.role,
      action:      "project_profile.exported",
      category:    "publishing",
      result:      "success",
      summary:     `Project profile report exported: ${profile.kind} (${profile.label})`,
      metadata:    { kind: profile.kind, slug: profile.slug ?? null },
      ...ctx,
    }).catch(() => null);

    return {
      ok:   true,
      data: { markdown, filename: "PROJECT_PROFILE_REPORT.md" },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message.slice(0, 300) : "Failed to export project profile report.";
    return { ok: false, error: msg };
  }
}
