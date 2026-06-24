/**
 * lib/backups/restore-target-safety.ts
 *
 * Sprint 60: Safety guard for restore target validation.
 *
 * Rules:
 *  - staging restore cannot target the source project slug
 *  - live restore requires confirmation "RESTORE LIVE"
 *  - restore drill slug must not equal any live Sardar production slug
 *  - Prisom panel project/domain is blocked
 *  - Doorsteps/LocalShop paths/domains are blocked
 *
 * Server-only.
 */

import { db } from "@/lib/db";

// ── Blocked slugs / paths ─────────────────────────────────────────────────────

const LIVE_SARDAR_SLUGS = new Set([
  "sardar-security-project",
  "sardar-security-supplies",
  "sardar-security-supplies-project",
]);

const BLOCKED_PANEL_SLUGS = new Set([
  "prisom-project-panel",
  "prisom-projects",
  "prisom-panel",
  "projects-doorstepmanchester",
]);

const BLOCKED_DOORSTEPS_SLUGS = new Set([
  "doorstep-manchester",
  "doorsteps-app",
  "localshop",
  "prisom-manager",
  "prisom-backend",
]);

function isBlockedSlug(slug: string): { blocked: boolean; reason: string } {
  const s = slug.toLowerCase().trim();

  if (LIVE_SARDAR_SLUGS.has(s)) {
    return {
      blocked: true,
      reason: `"${s}" is a live Sardar Security production project. Use a separate drill slug like sardar-security-restore-drill.`,
    };
  }
  if (BLOCKED_PANEL_SLUGS.has(s)) {
    return {
      blocked: true,
      reason: `"${s}" is the Prisom Project Panel itself. Never restore over it.`,
    };
  }
  if (BLOCKED_DOORSTEPS_SLUGS.has(s)) {
    return {
      blocked: true,
      reason: `"${s}" belongs to the Doorsteps / LocalShop application. Never restore over it.`,
    };
  }
  if (
    s.includes("doorstep") ||
    s.includes("localshop") ||
    s.includes("prisom-manager") ||
    s.includes("prisom-backend")
  ) {
    return {
      blocked: true,
      reason: `"${s}" appears to be a Doorsteps/LocalShop slug. Restore blocked for safety.`,
    };
  }

  return { blocked: false, reason: "" };
}

// ── Public guard ──────────────────────────────────────────────────────────────

export async function assertSafeRestoreTarget(input: {
  sourceProjectId: string;
  targetProjectId?: string;
  targetSlug?: string;
  mode: "staging" | "live";
  confirmation?: string;
}): Promise<void> {
  const { sourceProjectId, targetProjectId, targetSlug, mode, confirmation } = input;

  // live restore requires explicit phrase
  if (mode === "live") {
    if (confirmation?.trim() !== "RESTORE LIVE") {
      throw new Error(
        'Live restore requires confirmation phrase "RESTORE LIVE". This action is not automatic.',
      );
    }
  }

  // Resolve target slug from projectId if not provided directly
  let resolvedSlug = targetSlug;
  if (!resolvedSlug && targetProjectId) {
    const project = await db.project.findUnique({
      where: { id: targetProjectId },
      select: { slug: true },
    });
    resolvedSlug = project?.slug ?? undefined;
  }

  // staging restore must not target the source project itself
  if (mode === "staging" && targetProjectId && targetProjectId === sourceProjectId) {
    throw new Error(
      "Staging restore cannot target the source project. Use a separate restore-drill project.",
    );
  }

  // slug-based checks
  if (resolvedSlug) {
    const { blocked, reason } = isBlockedSlug(resolvedSlug);
    if (blocked) throw new Error(`Restore target blocked: ${reason}`);
  }

  // Check source project is not being overwritten in staging mode
  if (mode === "staging") {
    const sourceProject = await db.project.findUnique({
      where: { id: sourceProjectId },
      select: { slug: true },
    });
    if (sourceProject && resolvedSlug === sourceProject.slug) {
      throw new Error(
        "Staging restore target slug matches the source project slug. Use a distinct restore-drill slug.",
      );
    }
  }
}
