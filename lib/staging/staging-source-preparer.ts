/**
 * lib/staging/staging-source-preparer.ts
 *
 * Sprint 64: Plan-first source preparation for staging.
 *
 * Returns a list of commands and warnings for manually copying the source.
 * Does NOT execute file copies or shell commands.
 *
 * Safety: plan-only. No file mutations without explicit PREPARE STAGING SOURCE
 * confirmation in the server action.
 */

import { db } from "@/lib/db";
import {
  assertSafeStagingTarget,
  DEFAULT_STAGING_SLUG,
  DEFAULT_STAGING_DOMAIN,
} from "./staging-target-guard";

export type StagingSourcePlan =
  | {
      ok:         true;
      sourcePath: string;
      targetPath: string;
      commands:   string[];
      warnings:   string[];
    }
  | {
      ok:    false;
      error: string;
    };

// ── Project storage base ──────────────────────────────────────────────────────

const STORAGE_BASE = process.env.PROJECT_STORAGE_PATH ?? "/home/prisom/staging-projects";

// ── Files/dirs to exclude from copy ──────────────────────────────────────────

const EXCLUDED_PATTERNS = [
  "node_modules",
  ".git",
  ".env",
  ".env.*",
  "*.bak",
  "*.log",
  "dist",
  ".next",
  ".output",
];

// ── Main ──────────────────────────────────────────────────────────────────────

export async function prepareStagingSourcePlan(input: {
  projectId:    string;
  stagingSlug?: string;
}): Promise<StagingSourcePlan> {
  const { projectId, stagingSlug = DEFAULT_STAGING_SLUG } = input;

  try {
    await assertSafeStagingTarget({
      sourceProjectId: projectId,
      stagingSlug,
      stagingDomain:   DEFAULT_STAGING_DOMAIN,
    });
  } catch (err) {
    return {
      ok:    false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const project = await db.project.findUnique({
    where:  { id: projectId },
    select: { slug: true, name: true },
  }).catch(() => null);

  if (!project) {
    return { ok: false, error: `Project ${projectId} not found.` };
  }

  const sourcePath = `${STORAGE_BASE}/${project.slug}`;
  const targetPath = `${STORAGE_BASE}/${stagingSlug}`;

  // Build rsync-style exclude flags
  const excludeFlags = EXCLUDED_PATTERNS.map((p) => `--exclude='${p}'`).join(" \\\n  ");

  const commands = [
    "# 1. Verify source exists and is not live production",
    `ls -la "${sourcePath}"`,
    "",
    "# 2. Create staging target directory",
    `mkdir -p "${targetPath}"`,
    "",
    "# 3. Dry-run copy first (add --dry-run flag)",
    `rsync -av --dry-run \\`,
    `  ${excludeFlags} \\`,
    `  "${sourcePath}/" "${targetPath}/"`,
    "",
    "# 4. If dry run looks correct, run actual copy",
    `# rsync -av \\`,
    `#   ${excludeFlags} \\`,
    `#   "${sourcePath}/" "${targetPath}/"`,
    "",
    "# 5. Verify staging copy",
    `ls -la "${targetPath}"`,
    `cat "${targetPath}/package.json"`,
    `cat "${targetPath}/pnpm-workspace.yaml"`,
    "",
    "# 6. Remove any .env files that may have been copied",
    `find "${targetPath}" -name '.env*' -not -path '*/node_modules/*' -delete`,
    "",
    "# 7. Install dependencies in staging",
    `cd "${targetPath}" && pnpm install --frozen-lockfile`,
  ];

  const warnings = [
    "This is a PLAN ONLY — no files are copied by generating this plan.",
    "To copy: confirm with PREPARE STAGING SOURCE in the panel.",
    "Always run rsync with --dry-run first.",
    "Remove all .env files from the staging copy.",
    "Set staging-specific env vars manually — do not copy from production.",
    "Verify staging DATABASE_URL points to a separate staging database.",
  ];

  return {
    ok:         true,
    sourcePath,
    targetPath,
    commands,
    warnings,
  };
}
