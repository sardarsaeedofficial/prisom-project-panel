"use server";

/**
 * Server actions for the interactive file browser.
 *
 * All paths are resolved relative to storage/projects/<slug>/ and validated
 * to prevent path traversal attacks. Only storage-based projects (no GitHub
 * repo linked) are managed here.
 */

import { promises as fs } from "fs";
import path from "path";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";

// ── Path safety ───────────────────────────────────────────────────────────────

/** Returns the absolute path only if it stays within the project's storage dir. */
function safeResolvePath(slug: string, relativePath: string): string | null {
  if (!relativePath || relativePath.includes("\0")) return null;
  const root = path.resolve(process.cwd(), "storage", "projects", slug);
  const target = path.resolve(root, relativePath);
  // Must be strictly inside root (not equal to root itself)
  if (!target.startsWith(root + path.sep)) return null;
  return target;
}

async function getProjectSlug(projectId: string): Promise<string | null> {
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { slug: true },
  });
  return project?.slug ?? null;
}

// ── Actions ───────────────────────────────────────────────────────────────────

export async function createFolderAction(
  projectId: string,
  relativePath: string
): Promise<{ ok: boolean; error?: string }> {
  const slug = await getProjectSlug(projectId);
  if (!slug) return { ok: false, error: "Project not found." };

  const target = safeResolvePath(slug, relativePath);
  if (!target) return { ok: false, error: "Invalid path." };

  try {
    await fs.mkdir(target, { recursive: true });
    revalidatePath(`/projects/${projectId}/files`);
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Failed to create folder.",
    };
  }
}

export async function createTextFileAction(
  projectId: string,
  relativePath: string,
  content: string = ""
): Promise<{ ok: boolean; error?: string }> {
  if (content.length > 200_000) {
    return { ok: false, error: "Content too large (max 200 KB)." };
  }

  const slug = await getProjectSlug(projectId);
  if (!slug) return { ok: false, error: "Project not found." };

  const target = safeResolvePath(slug, relativePath);
  if (!target) return { ok: false, error: "Invalid path." };

  try {
    // Ensure parent directory exists
    await fs.mkdir(path.dirname(target), { recursive: true });

    // Refuse to overwrite an existing file
    try {
      await fs.access(target);
      return { ok: false, error: "A file already exists at that path." };
    } catch {
      // File doesn't exist — good to create
    }

    await fs.writeFile(target, content, "utf8");
    revalidatePath(`/projects/${projectId}/files`);
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Failed to create file.",
    };
  }
}

export async function readTextFileAction(
  projectId: string,
  relativePath: string
): Promise<{ ok: boolean; content?: string; error?: string }> {
  const slug = await getProjectSlug(projectId);
  if (!slug) return { ok: false, error: "Project not found." };

  const target = safeResolvePath(slug, relativePath);
  if (!target) return { ok: false, error: "Invalid path." };

  try {
    const stat = await fs.stat(target);
    if (stat.isDirectory()) {
      return { ok: false, error: "Cannot read a directory as text." };
    }
    if (stat.size > 200_000) {
      return { ok: false, error: "File too large to edit inline (max 200 KB)." };
    }
    const content = await fs.readFile(target, "utf8");
    return { ok: true, content };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Failed to read file.",
    };
  }
}

export async function writeTextFileAction(
  projectId: string,
  relativePath: string,
  content: string
): Promise<{ ok: boolean; error?: string }> {
  if (content.length > 200_000) {
    return { ok: false, error: "Content too large (max 200 KB)." };
  }

  const slug = await getProjectSlug(projectId);
  if (!slug) return { ok: false, error: "Project not found." };

  const target = safeResolvePath(slug, relativePath);
  if (!target) return { ok: false, error: "Invalid path." };

  try {
    await fs.writeFile(target, content, "utf8");
    revalidatePath(`/projects/${projectId}/files`);
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Failed to save file.",
    };
  }
}

export async function deleteFileAction(
  projectId: string,
  relativePath: string
): Promise<{ ok: boolean; error?: string }> {
  const slug = await getProjectSlug(projectId);
  if (!slug) return { ok: false, error: "Project not found." };

  const target = safeResolvePath(slug, relativePath);
  if (!target) return { ok: false, error: "Invalid path." };

  try {
    const stat = await fs.stat(target);
    if (stat.isDirectory()) {
      await fs.rm(target, { recursive: true, force: true });
    } else {
      await fs.unlink(target);
    }
    revalidatePath(`/projects/${projectId}/files`);
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Failed to delete.",
    };
  }
}

export async function renameFileAction(
  projectId: string,
  oldRelativePath: string,
  newRelativePath: string
): Promise<{ ok: boolean; error?: string }> {
  const slug = await getProjectSlug(projectId);
  if (!slug) return { ok: false, error: "Project not found." };

  const oldTarget = safeResolvePath(slug, oldRelativePath);
  const newTarget = safeResolvePath(slug, newRelativePath);
  if (!oldTarget || !newTarget) return { ok: false, error: "Invalid path." };
  if (oldTarget === newTarget) return { ok: true }; // no-op

  try {
    // Check destination doesn't already exist
    try {
      await fs.access(newTarget);
      return { ok: false, error: "A file or folder with that name already exists." };
    } catch {
      // Destination doesn't exist — good
    }

    await fs.rename(oldTarget, newTarget);
    revalidatePath(`/projects/${projectId}/files`);
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Failed to rename.",
    };
  }
}
