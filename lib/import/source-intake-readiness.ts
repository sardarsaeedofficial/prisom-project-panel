/**
 * lib/import/source-intake-readiness.ts
 *
 * Sprint 57: Generate a SourceIntakeReport for a project source directory.
 *
 * Safety rules:
 *  - sourcePath MUST be inside STORAGE_ROOT — validated before any FS reads.
 *  - Never reads .env files (only .env.example equivalents).
 *  - Never executes code.
 *  - Never runs install/build.
 */

import path           from "path";
import { promises as fs } from "fs";
import { detectSourceStructure } from "./source-structure-detector";
import type {
  SourceIntakeReport,
  SourceIntakeCheck,
  SourceIntakeStatus,
  SourceIntakeSourceType,
} from "./source-intake-types";

const STORAGE_ROOT = path.join(process.cwd(), "storage");

// ── Helpers ───────────────────────────────────────────────────────────────────

function pass(
  id:       string,
  label:    string,
  category: SourceIntakeCheck["category"],
  message:  string,
  evidence?: string[],
  required = true,
  command?:  string,
): SourceIntakeCheck {
  return { id, label, category, status: "pass", required, message, evidence, command };
}

function warn(
  id:       string,
  label:    string,
  category: SourceIntakeCheck["category"],
  message:  string,
  evidence?: string[],
  required = false,
  command?:  string,
): SourceIntakeCheck {
  return { id, label, category, status: "warning", required, message, evidence, command };
}

function fail(
  id:       string,
  label:    string,
  category: SourceIntakeCheck["category"],
  message:  string,
  evidence?: string[],
  required = true,
  command?:  string,
): SourceIntakeCheck {
  return { id, label, category, status: "fail", required, message, evidence, command };
}

function manual(
  id:       string,
  label:    string,
  category: SourceIntakeCheck["category"],
  message:  string,
  command?:  string,
): SourceIntakeCheck {
  return { id, label, category, status: "manual", required: false, message, command };
}

async function pathExists(p: string): Promise<boolean> {
  try { await fs.access(p); return true; } catch { return false; }
}

// ── Report generator ──────────────────────────────────────────────────────────

export async function generateSourceIntakeReport(input: {
  projectId?:  string;
  sourcePath:  string;
  sourceType?: SourceIntakeSourceType;
}): Promise<SourceIntakeReport> {
  const { projectId, sourcePath, sourceType = "unknown" } = input;
  const generatedAt = new Date().toISOString();

  const checks: SourceIntakeCheck[] = [];
  const blockers:   string[] = [];
  const warnings:   string[] = [];
  const nextSteps:  string[] = [];

  // ── Security: path containment check ──────────────────────────────────────
  const resolvedSource = path.resolve(sourcePath);
  const resolvedRoot   = path.resolve(STORAGE_ROOT);

  if (!resolvedSource.startsWith(resolvedRoot + path.sep) && resolvedSource !== resolvedRoot) {
    const msg = `Source path is outside the safe storage root. Importing from arbitrary paths is not allowed.`;
    checks.push(fail("security_path", "Path containment", "security", msg));
    blockers.push(msg);
    return {
      projectId, generatedAt, sourceType,
      status: "blocked",
      checks, detected: {}, blockers, warnings, nextSteps,
    };
  }

  checks.push(pass("security_path", "Path containment", "security", `Source is within storage root.`));

  // ── Source: path exists ────────────────────────────────────────────────────
  const sourceExists = await pathExists(resolvedSource);
  if (!sourceExists) {
    const msg = `Source directory does not exist: ${resolvedSource}`;
    checks.push(fail("source_exists", "Source directory", "source", msg));
    blockers.push("Source directory not found. Upload a ZIP or clone a repository first.");
    return {
      projectId, generatedAt, sourceType,
      status: "blocked",
      checks, detected: {}, blockers, warnings, nextSteps,
    };
  }
  checks.push(pass("source_exists", "Source directory", "source", "Source directory exists."));

  // ── Source: not empty ──────────────────────────────────────────────────────
  let dirEntries: string[] = [];
  try {
    dirEntries = await fs.readdir(resolvedSource);
  } catch {
    dirEntries = [];
  }

  if (dirEntries.length === 0) {
    const msg = "Source directory is empty. No files to analyze.";
    checks.push(fail("source_empty", "Source not empty", "source", msg));
    blockers.push(msg);
    return {
      projectId, generatedAt, sourceType,
      status: "blocked",
      checks, detected: {}, blockers, warnings, nextSteps,
    };
  }
  checks.push(pass("source_not_empty", "Source not empty", "source", `${dirEntries.length} entries found at root.`));

  // ── Run detector ──────────────────────────────────────────────────────────
  const detected = await detectSourceStructure(resolvedSource);

  // ── Source: package.json ───────────────────────────────────────────────────
  if (!detected.hasPackageJson) {
    checks.push(warn(
      "pkg_json",
      "package.json",
      "source",
      "No package.json found at source root. This may not be a Node.js project, or it may be inside a subdirectory.",
      undefined, false,
    ));
    warnings.push("No root package.json detected. Confirm source structure.");
    nextSteps.push("Check that the correct top-level directory was uploaded (not a parent/wrapper folder).");
  } else {
    checks.push(pass("pkg_json", "package.json", "source", "Root package.json found."));
  }

  // ── Package manager ────────────────────────────────────────────────────────
  if (detected.lockfiles.length === 0) {
    checks.push(warn(
      "pm_lockfile", "Lockfile", "package_manager",
      "No lockfile detected (pnpm-lock.yaml, package-lock.json, yarn.lock, bun.lockb). Installs may not be reproducible.",
      undefined, false,
    ));
    warnings.push("No lockfile found — reproducible installs not guaranteed.");
    nextSteps.push("Commit a lockfile (pnpm-lock.yaml recommended for Prisom VPS projects).");
  } else if (detected.lockfiles.length > 1) {
    checks.push(warn(
      "pm_multi_lock", "Multiple lockfiles", "package_manager",
      `Multiple lockfiles detected: ${detected.lockfiles.join(", ")}. Remove all but one to avoid install conflicts.`,
      detected.lockfiles, false,
    ));
    warnings.push(`Multiple lockfiles: ${detected.lockfiles.join(", ")}.`);
  } else {
    checks.push(pass(
      "pm_lockfile", "Lockfile", "package_manager",
      `${detected.lockfiles[0]} detected → package manager: ${detected.packageManager}.`,
      detected.lockfiles,
    ));
  }

  if (detected.packageManager !== "unknown") {
    checks.push(pass(
      "pm_detected", "Package manager", "package_manager",
      `Package manager detected: ${detected.packageManager}.`,
    ));
  }

  // ── Monorepo / workspace ───────────────────────────────────────────────────
  if (detected.monorepo) {
    checks.push(pass(
      "monorepo_ws", "Workspace file", "monorepo",
      `Workspace file found: ${detected.workspaceFile}. Monorepo structure detected.`,
      [detected.workspaceFile!],
    ));
    checks.push(pass(
      "monorepo_pkgs", "Package count", "monorepo",
      `${detected.packageJsonCount} package.json files found across workspace.`,
      detected.packageJsonPaths.slice(0, 8),
    ));
    nextSteps.push("Review workspace packages and configure per-service PM2 processes.");
  } else if (detected.packageJsonCount > 1) {
    checks.push(warn(
      "mono_no_ws", "Multiple packages without workspace", "monorepo",
      `${detected.packageJsonCount} package.json files found but no workspace file. Consider adding pnpm-workspace.yaml.`,
      detected.packageJsonPaths.slice(0, 5), false,
    ));
  }

  // ── Services ───────────────────────────────────────────────────────────────
  if (detected.services.length === 0) {
    checks.push(warn(
      "services_none", "Services", "services",
      "No distinct services detected. Source may be a single-service app.",
      undefined, false,
    ));
    warnings.push("No distinct services detected — review service layout before deployment.");
  } else {
    const apiServices    = detected.services.filter((s) => s.kind === "api" || s.kind === "fullstack");
    const staticServices = detected.services.filter((s) => s.kind === "static");

    if (apiServices.length > 0) {
      checks.push(pass(
        "services_api", "API service", "services",
        `API service(s) detected: ${apiServices.map((s) => s.name).join(", ")}.`,
        apiServices.map((s) => s.root),
      ));
      nextSteps.push(`Configure PM2 process for API service: ${apiServices[0].root}.`);
    }
    if (staticServices.length > 0) {
      checks.push(pass(
        "services_static", "Static frontend", "services",
        `Static service(s) detected: ${staticServices.map((s) => s.name).join(", ")}.`,
        staticServices.map((s) => s.root),
      ));
      nextSteps.push(`Set build output path for static service: ${staticServices[0].root}.`);
    }
    if (apiServices.length === 0 && staticServices.length === 0) {
      checks.push(warn(
        "services_type", "Service classification", "services",
        `${detected.services.length} service(s) detected but types unclear. Review manually.`,
        detected.services.map((s) => s.root), false,
      ));
    }
  }

  // ── Database ───────────────────────────────────────────────────────────────
  if (!detected.database) {
    checks.push(manual(
      "db_tooling", "Database tooling", "database",
      "No database tooling detected (Drizzle, Prisma, Knex, Sequelize). Review if database is required.",
    ));
  } else {
    const { tool, provider } = detected.database;
    checks.push(pass(
      "db_tooling", "Database tooling", "database",
      `${tool} detected with ${provider} provider.`,
      [`tool: ${tool}`, `provider: ${provider}`],
    ));

    const migCmd = tool === "drizzle" ? "pnpm drizzle-kit push" : tool === "prisma" ? "pnpm prisma migrate deploy" : null;
    if (migCmd) {
      checks.push(manual(
        "db_migration", "Database migration", "database",
        `Run migration command manually after DATABASE_URL is configured.`,
        migCmd,
      ));
      nextSteps.push(`Configure DATABASE_URL in Secrets Vault, then run: ${migCmd}`);
    }

    if (!detected.envNames.includes("DATABASE_URL")) {
      checks.push(warn(
        "db_url", "DATABASE_URL env", "database",
        "DATABASE_URL not found in env examples. Ensure it is added to the Secrets Vault.",
        undefined, false,
      ));
      warnings.push("DATABASE_URL not detected in env examples — add it to the Secrets Vault.");
    } else {
      checks.push(pass("db_url", "DATABASE_URL env", "database", "DATABASE_URL found in env examples (name only)."));
    }
  }

  // ── Env names ──────────────────────────────────────────────────────────────
  if (detected.envNames.length === 0) {
    checks.push(manual(
      "env_names", "Env variable names", "env",
      "No .env.example file found. Create one to document required env variable names.",
    ));
    nextSteps.push("Create a .env.example file listing all required env variable names (no values).");
  } else {
    checks.push(pass(
      "env_names", "Env variable names", "env",
      `${detected.envNames.length} env variable name(s) detected from example files.`,
      detected.envNames.slice(0, 10),
    ));
    nextSteps.push("Configure all required env variables in the Secrets Vault.");
  }

  // ── Replit markers ─────────────────────────────────────────────────────────
  if (detected.replitMarkers.length > 0) {
    checks.push(warn(
      "replit_markers", "Replit markers", "replit",
      `Replit-specific markers detected: ${detected.replitMarkers.join(", ")}. Portability patches may be needed.`,
      detected.replitMarkers, false,
    ));
    warnings.push(`Replit markers found: ${detected.replitMarkers.join(", ")} — apply portability patches before deployment.`);
    nextSteps.push("Run portability patches to remove Replit-specific dependencies and env markers.");
    if (detected.replitMarkers.includes("REPLIT_DB_URL")) {
      nextSteps.push("Replace REPLIT_DB_URL with DATABASE_URL (PostgreSQL connection string).");
    }
    if (detected.replitMarkers.includes("REPLIT_DOMAINS")) {
      nextSteps.push("Replace REPLIT_DOMAINS references with your production domain.");
    }
  } else if (sourceType === "replit_export") {
    checks.push(pass(
      "replit_markers", "Replit markers", "replit",
      "No Replit-specific markers detected in this export.",
    ));
  }

  // ── Security: node_modules ─────────────────────────────────────────────────
  if (detected.hasNodeModules) {
    checks.push(warn(
      "security_nm", "node_modules present", "security",
      "node_modules/ directory found in source. Remove it before deployment — it is automatically excluded from ZIP extraction.",
      ["node_modules/"], false,
    ));
    warnings.push("node_modules/ found in source — not needed in deployment.");
  }

  // ── Security: .env present ─────────────────────────────────────────────────
  if (detected.hasDotEnv) {
    checks.push(warn(
      "security_env", ".env file present", "security",
      ".env file found in source. This file should NOT be deployed — use the Secrets Vault instead.",
      [".env"], false,
    ));
    warnings.push(".env file found in source — remove it and configure secrets via the Secrets Vault.");
    nextSteps.push("Delete .env from source and add all required secrets to the Secrets Vault.");
  }

  // ── Security: .git present ─────────────────────────────────────────────────
  if (detected.hasGitDir) {
    checks.push(warn(
      "security_git", ".git directory present", "security",
      ".git/ found in source. This is fine but may increase upload size unnecessarily.",
      undefined, false,
    ));
  }

  // ── Determine overall status ───────────────────────────────────────────────
  const failedRequired  = checks.filter((c) => c.status === "fail"    && c.required);
  const failedAny       = checks.filter((c) => c.status === "fail");
  const warnChecks      = checks.filter((c) => c.status === "warning");

  let status: SourceIntakeStatus;
  if (failedRequired.length > 0 || failedAny.length > 0) {
    status = "blocked";
    failedAny.forEach((c) => {
      if (!blockers.includes(c.message)) blockers.push(c.message);
    });
  } else if (warnChecks.length > 0) {
    status = "warning";
    warnChecks.forEach((c) => {
      if (!warnings.includes(c.message)) warnings.push(c.message);
    });
  } else {
    status = "ready";
  }

  return {
    projectId,
    generatedAt,
    sourceType,
    status,
    checks,
    detected: {
      packageManager:   detected.packageManager,
      monorepo:         detected.monorepo,
      workspaceFile:    detected.workspaceFile,
      packageJsonCount: detected.packageJsonCount,
      services:         detected.services,
      database:         detected.database ?? undefined,
      envNames:         detected.envNames,
      replitMarkers:    detected.replitMarkers,
    },
    blockers:  [...new Set(blockers)],
    warnings:  [...new Set(warnings)],
    nextSteps: [...new Set(nextSteps)],
  };
}
