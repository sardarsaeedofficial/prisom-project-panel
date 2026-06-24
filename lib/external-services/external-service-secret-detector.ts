/**
 * lib/external-services/external-service-secret-detector.ts
 *
 * Sprint 54: Detect external service secret presence from env findings.
 *
 * Safety rules:
 *  - NEVER accesses or returns raw secret values
 *  - Uses EnvReadinessFinding status only (configured/missing/placeholder/suspicious)
 *  - Operates on finding names + statuses only
 */

import type { SecretPresenceStatus, ServiceKeyStatus } from "./external-services-types";
import type { EnvReadinessFinding }                    from "@/lib/env/env-readiness-types";

// ── Canonical var name sets ───────────────────────────────────────────────────

export const STRIPE_VARS = {
  secretKey:      "STRIPE_SECRET_KEY",
  publishableKey: "STRIPE_PUBLISHABLE_KEY",
  webhookSecret:  "STRIPE_WEBHOOK_SECRET",
} as const;

export const CLOUDINARY_VARS = {
  cloudName: "CLOUDINARY_CLOUD_NAME",
  apiKey:    "CLOUDINARY_API_KEY",
  apiSecret: "CLOUDINARY_API_SECRET",
} as const;

export const EMAIL_VARS = {
  resendApiKey:   "RESEND_API_KEY",
  sendgridApiKey: "SENDGRID_API_KEY",
  smtpHost:       "SMTP_HOST",
  smtpPort:       "SMTP_PORT",
  smtpUser:       "SMTP_USER",
  smtpPass:       "SMTP_PASS",
  smtpFrom:       "SMTP_FROM",
  mailFrom:       "MAIL_FROM",
  emailFrom:      "EMAIL_FROM",
} as const;

export const APP_URL_VARS = [
  "APP_URL",
  "PUBLIC_APP_URL",
  "NEXT_PUBLIC_APP_URL",
  "VITE_APP_URL",
  "NEXTAUTH_URL",
] as const;

// ── Status derivation ─────────────────────────────────────────────────────────

function findingToPresence(f: EnvReadinessFinding | undefined): SecretPresenceStatus {
  if (!f) return "missing";
  switch (f.status) {
    case "configured": return "configured";
    case "missing":    return "missing";
    case "empty":      return "missing";
    case "placeholder": return "placeholder";
    case "suspicious":  return "suspicious";
    default:           return f.valueConfigured ? "configured" : "missing";
  }
}

export function buildKeyStatus(
  name:     string,
  findings: EnvReadinessFinding[],
): ServiceKeyStatus {
  const f = findings.find((x) => x.name === name);
  return { name, status: findingToPresence(f) };
}

// ── Provider detector ─────────────────────────────────────────────────────────

export function detectEmailProvider(
  findings: EnvReadinessFinding[],
): "resend" | "sendgrid" | "smtp" | "unknown" {
  const names = new Set(findings.filter((f) => f.category === "email").map((f) => f.name));
  if (names.has("RESEND_API_KEY"))    return "resend";
  if (names.has("SENDGRID_API_KEY"))  return "sendgrid";
  if (names.has("SMTP_HOST"))         return "smtp";
  return "unknown";
}

// ── Mode warning for Stripe ───────────────────────────────────────────────────

export function detectStripeMode(
  findings: EnvReadinessFinding[],
  isProduction: boolean,
): string | undefined {
  const secretFinding = findings.find((f) => f.name === STRIPE_VARS.secretKey);
  if (!secretFinding) return undefined;

  // maskedPreview is safe to inspect for key prefix
  const preview = secretFinding.maskedPreview ?? "";
  const isTestKey = preview.startsWith("sk_test") || preview.startsWith("rk_test");
  const isLiveKey = preview.startsWith("sk_live") || preview.startsWith("rk_live");

  if (isProduction && isTestKey) {
    return "⚠️ Stripe test key detected in production environment — use live keys for real transactions.";
  }
  if (!isProduction && isLiveKey) {
    return "⚠️ Stripe live key detected in staging environment — use test keys for staging.";
  }
  return undefined;
}
