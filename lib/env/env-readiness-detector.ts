/**
 * lib/env/env-readiness-detector.ts
 *
 * Sprint 46: Builds an EnvReadinessReport for a project.
 *
 * Detection strategy (in priority order):
 *  1. ProjectMigrationReport.reportJson.requiredSecrets — file-scanned names
 *  2. Provider templates — standard vars for detected ORM/payments/email/media
 *  3. .env.example / env.example file in project storage — key names only
 *  4. Cross-reference with what is actually in the secrets vault
 *
 * Safety rules:
 *  - Raw values are only accessed for classification; never returned
 *  - maskedPreview only — no plaintext
 *  - Never reads files outside storage/projects/{slug}
 */

import path           from "path";
import { promises as fs } from "fs";
import { db }          from "@/lib/db";
import { decryptEnvValue } from "@/lib/projects/env-manager";
import { classifyEnvValue, buildMaskedPreview, isPlaceholder } from "./env-value-safety";
import type {
  EnvReadinessReport,
  EnvReadinessFinding,
  EnvVarCategory,
  EnvVarSeverity,
  EnvVarStatus,
  EnvRecommendedAction,
  EnvReadinessStatus,
} from "./env-readiness-types";

// ── Provider template registry ────────────────────────────────────────────────

type TemplateDef = {
  name:        string;
  category:    EnvVarCategory;
  severity:    EnvVarSeverity;
  description: string;
  fixHint:     string;
};

const DB_VARS: TemplateDef[] = [
  { name: "DATABASE_URL",         category: "database", severity: "required",    description: "Primary database connection URL", fixHint: "Add the production database URL from your provider (Neon, Supabase, etc.)." },
  { name: "DIRECT_URL",           category: "database", severity: "recommended", description: "Direct connection URL (bypasses pooler)", fixHint: "Required by Neon/Supabase when using Prisma migrate — set to the non-pooling URL." },
  { name: "SHADOW_DATABASE_URL",  category: "database", severity: "optional",    description: "Prisma shadow database for migrations", fixHint: "Only needed for `prisma migrate dev` — not required in production." },
];

const STRIPE_VARS: TemplateDef[] = [
  { name: "STRIPE_SECRET_KEY",      category: "stripe", severity: "required",    description: "Stripe secret key (server-side only)", fixHint: "Use the live secret key from Stripe Dashboard → API Keys." },
  { name: "STRIPE_PUBLISHABLE_KEY", category: "stripe", severity: "required",    description: "Stripe publishable key (client-safe)", fixHint: "Use the live publishable key from Stripe Dashboard → API Keys." },
  { name: "STRIPE_WEBHOOK_SECRET",  category: "stripe", severity: "recommended", description: "Stripe webhook signing secret", fixHint: "Set up a webhook in Stripe Dashboard and copy the signing secret." },
];

const CLOUDINARY_VARS: TemplateDef[] = [
  { name: "CLOUDINARY_CLOUD_NAME", category: "cloudinary", severity: "required",    description: "Cloudinary cloud name", fixHint: "Find in Cloudinary Dashboard → Settings → General." },
  { name: "CLOUDINARY_API_KEY",    category: "cloudinary", severity: "required",    description: "Cloudinary API key", fixHint: "Find in Cloudinary Dashboard → Settings → API Keys." },
  { name: "CLOUDINARY_API_SECRET", category: "cloudinary", severity: "required",    description: "Cloudinary API secret", fixHint: "Find in Cloudinary Dashboard → Settings → API Keys." },
];

const EMAIL_SMTP_VARS: TemplateDef[] = [
  { name: "SMTP_HOST",  category: "email", severity: "required",    description: "SMTP server hostname", fixHint: "Your email provider SMTP host (e.g. smtp.sendgrid.net)." },
  { name: "SMTP_PORT",  category: "email", severity: "required",    description: "SMTP port", fixHint: "465 for SSL, 587 for STARTTLS." },
  { name: "SMTP_USER",  category: "email", severity: "required",    description: "SMTP username", fixHint: "Your SMTP username (often the sending email address)." },
  { name: "SMTP_PASS",  category: "email", severity: "required",    description: "SMTP password", fixHint: "Your SMTP password or API key used as password." },
  { name: "SMTP_FROM",  category: "email", severity: "recommended", description: "Sender email address", fixHint: "The From address for outgoing emails." },
];

const EMAIL_RESEND_VARS: TemplateDef[] = [
  { name: "RESEND_API_KEY", category: "email", severity: "required", description: "Resend API key", fixHint: "Create an API key in the Resend Dashboard." },
];

const EMAIL_SENDGRID_VARS: TemplateDef[] = [
  { name: "SENDGRID_API_KEY", category: "email", severity: "required", description: "SendGrid API key", fixHint: "Create an API key in the SendGrid Dashboard." },
];

const AUTH_VARS: TemplateDef[] = [
  { name: "SESSION_SECRET",          category: "auth", severity: "required",    description: "Session signing secret (32+ chars)", fixHint: "Generate a strong random secret: `openssl rand -hex 32`." },
  { name: "JWT_SECRET",              category: "auth", severity: "required",    description: "JWT signing secret", fixHint: "Generate a strong random secret: `openssl rand -hex 32`." },
  { name: "NEXTAUTH_SECRET",         category: "auth", severity: "required",    description: "NextAuth.js secret", fixHint: "Generate with `openssl rand -base64 32`." },
  { name: "AUTH_SECRET",             category: "auth", severity: "required",    description: "Auth.js v5 secret", fixHint: "Generate with `openssl rand -base64 32`." },
  { name: "MASTER_RECOVERY_KEY_HASH", category: "auth", severity: "optional",   description: "Master recovery key hash", fixHint: "Only needed if your app supports master key recovery." },
];

const APP_URL_VARS: TemplateDef[] = [
  { name: "APP_URL",               category: "app_url", severity: "required",    description: "Production app URL", fixHint: "Set to your production domain: https://yourdomain.com." },
  { name: "PUBLIC_APP_URL",        category: "app_url", severity: "recommended", description: "Public-facing app URL", fixHint: "Same as APP_URL — used in some frameworks." },
  { name: "NEXT_PUBLIC_APP_URL",   category: "app_url", severity: "recommended", description: "Next.js public app URL", fixHint: "NEXT_PUBLIC_ prefix makes this available client-side." },
  { name: "VITE_APP_URL",          category: "app_url", severity: "recommended", description: "Vite public app URL", fixHint: "VITE_ prefix makes this available in Vite frontend code." },
  { name: "NEXTAUTH_URL",          category: "app_url", severity: "required",    description: "NextAuth.js canonical URL", fixHint: "Must match your production domain exactly." },
];

const OAUTH_VARS: TemplateDef[] = [
  { name: "GOOGLE_CLIENT_ID",     category: "oauth", severity: "required",    description: "Google OAuth client ID", fixHint: "Find in Google Cloud Console → APIs & Services → Credentials." },
  { name: "GOOGLE_CLIENT_SECRET", category: "oauth", severity: "required",    description: "Google OAuth client secret", fixHint: "Find in Google Cloud Console → APIs & Services → Credentials." },
  { name: "GITHUB_CLIENT_ID",     category: "oauth", severity: "required",    description: "GitHub OAuth App client ID", fixHint: "Find in GitHub Settings → Developer Settings → OAuth Apps." },
  { name: "GITHUB_CLIENT_SECRET", category: "oauth", severity: "required",    description: "GitHub OAuth App client secret", fixHint: "Find in GitHub Settings → Developer Settings → OAuth Apps." },
];

const STORAGE_VARS: TemplateDef[] = [
  { name: "S3_BUCKET",           category: "storage", severity: "required",    description: "S3 bucket name", fixHint: "The name of your S3 bucket." },
  { name: "S3_ACCESS_KEY_ID",    category: "storage", severity: "required",    description: "AWS access key ID", fixHint: "IAM user access key with S3 permissions." },
  { name: "S3_SECRET_ACCESS_KEY", category: "storage", severity: "required",   description: "AWS secret access key", fixHint: "IAM user secret key — keep this confidential." },
  { name: "AWS_REGION",          category: "storage", severity: "required",    description: "AWS region", fixHint: "e.g. eu-west-1 or us-east-1." },
  { name: "R2_ACCOUNT_ID",       category: "storage", severity: "required",    description: "Cloudflare R2 account ID", fixHint: "Find in Cloudflare Dashboard → R2." },
  { name: "R2_ACCESS_KEY_ID",    category: "storage", severity: "required",    description: "R2 access key ID", fixHint: "Create in Cloudflare R2 → Manage R2 API Tokens." },
  { name: "R2_SECRET_ACCESS_KEY", category: "storage", severity: "required",   description: "R2 secret access key", fixHint: "Create in Cloudflare R2 → Manage R2 API Tokens." },
];

const REPLIT_VARS: TemplateDef[] = [
  { name: "REPLIT_DOMAINS", category: "replit", severity: "optional", description: "Replit domain list (Replit-specific)", fixHint: "Remove or replace with APP_URL — this only works on Replit." },
  { name: "REPL_ID",        category: "replit", severity: "optional", description: "Replit REPL ID (Replit-specific)", fixHint: "Remove — this is injected automatically by Replit and not needed on VPS." },
  { name: "REPL_SLUG",      category: "replit", severity: "optional", description: "Replit REPL slug (Replit-specific)", fixHint: "Remove — this is injected automatically by Replit and not needed on VPS." },
  { name: "REPL_OWNER",     category: "replit", severity: "optional", description: "Replit owner username (Replit-specific)", fixHint: "Remove — this is injected automatically by Replit and not needed on VPS." },
];

// ── Category map for quick lookup ─────────────────────────────────────────────

const ALL_TEMPLATES: TemplateDef[] = [
  ...DB_VARS, ...STRIPE_VARS, ...CLOUDINARY_VARS, ...EMAIL_SMTP_VARS,
  ...EMAIL_RESEND_VARS, ...EMAIL_SENDGRID_VARS, ...AUTH_VARS, ...APP_URL_VARS,
  ...OAUTH_VARS, ...STORAGE_VARS, ...REPLIT_VARS,
];

const TEMPLATE_MAP = new Map<string, TemplateDef>(ALL_TEMPLATES.map((t) => [t.name, t]));

function categoryForName(name: string): EnvVarCategory {
  const t = TEMPLATE_MAP.get(name);
  if (t) return t.category;
  const n = name.toUpperCase();
  if (n.includes("DATABASE") || n.includes("POSTGRES") || n === "MONGODB_URI")       return "database";
  if (n.startsWith("STRIPE_"))                                                         return "stripe";
  if (n.startsWith("CLOUDINARY_"))                                                     return "cloudinary";
  if (n.includes("SMTP") || n.includes("RESEND") || n.includes("SENDGRID") ||
      n.includes("MAILGUN") || n.includes("POSTMARK"))                                 return "email";
  if (n.includes("SECRET") || n.includes("AUTH") || n.includes("SESSION") ||
      n.includes("JWT"))                                                               return "auth";
  if (n === "APP_URL" || n.includes("APP_URL") || n === "NEXTAUTH_URL")               return "app_url";
  if (n.includes("GOOGLE_") || n.includes("GITHUB_") || n.includes("OAUTH") ||
      n.includes("FACEBOOK_") || n.includes("TWITTER_"))                              return "oauth";
  if (n.startsWith("S3_") || n.startsWith("AWS_") || n.startsWith("R2_"))             return "storage";
  if (n.startsWith("REPLIT_") || n.startsWith("REPL_"))                               return "replit";
  if (n.startsWith("GA_") || n.startsWith("PLAUSIBLE_") || n.includes("ANALYTICS"))   return "analytics";
  return "unknown";
}

// ── Migration report secret category mapping ──────────────────────────────────

function migrationCategoryToEnv(
  migCategory: string,
  name:        string,
): { category: EnvVarCategory; severity: EnvVarSeverity } {
  const precise = categoryForName(name);
  if (precise !== "unknown") {
    return { category: precise, severity: migCategory === "database" || migCategory === "auth" ? "required" : "recommended" };
  }
  switch (migCategory) {
    case "database":       return { category: "database",   severity: "required" };
    case "payments":       return { category: "stripe",     severity: "required" };
    case "email":          return { category: "email",      severity: "recommended" };
    case "media":          return { category: "cloudinary", severity: "recommended" };
    case "auth":           return { category: "auth",       severity: "required" };
    case "app":            return { category: "app_url",    severity: "required" };
    case "replit-specific":return { category: "replit",     severity: "optional" };
    default:               return { category: "unknown",    severity: "optional" };
  }
}

// ── .env.example file parsing ─────────────────────────────────────────────────

async function parseEnvExampleFile(slug: string): Promise<Set<string>> {
  const storage = path.resolve(process.cwd(), "storage", "projects");
  const candidates = [
    path.join(storage, slug, ".env.example"),
    path.join(storage, slug, "env.example"),
    path.join(storage, slug, ".env.local.example"),
  ];
  const keys = new Set<string>();
  for (const filePath of candidates) {
    try {
      const content = await fs.readFile(filePath, "utf8");
      for (const line of content.split(/\r?\n/)) {
        const stripped = line.trim();
        if (!stripped || stripped.startsWith("#")) continue;
        const eqIdx = stripped.indexOf("=");
        const key   = eqIdx !== -1 ? stripped.slice(0, eqIdx).trim() : stripped;
        if (/^[A-Z][A-Z0-9_]*$/.test(key)) keys.add(key);
      }
      break; // found one, stop looking
    } catch {
      // file not found — continue
    }
  }
  return keys;
}

// ── Vault state loading ───────────────────────────────────────────────────────

type VaultState = Map<string, { encrypted: string; isEnabled: boolean }>;

async function loadVaultState(projectId: string): Promise<VaultState> {
  const rows = await db.projectEnvVar.findMany({
    where:  { projectId, environment: "production" },
    select: { name: true, value: true, isEnabled: true },
  });
  return new Map(rows.map((r) => [r.name, { encrypted: r.value, isEnabled: r.isEnabled }]));
}

// ── Building findings ─────────────────────────────────────────────────────────

async function buildFinding(
  template:    TemplateDef,
  source:      EnvReadinessFinding["source"],
  evidence:    string[],
  vault:       VaultState,
): Promise<EnvReadinessFinding> {
  const record = vault.get(template.name);

  if (!record) {
    return {
      name:            template.name,
      category:        template.category,
      severity:        template.severity,
      status:          "missing" as EnvVarStatus,
      presentInVault:  false,
      valueConfigured: false,
      source,
      evidence,
      description:     template.description,
      fixHint:         template.fixHint,
    };
  }

  // Decrypt to classify (never returned)
  let status: EnvVarStatus = "configured";
  let maskedPreview: string | undefined;

  try {
    const raw = decryptEnvValue(record.encrypted);
    status        = classifyEnvValue(template.name, raw);
    maskedPreview = status === "configured" || status === "suspicious"
      ? buildMaskedPreview(template.name, raw)
      : undefined;

    // Also check if disabled (isEnabled: false = placeholder from migration wizard)
    if (!record.isEnabled && (status === "configured" || status === "empty")) {
      status = "placeholder";
    }
  } catch {
    status = "placeholder"; // decrypt failure — treat as misconfigured
  }

  return {
    name:            template.name,
    category:        template.category,
    severity:        template.severity,
    status,
    presentInVault:  true,
    valueConfigured: status === "configured" || status === "suspicious",
    maskedPreview,
    source,
    evidence,
    description:     template.description,
    fixHint:         template.fixHint,
  };
}

// ── Recommended actions ───────────────────────────────────────────────────────

function buildRecommendedActions(
  findings: EnvReadinessFinding[],
): EnvRecommendedAction[] {
  const actions: EnvRecommendedAction[] = [];

  const missingRequired = findings.filter(
    (f) => f.severity === "required" && f.status === "missing",
  );
  if (missingRequired.length > 0) {
    actions.push({
      id:                   "create_missing_placeholders",
      type:                 "create_placeholder",
      label:                `Create ${missingRequired.length} missing placeholder(s)`,
      description:          "Create placeholder env var records so you can easily fill in the real values via the Secrets Vault.",
      envNames:             missingRequired.map((f) => f.name),
      confirmationRequired: false,
    });
  }

  const placeholders = findings.filter((f) => f.status === "placeholder");
  if (placeholders.length > 0) {
    actions.push({
      id:                   "replace_placeholders",
      type:                 "replace_placeholder",
      label:                `Replace ${placeholders.length} placeholder(s) with real values`,
      description:          "Open the Secrets Vault and enter the production values for these env vars.",
      envNames:             placeholders.map((f) => f.name),
      confirmationRequired: false,
    });
  }

  const replitLeftovers = findings.filter(
    (f) => f.category === "replit" && f.presentInVault,
  );
  if (replitLeftovers.length > 0) {
    actions.push({
      id:                   "remove_replit_leftovers",
      type:                 "remove_replit_leftover",
      label:                `Review ${replitLeftovers.length} Replit-specific var(s)`,
      description:          "These vars are injected by Replit and may not work on VPS. Consider removing them.",
      envNames:             replitLeftovers.map((f) => f.name),
      confirmationRequired: true,
    });
  }

  const suspicious = findings.filter((f) => f.status === "suspicious");
  if (suspicious.length > 0) {
    actions.push({
      id:                   "review_suspicious",
      type:                 "verify_provider",
      label:                `Review ${suspicious.length} suspicious value(s)`,
      description:          "These values look like test/development values. Replace with production values before going live.",
      envNames:             suspicious.map((f) => f.name),
      confirmationRequired: false,
    });
  }

  return actions;
}

// ── Score / status ────────────────────────────────────────────────────────────

function computeStatus(findings: EnvReadinessFinding[]): EnvReadinessStatus {
  const hasRequiredBlocked = findings.some(
    (f) => f.severity === "required" && (f.status === "missing" || f.status === "empty" || f.status === "placeholder"),
  );
  if (hasRequiredBlocked) return "blocked";

  const hasWarning = findings.some(
    (f) => f.status === "suspicious" || f.status === "placeholder" ||
      (f.severity === "recommended" && (f.status === "missing" || f.status === "empty")),
  );
  if (hasWarning) return "warning";

  return "ready";
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function generateEnvReadinessReport(
  projectId: string,
): Promise<EnvReadinessReport | null> {
  const project = await db.project.findUnique({
    where:  { id: projectId },
    select: { id: true, slug: true },
  });
  if (!project) return null;

  // Load all sources in parallel
  const [vault, services, envExampleKeys] = await Promise.all([
    loadVaultState(projectId),
    db.projectService.findMany({
      where:  { projectId, isEnabled: true },
      select: { name: true, buildCommand: true, startCommand: true },
    }),
    parseEnvExampleFile(project.slug),
  ]);

  // Load migration report
  type MigSecret = { name: string; category: string; required: boolean; notes?: string };
  let migrationSecrets: MigSecret[] = [];
  let migrationDb: { orm?: string } | null = null;
  let migrationPayments: { provider?: string }[] = [];
  let migrationEmail: { provider?: string; isReplitConnector?: boolean } | null = null;
  let migrationMedia: { provider?: string } | null = null;
  try {
    const report = await db.projectMigrationReport.findFirst({
      where:   { projectId },
      orderBy: { createdAt: "desc" },
      select:  { reportJson: true },
    });
    if (report?.reportJson && typeof report.reportJson === "object") {
      const json = report.reportJson as Record<string, unknown>;
      if (Array.isArray(json["requiredSecrets"])) {
        migrationSecrets = json["requiredSecrets"] as MigSecret[];
      }
      if (json["database"] && typeof json["database"] === "object") {
        const raw = json["database"] as Record<string, unknown>;
        migrationDb = {
          orm: typeof raw["orm"] === "string" ? raw["orm"] : undefined,
        };
      }
      if (Array.isArray(json["payments"])) {
        migrationPayments = (json["payments"] as unknown[]).map((p) => {
          const pr = p && typeof p === "object" ? (p as Record<string, unknown>) : {};
          return { provider: typeof pr["provider"] === "string" ? pr["provider"] : undefined };
        });
      }
      if (json["email"] && typeof json["email"] === "object") {
        const raw = json["email"] as Record<string, unknown>;
        migrationEmail = {
          provider:            typeof raw["provider"] === "string"            ? raw["provider"]            : undefined,
          isReplitConnector:   typeof raw["isReplitConnector"] === "boolean"  ? raw["isReplitConnector"]   : undefined,
        };
      }
      if (json["media"] && typeof json["media"] === "object") {
        const raw = json["media"] as Record<string, unknown>;
        migrationMedia = {
          provider: typeof raw["provider"] === "string" ? raw["provider"] : undefined,
        };
      }
    }
  } catch {
    // No migration report — continue with templates only
  }

  // ── Build the set of vars to check ─────────────────────────────────────────

  const varMap = new Map<string, { template: TemplateDef; source: EnvReadinessFinding["source"]; evidence: string[] }>();

  function addVar(t: TemplateDef, source: EnvReadinessFinding["source"], evidence: string) {
    if (!varMap.has(t.name)) {
      varMap.set(t.name, { template: t, source, evidence: [evidence] });
    } else {
      varMap.get(t.name)!.evidence.push(evidence);
    }
  }

  // 1. Migration report secrets
  for (const sec of migrationSecrets) {
    const tmpl = TEMPLATE_MAP.get(sec.name);
    const { category, severity } = migrationCategoryToEnv(sec.category, sec.name);
    const effective: TemplateDef = tmpl ?? {
      name:        sec.name,
      category,
      severity:    sec.required ? "required" : severity,
      description: sec.notes ?? `${sec.name} detected in project source`,
      fixHint:     `Add ${sec.name} to the Secrets Vault with a production value.`,
    };
    addVar(effective, "migration_report", "detected in project source files");
  }

  // 2. Provider templates based on detected features
  if (migrationDb?.orm === "prisma" || migrationDb?.orm === "drizzle") {
    DB_VARS.forEach((v) => addVar(v, "template", `database ORM detected: ${migrationDb?.orm}`));
  }

  const hasStripe = migrationPayments.some((p) => (p.provider ?? "").toLowerCase().includes("stripe"));
  if (hasStripe) {
    STRIPE_VARS.forEach((v) => addVar(v, "template", "Stripe integration detected"));
  }

  const hasCloudinary = (migrationMedia?.provider ?? "").toLowerCase().includes("cloudinary");
  if (hasCloudinary) {
    CLOUDINARY_VARS.forEach((v) => addVar(v, "template", "Cloudinary media provider detected"));
  }

  if (migrationEmail) {
    const emailProvider = (migrationEmail.provider ?? "").toLowerCase();
    if (emailProvider.includes("resend")) {
      EMAIL_RESEND_VARS.forEach((v) => addVar(v, "template", "Resend email provider detected"));
    } else if (emailProvider.includes("sendgrid")) {
      EMAIL_SENDGRID_VARS.forEach((v) => addVar(v, "template", "SendGrid email provider detected"));
    } else if (emailProvider !== "unknown" && emailProvider !== "none") {
      EMAIL_SMTP_VARS.forEach((v) => addVar(v, "template", "SMTP email provider detected"));
    }
  }

  // 3. .env.example keys
  for (const key of envExampleKeys) {
    const tmpl = TEMPLATE_MAP.get(key);
    const effective: TemplateDef = tmpl ?? {
      name:        key,
      category:    categoryForName(key),
      severity:    "optional" as EnvVarSeverity,
      description: `${key} found in .env.example`,
      fixHint:     `Add ${key} to the Secrets Vault with a production value.`,
    };
    addVar(effective, "code", ".env.example");
  }

  // 4. Service commands
  const serviceSignals: Record<string, TemplateDef[]> = {
    stripe:     STRIPE_VARS,
    cloudinary: CLOUDINARY_VARS,
    prisma:     DB_VARS,
    drizzle:    DB_VARS,
    nextauth:   AUTH_VARS,
    resend:     EMAIL_RESEND_VARS,
    sendgrid:   EMAIL_SENDGRID_VARS,
  };
  for (const svc of services) {
    const combined = `${svc.buildCommand ?? ""} ${svc.startCommand ?? ""}`.toLowerCase();
    for (const [keyword, templates] of Object.entries(serviceSignals)) {
      if (combined.includes(keyword)) {
        templates.forEach((v) => addVar(v, "service", `service "${svc.name}" uses ${keyword}`));
      }
    }
  }

  // 5. Replit-specific — include if any are present in vault
  for (const v of REPLIT_VARS) {
    if (vault.has(v.name)) {
      addVar(v, "template", "Replit env var found in vault (leftover from migration)");
    }
  }

  // ── Build findings ──────────────────────────────────────────────────────────

  const findingPromises: Promise<EnvReadinessFinding>[] = [];
  for (const [, entry] of varMap) {
    findingPromises.push(buildFinding(entry.template, entry.source, entry.evidence, vault));
  }

  const findings = await Promise.all(findingPromises);

  // Sort: required first, then by status severity
  const statusOrder: Record<EnvVarStatus, number> = {
    missing:     0,
    empty:       1,
    placeholder: 2,
    suspicious:  3,
    configured:  4,
    duplicate:   5,
  };
  const severityOrder: Record<string, number> = { required: 0, recommended: 1, optional: 2 };
  findings.sort((a, b) => {
    const sevDiff = (severityOrder[a.severity] ?? 3) - (severityOrder[b.severity] ?? 3);
    if (sevDiff !== 0) return sevDiff;
    return (statusOrder[a.status] ?? 6) - (statusOrder[b.status] ?? 6);
  });

  // ── Summary ─────────────────────────────────────────────────────────────────

  const configured      = findings.filter((f) => f.status === "configured" || f.status === "suspicious").length;
  const missing         = findings.filter((f) => f.status === "missing" || f.status === "empty").length;
  const placeholders    = findings.filter((f) => f.status === "placeholder").length;
  const suspicious      = findings.filter((f) => f.status === "suspicious").length;
  const requiredBlocked = findings.filter(
    (f) => f.severity === "required" && (f.status === "missing" || f.status === "empty" || f.status === "placeholder"),
  ).length;

  // ── Warnings / blockers ──────────────────────────────────────────────────────

  const blockers: string[] = [];
  const warnings: string[] = [];

  findings
    .filter((f) => f.severity === "required" && (f.status === "missing" || f.status === "empty"))
    .forEach((f) => blockers.push(`${f.name} is required but ${f.status}.`));

  findings
    .filter((f) => f.severity === "required" && f.status === "placeholder")
    .forEach((f) => blockers.push(`${f.name} is still a placeholder — enter the real value.`));

  findings
    .filter((f) => f.status === "suspicious")
    .forEach((f) => warnings.push(`${f.name} looks like a test/development value.`));

  findings
    .filter((f) => f.category === "replit" && f.presentInVault)
    .forEach((f) => warnings.push(`${f.name} is a Replit-specific var — may not work on VPS.`));

  const status = computeStatus(findings);
  const recommendedActions = buildRecommendedActions(findings);

  return {
    projectId,
    generatedAt: new Date().toISOString(),
    status,
    summary: { total: findings.length, configured, missing, placeholders, suspicious, requiredBlocked },
    findings,
    blockers,
    warnings,
    recommendedActions,
  };
}
