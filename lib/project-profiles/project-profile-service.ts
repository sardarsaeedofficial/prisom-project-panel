/**
 * lib/project-profiles/project-profile-service.ts
 *
 * Sprint 71: Detects a project's migration profile by querying the DB for
 * slug, domain, registered services, and env key names (never values).
 * Returns a fully resolved ProjectMigrationProfile without exposing secrets.
 */

import { db }                  from "@/lib/db";
import { isSardarProject }     from "@/lib/migration/sardar-migration-types";
import { getSardarProfile }    from "./sardar-profile";
import type { ProjectMigrationProfile, ProjectProfileKind, ProjectProfileService, ProjectProfileEnvRequirement } from "./project-profile-types";

// ── Env key category detection ────────────────────────────────────────────────

const STRIPE_KEYS   = ["STRIPE_SECRET_KEY", "STRIPE_PUBLISHABLE_KEY", "STRIPE_WEBHOOK_SECRET", "STRIPE_API_KEY"];
const CLOUD_KEYS    = ["CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET", "S3_BUCKET", "AWS_ACCESS_KEY_ID"];
const EMAIL_KEYS    = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "RESEND_API_KEY", "SENDGRID_API_KEY", "MAILGUN_API_KEY"];
const DATABASE_KEYS = ["DATABASE_URL", "DB_URL", "POSTGRES_URL", "MYSQL_URL", "MONGODB_URI"];
const AUTH_KEYS     = ["SESSION_SECRET", "JWT_SECRET", "NEXTAUTH_SECRET", "AUTH_SECRET", "COOKIE_SECRET"];

function hasAny(names: string[], patterns: string[]): boolean {
  return names.some((n) => patterns.some((p) => n.toUpperCase().includes(p)));
}

function envCategory(name: string): ProjectProfileEnvRequirement["category"] {
  const u = name.toUpperCase();
  if (STRIPE_KEYS.some((k)   => u.includes(k.replace("_KEY","").replace("_SECRET","").replace("_PUBLISHABLE","").split("_")[0]!) && u.includes("STRIPE")) ) return "stripe";
  if (CLOUD_KEYS.some((k)    => u === k || u.includes("CLOUDINARY") || u.includes("AWS_") || u.includes("S3_"))) return "cloudinary";
  if (EMAIL_KEYS.some((k)    => u === k || u.includes("SMTP") || u.includes("RESEND") || u.includes("SENDGRID") || u.includes("MAILGUN"))) return "email";
  if (DATABASE_KEYS.some((k) => u === k || u.includes("DATABASE") || u.includes("POSTGRES") || u.includes("MYSQL") || u.includes("MONGO"))) return "database";
  if (AUTH_KEYS.some((k)     => u === k || u.includes("SECRET") || u.includes("JWT") || u.includes("AUTH"))) return "auth";
  if (u.includes("STRIPE"))                            return "stripe";
  if (u.includes("WEBHOOK"))                           return "webhook";
  if (u.includes("URL") || u.includes("HOST") || u.includes("PORT")) return "app";
  return "other";
}

// ── Profile builder helpers ───────────────────────────────────────────────────

function buildEnvRequirements(names: string[]): ProjectProfileEnvRequirement[] {
  return names.map((name) => ({
    name,
    category: envCategory(name),
    required: DATABASE_KEYS.some((k) => name.toUpperCase().includes(k.split("_")[0]!)) || AUTH_KEYS.some((k) => name.toUpperCase().includes(k.split("_")[0]!)),
    secret:   !["APP_URL", "STRIPE_PUBLISHABLE_KEY", "NEXT_PUBLIC_"].some((p) => name.startsWith(p)),
    description: "",
  }));
}

function buildServiceList(
  dbServices: Array<{
    name: string;
    serviceType: string;
    healthPath: string | null;
    buildCommand: string | null;
    startCommand: string | null;
    staticOutputDir: string | null;
    workingDir: string;
  }>,
): ProjectProfileService[] {
  return dbServices.map((s) => ({
    name: s.name,
    kind: s.serviceType === "static" ? "static" : s.serviceType === "node" ? "api" : "unknown",
    root: s.workingDir !== "." ? s.workingDir : undefined,
    buildCommand:  s.buildCommand  ?? undefined,
    startCommand:  s.startCommand  ?? undefined,
    outputPath:    s.staticOutputDir ?? undefined,
    healthPath:    s.healthPath    ?? undefined,
  }));
}

// ── Main detection ────────────────────────────────────────────────────────────

export async function detectProjectMigrationProfile(input: {
  projectId: string;
}): Promise<ProjectMigrationProfile> {
  const { projectId } = input;

  // 1. Load project slug/name
  const project = await db.project.findUnique({
    where:  { id: projectId },
    select: { name: true, slug: true },
  });
  if (!project) {
    return buildUnknownProfile(projectId);
  }

  const slug = project.slug ?? "";
  const name = project.name ?? "";

  // 2. Check Sardar first — fast path via name/slug
  if (isSardarProject(name) || isSardarProject(slug)) {
    const domain = await getPrimaryDomain(projectId);
    return getSardarProfile({ projectId, slug, domain: domain ?? undefined });
  }

  // 3. Load DB data for generic detection
  const [domains, envVars, services] = await Promise.all([
    db.domain.findMany({
      where:  { projectId },
      select: { hostname: true, isPrimary: true },
    }),
    db.projectEnvVar.findMany({
      where:  { projectId },
      select: { name: true, isSecret: true },
    }),
    db.projectService.findMany({
      where:  { projectId, isEnabled: true },
      select: {
        name: true, serviceType: true, healthPath: true,
        buildCommand: true, startCommand: true,
        staticOutputDir: true, workingDir: true,
      },
    }),
  ]);

  // 4. Check domain for sardar pattern (belt-and-suspenders)
  const primaryHostname = domains.find((d) => d.isPrimary)?.hostname ?? domains[0]?.hostname ?? "";
  if (isSardarProject(primaryHostname)) {
    return getSardarProfile({ projectId, slug, domain: primaryHostname });
  }

  const envNames     = envVars.map((e) => e.name);
  const hasStripe    = hasAny(envNames, ["STRIPE"]);
  const hasDatabase  = hasAny(envNames, ["DATABASE_URL", "DB_URL", "POSTGRES_URL", "MYSQL_URL", "MONGODB_URI"]);
  const hasOnlyStatic = services.length > 0 && services.every((s) => s.serviceType === "static");
  const hasOnlyNode   = services.length > 0 && services.every((s) => s.serviceType === "node");

  // 5. Classify
  let kind: ProjectProfileKind;
  let label: string;
  let description: string;
  let isEcommerce = false;

  if (hasStripe) {
    kind        = "generic_ecommerce";
    label       = "Ecommerce App";
    description = "Ecommerce application with Stripe payment integration detected.";
    isEcommerce = true;
  } else if (hasOnlyStatic) {
    kind        = "static_site";
    label       = "Static Site";
    description = "Static output only — no Node.js API service detected.";
  } else if (hasOnlyNode && !hasDatabase) {
    kind        = "api_service";
    label       = "API Service";
    description = "Node.js API service without a detectable frontend service.";
  } else if (hasDatabase) {
    kind        = "generic_web_app";
    label       = "Web App";
    description = "Full-stack web application with a database connection.";
  } else {
    kind        = "unknown";
    label       = "Unknown";
    description = "Not enough signals to classify this project's migration profile.";
  }

  const expectedRoutes = buildExpectedRoutes(services);

  return {
    kind,
    label,
    description,
    projectId,
    slug,
    domain: primaryHostname || undefined,
    isSardar: false,
    isEcommerce,
    expectedServices: buildServiceList(services),
    expectedEnv: buildEnvRequirements(envNames),
    expectedRoutes,
    safetyNotes: buildSafetyNotes(kind),
    recommendedNextSteps: buildNextSteps(kind),
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getPrimaryDomain(projectId: string): Promise<string | null> {
  const d = await db.domain.findFirst({
    where:   { projectId, isPrimary: true },
    select:  { hostname: true },
  });
  if (d) return d.hostname;
  const fallback = await db.domain.findFirst({
    where:  { projectId },
    select: { hostname: true },
  });
  return fallback?.hostname ?? null;
}

function buildExpectedRoutes(
  services: Array<{ serviceType: string; healthPath: string | null }>,
): ProjectMigrationProfile["expectedRoutes"] {
  const routes: ProjectMigrationProfile["expectedRoutes"] = [];
  const hasNode   = services.some((s) => s.serviceType === "node");
  const hasStatic = services.some((s) => s.serviceType === "static");
  if (hasNode) {
    routes.push({ path: "/api/*", target: "Node.js service", type: "api" });
  }
  if (hasStatic) {
    routes.push({ path: "/*", target: "static output directory", type: "spa_fallback" });
  }
  if (routes.length === 0) {
    routes.push({ path: "/*", target: "unknown", type: "unknown" });
  }
  return routes;
}

function buildSafetyNotes(kind: ProjectProfileKind): string[] {
  const base = [
    "Do not restart PM2 processes from the panel UI.",
    "Do not reload nginx from the panel UI.",
    "Do not run DB migrations from the panel.",
  ];
  if (kind === "generic_ecommerce" || kind === "sardar_ecommerce") {
    base.push("Verify Stripe webhook secret matches the live Stripe dashboard endpoint.");
    base.push("Confirm ecommerce smoke checks pass before going live.");
  }
  return base;
}

function buildNextSteps(kind: ProjectProfileKind): string[] {
  const base = [
    "Run Source Intake to verify artifacts are present.",
    "Run Deployment Dry Run to confirm build succeeds.",
  ];
  if (kind === "generic_ecommerce") {
    base.push("Complete Ecommerce Test Plan before cutover.");
  }
  base.push("Execute Production Cutover only after RC is approved.");
  return base;
}

function buildUnknownProfile(projectId: string): ProjectMigrationProfile {
  return {
    kind: "unknown",
    label: "Unknown",
    description: "Project not found or insufficient data to detect a migration profile.",
    projectId,
    isSardar: false,
    isEcommerce: false,
    expectedServices: [],
    expectedEnv: [],
    expectedRoutes: [],
    safetyNotes: [],
    recommendedNextSteps: [],
  };
}
