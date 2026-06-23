/**
 * lib/migration/manual-steps-generator.ts
 *
 * Sprint 41: Generate an ordered list of manual setup steps based on what
 * the migration analyzer and external service detector found.
 *
 * Safety rules:
 *  - No secret values — only key names (DetectedSecret.name)
 *  - Steps never run commands automatically
 *  - All content is static text / hints
 */

import type { ReplitMigrationReport } from "./replit-detection-types";
import type { ExternalServiceFinding, ManualStep } from "./replit-migration-types";

let _id = 0;
function nextId(prefix: string) { return `${prefix}-${++_id}`; }

function resetId() { _id = 0; }

// ── Step generators ───────────────────────────────────────────────────────────

function databaseSteps(report: ReplitMigrationReport): ManualStep[] {
  const steps: ManualStep[] = [];
  if (!report.database) return steps;

  const dbType = report.database.type;
  if (dbType !== "none") {
    steps.push({
      id:          nextId("db"),
      title:       "Configure DATABASE_URL",
      description: `This project uses ${dbType}. Set DATABASE_URL in your environment variables to point to your production database.`,
      severity:    "required",
      envKeys:     [report.database.connectionEnvKey ?? "DATABASE_URL"],
    });
  }

  // Detect if ORM-based migrations are likely needed
  if (report.database.orm === "prisma") {
    steps.push({
      id:          nextId("db"),
      title:       "Run Prisma database migrations",
      description: "Run Prisma migrations after the first deployment to set up the schema.",
      severity:    "required",
      command:     "npx prisma migrate deploy",
    });
  } else if (report.database.orm === "drizzle") {
    steps.push({
      id:          nextId("db"),
      title:       "Run Drizzle database migrations",
      description: "Run your Drizzle migration script after the first deployment.",
      severity:    "required",
      command:     "npx drizzle-kit migrate",
    });
  }

  if (dbType === "replit-db") {
    steps.push({
      id:          nextId("db"),
      title:       "Replace Replit Database with a hosted database",
      description: "Replit Database (built-in KV) is not available outside Replit. Migrate to PostgreSQL, Redis, or another hosted database.",
      severity:    "required",
    });
  }

  return steps;
}

function secretSteps(report: ReplitMigrationReport): ManualStep[] {
  const required = report.requiredSecrets.filter((s) => s.required);
  if (required.length === 0) return [];

  return [{
    id:          nextId("secrets"),
    title:       `Configure ${required.length} required environment variable${required.length > 1 ? "s" : ""}`,
    description: "The following environment variables are required by this project. Set them before deploying.",
    severity:    "required",
    envKeys:     required.map((s) => s.name),
  }];
}

function replitDepSteps(report: ReplitMigrationReport): ManualStep[] {
  const steps: ManualStep[] = [];
  const pkgDeps = report.replitDependencies.filter((d) => d.type === "package");
  if (pkgDeps.length === 0) return steps;

  steps.push({
    id:          nextId("replit"),
    title:       `Remove ${pkgDeps.length} Replit-only package${pkgDeps.length > 1 ? "s" : ""}`,
    description: pkgDeps.map((d) => `${d.name}: ${d.replacement ?? "no direct replacement"}`).join("\n"),
    severity:    "required",
    command:     `pnpm remove ${pkgDeps.map((d) => d.name).join(" ")}`,
  });

  return steps;
}

function mediaSteps(report: ReplitMigrationReport): ManualStep[] {
  const steps: ManualStep[] = [];
  if (!report.media) return steps;

  if (report.media.hasLocalUploads && report.media.localUploadPaths.length > 0) {
    steps.push({
      id:          nextId("media"),
      title:       "Migrate local file uploads to cloud storage",
      description: "This project has local file uploads. These files will not persist across deployments unless you configure cloud storage (Cloudinary, S3, or R2).",
      severity:    "recommended",
      files:       report.media.localUploadPaths.slice(0, 3),
    });
  }

  if (report.media.provider === "unknown" && report.media.hasLocalUploads) {
    steps.push({
      id:          nextId("media"),
      title:       "Configure a media storage provider",
      description: "No cloud media provider was detected. Uploads stored locally will be lost on redeployment. Configure Cloudinary, S3, or R2.",
      severity:    "required",
    });
  }

  return steps;
}

function externalServiceSteps(findings: ExternalServiceFinding[]): ManualStep[] {
  return findings
    .filter((f) => f.critical && f.envKeys.length > 0)
    .map((f) => ({
      id:          nextId("ext"),
      title:       `Configure ${f.label}`,
      description: f.action,
      severity:    "required" as const,
      envKeys:     f.envKeys,
      files:       f.files,
    }));
}

function webhookSteps(findings: ExternalServiceFinding[]): ManualStep[] {
  return findings
    .filter((f) => !!f.webhookPath)
    .map((f) => ({
      id:          nextId("webhook"),
      title:       `Register ${f.label} webhook`,
      description: `After deployment, register your public URL as a webhook endpoint in the ${f.label} dashboard. Webhook path: ${f.webhookPath}`,
      severity:    "required" as const,
      files:       f.files,
    }));
}

function oauthCallbackSteps(findings: ExternalServiceFinding[]): ManualStep[] {
  return findings
    .filter((f) => !!f.callbackPath)
    .map((f) => ({
      id:          nextId("oauth"),
      title:       `Update ${f.label} OAuth callback URL`,
      description: `Add your production URL to the allowed callback URLs in the ${f.label} developer console. Callback path: ${f.callbackPath}`,
      severity:    "required" as const,
    }));
}

function emailSteps(report: ReplitMigrationReport): ManualStep[] {
  const steps: ManualStep[] = [];
  if (!report.email) return steps;

  if (report.email.isReplitConnector) {
    steps.push({
      id:          nextId("email"),
      title:       "Replace Replit email connector",
      description: "The Replit email connector is not available outside Replit. Migrate to Resend, SendGrid, or Postmark.",
      severity:    "required",
      envKeys:     ["RESEND_API_KEY"],
    });
  }

  return steps;
}

function sslDomainStep(): ManualStep[] {
  return [{
    id:          nextId("domain"),
    title:       "Configure domain and SSL",
    description: "Add your custom domain in the Domains section of this project. Prisorm will provision SSL automatically via Let's Encrypt. Update DNS A-records to point to the VPS IP.",
    severity:    "recommended",
    docsHint:    "/projects/{projectId}/domains",
  }];
}

function envBackupStep(report: ReplitMigrationReport): ManualStep[] {
  if (report.requiredSecrets.length === 0) return [];
  return [{
    id:          nextId("backup"),
    title:       "Back up your Replit Secrets before deleting the Repl",
    description: "Copy all Replit Secrets to a password manager or vault before closing the Replit project. Once the Repl is deleted, those values are lost.",
    severity:    "recommended",
    envKeys:     report.requiredSecrets.map((s) => s.name),
  }];
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Generates an ordered list of manual steps for the migration wizard.
 * Steps are ordered: required first, then recommended, then optional.
 */
export function generateManualSteps(
  report:   ReplitMigrationReport,
  findings: ExternalServiceFinding[],
): ManualStep[] {
  resetId();

  const raw: ManualStep[] = [
    ...databaseSteps(report),
    ...secretSteps(report),
    ...replitDepSteps(report),
    ...mediaSteps(report),
    ...emailSteps(report),
    ...externalServiceSteps(findings),
    ...webhookSteps(findings),
    ...oauthCallbackSteps(findings),
    ...sslDomainStep(),
    ...envBackupStep(report),
  ];

  const order: Record<ManualStep["severity"], number> = {
    required:    0,
    recommended: 1,
    optional:    2,
  };

  return raw.sort((a, b) => order[a.severity] - order[b.severity]);
}
