/**
 * lib/cutover/rollback-readiness.ts
 *
 * Sprint 55: Rollback readiness check for production cutover.
 *
 * Safety rules:
 *  - read-only DB access
 *  - no PM2/nginx mutations
 *  - always displays DB rollback warning
 */

import { db } from "@/lib/db";
import type { RollbackReadiness } from "./production-cutover-types";

const DB_ROLLBACK_WARNING =
  "Application rollback does not automatically rollback database schema/data. " +
  "If your cutover included a DB migration, restore from a pre-cutover backup instead.";

export async function generateRollbackReadiness(
  projectId: string,
): Promise<RollbackReadiness> {
  let hasPreviousRelease     = false;
  let rollbackDeploymentRef: string | null = null;
  let routeSnapshotAvailable = false;

  try {
    // Check for previous promoted release (rollback target)
    const previousPromotion = await db.projectReleasePromotion.findFirst({
      where:   { projectId, status: "promoted", rollbackDeploymentRef: { not: null } },
      orderBy: { createdAt: "desc" },
      select:  { id: true, rollbackDeploymentRef: true, deploymentRef: true },
    });

    if (previousPromotion?.rollbackDeploymentRef) {
      hasPreviousRelease    = true;
      rollbackDeploymentRef = previousPromotion.rollbackDeploymentRef;
    } else {
      // Fallback: check if there are at least 2 successful deployments
      const deployCount = await db.deployment.count({
        where: { projectId, status: "SUCCESS" },
      });
      if (deployCount >= 2) {
        hasPreviousRelease = true;
        const prev = await db.deployment.findFirst({
          where:   { projectId, status: "SUCCESS", isActive: false },
          orderBy: { createdAt: "desc" },
          select:  { id: true, metadata: true },
        });
        if (prev) {
          const meta = prev.metadata as Record<string, unknown> | null;
          rollbackDeploymentRef = (meta?.deploymentRef as string) ?? prev.id;
        }
      }
    }

    // Check for nginx route backup
    const domain = await db.domain.findFirst({
      where:  { projectId, isPrimary: true },
      select: { hostname: true },
    });
    if (domain?.hostname) {
      const { hasBackupConfig } = await import("@/lib/routing/nginx-route-apply");
      routeSnapshotAvailable = await hasBackupConfig(domain.hostname).catch(() => false);
    }
  } catch {
    // non-fatal — return safe defaults
  }

  const checklist: string[] = [
    hasPreviousRelease && rollbackDeploymentRef
      ? `✅ Rollback target available: ${rollbackDeploymentRef.slice(0, 16)}`
      : "⚠️  No rollback target found — promote a build first to establish a rollback target",
    routeSnapshotAvailable
      ? "✅ Nginx route backup exists — previous routing can be restored"
      : "⚠️  No nginx route backup found — manually save routing config before applying production routes",
    "[ ] Stripe webhook rollback: manually update endpoint URL in Stripe Dashboard → Webhooks",
    "[ ] DNS rollback: update DNS A record to point back to previous server/IP (requires DNS propagation)",
    "[ ] Confirm rollback plan with team before cutover",
  ];

  const warnings: string[] = [
    DB_ROLLBACK_WARNING,
    "Rollback reverts the deployment but does not undo database migrations.",
    "DNS propagation may take up to 48 hours after a rollback.",
    "Stripe webhook rollback requires manual action in the Stripe Dashboard.",
  ];

  return {
    hasPreviousRelease,
    rollbackDeploymentRef,
    routeSnapshotAvailable,
    dbRollbackWarning: DB_ROLLBACK_WARNING,
    checklist,
    warnings,
  };
}
