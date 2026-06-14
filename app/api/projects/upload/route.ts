/**
 * POST /api/projects/upload
 *
 * Accepts a multipart/form-data request with:
 *   name       string  (required)
 *   slug       string  (required, a-z0-9-)
 *   description string (optional)
 *   type       string  (ProjectType enum, default APP)
 *   file       File    (.zip, max 50 MB)
 *
 * Processing:
 *   1. Validates all fields.
 *   2. Saves the zip to storage/uploads/<slug>/<timestamp>.zip
 *   3. Extracts it to storage/projects/<slug>/ with zip-slip protection:
 *        - Rejects entries with ../ in path
 *        - Rejects absolute paths
 *        - Rejects backslashes (Windows path tricks)
 *        - Skips __MACOSX, .DS_Store, node_modules, .next, dist, build, .git
 *        - Strips a single top-level directory prefix if present (common in GitHub archives)
 *   4. Creates a Project DB record (status DRAFT) + DEVELOPMENT + PRODUCTION environments.
 *   5. Writes a ProjectLog entry.
 *   6. Returns { projectId: string } on success.
 *
 * NEVER executes uploaded code.
 * NEVER installs dependencies.
 */

import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import AdmZip from "adm-zip";
import { db } from "@/lib/db";
import { getCurrentWorkspaceId, getCurrentUser } from "@/lib/current-workspace";
import {
  ProjectStatus,
  ProjectType,
  Visibility,
  EnvironmentName,
  EnvironmentStatus,
  LogLevel,
  LogSource,
} from "@prisma/client";

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB
const SLUG_RE = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/;
const STORAGE_ROOT = path.join(process.cwd(), "storage");

// Directories to skip when extracting
const SKIP_DIRS = new Set([
  "__macosx",
  "node_modules",
  ".next",
  ".git",
  "dist",
  "build",
  ".nuxt",
  ".output",
]);

// ── Zip-slip guard ────────────────────────────────────────────────────────────

/**
 * Returns true if the entry path is safe (no zip-slip, no absolute paths).
 */
function isSafeEntryPath(entryPath: string): boolean {
  // Reject backslashes (Windows path separator tricks)
  if (entryPath.includes("\\")) return false;
  // Reject absolute paths
  if (path.isAbsolute(entryPath)) return false;
  // Reject ../ traversal (also catches encoded variants after normalisation)
  const normalised = path.normalize(entryPath);
  if (normalised.startsWith("..")) return false;
  if (normalised.includes("/../")) return false;
  return true;
}

/**
 * Returns true if the entry should be skipped (MACOSX metadata, hidden junk, large build dirs).
 */
function shouldSkipEntry(entryPath: string): boolean {
  const lower = entryPath.toLowerCase();
  const parts = lower.split("/");
  // Skip .DS_Store, Thumbs.db
  const basename = parts[parts.length - 1] ?? "";
  if (basename === ".ds_store" || basename === "thumbs.db") return true;
  // Skip any segment that matches known junk dirs
  for (const part of parts) {
    if (SKIP_DIRS.has(part)) return true;
  }
  return false;
}

/**
 * Detect a common single top-level directory prefix in a zip archive
 * (e.g. GitHub archives extract as "repo-main/...").
 * If ALL entries start with the same prefix directory, strip it.
 */
function detectStripPrefix(entries: string[]): string {
  if (entries.length === 0) return "";
  const fileEntries = entries.filter((e) => !e.endsWith("/"));
  if (fileEntries.length === 0) return "";

  const firstDir = fileEntries[0].split("/")[0];
  if (!firstDir) return "";

  const allSamePrefix = fileEntries.every((e) => e.startsWith(`${firstDir}/`));
  return allSamePrefix ? `${firstDir}/` : "";
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const contentType = req.headers.get("content-type") ?? "";
    if (!contentType.includes("multipart/form-data")) {
      return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
    }

    const formData = await req.formData();

    // ── Validate text fields ──────────────────────────────────────────────────

    const name = (formData.get("name") as string | null)?.trim() ?? "";
    const slug = (formData.get("slug") as string | null)?.trim() ?? "";
    const description = (formData.get("description") as string | null)?.trim() ?? "";
    const typeRaw = (formData.get("type") as string | null)?.trim().toUpperCase() ?? "APP";

    if (!name || name.length > 100)
      return NextResponse.json({ error: "Project name is required (max 100 chars)" }, { status: 400 });
    if (!slug || !SLUG_RE.test(slug) || slug.length > 100)
      return NextResponse.json({
        error: "Invalid slug — lowercase letters, numbers, and hyphens only",
      }, { status: 400 });

    const validTypes = Object.values(ProjectType) as string[];
    const type: ProjectType = validTypes.includes(typeRaw)
      ? (typeRaw as ProjectType)
      : ProjectType.APP;

    // ── Validate file ─────────────────────────────────────────────────────────

    const file = formData.get("file") as File | null;
    if (!file || file.size === 0)
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    if (file.size > MAX_SIZE_BYTES)
      return NextResponse.json({ error: "File exceeds 50 MB limit" }, { status: 400 });

    // Accept only .zip by name and content-type
    const originalName = file.name.toLowerCase();
    if (!originalName.endsWith(".zip"))
      return NextResponse.json({ error: "Only .zip files are accepted" }, { status: 400 });
    if (
      file.type !== "" &&
      !file.type.includes("zip") &&
      !file.type.includes("octet-stream")
    ) {
      return NextResponse.json({ error: "File must be a ZIP archive" }, { status: 400 });
    }

    // ── Read file bytes ───────────────────────────────────────────────────────

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Quick ZIP magic number check (PK\x03\x04)
    if (
      buffer.length < 4 ||
      buffer[0] !== 0x50 ||
      buffer[1] !== 0x4b ||
      buffer[2] !== 0x03 ||
      buffer[3] !== 0x04
    ) {
      return NextResponse.json({ error: "File is not a valid ZIP archive" }, { status: 400 });
    }

    // ── Prepare storage directories ───────────────────────────────────────────

    const timestamp = Date.now();
    const uploadsDir = path.join(STORAGE_ROOT, "uploads", slug);
    const extractDir = path.join(STORAGE_ROOT, "projects", slug);
    const zipPath = path.join(uploadsDir, `${timestamp}.zip`);

    await fs.mkdir(uploadsDir, { recursive: true });
    await fs.mkdir(extractDir, { recursive: true });

    // Save the zip
    await fs.writeFile(zipPath, buffer);

    // ── Extract with zip-slip protection ──────────────────────────────────────

    let zip: AdmZip;
    try {
      zip = new AdmZip(buffer);
    } catch {
      return NextResponse.json({ error: "Could not parse ZIP file" }, { status: 400 });
    }

    const allEntries = zip.getEntries();
    const allPaths = allEntries.map((e) => e.entryName);
    const stripPrefix = detectStripPrefix(allPaths);

    let extractedCount = 0;

    for (const entry of allEntries) {
      const raw = entry.entryName;

      // Strip common top-level prefix
      const relative = stripPrefix ? raw.slice(stripPrefix.length) : raw;
      if (!relative) continue; // was the prefix directory itself

      // Safety checks
      if (!isSafeEntryPath(relative)) continue;
      if (shouldSkipEntry(relative)) continue;

      const target = path.join(extractDir, relative);

      // Verify the resolved target is still under extractDir (belt + suspenders)
      const resolved = path.resolve(target);
      if (!resolved.startsWith(path.resolve(extractDir) + path.sep) &&
          resolved !== path.resolve(extractDir)) {
        continue; // Path escapes target dir — skip silently
      }

      if (entry.isDirectory) {
        await fs.mkdir(target, { recursive: true });
      } else {
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, entry.getData());
        extractedCount++;
      }
    }

    // ── Create DB records ─────────────────────────────────────────────────────

    const [workspaceId, user] = await Promise.all([
      getCurrentWorkspaceId(),
      getCurrentUser(),
    ]);

    // Slug uniqueness check
    const existing = await db.project.findUnique({
      where: { workspaceId_slug: { workspaceId, slug } },
      select: { id: true },
    });
    if (existing) {
      // Clean up files we just wrote
      await fs.rm(extractDir, { recursive: true, force: true });
      await fs.rm(zipPath, { force: true });
      return NextResponse.json(
        { error: `A project with slug "${slug}" already exists in your workspace.` },
        { status: 409 }
      );
    }

    const project = await db.project.create({
      data: {
        workspaceId,
        ownerId: user.id,
        name,
        slug,
        description: description || null,
        type,
        status: ProjectStatus.DRAFT,
        visibility: Visibility.PRIVATE,
      },
    });

    await db.environment.createMany({
      data: [
        { projectId: project.id, name: EnvironmentName.DEVELOPMENT, status: EnvironmentStatus.ACTIVE },
        { projectId: project.id, name: EnvironmentName.PRODUCTION, status: EnvironmentStatus.ACTIVE },
      ],
    });

    await db.projectLog.create({
      data: {
        projectId: project.id,
        level: LogLevel.INFO,
        source: LogSource.SYSTEM,
        message: `Project created from uploaded zip (${extractedCount} files extracted)`,
        metadata: {
          zipPath,
          extractDir,
          extractedFiles: extractedCount,
          originalFilename: file.name,
        } as object,
      },
    });

    return NextResponse.json({ projectId: project.id }, { status: 201 });
  } catch (err) {
    console.error("[upload] Unexpected error:", err);
    return NextResponse.json(
      { error: "An unexpected error occurred. Please try again." },
      { status: 500 }
    );
  }
}
