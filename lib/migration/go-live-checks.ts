/**
 * lib/migration/go-live-checks.ts
 *
 * Sprint 26: Individual check functions for go-live readiness.
 *
 * Each function receives a GoLiveContext (pre-loaded data) and returns
 * one or more GoLiveCheck objects.
 *
 * Safety rules:
 *  - No secret values are ever included in check output
 *  - All detection is done on key names only
 *  - No external calls (HTTP health check lives in go-live-runner.ts)
 */

import type { GoLiveCheck, GoLiveCheckCategory, GoLiveCheckStatus, GoLiveServiceCheck, GoLiveExternalTask } from "./go-live-types";
import type { PatchSummary } from "./portability-patch-types";
import { validateServiceCommand } from "@/lib/projects/service-command-validator";

// ── Context ───────────────────────────────────────────────────────────────────

export type DbService = {
  id:              string;
  name:            string;
  slug:            string;
  serviceType:     string;
  installCommand:  string | null;
  buildCommand:    string | null;
  startCommand:    string | null;
  internalPort:    number | null;
  healthPath:      string | null;
  staticOutputDir: string | null;
  spaFallback:     boolean;
  isEnabled:       boolean;
  workingDir:      string;
  requiredEnvKeysJson: string | null;
  lastStatus:      string | null;
  lastDeploymentRef: string | null;
};

export type DbDomain = {
  id:        string;
  hostname:  string;
  status:    string;
  isPrimary: boolean;
};

export type GoLiveContext = {
  projectId:       string;
  projectSlug:     string;
  projectName:     string;
  /** Production env var key names that are configured and enabled */
  configuredKeys:  Set<string>;
  services:        DbService[];
  domains:         DbDomain[];
  /** Latest backup record, or null if none */
  latestBackup:    { completedAt: Date } | null;
  /** Sprint 25 patch summaries, or null if source not available */
  patchSummaries:  PatchSummary[] | null;
  /** Concatenated source file content for feature detection (no .env content) */
  allContent:      string | null;
  /** Whether the source scan found Stripe usage */
  hasStripe:       boolean;
  /** Whether the source scan found Cloudinary usage */
  hasCloudinary:   boolean;
  /** Whether the source scan found email usage */
  hasEmail:        boolean;
  /** Whether any Replit-specific packages/APIs still detected */
  hasReplitDeps:   boolean;
  /** Whether static frontend was detected */
  hasFrontend:     boolean;
  /** DB type from detection */
  detectedDbType:  string | null;
  /** Static output dir from detection (if available) */
  detectedOutputDir: string | null;
  /** Whether static output dir's index.html exists on disk */
  staticIndexExists: boolean | null;
};

// ── Helper ────────────────────────────────────────────────────────────────────

function check(
  id:       string,
  title:    string,
  category: GoLiveCheckCategory,
  status:   GoLiveCheckStatus,
  details:  string,
  action?:  GoLiveCheck["action"],
): GoLiveCheck {
  return { id, title, status, category, details, action };
}

// ── 1. Backup ─────────────────────────────────────────────────────────────────

export function checkBackup(ctx: GoLiveContext, projectId: string): GoLiveCheck {
  const action: GoLiveCheck["action"] = {
    label: "Open Backups",
    href:  `/projects/${projectId}/backups`,
  };

  if (!ctx.latestBackup) {
    return check("backup", "Project backup", "backup", "fail",
      "No backup found. Create a backup before going live.", action);
  }

  const ageHours = (Date.now() - ctx.latestBackup.completedAt.getTime()) / 3_600_000;
  if (ageHours <= 24) {
    return check("backup", "Project backup", "backup", "pass",
      `Recent backup exists (${Math.round(ageHours)}h ago).`);
  }
  if (ageHours <= 168) {
    return check("backup", "Project backup", "backup", "warning",
      `Backup is ${Math.round(ageHours / 24)}d old. Create a fresh backup before go-live.`, action);
  }
  return check("backup", "Project backup", "backup", "fail",
    `Last backup is ${Math.round(ageHours / 24)} days old. Create a backup first.`, action);
}

// ── 2. Portability patches ────────────────────────────────────────────────────

export function checkAppUrlPatch(ctx: GoLiveContext, projectId: string): GoLiveCheck {
  const action: GoLiveCheck["action"] = {
    label: "Fix in Migration → Fix Issues",
    href:  `/projects/${projectId}/migration`,
  };

  if (!ctx.patchSummaries) {
    return check("patch_app_url", "APP_URL portability patch", "patches", "skip",
      "Source files not available — patch status could not be checked.");
  }

  const patch = ctx.patchSummaries.find((p) => p.id === "app-url-replacement");
  if (!patch) {
    return check("patch_app_url", "APP_URL portability patch", "patches", "skip",
      "APP_URL patch not applicable to this project.");
  }

  if (patch.status === "already_applied" || patch.status === "not_applicable") {
    return check("patch_app_url", "APP_URL portability patch", "patches", "pass",
      patch.status === "already_applied" ? "APP_URL helper already applied." : "Not applicable.");
  }
  if (patch.status === "blocked") {
    return check("patch_app_url", "APP_URL portability patch", "patches", "warning",
      `Patch is blocked: ${patch.statusReason ?? "check git/backup status"}.`, action);
  }
  return check("patch_app_url", "APP_URL portability patch", "patches", "fail",
    "REPLIT_DOMAINS usage detected. Apply the APP_URL patch to replace it.", action);
}

export function checkEmailTransportPatch(ctx: GoLiveContext, projectId: string): GoLiveCheck {
  const action: GoLiveCheck["action"] = {
    label: "Fix in Migration → Fix Issues",
    href:  `/projects/${projectId}/migration`,
  };

  if (!ctx.patchSummaries) {
    return check("patch_email", "Email transport patch", "patches", "skip",
      "Source files not available — patch status could not be checked.");
  }

  const patch = ctx.patchSummaries.find((p) => p.id === "email-transport-replacement");
  if (!patch) {
    return check("patch_email", "Email transport patch", "patches", "skip",
      "Email transport patch not applicable to this project.");
  }

  if (patch.status === "already_applied" || patch.status === "not_applicable") {
    return check("patch_email", "Email transport patch", "patches", "pass",
      patch.status === "already_applied" ? "Email transport patched (nodemailer)." : "Not applicable.");
  }
  if (patch.status === "blocked") {
    return check("patch_email", "Email transport patch", "patches", "warning",
      `Patch is blocked: ${patch.statusReason ?? "check git/backup status"}.`, action);
  }
  return check("patch_email", "Email transport patch", "patches", "fail",
    "@replit/connectors-sdk still in use. Apply the email transport patch.", action);
}

// ── 3. Secrets vault ──────────────────────────────────────────────────────────

/** Build the required key list from services + well-known groups. */
export function buildRequiredKeyGroups(ctx: GoLiveContext): {
  core:       string[];
  database:   string[];
  stripe:     string[];
  email:      string[];
  cloudinary: string[];
  service:    string[];
} {
  // Collect required keys from service records
  const serviceKeys = new Set<string>();
  for (const svc of ctx.services) {
    if (svc.requiredEnvKeysJson) {
      try {
        const keys: string[] = JSON.parse(svc.requiredEnvKeysJson);
        keys.forEach((k) => serviceKeys.add(k));
      } catch { /* ignore bad JSON */ }
    }
  }

  // Infer from configured keys (if already in vault, they're "expected")
  const hasStripeKeys = ctx.hasStripe || [...ctx.configuredKeys].some((k) => k.startsWith("STRIPE_"));
  const hasCloudinaryKeys = ctx.hasCloudinary || [...ctx.configuredKeys].some((k) => k.startsWith("CLOUDINARY_"));
  const hasSmtp = ctx.hasEmail || [...ctx.configuredKeys].some((k) => k.startsWith("SMTP_") || k === "RESEND_API_KEY");

  const core: string[]       = ["APP_URL", "SESSION_SECRET"];
  const database: string[]   = ["DATABASE_URL"];
  const stripe: string[]     = hasStripeKeys ? ["STRIPE_SECRET_KEY", "STRIPE_PUBLISHABLE_KEY", "STRIPE_WEBHOOK_SECRET"] : [];
  const email: string[]      = hasSmtp ? (
    ctx.configuredKeys.has("RESEND_API_KEY")
      ? ["RESEND_API_KEY", "RESEND_FROM"]
      : ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "SMTP_FROM"]
  ) : [];
  const cloudinary: string[] = hasCloudinaryKeys ? ["CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"] : [];
  const service: string[]    = [...serviceKeys].filter((k) => !core.includes(k) && !database.includes(k) && !stripe.includes(k) && !email.includes(k) && !cloudinary.includes(k));

  return { core, database, stripe, email, cloudinary, service };
}

export function checkCoreSecrets(ctx: GoLiveContext, projectId: string): GoLiveCheck {
  const required = ["APP_URL", "SESSION_SECRET"];
  const missing  = required.filter((k) => !ctx.configuredKeys.has(k));
  const action: GoLiveCheck["action"] = { label: "Open Secrets Vault", href: `/projects/${projectId}/env` };

  if (missing.length === 0) {
    return check("secrets_core", "Core secrets (APP_URL, SESSION_SECRET)", "secrets", "pass",
      "Core application secrets are configured.");
  }
  return check("secrets_core", "Core secrets (APP_URL, SESSION_SECRET)", "secrets", "fail",
    `Missing required secrets: ${missing.join(", ")}`, action);
}

export function checkDatabaseSecret(ctx: GoLiveContext, projectId: string): GoLiveCheck {
  const action: GoLiveCheck["action"] = { label: "Open Secrets Vault", href: `/projects/${projectId}/env` };
  if (ctx.configuredKeys.has("DATABASE_URL")) {
    return check("secrets_db", "DATABASE_URL configured", "database", "pass",
      "DATABASE_URL is present in the secrets vault.");
  }
  return check("secrets_db", "DATABASE_URL configured", "database", "fail",
    "DATABASE_URL is required for database connectivity.", action);
}

export function checkStripeSecrets(ctx: GoLiveContext, projectId: string): GoLiveCheck {
  const action: GoLiveCheck["action"] = { label: "Open Secrets Vault", href: `/projects/${projectId}/env` };
  const required = ["STRIPE_SECRET_KEY", "STRIPE_PUBLISHABLE_KEY", "STRIPE_WEBHOOK_SECRET"];
  const hasAny   = required.some((k) => ctx.configuredKeys.has(k));
  const allHave  = required.every((k) => ctx.configuredKeys.has(k));

  if (!ctx.hasStripe && !hasAny) {
    return check("secrets_stripe", "Stripe payment secrets", "payments", "skip",
      "Stripe not detected in this project.");
  }
  if (allHave) {
    return check("secrets_stripe", "Stripe payment secrets", "payments", "pass",
      "All Stripe keys (secret, publishable, webhook) are configured.");
  }
  const missing = required.filter((k) => !ctx.configuredKeys.has(k));
  return check("secrets_stripe", "Stripe payment secrets", "payments", "fail",
    `Missing Stripe keys: ${missing.join(", ")}`, action);
}

export function checkEmailSecrets(ctx: GoLiveContext, projectId: string): GoLiveCheck {
  const action: GoLiveCheck["action"] = { label: "Open Secrets Vault", href: `/projects/${projectId}/env` };
  const smtpKeys   = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "SMTP_FROM"];
  const resendKeys = ["RESEND_API_KEY", "RESEND_FROM"];

  const hasSmtp   = smtpKeys.every((k)   => ctx.configuredKeys.has(k));
  const hasResend = resendKeys.every((k) => ctx.configuredKeys.has(k));
  const anyEmail  = [...smtpKeys, ...resendKeys].some((k) => ctx.configuredKeys.has(k));

  if (!ctx.hasEmail && !anyEmail) {
    return check("secrets_email", "Email provider secrets", "email", "skip",
      "Email sending not detected in this project.");
  }
  if (hasSmtp || hasResend) {
    const provider = hasResend ? "Resend" : "SMTP";
    return check("secrets_email", "Email provider secrets", "email", "pass",
      `${provider} email provider is configured.`);
  }
  const missingGroup = smtpKeys.filter((k) => !ctx.configuredKeys.has(k));
  return check("secrets_email", "Email provider secrets", "email", "fail",
    `Email transport configured but missing: ${missingGroup.join(", ")}`, action);
}

export function checkCloudinarySecrets(ctx: GoLiveContext, projectId: string): GoLiveCheck {
  const action: GoLiveCheck["action"] = { label: "Open Secrets Vault", href: `/projects/${projectId}/env` };
  const required = ["CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"];
  const allHave  = required.every((k) => ctx.configuredKeys.has(k));
  const anyHave  = required.some((k) => ctx.configuredKeys.has(k));

  if (!ctx.hasCloudinary && !anyHave) {
    return check("secrets_cloudinary", "Cloudinary media secrets", "media", "skip",
      "Cloudinary not detected in this project.");
  }
  if (allHave) {
    return check("secrets_cloudinary", "Cloudinary media secrets", "media", "pass",
      "Cloudinary credentials are configured.");
  }
  const missing = required.filter((k) => !ctx.configuredKeys.has(k));
  return check("secrets_cloudinary", "Cloudinary media secrets", "media", "warning",
    `Missing Cloudinary keys: ${missing.join(", ")}`, action);
}

// ── 4. Database readiness ─────────────────────────────────────────────────────

export function checkDatabaseReadiness(ctx: GoLiveContext, projectId: string): GoLiveCheck {
  const dbType     = ctx.detectedDbType;
  const hasDrizzle = ctx.allContent?.includes("drizzle") ?? false;
  const hasPrisma  = ctx.allContent?.includes("@prisma/client") ?? false;

  let schemaCmd: string | undefined;
  if (hasDrizzle && dbType === "postgres") {
    schemaCmd = "pnpm --filter @workspace/db exec drizzle-kit push";
  } else if (hasDrizzle) {
    schemaCmd = "pnpm exec drizzle-kit push";
  } else if (hasPrisma) {
    schemaCmd = "pnpm prisma db push";
  }

  if (!ctx.configuredKeys.has("DATABASE_URL")) {
    return check("db_readiness", "Database schema ready", "database", "fail",
      "DATABASE_URL not configured — cannot verify database readiness.",
      { label: "Open Secrets Vault", href: `/projects/${projectId}/env` });
  }

  if (schemaCmd) {
    return check("db_readiness", "Database schema ready", "database", "manual",
      `Run schema push before first deployment. This cannot be automated safely.`,
      { label: "Copy command", copyText: schemaCmd });
  }

  return check("db_readiness", "Database schema ready", "database", "manual",
    "Ensure your database schema is applied before first production deployment.");
}

// ── 5. Service config ─────────────────────────────────────────────────────────

export function buildServiceChecks(ctx: GoLiveContext): GoLiveServiceCheck[] {
  if (ctx.services.length === 0) return [];

  return ctx.services.map((svc): GoLiveServiceCheck => {
    const issues: string[] = [];
    let commandsValid = true;

    for (const [label, cmd] of [
      ["Install", svc.installCommand],
      ["Build",   svc.buildCommand],
      ["Start",   svc.startCommand],
    ] as const) {
      if (cmd) {
        const r = validateServiceCommand(cmd);
        if (!r.ok) { issues.push(`${label} command invalid: ${r.error}`); commandsValid = false; }
      }
    }

    const portAssigned        = svc.serviceType !== "node" || svc.internalPort !== null;
    const healthPathValid     = svc.serviceType !== "node" || !svc.healthPath || svc.healthPath.startsWith("/");
    const staticOutputConfigured = svc.serviceType !== "static" || !!svc.staticOutputDir;

    if (!portAssigned)            issues.push("No port assigned");
    if (!healthPathValid)         issues.push("Health path must start with /");
    if (!staticOutputConfigured)  issues.push("No static output directory configured");
    if (!svc.isEnabled)           issues.push("Service is disabled");

    return {
      serviceId:              svc.id,
      serviceName:            svc.name,
      serviceType:            svc.serviceType,
      slug:                   svc.slug,
      internalPort:           svc.internalPort,
      commandsValid,
      portAssigned,
      healthPathValid,
      staticOutputConfigured,
      isEnabled:              svc.isEnabled,
      lastStatus:             svc.lastStatus,
      pm2Name:                `project-${ctx.projectSlug}-${svc.slug}`,
      issues,
    };
  });
}

export function checkServiceConfig(ctx: GoLiveContext, projectId: string): GoLiveCheck {
  const action: GoLiveCheck["action"] = {
    label: "Open Services",
    href:  `/projects/${projectId}/publishing`,
  };

  if (ctx.services.length === 0) {
    return check("services_config", "Service configuration", "services", "warning",
      "No multi-service config found. Configure services in Publishing before deploying.", action);
  }

  const enabled = ctx.services.filter((s) => s.isEnabled);
  if (enabled.length === 0) {
    return check("services_config", "Service configuration", "services", "fail",
      "All services are disabled.", action);
  }

  const issues: string[] = [];
  let commandsValid = true;

  for (const svc of enabled) {
    for (const [label, cmd] of [["Install", svc.installCommand], ["Build", svc.buildCommand], ["Start", svc.startCommand]] as const) {
      if (cmd) {
        const r = validateServiceCommand(cmd);
        if (!r.ok) { issues.push(`${svc.name} ${label}: ${r.error}`); commandsValid = false; }
      }
    }
    if (svc.serviceType === "node" && !svc.internalPort) issues.push(`${svc.name}: no port`);
    if (svc.serviceType === "static" && !svc.staticOutputDir) issues.push(`${svc.name}: no output dir`);
  }

  if (!commandsValid || issues.length > 0) {
    return check("services_config", "Service configuration", "services", "warning",
      `${enabled.length} service(s) configured, ${issues.length} issue(s): ${issues.slice(0, 2).join("; ")}${issues.length > 2 ? "…" : ""}`, action);
  }

  const nodeServices   = enabled.filter((s) => s.serviceType === "node");
  const staticServices = enabled.filter((s) => s.serviceType === "static");
  return check("services_config", "Service configuration", "services", "pass",
    `${nodeServices.length} API service(s), ${staticServices.length} static service(s) — all valid.`);
}

// ── 6. Build validation ───────────────────────────────────────────────────────

export function checkBuildValidation(ctx: GoLiveContext, projectId: string): GoLiveCheck {
  if (ctx.services.length === 0) {
    return check("build_validation", "Build commands validated", "build", "skip",
      "No services configured — nothing to validate.");
  }

  const errors: string[] = [];
  const warnings: string[] = [];

  for (const svc of ctx.services.filter((s) => s.isEnabled)) {
    if (!svc.buildCommand && !svc.startCommand) {
      warnings.push(`${svc.name}: no build or start command`);
      continue;
    }
    for (const [label, cmd] of [["Install", svc.installCommand], ["Build", svc.buildCommand], ["Start", svc.startCommand]] as const) {
      if (!cmd) continue;
      const r = validateServiceCommand(cmd);
      if (!r.ok) errors.push(`${svc.name} ${label}: ${r.error}`);
    }
  }

  if (errors.length > 0) {
    return check("build_validation", "Build commands validated", "build", "fail",
      `${errors.length} invalid command(s): ${errors.slice(0, 2).join("; ")}${errors.length > 2 ? "…" : ""}`,
      { label: "Open Services", href: `/projects/${projectId}/publishing` });
  }
  if (warnings.length > 0) {
    return check("build_validation", "Build commands validated", "build", "warning",
      `Commands validated. Warnings: ${warnings.join("; ")}`);
  }
  return check("build_validation", "Build commands validated", "build", "pass",
    "All service build and start commands are valid.");
}

// ── 7. API health ─────────────────────────────────────────────────────────────

export function buildApiHealthCheck(
  svc:         DbService,
  projectSlug: string,
  healthOk:    boolean | null,  // null = not checked (not deployed)
  httpStatus?: number,
): GoLiveCheck {
  const pm2Name = `project-${projectSlug}-${svc.slug}`;

  if (svc.lastStatus === null || svc.lastStatus === undefined) {
    return check(`health_${svc.slug}`, `API health: ${svc.name}`, "services", "warning",
      `${svc.name} has not been deployed yet. Deploy it from Publishing first.`);
  }
  if (svc.lastStatus !== "success") {
    return check(`health_${svc.slug}`, `API health: ${svc.name}`, "services", "warning",
      `Last deployment was '${svc.lastStatus}'. Redeploy to fix.`);
  }
  if (healthOk === null) {
    return check(`health_${svc.slug}`, `API health: ${svc.name}`, "services", "warning",
      `Service deployed but health could not be checked (port ${svc.internalPort}).`);
  }
  if (healthOk) {
    return check(`health_${svc.slug}`, `API health: ${svc.name}`, "services", "pass",
      `${pm2Name} is responding (HTTP ${httpStatus ?? "2xx"}) on port ${svc.internalPort}.`);
  }
  return check(`health_${svc.slug}`, `API health: ${svc.name}`, "services", "fail",
    `${pm2Name} is deployed but health endpoint ${svc.healthPath ?? "/"} is not responding.`);
}

// ── 8. Static frontend ────────────────────────────────────────────────────────

export function buildStaticFrontendCheck(
  svc:          DbService,
  indexExists:  boolean | null,  // null = not checked
): GoLiveCheck {
  if (!svc.staticOutputDir) {
    return check(`static_${svc.slug}`, `Static output: ${svc.name}`, "build", "fail",
      `${svc.name}: no static output directory configured.`);
  }
  if (svc.lastStatus === null) {
    return check(`static_${svc.slug}`, `Static output: ${svc.name}`, "build", "warning",
      `${svc.name} has not been deployed yet — output dir (${svc.staticOutputDir}) not built.`);
  }
  if (indexExists === null) {
    return check(`static_${svc.slug}`, `Static output: ${svc.name}`, "build", "warning",
      `Output dir ${svc.staticOutputDir} could not be checked.`);
  }
  if (indexExists) {
    const spaNote = svc.spaFallback ? " SPA fallback enabled." : "";
    return check(`static_${svc.slug}`, `Static output: ${svc.name}`, "build", "pass",
      `index.html found in ${svc.staticOutputDir}.${spaNote}`);
  }
  return check(`static_${svc.slug}`, `Static output: ${svc.name}`, "build", "fail",
    `index.html not found in ${svc.staticOutputDir}. Run a fresh deployment.`);
}

// ── 9. Domain routing ─────────────────────────────────────────────────────────

export function checkDomainRouting(ctx: GoLiveContext, projectId: string): GoLiveCheck {
  const action: GoLiveCheck["action"] = { label: "Open Domains", href: `/projects/${projectId}/domains` };

  if (ctx.domains.length === 0) {
    return check("domain", "Domain configured", "domain", "warning",
      "No domain configured. Add a domain in the Domains tab before public go-live.", action);
  }

  const active  = ctx.domains.find((d) => d.status === "ACTIVE");
  const primary = ctx.domains.find((d) => d.isPrimary);

  if (active && primary) {
    return check("domain", "Domain configured", "domain", "pass",
      `Primary domain active: ${primary.hostname}. Run Domain Health checks for DNS and SSL status.`);
  }
  if (active) {
    return check("domain", "Domain configured", "domain", "pass",
      `Active domain: ${active.hostname}. Run Domain Health checks for DNS and SSL status.`);
  }

  const pending = ctx.domains.find((d) => d.status === "PENDING");
  if (pending) {
    return check("domain", "Domain configured", "domain", "warning",
      `Domain ${pending.hostname} is pending DNS verification.`, action);
  }

  return check("domain", "Domain configured", "domain", "warning",
    "No active domain found. Add or verify a domain.", action);
}

// ── 10–12. External tasks ─────────────────────────────────────────────────────

export function buildExternalTasks(ctx: GoLiveContext): GoLiveExternalTask[] {
  const tasks: GoLiveExternalTask[] = [];

  // Stripe webhook
  if (ctx.hasStripe || [...ctx.configuredKeys].some((k) => k.startsWith("STRIPE_"))) {
    tasks.push({
      id:       "stripe_webhook",
      title:    "Configure Stripe webhook",
      provider: "stripe",
      status:   "manual_required",
      instructions: [
        "Go to Stripe Dashboard → Developers → Webhooks.",
        "Add endpoint: https://<your-domain>/api/webhooks/stripe",
        "Select events: payment_intent.succeeded, checkout.session.completed, customer.subscription.*",
        "Copy the signing secret into STRIPE_WEBHOOK_SECRET in your Secrets Vault.",
      ],
    });
  }

  // Email provider
  if (ctx.hasEmail || [...ctx.configuredKeys].some((k) => k.startsWith("SMTP_") || k === "RESEND_API_KEY")) {
    const usesResend = ctx.configuredKeys.has("RESEND_API_KEY");
    tasks.push({
      id:       "email_provider",
      title:    usesResend ? "Verify Resend sending domain" : "Verify SMTP provider",
      provider: "email",
      status:   "manual_required",
      instructions: usesResend ? [
        "In Resend Dashboard, verify your sending domain.",
        "Set RESEND_FROM to your verified sender address.",
        "Test by sending a verification email via the dashboard.",
      ] : [
        "Confirm SMTP credentials are for your production provider (not Replit's Gmail connector).",
        "Test delivery by sending a test email via your SMTP provider.",
        "Ensure SMTP_FROM matches a verified sender address.",
      ],
    });
  }

  // DNS / domain
  const hasActiveDomain = ctx.domains.some((d) => d.status === "ACTIVE");
  if (!hasActiveDomain) {
    const hostname = ctx.domains[0]?.hostname;
    tasks.push({
      id:       "dns_setup",
      title:    "Configure DNS for domain",
      provider: "dns",
      status:   "manual_required",
      instructions: [
        hostname
          ? `Add a CNAME or A record for ${hostname} pointing to your server IP.`
          : "Add your domain in Prisom Domains tab, then create a DNS CNAME or A record.",
        "SSL certificate is auto-issued after DNS propagation.",
        "DNS may take up to 48h to propagate.",
      ],
    });
  }

  // Cloudinary
  if (ctx.hasCloudinary || [...ctx.configuredKeys].some((k) => k.startsWith("CLOUDINARY_"))) {
    const missing = ["CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"]
      .filter((k) => !ctx.configuredKeys.has(k));
    if (missing.length > 0) {
      tasks.push({
        id:       "cloudinary_setup",
        title:    "Cloudinary credentials",
        provider: "cloudinary",
        status:   "manual_required",
        instructions: [
          "Go to Cloudinary Console → Settings → Access Keys.",
          `Copy ${missing.join(", ")} into your Secrets Vault.`,
          "Upload existing media assets to your Cloudinary account.",
        ],
      });
    }
  }

  // Database restore
  tasks.push({
    id:       "db_schema",
    title:    "Apply database schema / restore",
    provider: "database",
    status:   "manual_required",
    instructions: [
      "Run schema push command before first deployment (see Database check above).",
      "If restoring from a pg_dump: use pg_restore manually from the Prisom terminal.",
      "Do NOT run pg_restore automatically — verify your target database first.",
    ],
  });

  return tasks;
}
