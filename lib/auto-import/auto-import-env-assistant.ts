/**
 * lib/auto-import/auto-import-env-assistant.ts
 *
 * Sprint 86: Detects missing env var names for auto import.
 * Returns names only — never returns secret values.
 */

import { db } from "@/lib/db";

type EnvAssistantEntry = {
  name: string;
  required: boolean;
  secret: boolean;
  purpose: string;
  example?: string;
};

// ── Sardar/Replit ecommerce env map ──────────────────────────────────────────

const SARDAR_ECOMMERCE_ENVS: EnvAssistantEntry[] = [
  // Required
  { name: "DATABASE_URL",            required: true,  secret: true,  purpose: "PostgreSQL connection string (target/runtime database)", example: "postgresql://user:pass@host:5432/dbname" },
  { name: "SESSION_SECRET",          required: true,  secret: true,  purpose: "Session signing key (long random string)", example: "a_random_64_char_string" },
  { name: "APP_URL",                 required: true,  secret: false, purpose: "Public URL of this app (used in emails and OAuth)", example: "https://yourdomain.com" },
  { name: "STRIPE_SECRET_KEY",       required: true,  secret: true,  purpose: "Stripe secret API key", example: "sk_live_..." },
  { name: "STRIPE_PUBLISHABLE_KEY",  required: true,  secret: false, purpose: "Stripe publishable key (used on frontend)", example: "pk_live_..." },
  { name: "STRIPE_WEBHOOK_SECRET",   required: true,  secret: true,  purpose: "Stripe webhook signing secret", example: "whsec_..." },
  { name: "CLOUDINARY_CLOUD_NAME",   required: true,  secret: false, purpose: "Cloudinary cloud name for media uploads", example: "your_cloud_name" },
  { name: "CLOUDINARY_API_KEY",      required: true,  secret: true,  purpose: "Cloudinary API key", example: "1234567890" },
  { name: "CLOUDINARY_API_SECRET",   required: true,  secret: true,  purpose: "Cloudinary API secret", example: "abc123..." },
  // Optional / full-feature
  { name: "MASTER_RECOVERY_KEY_HASH", required: false, secret: true,  purpose: "Bcrypt hash of the master recovery key", example: "$2b$12$..." },
  { name: "BACKUP_TRIGGER_SECRET",   required: false, secret: true,  purpose: "Secret token to trigger backups via API", example: "random_secret" },
  { name: "SMTP_HOST",               required: false, secret: false, purpose: "SMTP server hostname for emails", example: "smtp.mailprovider.com" },
  { name: "RESEND_API_KEY",          required: false, secret: true,  purpose: "Resend email API key", example: "re_..." },
  { name: "SENDGRID_API_KEY",        required: false, secret: true,  purpose: "SendGrid email API key", example: "SG...." },
];

// ── Generic fallback (non-Sardar projects) ────────────────────────────────────

const GENERIC_ENVS: EnvAssistantEntry[] = [
  { name: "DATABASE_URL",  required: true,  secret: true,  purpose: "Database connection string" },
  { name: "SESSION_SECRET", required: true,  secret: true,  purpose: "Session signing key" },
  { name: "NODE_ENV",      required: false, secret: false, purpose: "Node environment (production)" },
  { name: "PORT",          required: false, secret: false, purpose: "Port (set by the platform)" },
];

// ── Detector ──────────────────────────────────────────────────────────────────

export async function detectMissingEnvForAutoImport(input: {
  projectId: string;
}): Promise<EnvAssistantEntry[]> {
  const { projectId } = input;

  // Detect whether this is a Sardar/Replit ecommerce project
  const project = await db.project.findUnique({
    where:  { id: projectId },
    select: { slug: true },
  });

  const isSardar = await detectIsSardarEcommerce(project?.slug ?? "");

  const allEnvs = isSardar ? SARDAR_ECOMMERCE_ENVS : GENERIC_ENVS;

  // Fetch configured env names (names only, no values)
  const configured = await db.projectEnvVar.findMany({
    where:  { projectId, isEnabled: true },
    select: { name: true },
  }).then((rows) => new Set(rows.map((r) => r.name)));

  // Return only missing entries
  return allEnvs.filter((e) => !configured.has(e.name));
}

async function detectIsSardarEcommerce(slug: string): Promise<boolean> {
  if (!slug) return false;
  const { existsSync } = await import("fs");
  const path = await import("path");
  const sourceDir = path.default.resolve(process.cwd(), "storage", "projects", slug);
  return (
    existsSync(path.default.join(sourceDir, "pnpm-workspace.yaml")) &&
    existsSync(path.default.join(sourceDir, "artifacts", "api-server"))
  );
}
