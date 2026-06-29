/**
 * lib/auto-import/auto-import-orchestrator.ts
 *
 * Sprint 86: Orchestrates the full auto import analysis.
 * Combines source detection, stack detection, env/DB checks, domain resolution,
 * preview checks, and fix classification into one AutoImportRun.
 *
 * No secrets returned. No deployment mutations.
 */

import path from "path";
import fsSync from "fs";
import { db } from "@/lib/db";
import { detectSmartImportStack }        from "@/lib/smart-import/smart-import-detector";
import { selectSmartImportPreset }       from "@/lib/smart-import/smart-import-presets";
import { detectMissingEnvForAutoImport } from "./auto-import-env-assistant";
import { generateDatabaseImportGuidance } from "./auto-import-database-assistant";
import { classifyAutoImportIssue }       from "./auto-import-fix-classifier";
import type {
  AutoImportRun,
  AutoImportStatus,
  AutoImportDetectedDomain,
} from "./auto-import-types";

const PROJECT_STORAGE = path.resolve(process.cwd(), "storage", "projects");

function existsSync(p: string): boolean {
  try { return fsSync.existsSync(p); } catch { return false; }
}

// ── HTTP preview check (server-side, no auth header) ─────────────────────────

async function httpGet(url: string, timeoutMs = 8000): Promise<{ status: number; body: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: "manual" });
    const body = await res.text().catch(() => "");
    return { status: res.status, body: body.slice(0, 500) };
  } catch {
    return { status: 0, body: "Connection failed" };
  } finally {
    clearTimeout(timer);
  }
}

// ── Orchestrator ──────────────────────────────────────────────────────────────

export async function runAutoImportAnalysis(input: {
  projectId: string;
}): Promise<AutoImportRun> {
  const { projectId } = input;
  const generatedAt = new Date().toISOString();

  // ── Load project ──────────────────────────────────────────────────────────
  const project = await db.project.findUnique({
    where:  { id: projectId },
    select: { slug: true, name: true },
  });
  if (!project) {
    return errorRun(projectId, generatedAt, "Project not found.");
  }

  const sourceDir = path.join(PROJECT_STORAGE, project.slug);
  const sourceExists = existsSync(sourceDir);

  // ── Load deployment config ─────────────────────────────────────────────────
  const deployConfig = await db.projectDeploymentConfig.findUnique({
    where:  { projectId },
    select: {
      port:            true,
      healthPath:      true,
      routeMode:       true,
      staticOutputDir: true,
      pm2Name:         true,
      primaryDomain:   true,
      publicPreviewUrl: true,
      publicPreviewStatus: true,
      apiPrefix:       true,
    },
  });

  // ── Load domains ───────────────────────────────────────────────────────────
  const rawDomains = await db.domain.findMany({
    where:   { projectId },
    select:  { hostname: true, isPrimary: true, status: true, sslStatus: true },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
  });

  // ── Latest successful deploy ───────────────────────────────────────────────
  const latestDeploy = await db.deployment.findFirst({
    where:   { projectId, status: "SUCCESS" },
    orderBy: { startedAt: "desc" },
    select:  { id: true, startedAt: true },
  });

  // ── Detect stack ───────────────────────────────────────────────────────────
  let detectedStackFull: Awaited<ReturnType<typeof detectSmartImportStack>> | null = null;
  try {
    detectedStackFull = await detectSmartImportStack({ projectId, slug: project.slug });
  } catch {
    detectedStackFull = null;
  }

  const preset = detectedStackFull
    ? selectSmartImportPreset({ detectedStack: detectedStackFull })
    : null;

  const detectedStack: AutoImportRun["detectedStack"] = {
    packageManager:   detectedStackFull?.packageManager ?? "unknown",
    framework:        detectedStackFull?.framework      ?? [],
    database:         detectedStackFull?.database?.tool
                        ? [detectedStackFull.database.tool]
                        : [],
    services:         (detectedStackFull?.services ?? []).map((s) => `${s.name} (${s.type})`),
    routeMode:        deployConfig?.routeMode         ?? preset?.routeMode,
    staticOutputPath: deployConfig?.staticOutputDir   ?? preset?.staticOutputPath,
    healthPath:       deployConfig?.healthPath        ?? preset?.healthPath,
  };

  // ── Missing env assistant ─────────────────────────────────────────────────
  const missingEnvEntries = await detectMissingEnvForAutoImport({ projectId });

  // ── Database assistant ────────────────────────────────────────────────────
  const dbGuidance = await generateDatabaseImportGuidance({ projectId });

  // ── Domains ────────────────────────────────────────────────────────────────
  const domains: AutoImportDetectedDomain[] = [];

  if (deployConfig?.port) {
    domains.push({
      type:   "internal",
      url:    `http://127.0.0.1:${deployConfig.port}`,
      status: latestDeploy ? "working" : "unknown",
    });
  }

  if (deployConfig?.publicPreviewUrl && deployConfig.publicPreviewStatus === "active") {
    domains.push({
      type:   "preview",
      url:    deployConfig.publicPreviewUrl,
      status: "working",
    });
  }

  for (const d of rawDomains) {
    const scheme = d.sslStatus === "ACTIVE" ? "https" : "http";
    domains.push({
      type:     "public",
      url:      `${scheme}://${d.hostname}`,
      status:   d.status === "ACTIVE" ? "working" : "not_configured",
      evidence: `status=${d.status}, ssl=${d.sslStatus}`,
    });
  }

  const hasPublicDomain = rawDomains.some((d) => d.status === "ACTIVE");

  // ── Preview checks (only if there is a known port and a successful deploy) ─
  const previewChecks: AutoImportRun["previewChecks"] = [];

  if (deployConfig?.port && latestDeploy) {
    const base = `http://127.0.0.1:${deployConfig.port}`;
    const healthPath = deployConfig.healthPath ?? "/api/healthz";

    // Health check
    const healthRes = await httpGet(`${base}${healthPath}`);
    previewChecks.push({
      path:   healthPath,
      status: healthRes.status >= 200 && healthRes.status < 400 ? "pass" : "blocked",
      result: healthRes.status === 0
        ? "Could not connect — is the app running?"
        : `HTTP ${healthRes.status}`,
    });

    // Root check
    const rootRes = await httpGet(`${base}/`);
    const rootFailed =
      rootRes.status === 404 ||
      rootRes.body.includes("Cannot GET") ||
      rootRes.status === 0;

    previewChecks.push({
      path:   "/",
      status: rootFailed ? "warning" : "pass",
      result: rootFailed
        ? `HTTP ${rootRes.status} — ${rootRes.body.slice(0, 80)}`
        : `HTTP ${rootRes.status} OK`,
    });

    // SPA route check for static+api mode
    const routeMode = deployConfig.routeMode ?? "fullstack_node";
    if (routeMode === "static_plus_api" || routeMode === "static_only") {
      const spaRes = await httpGet(`${base}/products`);
      previewChecks.push({
        path:   "/products (SPA route)",
        status: spaRes.status >= 200 && spaRes.status < 400 ? "pass" : "warning",
        result: `HTTP ${spaRes.status}`,
      });
    }
  }

  // ── Issues + fix classification ───────────────────────────────────────────
  const issues: AutoImportRun["issues"] = [];

  if (!sourceExists) {
    issues.push({
      id:      "no-source",
      kind:    "unknown",
      title:   "No source uploaded",
      message: "Upload a ZIP or clone from GitHub before running Auto Import.",
    });
  }

  if (missingEnvEntries.filter((e) => e.required).length > 0) {
    const names = missingEnvEntries.filter((e) => e.required).map((e) => e.name).join(", ");
    const fix = classifyAutoImportIssue({ message: "missing_env" });
    issues.push({
      id:      "missing-required-env",
      kind:    "missing_env",
      title:   "Required env vars missing",
      message: `These required env vars are not configured: ${names}`,
      fix:     fix ?? undefined,
    });
  }

  if (!dbGuidance.targetDatabaseConfigured) {
    const fix = classifyAutoImportIssue({ message: "DATABASE_URL missing" });
    issues.push({
      id:      "missing-database-url",
      kind:    "missing_database",
      title:   "DATABASE_URL not configured",
      message: "Add DATABASE_URL in the Environment tab before deploying.",
      fix:     fix ?? undefined,
    });
  }

  if (!deployConfig) {
    issues.push({
      id:      "no-deploy-config",
      kind:    "unknown",
      title:   "No deployment config",
      message: "Apply the recommended deployment preset to save a deployment config.",
    });
  } else {
    const routeMode = deployConfig.routeMode ?? "fullstack_node";
    if (
      preset?.routeMode === "static_plus_api" &&
      routeMode !== "static_plus_api"
    ) {
      const fix = classifyAutoImportIssue({ message: "routeMode fullstack_node should use static_plus_api" });
      issues.push({
        id:      "wrong-route-mode",
        kind:    "route_mode_wrong",
        title:   "Route mode should be static_plus_api",
        message: `Current routeMode is "${routeMode}". Frontend and API need split routing.`,
        fix:     fix ?? undefined,
      });
    }

    if (preset?.staticOutputPath && !deployConfig.staticOutputDir) {
      const fix = classifyAutoImportIssue({ message: "staticOutputDir not set build output missing" });
      issues.push({
        id:      "missing-static-output",
        kind:    "static_output_missing",
        title:   "Static output directory not configured",
        message: "The frontend build output directory is not set. Frontend will not be served.",
        fix:     fix ?? undefined,
      });
    }
  }

  // Preview check failures → classify
  for (const check of previewChecks) {
    if (check.status === "blocked" || (check.status === "warning" && check.path === "/")) {
      const isCannotGet = check.result.includes("Cannot GET") || check.result.includes("404");
      const isConnFail  = check.result.includes("connect");
      if (isCannotGet) {
        const fix = classifyAutoImportIssue({ message: "Cannot GET /" });
        issues.push({
          id:       `preview-root-fail`,
          kind:     "frontend_not_served",
          title:    "Frontend not served at /",
          message:  "API is healthy but the frontend returns 'Cannot GET /'. Apply static_plus_api routing fix.",
          evidence: check.result,
          fix:      fix ?? undefined,
        });
      } else if (isConnFail && check.path.includes("healthz")) {
        issues.push({
          id:      "preview-health-fail",
          kind:    "start_failed",
          title:   "App not responding",
          message: "Could not connect to the app. It may not be running. Deploy or restart the service.",
          evidence: check.result,
        });
      }
    }
  }

  if (!hasPublicDomain) {
    const fix = classifyAutoImportIssue({ message: "domain missing no public domain configured" });
    issues.push({
      id:      "no-public-domain",
      kind:    "domain_missing",
      title:   "No public domain attached",
      message: "Add a domain in the Domains tab before go-live.",
      fix:     fix ?? undefined,
    });
  }

  // ── Overall status ─────────────────────────────────────────────────────────
  const status = deriveStatus({
    sourceExists,
    hasConfig: !!deployConfig,
    hasMissingRequired: missingEnvEntries.filter((e) => e.required).length > 0,
    hasDbMissing: !dbGuidance.targetDatabaseConfigured,
    hasLatestDeploy: !!latestDeploy,
    previewChecks,
    hasDomain: hasPublicDomain,
    hasFixableIssues: issues.some((i) => i.fix),
  });

  // ── Recommended next steps ─────────────────────────────────────────────────
  const recommendedNextSteps: string[] = [];

  if (!sourceExists) {
    recommendedNextSteps.push("Upload source: use Source Intake to upload a ZIP or clone from GitHub.");
  }
  if (!deployConfig) {
    recommendedNextSteps.push("Apply the deployment preset (Analyze Import → Apply Safe Fix).");
  }
  if (missingEnvEntries.filter((e) => e.required).length > 0) {
    recommendedNextSteps.push(
      `Add missing env vars in Environment tab: ${missingEnvEntries.filter((e) => e.required).map((e) => e.name).join(", ")}`,
    );
  }
  if (!dbGuidance.targetDatabaseConfigured) {
    recommendedNextSteps.push("Add DATABASE_URL pointing to your PostgreSQL database.");
  }
  if (deployConfig && !latestDeploy && sourceExists) {
    recommendedNextSteps.push("Deploy the project (Publishing tab → Deploy).");
  }
  if (latestDeploy && previewChecks.some((c) => c.status !== "pass")) {
    recommendedNextSteps.push("Apply the safe fix for the failing preview check, then retry deploy.");
  }
  if (latestDeploy && previewChecks.every((c) => c.status === "pass") && !hasPublicDomain) {
    recommendedNextSteps.push("Preview is working. Add a public domain in the Domains tab.");
  }
  if (latestDeploy && previewChecks.every((c) => c.status === "pass") && hasPublicDomain) {
    recommendedNextSteps.push("All checks passed. Review final settings and confirm Go Live.");
  }

  return {
    projectId,
    generatedAt,
    status,
    detectedStack,
    domains,
    missingEnvNames: missingEnvEntries,
    database: {
      required:                  dbGuidance.required,
      targetConfigured:          dbGuidance.targetDatabaseConfigured,
      sourceMigrationAvailable:  dbGuidance.sourceDatabaseProvided,
      message:                   dbGuidance.guidance[0] ?? "",
    },
    issues,
    previewChecks,
    recommendedNextSteps,
  };
}

// ── Status deriver ─────────────────────────────────────────────────────────────

function deriveStatus(flags: {
  sourceExists:        boolean;
  hasConfig:           boolean;
  hasMissingRequired:  boolean;
  hasDbMissing:        boolean;
  hasLatestDeploy:     boolean;
  previewChecks:       Array<{ status: "pass" | "warning" | "blocked" }>;
  hasDomain:           boolean;
  hasFixableIssues:    boolean;
}): AutoImportStatus {
  if (!flags.sourceExists || !flags.hasConfig) return "blocked";
  if (flags.hasMissingRequired)                 return "needs_env";
  if (flags.hasDbMissing)                       return "needs_database";
  if (!flags.hasLatestDeploy)                   return "config_ready";
  if (flags.previewChecks.some((c) => c.status === "blocked")) {
    return flags.hasFixableIssues ? "fix_available" : "blocked";
  }
  if (flags.previewChecks.some((c) => c.status === "warning")) {
    return flags.hasFixableIssues ? "fix_available" : "retry_ready";
  }
  if (flags.previewChecks.length > 0 && flags.previewChecks.every((c) => c.status === "pass")) {
    return flags.hasDomain ? "ready_for_go_live" : "preview_live";
  }
  return "config_ready";
}

// ── Error run helper ──────────────────────────────────────────────────────────

function errorRun(projectId: string, generatedAt: string, message: string): AutoImportRun {
  return {
    projectId,
    generatedAt,
    status:       "blocked",
    detectedStack: { packageManager: "unknown", framework: [], database: [], services: [] },
    domains:      [],
    missingEnvNames: [],
    database:     { required: false, targetConfigured: false, sourceMigrationAvailable: false, message },
    issues:       [{ id: "error", kind: "unknown", title: "Error", message }],
    previewChecks: [],
    recommendedNextSteps: [message],
  };
}
