/**
 * lib/import/source-structure-detector.ts
 *
 * Sprint 57: Detect source structure of an uploaded/extracted project directory.
 *
 * Safety:
 *  - Never executes code or installs packages.
 *  - Never reads .env files (only .env.example / .env.sample / env.example).
 *  - Path validation happens in the caller (source-intake-readiness.ts).
 *  - Max walk depth of 4 prevents runaway scanning on large monorepos.
 */

import path                       from "path";
import { promises as fs, Dirent } from "fs";

// ── Types ─────────────────────────────────────────────────────────────────────

export type DetectedService = {
  name:          string;
  kind:          "api" | "static" | "worker" | "fullstack" | "unknown";
  root:          string;
  buildCommand:  string | null;
  startCommand:  string | null;
  outputPath:    string | null;
  healthPath:    string | null;
};

export type DetectedDatabase = {
  tool:     "drizzle" | "prisma" | "knex" | "sequelize" | "unknown";
  provider: "postgres" | "mysql" | "sqlite" | "unknown";
};

export type DetectedStructure = {
  packageManager:  "pnpm" | "npm" | "yarn" | "bun" | "unknown";
  lockfiles:       string[];
  workspaceFile:   string | null;
  monorepo:        boolean;
  packageJsonCount: number;
  packageJsonPaths: string[];
  services:        DetectedService[];
  database:        DetectedDatabase | null;
  envNames:        string[];
  replitMarkers:   string[];
  hasNodeModules:  boolean;
  hasDotEnv:       boolean;
  hasGitDir:       boolean;
  hasPackageJson:  boolean;
};

// ── Constants ─────────────────────────────────────────────────────────────────

const SKIP_DIRS = new Set([
  "node_modules", ".git", ".next", "dist", "build",
  ".nuxt", ".output", ".turbo", ".cache", ".yarn", "coverage",
]);

const MAX_DEPTH = 4;

const API_DEPS = new Set([
  "express", "fastify", "hono", "koa", "restify",
  "@nestjs/core", "nest", "@hono/node-server",
]);

const STATIC_DEPS = new Set([
  "vite", "react", "react-dom", "@vitejs/plugin-react",
  "next", "astro", "nuxt", "@sveltejs/kit",
]);

const WORKER_DEPS = new Set([
  "bullmq", "bull", "agenda", "cron", "node-cron",
]);

// ── Helpers ───────────────────────────────────────────────────────────────────

async function exists(p: string): Promise<boolean> {
  try { await fs.access(p); return true; } catch { return false; }
}

async function readJson(p: string): Promise<Record<string, unknown> | null> {
  try {
    const text = await fs.readFile(p, "utf-8");
    return JSON.parse(text) as Record<string, unknown>;
  } catch { return null; }
}

async function readText(p: string): Promise<string | null> {
  try { return await fs.readFile(p, "utf-8"); } catch { return null; }
}

async function listDir(p: string): Promise<Dirent[]> {
  try { return await fs.readdir(p, { withFileTypes: true }); } catch { return []; }
}

async function walkDir(
  dir:      string,
  depth:    number,
  maxDepth: number,
  rel:      string,
): Promise<string[]> {
  if (depth > maxDepth) return [];
  const entries: string[] = [];
  const items = await listDir(dir);

  for (const item of items) {
    const relPath = rel ? `${rel}/${item.name}` : item.name;
    const abs     = path.join(dir, item.name);

    if (item.isDirectory()) {
      if (SKIP_DIRS.has(item.name.toLowerCase())) continue;
      const sub = await walkDir(abs, depth + 1, maxDepth, relPath);
      entries.push(...sub);
    } else if (item.isFile()) {
      entries.push(relPath);
    }
  }
  return entries;
}

function allDeps(pkg: Record<string, unknown>): Set<string> {
  const deps    = Object.keys((pkg.dependencies    as Record<string, unknown>) ?? {});
  const devDeps = Object.keys((pkg.devDependencies as Record<string, unknown>) ?? {});
  return new Set([...deps, ...devDeps]);
}

function classifyServiceKind(
  deps:    Set<string>,
  dirName: string,
): "api" | "static" | "worker" | "fullstack" | "unknown" {
  const hasApi    = [...deps].some((d) => API_DEPS.has(d));
  const hasStatic = [...deps].some((d) => STATIC_DEPS.has(d));
  const hasWorker = [...deps].some((d) => WORKER_DEPS.has(d));

  const nameLow = dirName.toLowerCase();
  if (nameLow.includes("api") || nameLow.includes("server") || nameLow.includes("backend"))
    return hasStatic ? "fullstack" : "api";
  if (nameLow.includes("static") || nameLow.includes("frontend") || nameLow.includes("web") || nameLow.includes("security"))
    return "static";
  if (nameLow.includes("worker")) return "worker";

  if (hasApi && hasStatic) return "fullstack";
  if (hasApi)    return "api";
  if (hasStatic) return "static";
  if (hasWorker) return "worker";
  return "unknown";
}

function inferServiceCommands(
  pkg:     Record<string, unknown>,
  kind:    "api" | "static" | "worker" | "fullstack" | "unknown",
  relRoot: string,
): { build: string | null; start: string | null; output: string | null; health: string | null } {
  const scripts = (pkg.scripts as Record<string, string>) ?? {};

  const build  = scripts.build  ?? null;
  const start  = scripts.start  ?? scripts.serve ?? null;
  const dev    = scripts.dev    ?? null;

  const output = kind === "static"
    ? (scripts.build?.includes("dist") ? "dist/" : scripts.build?.includes("out") ? "out/" : "dist/")
    : kind === "api" ? null
    : null;

  const health = kind === "api" || kind === "fullstack"
    ? "/api/healthz"
    : null;

  return {
    build:  build  ?? (scripts.build  ? `pnpm --filter ${relRoot} build` : null),
    start:  start  ?? dev ?? null,
    output,
    health,
  };
}

function parseEnvNames(text: string): string[] {
  const names: string[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    if (/^[A-Z][A-Z0-9_]*$/.test(key)) names.push(key);
  }
  return names;
}

// ── Main detector ─────────────────────────────────────────────────────────────

export async function detectSourceStructure(
  sourceRoot: string,
): Promise<DetectedStructure> {
  // ── 1. Lockfile / package manager ──────────────────────────────────────────
  const lockfileCandidates: Array<{ file: string; pm: "pnpm" | "npm" | "yarn" | "bun" }> = [
    { file: "pnpm-lock.yaml",    pm: "pnpm" },
    { file: "package-lock.json", pm: "npm"  },
    { file: "yarn.lock",         pm: "yarn" },
    { file: "bun.lockb",         pm: "bun"  },
  ];

  const lockfiles: string[] = [];
  for (const lf of lockfileCandidates) {
    if (await exists(path.join(sourceRoot, lf.file))) lockfiles.push(lf.file);
  }

  let packageManager: DetectedStructure["packageManager"] = "unknown";
  if (lockfiles.includes("pnpm-lock.yaml"))    packageManager = "pnpm";
  else if (lockfiles.includes("bun.lockb"))    packageManager = "bun";
  else if (lockfiles.includes("yarn.lock"))    packageManager = "yarn";
  else if (lockfiles.includes("package-lock.json")) packageManager = "npm";

  // ── 2. Workspace / monorepo ─────────────────────────────────────────────────
  let workspaceFile: string | null = null;
  for (const wf of ["pnpm-workspace.yaml", "turbo.json", "nx.json"]) {
    if (await exists(path.join(sourceRoot, wf))) { workspaceFile = wf; break; }
  }
  const monorepo = workspaceFile !== null;

  // ── 3. Root package.json ────────────────────────────────────────────────────
  const rootPkgPath  = path.join(sourceRoot, "package.json");
  const hasPackageJson = await exists(rootPkgPath);
  const rootPkg      = hasPackageJson ? await readJson(rootPkgPath) : null;

  // ── 4. Walk directory (depth 4, relative paths) ─────────────────────────────
  const allRelPaths = await walkDir(sourceRoot, 0, MAX_DEPTH, "");

  // Collect package.json paths (relative)
  const packageJsonPaths = allRelPaths.filter((p) => p.endsWith("package.json"));

  // ── 5. Services (from subdirectory package.json files) ─────────────────────
  const services: DetectedService[] = [];

  // Directories that commonly hold services
  const SERVICE_PARENT_DIRS = ["artifacts", "apps", "services", "packages", "api", "backend", "frontend", "web"];

  const subPkgPaths = packageJsonPaths.filter((p) => p !== "package.json");

  for (const relPkgPath of subPkgPaths) {
    const parts   = relPkgPath.split("/");
    if (parts.length < 2) continue;

    const parentDir = parts[0];
    const depth     = parts.length - 1; // depth of the package.json

    // Only look at depth 1-2 from root: e.g., artifacts/api-server/package.json or apps/api/package.json
    if (depth > 2) continue;

    const isServiceParent = SERVICE_PARENT_DIRS.includes(parentDir);
    if (!isServiceParent && depth > 1) continue;

    const serviceDirRel = parts.slice(0, -1).join("/");
    const serviceName   = parts.length === 2 ? parts[0] : parts[1]; // e.g. "api-server"
    const absDir        = path.join(sourceRoot, serviceDirRel);
    const pkg           = await readJson(path.join(sourceRoot, relPkgPath));
    if (!pkg) continue;

    const deps   = allDeps(pkg);
    const kind   = classifyServiceKind(deps, serviceName);
    const cmds   = inferServiceCommands(pkg, kind, serviceDirRel);

    // Avoid duplicate service roots
    if (services.some((s) => s.root === serviceDirRel)) continue;

    services.push({
      name:         (pkg.name as string) ?? serviceName,
      kind,
      root:         serviceDirRel,
      buildCommand: cmds.build,
      startCommand: cmds.start,
      outputPath:   cmds.output,
      healthPath:   cmds.health,
    });
  }

  // If no sub-services detected but we have a root package.json, add root as a service
  if (services.length === 0 && rootPkg) {
    const deps = allDeps(rootPkg);
    const kind = classifyServiceKind(deps, "root");
    const cmds = inferServiceCommands(rootPkg, kind, ".");
    services.push({
      name:         (rootPkg.name as string) ?? "app",
      kind:         kind === "unknown" ? "fullstack" : kind,
      root:         ".",
      buildCommand: cmds.build,
      startCommand: cmds.start,
      outputPath:   cmds.output,
      healthPath:   cmds.health,
    });
  }

  // ── 6. Database detection ───────────────────────────────────────────────────
  let database: DetectedDatabase | null = null;

  const drizzleConfigExists =
    allRelPaths.some((p) => /^drizzle\.config\.(ts|js|mjs|cjs)$/.test(p)) ||
    allRelPaths.some((p) => p === "lib/db/index.ts" || p.includes("drizzle")) ;

  const prismaExists = allRelPaths.some((p) => p === "prisma/schema.prisma");

  // Also check root pkg deps
  const rootDeps = rootPkg ? allDeps(rootPkg) : new Set<string>();

  if (drizzleConfigExists || rootDeps.has("drizzle-orm")) {
    const provider: DetectedDatabase["provider"] =
      rootDeps.has("pg") || rootDeps.has("@electric-sql/pglite") || rootDeps.has("postgres")
        ? "postgres"
        : rootDeps.has("mysql2") || rootDeps.has("mysql")
        ? "mysql"
        : rootDeps.has("better-sqlite3") || rootDeps.has("sqlite3")
        ? "sqlite"
        : "postgres"; // default assumption for Drizzle

    database = { tool: "drizzle", provider };
  } else if (prismaExists || rootDeps.has("@prisma/client")) {
    // Check prisma schema for provider
    const schemaText = await readText(path.join(sourceRoot, "prisma", "schema.prisma"));
    const provider: DetectedDatabase["provider"] =
      schemaText?.includes("postgresql") ? "postgres"
      : schemaText?.includes("mysql")     ? "mysql"
      : schemaText?.includes("sqlite")    ? "sqlite"
      : "postgres";

    database = { tool: "prisma", provider };
  } else if (rootDeps.has("knex")) {
    database = { tool: "knex", provider: "postgres" };
  } else if (rootDeps.has("sequelize")) {
    database = { tool: "sequelize", provider: "postgres" };
  }

  // ── 7. Env names ───────────────────────────────────────────────────────────
  const envNames: string[] = [];
  const envExampleCandidates = [
    ".env.example", ".env.sample", "env.example", ".env.local.example",
  ];
  for (const candidate of envExampleCandidates) {
    const text = await readText(path.join(sourceRoot, candidate));
    if (text) {
      const names = parseEnvNames(text);
      envNames.push(...names.filter((n) => !envNames.includes(n)));
    }
  }
  // Also check sub-dirs at depth 1
  for (const relPath of allRelPaths) {
    const parts = relPath.split("/");
    if (parts.length !== 2) continue;
    if (envExampleCandidates.includes(parts[1])) {
      const text = await readText(path.join(sourceRoot, relPath));
      if (text) {
        const names = parseEnvNames(text);
        envNames.push(...names.filter((n) => !envNames.includes(n)));
      }
    }
  }

  // ── 8. Replit markers ──────────────────────────────────────────────────────
  const replitMarkers: string[] = [];
  if (allRelPaths.includes(".replit"))   replitMarkers.push(".replit");
  if (allRelPaths.includes("replit.nix")) replitMarkers.push("replit.nix");

  // Check root pkg deps for @replit/ packages
  if (rootPkg) {
    const deps = allDeps(rootPkg);
    for (const dep of deps) {
      if (dep.startsWith("@replit/")) {
        replitMarkers.push(`dep:${dep}`);
      }
    }
    // Check env vars in .replit for REPLIT_DOMAINS marker
    const replitText = await readText(path.join(sourceRoot, ".replit"));
    if (replitText?.includes("REPLIT_DOMAINS")) replitMarkers.push("REPLIT_DOMAINS");
    if (replitText?.includes("REPLIT_DB_URL"))   replitMarkers.push("REPLIT_DB_URL");
  }

  // ── 9. Security signals ────────────────────────────────────────────────────
  const hasNodeModules = await exists(path.join(sourceRoot, "node_modules"));
  const hasDotEnv      = await exists(path.join(sourceRoot, ".env"));
  const hasGitDir      = await exists(path.join(sourceRoot, ".git"));

  return {
    packageManager,
    lockfiles,
    workspaceFile,
    monorepo,
    packageJsonCount: packageJsonPaths.length,
    packageJsonPaths,
    services,
    database,
    envNames,
    replitMarkers,
    hasNodeModules,
    hasDotEnv,
    hasGitDir,
    hasPackageJson,
  };
}
