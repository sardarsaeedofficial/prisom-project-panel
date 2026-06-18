/**
 * lib/projects/release-safety.ts
 *
 * Sprint 13: Release folder path validation for safe rollback.
 *
 * Expected layout:  storage/releases/<projectSlug>/<deploymentRef>
 *
 * Safety rules:
 *  - deploymentRef must be a simple safe alphanumeric/underscore string
 *  - No slash, no .., no null bytes in deploymentRef
 *  - Resolved realpath must stay inside storage/releases/<projectSlug>
 *  - Target release folder must exist on disk
 *  - projectSlug must also be a safe identifier
 */

import path from "path";
import { promises as fs } from "fs";
import { RELEASE_STORAGE } from "@/lib/projects/project-deploy-runner";

// ── Validators ────────────────────────────────────────────────────────────────

/** Allowed deployment reference pattern (e.g. dep_20240101_abc1234 or dep_00000000000000_unknown). */
const DEPLOYMENT_REF_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/;

/** Allowed project slug pattern. */
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,127}$/;

export function validateDeploymentRef(
  ref: string,
): { ok: true; ref: string } | { ok: false; error: string } {
  if (!ref || typeof ref !== "string") {
    return { ok: false, error: "Deployment reference is required." };
  }
  if (ref.includes("\0")) {
    return { ok: false, error: "Deployment reference contains null bytes." };
  }
  if (ref.includes("/") || ref.includes("\\")) {
    return { ok: false, error: "Deployment reference must not contain path separators." };
  }
  if (ref.includes("..")) {
    return { ok: false, error: "Deployment reference must not contain '..'." };
  }
  if (!DEPLOYMENT_REF_RE.test(ref)) {
    return {
      ok:    false,
      error: `Deployment reference "${ref}" contains invalid characters. ` +
             "Only alphanumeric, underscore, hyphen, and dot are allowed.",
    };
  }
  return { ok: true, ref };
}

export function validateProjectSlug(
  slug: string,
): { ok: true; slug: string } | { ok: false; error: string } {
  if (!slug || typeof slug !== "string") {
    return { ok: false, error: "Project slug is required." };
  }
  if (!SLUG_RE.test(slug)) {
    return { ok: false, error: `Project slug "${slug}" is not a safe identifier.` };
  }
  return { ok: true, slug };
}

// ── Path resolution + validation ──────────────────────────────────────────────

/**
 * Resolve the release path for a given project slug + deploymentRef.
 * Does NOT check whether the folder exists — call assertReleasePathExists for that.
 */
export async function resolveProjectReleasePath(input: {
  projectSlug:   string;
  deploymentRef: string;
}): Promise<
  | { ok: true;  releasePath: string; realReleasePath: string }
  | { ok: false; error: string }
> {
  const { projectSlug, deploymentRef } = input;

  const slugCheck = validateProjectSlug(projectSlug);
  if (!slugCheck.ok) return { ok: false, error: slugCheck.error };

  const refCheck = validateDeploymentRef(deploymentRef);
  if (!refCheck.ok) return { ok: false, error: refCheck.error };

  const slugRoot    = path.join(RELEASE_STORAGE, projectSlug);
  const releasePath = path.join(slugRoot, deploymentRef);

  // Confirm the path doesn't escape slugRoot (join-based traversal protection)
  if (!releasePath.startsWith(slugRoot + path.sep) && releasePath !== slugRoot) {
    return {
      ok:    false,
      error: `Release path would escape the project release directory.`,
    };
  }

  // Realpath check to block symlink escapes — only if the folder exists
  let realReleasePath = releasePath;
  try {
    realReleasePath = await fs.realpath(releasePath);
    const realSlugRoot = await fs.realpath(slugRoot);
    if (!realReleasePath.startsWith(realSlugRoot + path.sep) && realReleasePath !== realSlugRoot) {
      return {
        ok:    false,
        error: `Release path resolves outside the project release directory (symlink escape blocked).`,
      };
    }
  } catch {
    // Folder may not exist yet — realpath will throw; that's OK here.
    // assertReleasePathExists handles the existence check.
  }

  return { ok: true, releasePath, realReleasePath };
}

/**
 * Resolve the release path AND assert it exists on disk.
 */
export async function assertReleasePathExists(input: {
  projectSlug:   string;
  deploymentRef: string;
}): Promise<
  | { ok: true;  releasePath: string }
  | { ok: false; error: string }
> {
  const resolved = await resolveProjectReleasePath(input);
  if (!resolved.ok) return resolved;

  const { releasePath } = resolved;

  try {
    const stat = await fs.stat(releasePath);
    if (!stat.isDirectory()) {
      return {
        ok:    false,
        error: `Release path exists but is not a directory: ${input.deploymentRef}`,
      };
    }
  } catch {
    return {
      ok:    false,
      error: `Release folder not found for deployment ${input.deploymentRef}. The release may have been manually deleted.`,
    };
  }

  return { ok: true, releasePath };
}
