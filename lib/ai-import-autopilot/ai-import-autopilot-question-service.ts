/**
 * lib/ai-import-autopilot/ai-import-autopilot-question-service.ts
 *
 * Sprint 88: Turns missing env var names (from the Sprint 86 env assistant)
 * into grouped, conversational RequiredInput entries for the autopilot UI.
 * Pure function — no async, no DB, no secret values.
 */

import type { RequiredInput, RequiredInputGroup } from "./ai-import-autopilot-types";
import type { AutoImportRun } from "@/lib/auto-import/auto-import-types";

type MissingEnv = AutoImportRun["missingEnvNames"][number];

const GROUP_BY_NAME: Record<string, RequiredInputGroup> = {
  DATABASE_URL:            "core",
  SESSION_SECRET:          "core",
  APP_URL:                 "core",
  STRIPE_SECRET_KEY:       "payments",
  STRIPE_PUBLISHABLE_KEY:  "payments",
  STRIPE_WEBHOOK_SECRET:   "payments",
  CLOUDINARY_CLOUD_NAME:   "media",
  CLOUDINARY_API_KEY:      "media",
  CLOUDINARY_API_SECRET:   "media",
  MASTER_RECOVERY_KEY_HASH: "advanced",
  BACKUP_TRIGGER_SECRET:    "advanced",
};

const LABEL_BY_NAME: Record<string, string> = {
  DATABASE_URL:             "Database URL",
  SESSION_SECRET:           "Session Secret",
  APP_URL:                  "App URL",
  STRIPE_SECRET_KEY:        "Stripe Secret Key",
  STRIPE_PUBLISHABLE_KEY:   "Stripe Publishable Key",
  STRIPE_WEBHOOK_SECRET:    "Stripe Webhook Secret",
  CLOUDINARY_CLOUD_NAME:    "Cloudinary Cloud Name",
  CLOUDINARY_API_KEY:       "Cloudinary API Key",
  CLOUDINARY_API_SECRET:    "Cloudinary API Secret",
  MASTER_RECOVERY_KEY_HASH: "Master Recovery Key Hash",
  BACKUP_TRIGGER_SECRET:    "Backup Trigger Secret",
};

const PLACEHOLDER_BY_NAME: Record<string, string> = {
  DATABASE_URL:            "postgresql://user:pass@host:5432/dbname",
  SESSION_SECRET:          "a random 64-character string",
  APP_URL:                 "https://yourdomain.com",
  STRIPE_SECRET_KEY:       "sk_live_...",
  STRIPE_PUBLISHABLE_KEY:  "pk_live_...",
  STRIPE_WEBHOOK_SECRET:   "whsec_...",
  CLOUDINARY_CLOUD_NAME:   "your_cloud_name",
  CLOUDINARY_API_KEY:      "1234567890",
  CLOUDINARY_API_SECRET:   "abc123...",
  MASTER_RECOVERY_KEY_HASH: "$2b$12$...",
  BACKUP_TRIGGER_SECRET:    "random_secret",
};

export const GROUP_LABELS: Record<RequiredInputGroup, string> = {
  core:     "Core",
  payments: "Payments",
  media:    "Media uploads",
  advanced: "Advanced (optional)",
};

/** Turns missing env entries into grouped RequiredInput questions. Never includes values. */
export function buildAutopilotQuestions(missingEnvNames: MissingEnv[]): RequiredInput[] {
  return missingEnvNames.map((e) => ({
    id:          e.name,
    group:       GROUP_BY_NAME[e.name] ?? "advanced",
    label:       LABEL_BY_NAME[e.name] ?? e.name,
    description: e.purpose,
    required:    e.required,
    secret:      e.secret,
    fieldName:   e.name,
    placeholder: PLACEHOLDER_BY_NAME[e.name],
    distinguishHint:
      e.name === "DATABASE_URL"
        ? "This is the Sardar ecommerce app database URL, not the Prisom panel database URL."
        : undefined,
  }));
}

/** Picks the single next question to ask, prioritising required core inputs first. */
export function pickNextQuestion(inputs: RequiredInput[]): RequiredInput | undefined {
  const requiredCore = inputs.find((i) => i.required && i.group === "core");
  if (requiredCore) return requiredCore;
  return inputs.find((i) => i.required);
}
