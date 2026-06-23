/**
 * lib/migration/migration-apply-planner.ts
 *
 * Sprint 43: Generates a MigrationApplyPlan from an EnrichedMigrationReport
 * plus the current project state (deployment config, services, env vars, domains).
 *
 * Safety rules:
 *  - Never includes real secret values (only key names, placeholder text)
 *  - Never marks service changes as destructive
 *  - Overwrites of existing non-empty values always require APPLY confirmation
 *  - Domain hints are informational only — never auto-apply
 */

import type { EnrichedMigrationReport } from "./replit-migration-types";
import type {
  MigrationApplyPlan,
  MigrationApplyChange,
} from "./migration-apply-types";

// ── Context (current project state) ──────────────────────────────────────────

export type PlannerContext = {
  projectId: string;
  /** Current ProjectDeploymentConfig, or null if not yet set up */
  deploymentConfig: {
    installCommand: string | null;
    buildCommand:   string | null;
    startCommand:   string | null;
    healthPath:     string | null;
  } | null;
  /** Existing service slugs (just slugs to detect conflicts) */
  existingServiceSlugs: string[];
  /** Existing env var names in "production" environment (just names, no values) */
  existingEnvVarNames: string[];
  /** Active domain hostname, if any */
  activeDomainHostname: string | null;
  /** Project live URL, if any */
  liveUrl: string | null;
};

// ── ID generator ──────────────────────────────────────────────────────────────

let _seq = 0;
function changeId(prefix: string): string {
  return `${prefix}_${(++_seq).toString(36)}`;
}

// ── Command derivation ────────────────────────────────────────────────────────

function deriveInstallCommand(report: EnrichedMigrationReport): string | null {
  const pm = report.packageManager;
  if (pm === "pnpm") return "pnpm install --frozen-lockfile";
  if (pm === "yarn") return "yarn install --frozen-lockfile";
  if (pm === "npm")  return "npm install --ignore-scripts";
  return null;
}

function deriveBuildCommand(report: EnrichedMigrationReport): string | null {
  // Prefer primary service build command from suggestedServices
  const primary = report.suggestedServices.find((s) => s.isPrimary);
  if (primary?.buildCommand) return primary.buildCommand;

  const pm = report.packageManager;
  const frontend = report.frontend;
  const backend  = report.backend;

  if (frontend?.buildScript) return frontend.buildScript;
  if (backend?.buildScript)  return backend.buildScript;

  if (pm === "pnpm") return "pnpm run build";
  if (pm === "yarn") return "yarn build";
  return "npm run build";
}

function deriveStartCommand(report: EnrichedMigrationReport): string | null {
  // Prefer primary Node service start command
  const primary = report.suggestedServices.find((s) => s.isPrimary && s.serviceType === "node");
  if (primary?.startCommand) return primary.startCommand;

  // Fallback from backend detection
  const backend = report.backend;
  if (backend?.startCommand) return backend.startCommand;

  const pm = report.packageManager;
  if (pm === "pnpm") return "pnpm start";
  if (pm === "yarn") return "yarn start";
  return "npm start";
}

function deriveHealthPath(report: EnrichedMigrationReport): string {
  const primary = report.suggestedServices.find((s) => s.isPrimary && s.serviceType === "node");
  if (primary?.healthPath) return primary.healthPath;
  if (report.backend?.framework === "express") return "/api/healthz";
  return "/";
}

// ── APP_URL helpers ───────────────────────────────────────────────────────────

function deriveAppUrl(ctx: PlannerContext): string {
  if (ctx.activeDomainHostname) return `https://${ctx.activeDomainHostname}`;
  if (ctx.liveUrl) return ctx.liveUrl;
  return "https://your-production-domain.example";
}

function appUrlKeysForFramework(report: EnrichedMigrationReport): string[] {
  const framework = report.frontend?.framework ?? report.backend?.framework ?? "";
  const keys: string[] = ["APP_URL"];

  // Always include APP_URL
  // Framework-specific public keys:
  if (framework.includes("next"))   keys.push("NEXT_PUBLIC_APP_URL");
  if (framework.includes("vite") || framework.includes("react")) keys.push("VITE_APP_URL");
  if (framework.includes("vue"))    keys.push("VITE_APP_URL");

  // Also include if already detected as required
  const detectedKeys = report.requiredSecrets.map((s) => s.name);
  for (const k of ["PUBLIC_APP_URL", "NEXT_PUBLIC_APP_URL", "VITE_APP_URL"]) {
    if (detectedKeys.includes(k) && !keys.includes(k)) keys.push(k);
  }

  return keys;
}

// ── Plan generators ───────────────────────────────────────────────────────────

function buildCommandChanges(
  report: EnrichedMigrationReport,
  ctx:    PlannerContext,
): MigrationApplyChange[] {
  if (!ctx.deploymentConfig) return [];

  const changes: MigrationApplyChange[] = [];
  const cfg = ctx.deploymentConfig;

  // installCommand
  const suggestedInstall = deriveInstallCommand(report);
  if (suggestedInstall) {
    const existing = cfg.installCommand?.trim() || null;
    const alreadyApplied = existing === suggestedInstall;
    changes.push({
      id:                   changeId("cmd_install"),
      type:                 "project_config",
      label:                "Install command",
      description:          "Set the package install command used before building.",
      target:               "installCommand",
      before:               existing,
      after:                suggestedInstall,
      destructive:          false,
      requiresConfirmation: !alreadyApplied && !!existing,
      confirmationText:     !alreadyApplied && !!existing ? "APPLY" : undefined,
      alreadyApplied,
      group:                "commands",
    });
  }

  // buildCommand
  const suggestedBuild = deriveBuildCommand(report);
  if (suggestedBuild) {
    const existing = cfg.buildCommand?.trim() || null;
    const alreadyApplied = existing === suggestedBuild;
    changes.push({
      id:                   changeId("cmd_build"),
      type:                 "project_config",
      label:                "Build command",
      description:          "Set the build command run to compile the project.",
      target:               "buildCommand",
      before:               existing,
      after:                suggestedBuild,
      destructive:          false,
      requiresConfirmation: !alreadyApplied && !!existing,
      confirmationText:     !alreadyApplied && !!existing ? "APPLY" : undefined,
      alreadyApplied,
      group:                "commands",
    });
  }

  // startCommand
  const suggestedStart = deriveStartCommand(report);
  if (suggestedStart) {
    const existing = cfg.startCommand?.trim() || null;
    const alreadyApplied = existing === suggestedStart;
    changes.push({
      id:                   changeId("cmd_start"),
      type:                 "project_config",
      label:                "Start command",
      description:          "Set the PM2 start command used to launch the app.",
      target:               "startCommand",
      before:               existing,
      after:                suggestedStart,
      destructive:          false,
      requiresConfirmation: !alreadyApplied && !!existing,
      confirmationText:     !alreadyApplied && !!existing ? "APPLY" : undefined,
      alreadyApplied,
      group:                "commands",
    });
  }

  // healthPath
  const suggestedHealth = deriveHealthPath(report);
  {
    const existing = cfg.healthPath?.trim() || null;
    const alreadyApplied = existing === suggestedHealth;
    changes.push({
      id:                   changeId("health"),
      type:                 "health_check",
      label:                "Health check path",
      description:          "Set the HTTP path used by the platform to check if the app is running.",
      target:               "healthPath",
      before:               existing,
      after:                suggestedHealth,
      destructive:          false,
      requiresConfirmation: !alreadyApplied && !!existing && existing !== "/",
      confirmationText:     "APPLY",
      alreadyApplied,
      group:                "commands",
    });
  }

  return changes;
}

function buildServiceChanges(
  report: EnrichedMigrationReport,
  ctx:    PlannerContext,
): MigrationApplyChange[] {
  return report.suggestedServices.map((svc) => {
    const exists = ctx.existingServiceSlugs.includes(svc.slug);
    const summary = [
      svc.serviceType === "node" ? "Node.js service" : "Static service",
      svc.buildCommand ? `build: ${svc.buildCommand}` : null,
      svc.startCommand ? `start: ${svc.startCommand}` : null,
    ].filter(Boolean).join(" · ");

    if (exists) {
      return {
        id:                   changeId(`svc_update_${svc.slug}`),
        type:                 "service_update" as const,
        label:                `Update service: ${svc.name}`,
        description:          `Update the "${svc.name}" service with recommended settings from analysis.`,
        target:               svc.slug,
        before:               "(existing settings)",
        after:                summary,
        destructive:          false,
        requiresConfirmation: true,
        confirmationText:     "APPLY",
        alreadyApplied:       false,
        group:                "services" as const,
      };
    }

    return {
      id:                   changeId(`svc_create_${svc.slug}`),
      type:                 "service_create" as const,
      label:                `Create service: ${svc.name}`,
      description:          `Create a new "${svc.name}" ${svc.serviceType} service from analysis recommendations.`,
      target:               svc.slug,
      before:               null,
      after:                summary,
      destructive:          false,
      requiresConfirmation: false,
      alreadyApplied:       false,
      group:                "services" as const,
    };
  });
}

function buildEnvPlaceholderChanges(
  report: EnrichedMigrationReport,
  ctx:    PlannerContext,
): MigrationApplyChange[] {
  const changes: MigrationApplyChange[] = [];

  for (const secret of report.requiredSecrets) {
    const exists = ctx.existingEnvVarNames.includes(secret.name);
    changes.push({
      id:                   changeId(`env_${secret.name}`),
      type:                 "env_placeholder",
      label:                `Add env placeholder: ${secret.name}`,
      description:          `Create a placeholder entry in Secrets Vault for ${secret.name}. ${secret.notes ?? ""}`.trim(),
      target:               secret.name,
      before:               exists ? "(already exists)" : null,
      after:                `<required: set ${secret.name} value>`,
      destructive:          false,
      requiresConfirmation: false,
      alreadyApplied:       exists,
      group:                "env",
    });
  }

  return changes;
}

function buildAppUrlChanges(
  report: EnrichedMigrationReport,
  ctx:    PlannerContext,
): MigrationApplyChange[] {
  const appUrl = deriveAppUrl(ctx);
  const keys   = appUrlKeysForFramework(report);
  const changes: MigrationApplyChange[] = [];

  for (const key of keys) {
    const exists = ctx.existingEnvVarNames.includes(key);
    // APP_URL is a domain_hint — informational + creates placeholder
    changes.push({
      id:                   changeId(`env_appurl_${key}`),
      type:                 "env_placeholder",
      label:                `Add ${key} placeholder`,
      description:          `Set ${key} to your production domain. Suggested value derived from project domains.`,
      target:               key,
      before:               exists ? "(already exists)" : null,
      after:                appUrl,
      destructive:          false,
      requiresConfirmation: false,
      alreadyApplied:       exists,
      group:                "env",
    });
  }

  return changes;
}

function buildBackupChange(): MigrationApplyChange {
  return {
    id:                   changeId("backup"),
    type:                 "backup",
    label:                "Create pre-migration backup",
    description:          "Create a backup snapshot before applying changes. Backup runs in the background.",
    target:               "project",
    before:               null,
    after:                "manual backup created",
    destructive:          false,
    requiresConfirmation: false,
    alreadyApplied:       false,
    group:                "backup",
  };
}

// ── Main entry point ──────────────────────────────────────────────────────────

export function generateMigrationApplyPlan(
  report: EnrichedMigrationReport,
  ctx:    PlannerContext,
): MigrationApplyPlan {
  // Reset sequence per plan generation so IDs are deterministic enough for a session
  _seq = 0;

  const changes: MigrationApplyChange[] = [
    // Commands + health check (only if deployment config exists)
    ...buildCommandChanges(report, ctx),
    // Service create/update
    ...buildServiceChanges(report, ctx),
    // Env var placeholders (required secrets)
    ...buildEnvPlaceholderChanges(report, ctx),
    // APP_URL / framework public URL
    ...buildAppUrlChanges(report, ctx),
    // Pre-migration backup
    buildBackupChange(),
  ];

  const blockers = report.risks
    .filter((r) => r.severity === "blocker")
    .map((r) => r.title);

  const warnings = report.risks
    .filter((r) => r.severity === "warning")
    .map((r) => r.title);

  const status: MigrationApplyPlan["status"] =
    blockers.length > 0 ? "blocked"
    : warnings.length > 0 ? "warning"
    : "ready";

  const manualOnlySteps = report.manualSteps.filter(
    (s) =>
      s.severity === "required" &&
      // These can't be automated — only count ones not covered by env placeholders
      !changes.some(
        (c) => c.type === "env_placeholder" && s.envKeys?.includes(c.target),
      ),
  );

  return {
    projectId:                     ctx.projectId,
    generatedAt:                   new Date().toISOString(),
    status,
    changes,
    blockers,
    warnings,
    estimatedManualStepsRemaining: manualOnlySteps.length,
    hasDeploymentConfig:           ctx.deploymentConfig !== null,
  };
}
