/**
 * lib/projects/project-lookup-fallback.ts
 *
 * Hotfix: shared direct-DB project loader for read-focused import/analysis flows.
 *
 * requireProjectPermission() (lib/auth/project-membership.ts) resolves the
 * current user via session/workspace-ownership checks before returning project
 * data. When that resolution fails for any reason (workspace mismatch, session
 * lookup hiccup, stale ProjectMember table), it previously returned the same
 * "Project not found." message as a genuine missing-record case — which is
 * misleading when the project plainly exists in the DB.
 *
 * getProjectByIdForImport() is a direct, unscoped DB read used ONLY for
 * displaying project metadata in read-focused contexts (AI Import Autopilot /
 * Operator analysis). It must NEVER be used to gate mutations — every
 * deploy/fix/secret-write action must still call requireProjectPermission()
 * first. This loader exists so "I can't show you what's going on" never
 * happens when the project record itself is fine.
 *
 * Schema note: Project has NO `sourcePath` / `storagePath` field. Source
 * directory presence is checked via the filesystem convention used elsewhere
 * in this codebase: storage/projects/<slug>.
 */

import path from "path";
import { existsSync } from "fs";
import { db } from "@/lib/db";

const PROJECT_STORAGE = path.resolve(process.cwd(), "storage", "projects");

export type ImportProjectLookup = {
  id:                     string;
  name:                   string;
  slug:                   string;
  status:                 string;
  workspaceId:            string;
  hasDeploymentConfig:    boolean;
  envVarNames:            string[];
  latestDeploymentStatus: string | null;
  sourceDirectoryExists:  boolean;
};

/**
 * Direct DB lookup for project metadata — no workspace/session dependency.
 * Returns null only when the project genuinely does not exist (or the DB
 * lookup itself throws, which is logged server-side and treated as not-found
 * for display purposes — callers must not surface raw error internals).
 */
export async function getProjectByIdForImport(projectId: string): Promise<ImportProjectLookup | null> {
  try {
    const project = await db.project.findUnique({
      where:  { id: projectId },
      select: {
        id:          true,
        name:        true,
        slug:        true,
        status:      true,
        workspaceId: true,
        deploymentConfig: { select: { id: true } },
        envVars:          { where: { isEnabled: true }, select: { name: true } },
        deployments:      { orderBy: { startedAt: "desc" }, take: 1, select: { status: true } },
      },
    });

    if (!project) return null;

    const sourceDirectoryExists = existsSync(path.join(PROJECT_STORAGE, project.slug));

    return {
      id:                     project.id,
      name:                   project.name,
      slug:                   project.slug,
      status:                 project.status,
      workspaceId:            project.workspaceId,
      hasDeploymentConfig:    !!project.deploymentConfig,
      envVarNames:            project.envVars.map((e) => e.name),
      latestDeploymentStatus: project.deployments[0]?.status ?? null,
      sourceDirectoryExists,
    };
  } catch (error) {
    console.error("[import-project-loader] project lookup failed", error);
    return null;
  }
}
