/**
 * lib/migration/external-service-detector.ts
 *
 * Sprint 41: Detect external service integrations (Stripe, Cloudinary, OpenAI,
 * OAuth providers, S3/R2, etc.) from a ReplitMigrationReport.
 *
 * Uses the already-parsed content/deps from the base report — no additional
 * file I/O. Returns structured ExternalServiceFinding[] that the wizard and
 * background-job handler can display and act on.
 *
 * Safety rules:
 *  - Never reads secret values — only key names (DetectedSecret.name)
 *  - Never runs arbitrary commands
 */

import type { ReplitMigrationReport } from "./replit-detection-types";
import type { ExternalServiceFinding, ExternalServiceProvider } from "./replit-migration-types";

// ── Service detection definitions ─────────────────────────────────────────────

type ServiceSpec = {
  provider:     ExternalServiceProvider;
  label:        string;
  envPrefixes:  string[];
  webhookHint?: string;
  callbackHint?: string;
  action:       string;
  critical:     boolean;
};

const SERVICE_SPECS: ServiceSpec[] = [
  {
    provider:    "stripe",
    label:       "Stripe Payments",
    envPrefixes: ["STRIPE_"],
    webhookHint: "STRIPE_WEBHOOK_SECRET",
    action:      "Add STRIPE_SECRET_KEY, STRIPE_PUBLISHABLE_KEY, and STRIPE_WEBHOOK_SECRET to environment variables. Configure your Stripe webhook URL after deployment.",
    critical:    true,
  },
  {
    provider:    "cloudinary",
    label:       "Cloudinary Media",
    envPrefixes: ["CLOUDINARY_", "NEXT_PUBLIC_CLOUDINARY_"],
    action:      "Add CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET to environment variables.",
    critical:    false,
  },
  {
    provider:    "openai",
    label:       "OpenAI",
    envPrefixes: ["OPENAI_"],
    action:      "Add OPENAI_API_KEY to environment variables.",
    critical:    false,
  },
  {
    provider:    "anthropic",
    label:       "Anthropic Claude",
    envPrefixes: ["ANTHROPIC_"],
    action:      "Add ANTHROPIC_API_KEY to environment variables.",
    critical:    false,
  },
  {
    provider:      "github-oauth",
    label:         "GitHub OAuth",
    envPrefixes:   ["GITHUB_CLIENT_", "AUTH_GITHUB_"],
    callbackHint:  "/api/auth/callback/github",
    action:        "Add GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET to environment variables. Register a new OAuth app on GitHub with the production callback URL.",
    critical:      true,
  },
  {
    provider:      "google-oauth",
    label:         "Google OAuth",
    envPrefixes:   ["GOOGLE_CLIENT_", "AUTH_GOOGLE_"],
    callbackHint:  "/api/auth/callback/google",
    action:        "Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to environment variables. Register a new OAuth app on Google Cloud Console with the production callback URL.",
    critical:      true,
  },
  {
    provider:    "supabase",
    label:       "Supabase",
    envPrefixes: ["SUPABASE_", "NEXT_PUBLIC_SUPABASE_"],
    action:      "Add SUPABASE_URL and SUPABASE_ANON_KEY to environment variables.",
    critical:    true,
  },
  {
    provider:    "neon",
    label:       "Neon Postgres",
    envPrefixes: ["NEON_"],
    action:      "Set DATABASE_URL to point to your Neon database.",
    critical:    true,
  },
  {
    provider:    "upstash",
    label:       "Upstash Redis",
    envPrefixes: ["UPSTASH_", "KV_"],
    action:      "Add UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN to environment variables.",
    critical:    false,
  },
  {
    provider:    "pusher",
    label:       "Pusher / Channels",
    envPrefixes: ["PUSHER_", "NEXT_PUBLIC_PUSHER_"],
    action:      "Add PUSHER_APP_ID, PUSHER_KEY, PUSHER_SECRET, and PUSHER_CLUSTER to environment variables.",
    critical:    false,
  },
  {
    provider:    "twilio",
    label:       "Twilio SMS",
    envPrefixes: ["TWILIO_"],
    action:      "Add TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER to environment variables.",
    critical:    false,
  },
  {
    provider:    "s3",
    label:       "AWS S3",
    envPrefixes: ["AWS_", "S3_"],
    action:      "Add AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION, and S3_BUCKET_NAME to environment variables.",
    critical:    false,
  },
  {
    provider:    "r2",
    label:       "Cloudflare R2",
    envPrefixes: ["CLOUDFLARE_", "R2_"],
    action:      "Add CLOUDFLARE_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_BUCKET_NAME to environment variables.",
    critical:    false,
  },
  {
    provider:    "resend",
    label:       "Resend Email",
    envPrefixes: ["RESEND_"],
    action:      "Add RESEND_API_KEY to environment variables. Update from-address to use your verified domain.",
    critical:    false,
  },
  {
    provider:    "sendgrid",
    label:       "SendGrid Email",
    envPrefixes: ["SENDGRID_"],
    action:      "Add SENDGRID_API_KEY to environment variables.",
    critical:    false,
  },
];

// ── Detector ──────────────────────────────────────────────────────────────────

/**
 * Detects external service integrations from a parsed migration report.
 * Uses payment, email, and media info from the report plus raw secret key names
 * to produce structured findings.
 *
 * DetectedSecret.name is the env var key name — never its value.
 */
export function detectExternalServices(
  report: ReplitMigrationReport,
): ExternalServiceFinding[] {
  const findings: ExternalServiceFinding[] = [];

  // All detected env var key names (never values)
  const knownKeyRaw = report.requiredSecrets.map((s) => s.name);

  for (const spec of SERVICE_SPECS) {
    const matchedKeys = knownKeyRaw.filter((k) =>
      spec.envPrefixes.some((prefix) => k.startsWith(prefix)),
    );

    // Also check if payment/email/media detection already found this service
    const fromPayment = spec.provider === "stripe"    && report.payments.some((p) => p.provider === "stripe");
    const fromEmail   =
      (spec.provider === "resend"    && report.email?.provider === "resend")    ||
      (spec.provider === "sendgrid"  && report.email?.provider === "sendgrid")  ||
      (spec.provider === "postmark"  && report.email?.provider === "postmark");
    const fromMedia   =
      (spec.provider === "cloudinary" && report.media?.provider === "cloudinary") ||
      (spec.provider === "s3"         && report.media?.provider === "s3")         ||
      (spec.provider === "r2"         && report.media?.provider === "r2");

    if (matchedKeys.length === 0 && !fromPayment && !fromEmail && !fromMedia) continue;

    // Detect Stripe webhook path
    let webhookPath: string | undefined;
    if (spec.provider === "stripe") {
      const stripePayment = report.payments.find((p) => p.provider === "stripe");
      webhookPath = stripePayment?.webhookPath;
    }

    findings.push({
      provider:    spec.provider,
      label:       spec.label,
      envKeys:     matchedKeys,
      files:       [],
      webhookPath,
      callbackPath: spec.callbackHint,
      action:      spec.action,
      critical:    spec.critical,
    });
  }

  // ── Ecommerce / Sardar preset detection ──────────────────────────────────────
  // Detect if this looks like an ecommerce project (Stripe + orders/products pattern)
  const hasStripeDetected = findings.some((f) => f.provider === "stripe");
  const hasOrderKeyword   = knownKeyRaw.some((k) => k.includes("ORDER") || k.includes("PRODUCT"));
  const hasStripeKeys     = knownKeyRaw.some((k) => k.startsWith("STRIPE_"));

  if (!hasStripeDetected && (hasOrderKeyword || hasStripeKeys)) {
    findings.push({
      provider: "stripe",
      label:    "Stripe Payments (ecommerce)",
      envKeys:  knownKeyRaw.filter((k) => k.startsWith("STRIPE_")),
      files:    [],
      action:   "This project appears to be an ecommerce app. Ensure STRIPE_SECRET_KEY, STRIPE_PUBLISHABLE_KEY, and STRIPE_WEBHOOK_SECRET are configured before deployment.",
      critical: true,
    });
  }

  return findings;
}
