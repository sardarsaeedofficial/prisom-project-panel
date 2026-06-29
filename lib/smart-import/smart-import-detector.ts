/**
 * lib/smart-import/smart-import-detector.ts
 *
 * Sprint 85: Detects the stack of an uploaded project and returns a
 * SmartImportDetectedStack by combining the existing source-structure-detector
 * output with Sardar/Replit-specific heuristics.
 *
 * Server-side only. Read-only — no writes.
 */

import path from "path";
import fsSync from "fs";
import { detectSourceStructure } from "@/lib/import/source-structure-detector";
import type { SmartImportDetectedStack } from "./smart-import-types";

const PROJECT_STORAGE = path.resolve(process.cwd(), "storage", "projects");

function existsSync(p: string): boolean {
  try { return fsSync.existsSync(p); } catch { return false; }
}

// Known env var purposes for common names
const ENV_PURPOSES: Record<string, { required: boolean; secret: boolean; purpose: string }> = {
  DATABASE_URL:             { required: true,  secret: true,  purpose: "PostgreSQL connection string" },
  DIRECT_URL:               { required: false, secret: true,  purpose: "Direct DB URL for migrations" },
  SESSION_SECRET:           { required: true,  secret: true,  purpose: "Session signing key" },
  JWT_SECRET:               { required: true,  secret: true,  purpose: "JWT signing key" },
  STRIPE_SECRET_KEY:        { required: true,  secret: true,  purpose: "Stripe API secret" },
  STRIPE_PUBLISHABLE_KEY:   { required: false, secret: false, purpose: "Stripe publishable key" },
  STRIPE_WEBHOOK_SECRET:    { required: true,  secret: true,  purpose: "Stripe webhook signature" },
  CLOUDINARY_URL:           { required: false, secret: true,  purpose: "Cloudinary upload URL" },
  CLOUDINARY_CLOUD_NAME:    { required: false, secret: false, purpose: "Cloudinary cloud name" },
  CLOUDINARY_API_KEY:       { required: false, secret: true,  purpose: "Cloudinary API key" },
  CLOUDINARY_API_SECRET:    { required: false, secret: true,  purpose: "Cloudinary API secret" },
  SENDGRID_API_KEY:         { required: false, secret: true,  purpose: "SendGrid email API key" },
  SMTP_HOST:                { required: false, secret: false, purpose: "SMTP server hostname" },
  SMTP_USER:                { required: false, secret: false, purpose: "SMTP username" },
  SMTP_PASS:                { required: false, secret: true,  purpose: "SMTP password" },
  NODE_ENV:                 { required: false, secret: false, purpose: "Node environment (production)" },
  PORT:                     { required: false, secret: false, purpose: "Listen port (set by platform)" },
  VITE_API_URL:             { required: false, secret: false, purpose: "Vite frontend API base URL" },
  NEXT_PUBLIC_API_URL:      { required: false, secret: false, purpose: "Next.js public API URL" },
};

function annotateEnvName(name: string): SmartImportDetectedStack["envNames"][number] {
  const known = ENV_PURPOSES[name];
  if (known) return { name, ...known };
  const isSecret = /secret|key|pass|token|url|dsn/i.test(name);
  const isRequired = /database|session|jwt|stripe.*secret/i.test(name);
  return {
    name,
    required: isRequired,
    secret:   isSecret,
    purpose:  "Application configuration",
  };
}

export async function detectSmartImportStack(input: {
  projectId: string;
  slug: string;
}): Promise<SmartImportDetectedStack> {
  const sourceDir = path.join(PROJECT_STORAGE, input.slug);

  if (!existsSync(sourceDir)) {
    return {
      packageManager: "unknown",
      framework: [],
      language: ["typescript"],
      database: { tool: "unknown", provider: "unknown", requiredEnvNames: [] },
      services: [],
      envNames: [],
      replitMarkers: [],
    };
  }

  // Reuse the existing structure detector
  let detected: Awaited<ReturnType<typeof detectSourceStructure>> | null = null;
  try {
    detected = await detectSourceStructure(sourceDir);
  } catch {
    detected = null;
  }

  const pm = detected?.packageManager ?? "unknown";

  // ── Sardar-specific structure detection ──────────────────────────────────
  const hasPnpmWorkspace  = existsSync(path.join(sourceDir, "pnpm-workspace.yaml"));
  const hasApiServer      = existsSync(path.join(sourceDir, "artifacts", "api-server"));
  const hasSardarSecurity = existsSync(path.join(sourceDir, "artifacts", "sardar-security"));
  const hasArtifactsWeb   = existsSync(path.join(sourceDir, "artifacts", "web"));

  // Frameworks
  const frameworks: string[] = [];
  if (hasSardarSecurity || hasArtifactsWeb) frameworks.push("vite", "react");
  if (detected?.services?.some((s) => s.kind === "static")) frameworks.push("vite");
  if (detected?.services?.some((s) => s.buildCommand?.includes("next"))) frameworks.push("next");
  const uniqueFrameworks = [...new Set(frameworks)];

  // Languages
  const languages: string[] = ["javascript"];
  if (
    existsSync(path.join(sourceDir, "tsconfig.json")) ||
    existsSync(path.join(sourceDir, "artifacts", "api-server", "tsconfig.json"))
  ) {
    languages.unshift("typescript");
  }

  // Database
  const dbTool    = detected?.database?.tool     ?? "unknown";
  const dbProvider = detected?.database?.provider ?? "unknown";
  const dbEnvNames: string[] = [];
  if (dbTool !== "unknown") {
    dbEnvNames.push("DATABASE_URL");
    if (dbTool === "prisma") dbEnvNames.push("DIRECT_URL");
  }

  // Services
  const services: SmartImportDetectedStack["services"] = [];

  if (hasApiServer) {
    services.push({
      name:         "API Server",
      type:         "api",
      root:         "artifacts/api-server",
      buildCommand: "pnpm run build",
      startCommand: "node artifacts/api-server/dist/index.mjs",
      healthPath:   "/api/healthz",
      route:        "/api/*",
    });
  } else if (detected?.services?.some((s) => s.kind === "api")) {
    const apiSvc = detected.services.find((s) => s.kind === "api");
    if (apiSvc) {
      services.push({
        name:         apiSvc.name,
        type:         "api",
        root:         apiSvc.root,
        buildCommand: apiSvc.buildCommand ?? undefined,
        startCommand: apiSvc.startCommand ?? undefined,
        healthPath:   apiSvc.healthPath ?? "/api/healthz",
        route:        "/api/*",
      });
    }
  }

  if (hasSardarSecurity) {
    services.push({
      name:         "Sardar Security Frontend",
      type:         "static",
      root:         "artifacts/sardar-security",
      buildCommand: "pnpm run build",
      outputPath:   "artifacts/sardar-security/dist/public",
      route:        "/*",
    });
  } else if (hasArtifactsWeb) {
    services.push({
      name:         "Web Frontend",
      type:         "static",
      root:         "artifacts/web",
      buildCommand: "pnpm run build",
      outputPath:   "artifacts/web/dist/public",
      route:        "/*",
    });
  } else if (detected?.services?.some((s) => s.kind === "static")) {
    const staticSvc = detected.services.find((s) => s.kind === "static");
    if (staticSvc) {
      services.push({
        name:       staticSvc.name,
        type:       "static",
        root:       staticSvc.root,
        outputPath: staticSvc.outputPath ?? undefined,
        route:      "/*",
      });
    }
  }

  // Env names
  const rawEnvNames: string[] = [
    ...(detected?.envNames ?? []),
    ...dbEnvNames,
  ];
  const uniqueEnvNames = [...new Set(rawEnvNames)];
  const annotatedEnvNames = uniqueEnvNames.map(annotateEnvName);

  // Replit markers
  const replitMarkers = detected?.replitMarkers ?? [];
  if (hasPnpmWorkspace) replitMarkers.push("pnpm-workspace.yaml");
  if (hasApiServer)      replitMarkers.push("artifacts/api-server");

  return {
    packageManager: hasPnpmWorkspace ? "pnpm" : pm,
    framework: uniqueFrameworks,
    language:  [...new Set(languages)],
    database: {
      tool:             dbTool === "knex" || dbTool === "sequelize" ? "unknown" : dbTool,
      provider:         dbProvider,
      requiredEnvNames: dbEnvNames,
    },
    services,
    envNames: annotatedEnvNames,
    replitMarkers: [...new Set(replitMarkers)],
  };
}
