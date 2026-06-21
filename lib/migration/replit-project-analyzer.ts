/**
 * lib/migration/replit-project-analyzer.ts
 *
 * Sprint 24: Core analyzer for Replit → Prisom migration.
 *
 * Safety guarantees:
 *  - All file access resolves strictly under storage/projects/<slug>
 *  - Max 300 files scanned, max 100 KB per file read
 *  - Symlinks are NOT followed (walkDirectory skips them)
 *  - .env, *.key, *.pem files are never read (excluded by backup safety)
 *  - No secret values are returned — only key NAMES
 *  - Returns structured DTOs only, never raw file dumps
 */

import path from "path";
import { promises as fs } from "fs";
import {
  resolveProjectSource,
  isSafeSlug,
} from "@/lib/backups/project-backup-safety";
import { detectRequiredSecrets }   from "./replit-secret-detector";
import { detectDatabase, buildDbMigrationPlan }    from "./replit-db-detector";
import { detectMedia, buildMediaMigrationPlan }    from "./replit-media-detector";
import { detectMigrationRisks }    from "./replit-risk-detector";
import { recommendServices }       from "./replit-service-recommender";
import type {
  ReplitMigrationReport,
  PackageManager,
  DetectedService,
  ReplitDependency,
  EmailDetection,
  PaymentDetection,
  BackgroundJobDetection,
} from "./replit-detection-types";

// ── Safety limits ─────────────────────────────────────────────────────────────

const MAX_FILE_BYTES   = 100 * 1024;   // 100 KB per file
const MAX_FILES_SCAN   = 300;
const MAX_TOTAL_BYTES  = 10 * 1024 * 1024;  // 10 MB total

// Dirs to skip during migration scan (same as backup exclusions plus more)
const SKIP_DIRS = new Set([
  "node_modules", ".git", ".next", ".nuxt", ".output", "dist", "build", "out",
  "coverage", "__pycache__", ".turbo", ".cache", "releases", ".pnp", ".yarn",
  ".vite", "artifacts", "storybook-static",
]);

// File extensions to include in source scan
const SCAN_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts",
  ".json", ".yaml", ".yml", ".toml", ".env.example", ".env.sample",
]);

// Files that are never read (secrets / sensitive)
const NEVER_READ_PATTERNS = [
  /^\.env$/i,
  /^\.env\./i,
  /\.pem$/i,
  /\.key$/i,
  /\.p12$/i,
  /\.pfx$/i,
  /id_rsa/i,
  /id_ed25519/i,
];

// ── File reading helpers ──────────────────────────────────────────────────────

async function readFileSafely(absPath: string): Promise<string | null> {
  try {
    const stat = await fs.stat(absPath);
    if (!stat.isFile()) return null;
    if (stat.size > MAX_FILE_BYTES) return null;
    // Never follow symlinks — lstat vs stat comparison
    const lstat = await fs.lstat(absPath);
    if (lstat.isSymbolicLink()) return null;
    return await fs.readFile(absPath, "utf8");
  } catch {
    return null;
  }
}

function shouldNeverRead(filename: string): boolean {
  return NEVER_READ_PATTERNS.some((p) => p.test(filename));
}

function shouldScanFile(relPath: string): boolean {
  const basename = path.basename(relPath);
  if (shouldNeverRead(basename)) return false;
  const ext = path.extname(basename);
  // Always include key config files by name
  const configFiles = [
    "package.json", "pnpm-workspace.yaml", ".replit", "replit.nix",
    "artifact.toml", "drizzle.config.ts", "drizzle.config.js",
    "next.config.ts", "next.config.js", "next.config.mjs",
    "vite.config.ts", "vite.config.js",
    ".nvmrc", ".node-version", "Dockerfile", "docker-compose.yml",
  ];
  if (configFiles.includes(basename)) return true;
  // Include source files with allowed extensions
  if (SCAN_EXTENSIONS.has(ext)) return true;
  // Include prisma schema
  if (relPath.endsWith("prisma/schema.prisma")) return true;
  return false;
}

// ── Project root walker ───────────────────────────────────────────────────────

async function walkProjectFiles(
  rootDir: string,
): Promise<{ fileList: string[]; contentMap: Map<string, string> }> {
  const fileList: string[]              = [];
  const contentMap = new Map<string, string>();
  let totalBytes = 0;

  async function walk(dir: string, prefix: string): Promise<void> {
    if (fileList.length >= MAX_FILES_SCAN) return;
    if (totalBytes >= MAX_TOTAL_BYTES) return;

    let entries: import("fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (fileList.length >= MAX_FILES_SCAN) break;

      const name    = entry.name;
      const absPath = path.join(dir, name);
      const relPath = prefix ? `${prefix}/${name}` : name;

      if (entry.isSymbolicLink()) continue;  // never follow symlinks

      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(name)) continue;
        await walk(absPath, relPath);
      } else if (entry.isFile()) {
        fileList.push(relPath);
        if (!shouldScanFile(relPath)) continue;

        const content = await readFileSafely(absPath);
        if (content !== null) {
          contentMap.set(relPath, content);
          totalBytes += content.length;
        }
      }
    }
  }

  await walk(rootDir, "");
  return { fileList, contentMap };
}

// ── package.json parser ───────────────────────────────────────────────────────

type PackageJson = {
  name?:         string;
  version?:      string;
  scripts?:      Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  engines?:      { node?: string };
  workspaces?:   string[] | { packages?: string[] };
  main?:         string;
  module?:       string;
  type?:         string;
};

function parsePackageJson(content: string): PackageJson | null {
  try {
    return JSON.parse(content) as PackageJson;
  } catch {
    return null;
  }
}

function mergeDeps(pkg: PackageJson | null): Record<string, string> {
  if (!pkg) return {};
  return {
    ...(pkg.dependencies ?? {}),
    ...(pkg.devDependencies ?? {}),
  };
}

// ── Monorepo workspace package discovery ──────────────────────────────────────

async function findWorkspacePackages(
  rootDir:     string,
  fileList:    string[],
  contentMap:  Map<string, string>,
): Promise<{ relDir: string; pkg: PackageJson }[]> {
  const results: { relDir: string; pkg: PackageJson }[] = [];

  // Look for package.json files 1-2 levels deep (not root)
  const pkgFiles = fileList.filter((f) => {
    const parts = f.split("/");
    return f.endsWith("package.json") && parts.length >= 2 && parts.length <= 3;
  });

  for (const pkgPath of pkgFiles) {
    let content = contentMap.get(pkgPath);
    if (!content) {
      content = await readFileSafely(path.join(rootDir, pkgPath)) ?? undefined;
    }
    if (!content) continue;
    const pkg = parsePackageJson(content);
    if (pkg) {
      const relDir = path.dirname(pkgPath);
      results.push({ relDir, pkg });
    }
  }

  return results;
}

// ── Detection helpers ─────────────────────────────────────────────────────────

function detectPackageManager(
  fileList: string[],
  rootPkg:  PackageJson | null,
): PackageManager {
  if (fileList.includes("pnpm-lock.yaml") || fileList.includes("pnpm-workspace.yaml")) return "pnpm";
  if (fileList.includes("yarn.lock")) return "yarn";
  if (fileList.includes("package-lock.json")) return "npm";
  // Check engines in package.json
  if (rootPkg?.scripts?.preinstall?.includes("pnpm")) return "pnpm";
  return "unknown";
}

function detectMonorepo(
  fileList:  string[],
  rootPkg:   PackageJson | null,
  allContent: string,
): { isMonorepo: boolean; paths: string[] } {
  const paths: string[] = [];

  if (fileList.includes("pnpm-workspace.yaml")) {
    paths.push("pnpm-workspace.yaml");
  }
  if (rootPkg?.workspaces) {
    const ws = rootPkg.workspaces;
    const patterns = Array.isArray(ws) ? ws : (ws.packages ?? []);
    patterns.forEach((p) => paths.push(p));
  }
  // Heuristic: multiple package.json files
  const subPkgs = fileList.filter((f) => {
    const parts = f.split("/");
    return f.endsWith("package.json") && parts.length >= 2;
  });
  if (subPkgs.length >= 2) {
    subPkgs.forEach((p) => { if (!paths.includes(path.dirname(p))) paths.push(path.dirname(p)); });
  }
  // Check for common workspace dirs
  for (const dir of ["apps", "packages", "lib", "services"]) {
    if (fileList.some((f) => f.startsWith(`${dir}/`))) {
      if (!paths.includes(dir)) paths.push(dir);
    }
  }

  return { isMonorepo: paths.length > 0, paths };
}

function detectNodeVersion(
  fileList:  string[],
  contentMap: Map<string, string>,
  rootPkg:   PackageJson | null,
): string | undefined {
  const nvmrc = contentMap.get(".nvmrc") ?? contentMap.get(".node-version");
  if (nvmrc) return nvmrc.trim().replace(/^v/, "");
  return rootPkg?.engines?.node;
}

function detectFrontend(
  allContent:       string,
  fileList:         string[],
  allDeps:          Record<string, string>,
  workspacePkgs:    { relDir: string; pkg: PackageJson }[],
): DetectedService | undefined {
  const hasVite   = fileList.some((f) => /vite\.config\.(ts|js|mjs)$/.test(f));
  const hasNext   = fileList.some((f) => /next\.config\.(ts|js|mjs)$/.test(f)) || !!allDeps["next"];
  const hasReact  = !!allDeps["react"] || !!allDeps["react-dom"];
  const hasVue    = !!allDeps["vue"];
  const hasSvelte = !!allDeps["svelte"];

  if (hasNext) {
    // Next.js is a node service, not pure static
    return {
      name:        "Next.js App",
      framework:   "nextjs",
      workingDir:  ".",
      buildScript: "build",
      outputDir:   ".next",
    };
  }

  if (hasVite || (hasReact && !allDeps["express"] && !allDeps["fastify"])) {
    // Try to find the static frontend workspace package
    const webPkg = workspacePkgs.find((w) => {
      const deps = mergeDeps(w.pkg);
      return !!deps["react"] || !!deps["vite"] || !!deps["vue"];
    });

    const framework = hasVue ? "vue" : hasSvelte ? "svelte" : "react/vite";

    // Detect output dir from allContent (outDir in vite config)
    let outputDir = "dist";
    const viteOutDirMatch = allContent.match(/outDir\s*:\s*["']([^"']+)["']/);
    if (viteOutDirMatch) outputDir = viteOutDirMatch[1];

    return {
      name:        "Web Frontend",
      framework,
      workingDir:  webPkg?.relDir ?? ".",
      buildScript: "build",
      outputDir,
      packageName: webPkg?.pkg.name,
    };
  }

  return undefined;
}

function detectBackend(
  allContent:    string,
  fileList:      string[],
  allDeps:       Record<string, string>,
  workspacePkgs: { relDir: string; pkg: PackageJson }[],
): DetectedService | undefined {
  const hasExpress  = !!allDeps["express"];
  const hasFastify  = !!allDeps["fastify"];
  const hasHono     = !!allDeps["hono"];
  const hasKoa      = !!allDeps["koa"];
  const hasNestJs   = !!allDeps["@nestjs/core"];
  const hasServer   = allContent.includes("app.listen(") || allContent.includes("server.listen(");
  const hasApiRoute = allContent.includes("app.get(") || allContent.includes("router.get(") ||
    allContent.includes("app.post(") || allContent.includes("fastify.get(");
  const hasPort     = allContent.includes("process.env.PORT");

  if (!hasExpress && !hasFastify && !hasHono && !hasKoa && !hasNestJs && !hasServer && !hasApiRoute) {
    return undefined;
  }

  // Find backend workspace package
  const apiPkg = workspacePkgs.find((w) => {
    const deps = mergeDeps(w.pkg);
    return !!deps["express"] || !!deps["fastify"] || !!deps["hono"] || !!deps["koa"];
  });

  const framework = hasNestJs ? "nestjs" : hasFastify ? "fastify" : hasHono ? "hono" : hasKoa ? "koa" : "express";

  // Detect entry file
  const serverFiles = fileList.filter((f) =>
    !f.includes("node_modules") &&
    /\.(ts|js|mjs|cjs)$/.test(f) &&
    /(server|index|main|app)\.(ts|js|mjs|cjs)$/.test(path.basename(f)) &&
    (f.includes("src/") || f.includes("server/") || f.split("/").length <= 2),
  );
  const entryFile = serverFiles[0];

  return {
    name:        "API Server",
    framework,
    entryFile,
    workingDir:  apiPkg?.relDir ?? ".",
    buildScript: "build",
    packageName: apiPkg?.pkg.name,
  };
}

function detectEmail(
  allContent: string,
  allDeps:    Record<string, string>,
): EmailDetection | undefined {
  const isReplitConnector = !!allDeps["@replit/connectors-sdk"] ||
    allContent.includes("REPLIT_CONNECTORS_") ||
    allContent.includes("@replit/connectors-sdk");

  const hasNodemailer  = !!allDeps["nodemailer"] || allContent.includes("nodemailer");
  const hasResend      = !!allDeps["resend"]     || allContent.includes("resend");
  const hasSendgrid    = !!allDeps["@sendgrid/mail"] || allContent.includes("sendgrid");
  const hasPostmark    = !!allDeps["postmark"]   || allContent.includes("postmark");
  const hasSmtp        = allContent.includes("SMTP_HOST") || allContent.includes("SMTP_");
  const hasAnyEmail    = isReplitConnector || hasNodemailer || hasResend || hasSendgrid || hasPostmark || hasSmtp;

  if (!hasAnyEmail) return undefined;

  const provider = isReplitConnector ? "replit-connector"
    : hasResend     ? "resend"
    : hasSendgrid   ? "sendgrid"
    : hasPostmark   ? "postmark"
    : hasNodemailer ? "nodemailer"
    : "smtp";

  const detectedPackage = isReplitConnector ? "@replit/connectors-sdk"
    : hasResend   ? "resend"
    : hasSendgrid ? "@sendgrid/mail"
    : hasPostmark ? "postmark"
    : hasNodemailer ? "nodemailer"
    : undefined;

  return {
    provider,
    isReplitConnector,
    smtpConfigured: hasSmtp,
    detectedPackage,
  };
}

function detectPayments(
  allContent: string,
  allDeps:    Record<string, string>,
): PaymentDetection[] {
  const payments: PaymentDetection[] = [];

  const hasStripe = !!allDeps["stripe"] || allContent.includes("STRIPE_") || allContent.includes("stripe");
  if (hasStripe) {
    const hasWebhook = allContent.includes("webhook") || allContent.includes("STRIPE_WEBHOOK_SECRET");
    const webhookPath = allContent.includes("/api/webhooks/stripe") ? "/api/webhooks/stripe"
      : allContent.includes("/webhooks/stripe") ? "/webhooks/stripe"
      : undefined;
    payments.push({ provider: "stripe", hasWebhook, webhookPath });
  }

  return payments;
}

function detectBackgroundJobs(
  allContent: string,
  allDeps:    Record<string, string>,
): BackgroundJobDetection[] {
  const jobs: BackgroundJobDetection[] = [];

  if (allDeps["node-cron"] || allContent.includes("node-cron") || allContent.includes("cron.schedule")) {
    jobs.push({ library: "node-cron", notes: "In-process scheduler. Will run on every PM2 instance — ensure instances=1 or use a dedicated worker." });
  }
  if (allDeps["bull"] || allDeps["bullmq"]) {
    jobs.push({ library: allDeps["bullmq"] ? "bullmq" : "bull", notes: "Redis-backed queue. Requires REDIS_URL secret. Compatible with multi-process PM2." });
  }
  if (allDeps["agenda"]) {
    jobs.push({ library: "agenda", notes: "MongoDB-backed job scheduler. Requires MONGODB_URI." });
  }

  return jobs;
}

function detectReplitDependencies(
  allContent:  string,
  fileList:    string[],
  contentMap:  Map<string, string>,
  allDeps:     Record<string, string>,
): ReplitDependency[] {
  const deps: ReplitDependency[] = [];

  if (fileList.includes(".replit")) {
    deps.push({ name: ".replit", type: "file", detail: "Replit-specific configuration file — not needed on VPS." });
  }
  if (fileList.includes("replit.nix")) {
    deps.push({ name: "replit.nix", type: "file", detail: "Nix environment config for Replit — not needed on VPS." });
  }
  if (allDeps["@replit/connectors-sdk"]) {
    deps.push({ name: "@replit/connectors-sdk", type: "package", detail: "Replit email/service connector — replace with SMTP provider.", replacement: "nodemailer + SMTP" });
  }
  if (allDeps["@replit/database"]) {
    deps.push({ name: "@replit/database", type: "package", detail: "Replit KV database — not available on VPS.", replacement: "Redis or PostgreSQL (JSONB)" });
  }
  if (allContent.includes("REPLIT_DOMAINS")) {
    deps.push({ name: "REPLIT_DOMAINS", type: "env", detail: "Replit auto-injected domain env var — undefined on VPS.", replacement: "APP_URL" });
  }
  if (allContent.includes("REPLIT_DB_URL")) {
    deps.push({ name: "REPLIT_DB_URL", type: "env", detail: "Replit KV store URL — not available on VPS.", replacement: "REDIS_URL or remove" });
  }
  if (allContent.includes("REPLIT_CONNECTORS_HOSTNAME") || allContent.includes("REPLIT_CONNECTORS_AUDIENCE")) {
    deps.push({ name: "REPLIT_CONNECTORS_*", type: "env", detail: "Replit connector auth env vars — not available on VPS.", replacement: "SMTP_HOST / SMTP_USER / SMTP_PASS" });
  }
  if (allContent.includes("REPL_ID") || allContent.includes("REPL_SLUG")) {
    deps.push({ name: "REPL_ID / REPL_SLUG", type: "env", detail: "Replit metadata env vars — will be undefined on VPS." });
  }

  return deps;
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Analyze a project's source directory and return a structured migration report.
 *
 * @param projectSlug  The project slug (used to resolve storage/projects/<slug>)
 * @returns            ReplitMigrationReport, or null if the slug is invalid / source missing
 */
export async function analyzeReplitProject(
  projectSlug: string,
): Promise<ReplitMigrationReport | null> {
  if (!isSafeSlug(projectSlug)) return null;

  const sourceDir = resolveProjectSource(projectSlug);
  if (!sourceDir) return null;

  // Verify source dir exists
  try {
    const stat = await fs.stat(sourceDir);
    if (!stat.isDirectory()) return null;
  } catch {
    return null;
  }

  // ── Walk files ──────────────────────────────────────────────────────────
  const { fileList, contentMap } = await walkProjectFiles(sourceDir);

  // ── Parse root package.json ─────────────────────────────────────────────
  const rootPkgContent = contentMap.get("package.json");
  const rootPkg = rootPkgContent ? parsePackageJson(rootPkgContent) : null;

  // ── Collect all workspace package.jsons ──────────────────────────────────
  const workspacePkgs = await findWorkspacePackages(sourceDir, fileList, contentMap);

  // ── Merge all deps across workspace ──────────────────────────────────────
  const allDeps: Record<string, string> = mergeDeps(rootPkg);
  for (const { pkg } of workspacePkgs) {
    Object.assign(allDeps, mergeDeps(pkg));
  }

  // ── Concatenate all source content (for pattern matching) ──────────────
  const allContent = Array.from(contentMap.values()).join("\n");

  // ── Core detections ──────────────────────────────────────────────────────
  const pm           = detectPackageManager(fileList, rootPkg);
  const { isMonorepo, paths: monorepoPaths } = detectMonorepo(fileList, rootPkg, allContent);
  const nodeVersion  = detectNodeVersion(fileList, contentMap, rootPkg);
  const frontend     = detectFrontend(allContent, fileList, allDeps, workspacePkgs);
  const backend      = detectBackend(allContent, fileList, allDeps, workspacePkgs);
  const database     = detectDatabase(allContent, fileList, allDeps);
  const media        = detectMedia(allContent, fileList, allDeps);
  const payments     = detectPayments(allContent, allDeps);
  const email        = detectEmail(allContent, allDeps);
  const backgroundJobs = detectBackgroundJobs(allContent, allDeps);
  const replitDeps   = detectReplitDependencies(allContent, fileList, contentMap, allDeps);

  // ── Secret detection ─────────────────────────────────────────────────────
  // Exclude any .env-like files from the content map for secret name detection
  const safeContentMap = new Map<string, string>();
  for (const [k, v] of contentMap) {
    if (!shouldNeverRead(path.basename(k))) safeContentMap.set(k, v);
  }
  const requiredSecrets = detectRequiredSecrets(safeContentMap);

  // ── Project type label ───────────────────────────────────────────────────
  let projectType = "Unknown";
  if (isMonorepo && pm === "pnpm") projectType = "pnpm workspace monorepo";
  else if (isMonorepo)             projectType = "Monorepo";
  else if (frontend?.framework === "nextjs") projectType = "Next.js app";
  else if (backend && frontend)    projectType = "Full-stack app";
  else if (backend)                projectType = "Node.js API";
  else if (frontend)               projectType = "Static frontend";

  // ── Build DB / media plans ───────────────────────────────────────────────
  const dbPlan    = database ? buildDbMigrationPlan(database) : undefined;
  const mediaPlan = media    ? buildMediaMigrationPlan(media)  : undefined;

  // ── Partial report (without risks + services) ─────────────────────────────
  const partial = {
    projectType, packageManager: pm, isMonorepo, monorepoPaths, nodeVersion,
    frontend, backend, database, dbPlan, media, mediaPlan,
    payments, email, backgroundJobs, replitDependencies: replitDeps, requiredSecrets,
  };

  // ── Suggested services ────────────────────────────────────────────────────
  const suggestedServices = recommendServices(partial);

  // ── Risks ─────────────────────────────────────────────────────────────────
  const risks = detectMigrationRisks(partial, allContent, fileList);

  return {
    ...partial,
    suggestedServices,
    risks,
    analyzedAt:   new Date().toISOString(),
    filesScanned: fileList.length,
  };
}
