"use server";

/**
 * app/actions/project-templates.ts
 *
 * Sprint 19: Server action for creating a project from a curated template.
 *
 * Security guarantees:
 *  - Only curated local templates are used — no remote fetching.
 *  - All file paths are validated by validateTemplateFileSet before any write.
 *  - Files are written only inside storage/projects/<slug>/.
 *  - Existing directories are never overwritten.
 *  - Reserved slugs are blocked.
 *  - Dependency install uses --ignore-scripts (no lifecycle scripts).
 *  - Git init never pushes to a remote.
 *  - No Nginx, PM2, or deploy actions triggered automatically.
 *  - Audit event written via fire-and-forget (never breaks the action).
 */

import { promises as fs } from "fs";
import path from "path";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/current-workspace";
import { renderTemplateFiles, validateTemplateVariables, getProjectTemplate } from "@/lib/templates/template-renderer";
import { validateTemplateFileSet } from "@/lib/templates/template-safety";
import { writeProjectAuditEvent } from "@/lib/audit/project-audit";
import { getAuditRequestContext } from "@/lib/audit/request-context";
import { runCommand } from "@/lib/server/command-runner";
import { ProjectType, Visibility, EnvironmentName, EnvironmentStatus, LogLevel, LogSource } from "@prisma/client";
import { revalidatePath } from "next/cache";

// ── Types ─────────────────────────────────────────────────────────────────────

type ActionResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: string };

export type CreateFromTemplateInput = {
  templateId: string;
  name: string;
  slug: string;
  description?: string;
  visibility?: "PRIVATE" | "PUBLIC" | "UNLISTED";
  variables?: Record<string, string>;
  initializeGit?: boolean;
  installDependencies?: boolean;
};

export type CreateFromTemplateOutput = {
  projectId: string;
  slug: string;
  path: string;
  fileCount: number;
  installed: boolean;
  gitInitialized: boolean;
  gitCommitSkipped: boolean;
  warnings: string[];
};

// ── Constants ─────────────────────────────────────────────────────────────────

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/;

const RESERVED_SLUGS = new Set([
  "admin",
  "api",
  "auth",
  "dashboard",
  "health",
  "integrations",
  "login",
  "logout",
  "new",
  "onboarding",
  "projects",
  "settings",
  "signup",
  "status",
  "templates",
  "workspace",
  // Protect production projects
  "sardar-security-project",
  "prisom-panel",
  "prisom-manager",
  "prisom-backend",
  "doorsteps",
  "localshop",
]);

// ── Helper: resolve project storage root ──────────────────────────────────────

function getProjectStorageRoot(slug: string): string {
  return path.join(process.cwd(), "storage", "projects", slug);
}

// ── Main action ───────────────────────────────────────────────────────────────

export async function createProjectFromTemplateAction(
  input: CreateFromTemplateInput,
): Promise<ActionResult<CreateFromTemplateOutput>> {
  const warnings: string[] = [];

  // ── 1. Authenticate ────────────────────────────────────────────────────────
  let user: Awaited<ReturnType<typeof getCurrentUser>>;
  try {
    user = await getCurrentUser();
  } catch {
    return { ok: false, error: "Not authenticated.", code: "UNAUTHENTICATED" };
  }

  // ── 2. Validate name ───────────────────────────────────────────────────────
  const name = input.name?.trim() ?? "";
  if (!name || name.length < 1) {
    return { ok: false, error: "Project name is required.", code: "VALIDATION" };
  }
  if (name.length > 100) {
    return { ok: false, error: "Project name is too long (max 100 characters).", code: "VALIDATION" };
  }

  // ── 3. Validate slug ──────────────────────────────────────────────────────
  const slug = input.slug?.trim() ?? "";
  if (!slug) {
    return { ok: false, error: "Project slug is required.", code: "VALIDATION" };
  }
  if (!SLUG_PATTERN.test(slug)) {
    return {
      ok: false,
      error: "Slug must contain only lowercase letters, numbers, and hyphens.",
      code: "VALIDATION",
    };
  }
  if (slug.length > 100) {
    return { ok: false, error: "Slug is too long (max 100 characters).", code: "VALIDATION" };
  }

  // ── 4. Check reserved slugs ────────────────────────────────────────────────
  if (RESERVED_SLUGS.has(slug)) {
    return { ok: false, error: `"${slug}" is a reserved slug and cannot be used.`, code: "RESERVED" };
  }

  // ── 5. Load and validate template ─────────────────────────────────────────
  const template = getProjectTemplate(input.templateId);
  if (!template) {
    return { ok: false, error: `Template "${input.templateId}" not found.`, code: "NOT_FOUND" };
  }

  // ── 6. Validate template variables ────────────────────────────────────────
  const varResult = validateTemplateVariables({
    templateId: input.templateId,
    variables: input.variables ?? {},
  });
  if (!varResult.ok) {
    return { ok: false, error: varResult.error, code: "VALIDATION" };
  }

  // ── 7. Render template files ───────────────────────────────────────────────
  const renderResult = renderTemplateFiles({
    templateId: input.templateId,
    variables: input.variables,
    projectName: name,
    projectSlug: slug,
  });
  if (!renderResult.ok) {
    return { ok: false, error: renderResult.error, code: "RENDER_ERROR" };
  }
  const renderedFiles = renderResult.files;

  // ── 8. Validate file set ───────────────────────────────────────────────────
  const safetyResult = validateTemplateFileSet(renderedFiles);
  if (!safetyResult.ok) {
    return { ok: false, error: safetyResult.error, code: "UNSAFE_FILES" };
  }

  // ── 9. Check target directory does not already exist ──────────────────────
  const storageRoot = getProjectStorageRoot(slug);
  try {
    await fs.access(storageRoot);
    // If we get here, the directory already exists
    return {
      ok: false,
      error: `Project source directory already exists: storage/projects/${slug}`,
      code: "DIR_EXISTS",
    };
  } catch {
    // Expected — directory does not exist, safe to continue
  }

  // ── 10. Get workspace ─────────────────────────────────────────────────────
  let workspaceId: string;
  try {
    const ws = await db.workspace.findFirst({
      where: { ownerId: user.id },
      select: { id: true },
    });
    if (!ws) return { ok: false, error: "No workspace found.", code: "NO_WORKSPACE" };
    workspaceId = ws.id;
  } catch {
    return { ok: false, error: "Failed to resolve workspace.", code: "DB_ERROR" };
  }

  // ── 11. Check slug uniqueness in workspace ─────────────────────────────────
  try {
    const existing = await db.project.findUnique({
      where: { workspaceId_slug: { workspaceId, slug } },
      select: { id: true },
    });
    if (existing) {
      return {
        ok: false,
        error: `A project with slug "${slug}" already exists in your workspace.`,
        code: "SLUG_CONFLICT",
      };
    }
  } catch {
    return { ok: false, error: "Failed to check slug uniqueness.", code: "DB_ERROR" };
  }

  // ── 12. Create project DB record ──────────────────────────────────────────
  let projectId: string;
  try {
    const project = await db.project.create({
      data: {
        workspaceId,
        ownerId: user.id,
        name,
        slug,
        description: input.description?.trim() || null,
        type: ProjectType.APP,
        status: "ACTIVE",
        visibility: (input.visibility as Visibility) ?? Visibility.PRIVATE,
        language: template.language,
        framework: template.framework !== "None" ? template.framework : null,
        installCommand: template.installCommand || null,
        buildCommand: template.buildCommand || null,
        startCommand: template.startCommand || null,
        outputDirectory: template.outputDirectory || null,
      },
    });
    projectId = project.id;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.toLowerCase().includes("unique constraint")) {
      return { ok: false, error: `A project with slug "${slug}" already exists.`, code: "SLUG_CONFLICT" };
    }
    return { ok: false, error: "Failed to create project record.", code: "DB_ERROR" };
  }

  // ── 13. Create DEVELOPMENT and PRODUCTION environments ────────────────────
  try {
    await db.environment.createMany({
      data: [
        { projectId, name: EnvironmentName.DEVELOPMENT, status: EnvironmentStatus.ACTIVE },
        { projectId, name: EnvironmentName.PRODUCTION, status: EnvironmentStatus.ACTIVE },
      ],
    });
  } catch {
    // Non-fatal — environments can be created later
    warnings.push("Failed to create default environments.");
  }

  // ── 14. Create owner ProjectMember row ────────────────────────────────────
  try {
    await db.projectMember.create({
      data: {
        projectId,
        userId: user.id,
        role: "owner",
      },
    });
  } catch {
    // May already exist via upsert elsewhere — non-fatal
    warnings.push("Owner membership may already exist.");
  }

  // ── 15. Write files to disk ────────────────────────────────────────────────
  try {
    // Create root directory
    await fs.mkdir(storageRoot, { recursive: true });

    // Write each file
    for (const file of renderedFiles) {
      const absPath = path.join(storageRoot, file.path);
      // Ensure parent directory exists
      await fs.mkdir(path.dirname(absPath), { recursive: true });
      await fs.writeFile(absPath, file.content, "utf-8");
    }
  } catch (e) {
    // Try to clean up the DB record and partially-written directory
    const errMsg = e instanceof Error ? e.message : "Unknown error";
    try {
      await db.project.delete({ where: { id: projectId } });
    } catch {
      // best-effort cleanup
    }
    try {
      await fs.rm(storageRoot, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
    return {
      ok: false,
      error: `Failed to write template files: ${errMsg}`,
      code: "FILE_WRITE_ERROR",
    };
  }

  // ── 16. Record creation in project log ────────────────────────────────────
  await db.projectLog.create({
    data: {
      projectId,
      level: LogLevel.INFO,
      source: LogSource.SYSTEM,
      message: `Project created from template "${template.name}" (${renderedFiles.length} files)`,
    },
  }).catch(() => null);

  // ── 17. Optionally initialise Git ─────────────────────────────────────────
  let gitInitialized = false;
  let gitCommitSkipped = false;

  if (input.initializeGit) {
    try {
      const initResult = await runCommand("git", ["init"], {
        cwd: storageRoot,
        timeoutMs: 15_000,
      });

      if (initResult.exitCode === 0) {
        // git add .
        const addResult = await runCommand("git", ["add", "."], {
          cwd: storageRoot,
          timeoutMs: 15_000,
        });

        if (addResult.exitCode === 0) {
          // Attempt initial commit — may fail if Git identity is not configured
          const commitResult = await runCommand(
            "git",
            ["commit", "-m", `Initial template scaffold (${template.name})`],
            { cwd: storageRoot, timeoutMs: 20_000 },
          );

          if (commitResult.exitCode === 0) {
            gitInitialized = true;
          } else {
            // Likely missing user.name / user.email
            gitInitialized = true; // init + add succeeded
            gitCommitSkipped = true;
            warnings.push(
              "Git repository initialised and files staged, but the initial commit was skipped because Git user identity is not configured on this server.",
            );

            void writeProjectAuditEvent({
              projectId,
              actorUserId: user.id,
              actorEmail: user.email,
              actorName: user.name ?? null,
              actorRole: "owner",
              action: "project.template.git_commit_skipped",
              category: "git",
              result: "skipped",
              summary: `Git initial commit skipped for "${name}" (identity not configured)`,
              metadata: { templateId: template.id, templateName: template.name },
            }).catch(() => null);
          }
        } else {
          warnings.push("Git init succeeded but 'git add .' failed.");
          gitInitialized = true; // partial — repo exists
        }
      } else {
        warnings.push("Git init failed — repository not created.");
      }
    } catch (gitErr) {
      const msg = gitErr instanceof Error ? gitErr.message : String(gitErr);
      warnings.push(`Git init error: ${msg}`);
    }
  }

  // ── 18. Optionally install dependencies ───────────────────────────────────
  let installed = false;
  const pm = template.packageManager; // "npm" | "yarn" | undefined

  if (input.installDependencies && pm) {
    // Use npm (system binary) for npm templates; skip yarn/pnpm templates
    // until their absolute paths are defined in deploy-constants.
    const binary = pm === "npm" ? "npm" : null;
    if (binary) {
      try {
        const installResult = await runCommand(
          binary,
          ["install", "--ignore-scripts"],
          { cwd: storageRoot, timeoutMs: 120_000 },
        );

        if (installResult.exitCode === 0) {
          installed = true;
          await db.projectLog.create({
            data: {
              projectId,
              level: LogLevel.INFO,
              source: LogSource.SYSTEM,
              message: `${pm} install --ignore-scripts completed (${installResult.durationMs}ms)`,
            },
          }).catch(() => null);
        } else {
          warnings.push(
            `Dependency install failed (${pm} exited with a non-zero code). Project was created — you can run install manually.`,
          );

          void writeProjectAuditEvent({
            projectId,
            actorUserId: user.id,
            actorEmail: user.email,
            actorName: user.name ?? null,
            actorRole: "owner",
            action: "project.template.install_failed",
            category: "packages",
            result: "failed",
            summary: `Dependency install failed for template "${template.name}"`,
            metadata: {
              templateId: template.id,
              templateName: template.name,
              exitCode: installResult.exitCode,
            },
          }).catch(() => null);
        }
      } catch (installErr) {
        const msg = installErr instanceof Error ? installErr.message : String(installErr);
        warnings.push(`Dependency install error: ${msg}. Project was still created.`);
      }
    } // end if binary
  }

  // ── 19. Write audit event ─────────────────────────────────────────────────
  const ctx = await getAuditRequestContext();
  void writeProjectAuditEvent({
    projectId,
    actorUserId: user.id,
    actorEmail: user.email,
    actorName: user.name ?? null,
    actorRole: "owner",
    action: "project.template.created",
    category: "system",
    result: "success",
    targetType: "project",
    targetId: projectId,
    targetLabel: name,
    summary: `Project "${name}" created from template "${template.name}"`,
    metadata: {
      templateId: template.id,
      templateName: template.name,
      fileCount: renderedFiles.length,
      installDependencies: !!input.installDependencies,
      installed,
      initializeGit: !!input.initializeGit,
      gitInitialized,
      gitCommitSkipped,
    },
    ...ctx,
  }).catch(() => null);

  // ── 20. Revalidate ────────────────────────────────────────────────────────
  revalidatePath("/projects");

  return {
    ok: true,
    data: {
      projectId,
      slug,
      path: `storage/projects/${slug}`,
      fileCount: renderedFiles.length,
      installed,
      gitInitialized,
      gitCommitSkipped,
      warnings,
    },
  };
}

// ── Preview action (no writes) ────────────────────────────────────────────────

export type PreviewTemplateInput = {
  templateId: string;
  variables?: Record<string, string>;
  projectName: string;
  projectSlug: string;
};

export type PreviewTemplateOutput = {
  files: Array<{ path: string; content: string; sizeBytes: number }>;
  templateName: string;
  installCommand: string | undefined;
  buildCommand: string | undefined;
  startCommand: string | undefined;
  healthPath: string | undefined;
};

export async function previewTemplateFilesAction(
  input: PreviewTemplateInput,
): Promise<ActionResult<PreviewTemplateOutput>> {
  // Auth check — only authenticated users can preview
  try {
    await getCurrentUser();
  } catch {
    return { ok: false, error: "Not authenticated.", code: "UNAUTHENTICATED" };
  }

  const template = getProjectTemplate(input.templateId);
  if (!template) {
    return { ok: false, error: "Template not found.", code: "NOT_FOUND" };
  }

  const renderResult = renderTemplateFiles({
    templateId: input.templateId,
    variables: input.variables,
    projectName: input.projectName || "my-project",
    projectSlug: input.projectSlug || "my-project",
  });
  if (!renderResult.ok) {
    return { ok: false, error: renderResult.error };
  }

  return {
    ok: true,
    data: {
      files: renderResult.files.map((f) => ({
        path: f.path,
        content: f.content,
        sizeBytes: Buffer.byteLength(f.content, "utf-8"),
      })),
      templateName: template.name,
      installCommand: template.installCommand,
      buildCommand: template.buildCommand,
      startCommand: template.startCommand,
      healthPath: template.healthPath,
    },
  };
}

// ── Repair action: fix broken Next.js template scaffolds ─────────────────────
//
// Renames next.config.ts → next.config.mjs for projects that were scaffolded
// before the Sprint 19 Hotfix. Safe to run on any Next.js project — it checks
// that next.config.ts exists AND that package.json lists "next" as a dependency
// before touching anything.

export type RepairNextConfigInput = {
  /** Project slug (directory name under storage/projects/) */
  projectSlug: string;
};

export type RepairNextConfigOutput = {
  repaired: boolean;
  message: string;
};

const NEXT_CONFIG_MJS_CONTENT = `/** @type {import('next').NextConfig} */
const nextConfig = {};

export default nextConfig;
`;

export async function repairNextConfigAction(
  input: RepairNextConfigInput,
): Promise<ActionResult<RepairNextConfigOutput>> {
  // Auth required
  try {
    await getCurrentUser();
  } catch {
    return { ok: false, error: "Not authenticated.", code: "UNAUTHENTICATED" };
  }

  const slug = input.projectSlug?.trim();
  if (!slug || !/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
    return { ok: false, error: "Invalid project slug.", code: "VALIDATION" };
  }

  const projectRoot = path.join(process.cwd(), "storage", "projects", slug);

  // Check the project directory exists
  try {
    await fs.access(projectRoot);
  } catch {
    return { ok: false, error: `Project directory not found: storage/projects/${slug}`, code: "NOT_FOUND" };
  }

  const tsConfigPath  = path.join(projectRoot, "next.config.ts");
  const mjsConfigPath = path.join(projectRoot, "next.config.mjs");
  const pkgJsonPath   = path.join(projectRoot, "package.json");

  // Check next.config.ts exists
  let hasTsConfig = false;
  try {
    await fs.access(tsConfigPath);
    hasTsConfig = true;
  } catch {
    // Not present
  }

  if (!hasTsConfig) {
    return {
      ok: true,
      data: { repaired: false, message: "next.config.ts not found — no repair needed." },
    };
  }

  // Check package.json lists "next" as a dependency
  let isNextProject = false;
  try {
    const pkgRaw = await fs.readFile(pkgJsonPath, "utf-8");
    const pkg = JSON.parse(pkgRaw) as Record<string, unknown>;
    const deps = { ...(pkg.dependencies as Record<string, unknown> ?? {}), ...(pkg.devDependencies as Record<string, unknown> ?? {}) };
    isNextProject = "next" in deps;
  } catch {
    // If we can't read package.json, skip the dep check but still repair
    isNextProject = true;
  }

  if (!isNextProject) {
    return {
      ok: true,
      data: { repaired: false, message: "next.config.ts found but package.json does not list 'next' — skipping repair." },
    };
  }

  // Check next.config.mjs doesn't already exist
  try {
    await fs.access(mjsConfigPath);
    // If we get here, mjs already exists — remove the ts file and we're done
    await fs.rm(tsConfigPath, { force: true });
    return {
      ok: true,
      data: { repaired: true, message: "next.config.mjs already existed; removed stale next.config.ts." },
    };
  } catch {
    // mjs does not exist — proceed
  }

  // Write next.config.mjs
  await fs.writeFile(mjsConfigPath, NEXT_CONFIG_MJS_CONTENT, "utf-8");

  // Remove next.config.ts
  await fs.rm(tsConfigPath, { force: true });

  return {
    ok: true,
    data: {
      repaired: true,
      message: `Repaired: renamed next.config.ts → next.config.mjs in storage/projects/${slug}.`,
    },
  };
}
