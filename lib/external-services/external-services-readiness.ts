/**
 * lib/external-services/external-services-readiness.ts
 *
 * Sprint 54: Generates an External Services Readiness report for a project.
 *
 * Safety rules:
 *  - reads env findings by name/status only — no raw values
 *  - no API calls to Stripe, Cloudinary, or email providers
 *  - no secrets returned
 *  - all sub-service integrations are non-fatal (errors → warning check)
 */

import { db }                  from "@/lib/db";
import {
  buildKeyStatus,
  detectEmailProvider,
  detectStripeMode,
  STRIPE_VARS,
  CLOUDINARY_VARS,
  EMAIL_VARS,
  APP_URL_VARS,
}                              from "./external-service-secret-detector";
import type {
  ExternalServiceCheck,
  ExternalServiceProvider,
  ExternalServiceReadinessReport,
  ExternalServiceStatus,
}                              from "./external-services-types";
import type { EnvReadinessFinding } from "@/lib/env/env-readiness-types";

// ── Check builder ─────────────────────────────────────────────────────────────

function check(
  id:        string,
  provider:  ExternalServiceProvider,
  label:     string,
  status:    ExternalServiceCheck["status"],
  message:   string,
  required:  boolean,
  opts?: {
    evidence?: string[];
    linkHref?: string;
    command?:  string;
  },
): ExternalServiceCheck {
  return { id, provider, label, status, message, required, ...opts };
}

function statusFromChecks(checks: ExternalServiceCheck[]): ExternalServiceStatus {
  const hasBlocker = checks.some((c) => c.status === "fail" && c.required);
  const hasWarning = checks.some((c) => c.status === "warning" || (c.status === "fail" && !c.required));
  if (hasBlocker) return "blocked";
  if (hasWarning) return "warning";
  const hasUnknown = checks.every((c) => c.status === "manual");
  if (hasUnknown) return "unknown";
  return "ready";
}

// ── Stripe checks ─────────────────────────────────────────────────────────────

function buildStripeChecks(
  findings:     EnvReadinessFinding[],
  projectId:    string,
  domain:       string | null,
  isProduction: boolean,
): ExternalServiceCheck[] {
  const checks: ExternalServiceCheck[] = [];

  const secretKey      = buildKeyStatus(STRIPE_VARS.secretKey,      findings);
  const publishableKey = buildKeyStatus(STRIPE_VARS.publishableKey,  findings);
  const webhookSecret  = buildKeyStatus(STRIPE_VARS.webhookSecret,   findings);

  const secretFound = findings.some((f) => f.name === STRIPE_VARS.secretKey);
  if (!secretFound) {
    // Stripe not detected — low-priority info
    checks.push(check(
      "stripe.not_detected",
      "stripe",
      "Stripe detected",
      "manual",
      "Stripe env vars not found. If this project uses Stripe, add STRIPE_SECRET_KEY, STRIPE_PUBLISHABLE_KEY, and STRIPE_WEBHOOK_SECRET.",
      false,
      { linkHref: `/projects/${projectId}/env` },
    ));
    return checks;
  }

  const keyStatuses: Record<string, ExternalServiceCheck["status"]> = {
    configured: "pass",
    missing:    "fail",
    placeholder: "warning",
    suspicious: "warning",
    unknown:    "warning",
  };

  checks.push(check(
    "stripe.secret_key",
    "stripe",
    "STRIPE_SECRET_KEY",
    keyStatuses[secretKey.status] ?? "warning",
    secretKey.status === "configured"
      ? "STRIPE_SECRET_KEY is configured."
      : secretKey.status === "placeholder"
      ? "STRIPE_SECRET_KEY is a placeholder — add the real key."
      : secretKey.status === "suspicious"
      ? "STRIPE_SECRET_KEY looks suspicious — verify it is the correct key type for this environment."
      : "STRIPE_SECRET_KEY is missing — Stripe payments will not work.",
    true,
    { linkHref: `/projects/${projectId}/env` },
  ));

  checks.push(check(
    "stripe.publishable_key",
    "stripe",
    "STRIPE_PUBLISHABLE_KEY",
    keyStatuses[publishableKey.status] ?? "warning",
    publishableKey.status === "configured"
      ? "STRIPE_PUBLISHABLE_KEY is configured."
      : publishableKey.status === "placeholder"
      ? "STRIPE_PUBLISHABLE_KEY is a placeholder — add the real key."
      : "STRIPE_PUBLISHABLE_KEY is missing — the payment form will not load.",
    true,
    { linkHref: `/projects/${projectId}/env` },
  ));

  checks.push(check(
    "stripe.webhook_secret",
    "stripe",
    "STRIPE_WEBHOOK_SECRET",
    keyStatuses[webhookSecret.status] ?? "warning",
    webhookSecret.status === "configured"
      ? "STRIPE_WEBHOOK_SECRET is configured."
      : webhookSecret.status === "placeholder"
      ? "STRIPE_WEBHOOK_SECRET is a placeholder — add the webhook signing secret."
      : "STRIPE_WEBHOOK_SECRET is missing — webhooks cannot be verified.",
    true,
    { linkHref: `/projects/${projectId}/env` },
  ));

  // Mode warning
  const modeWarning = detectStripeMode(findings, isProduction);
  if (modeWarning) {
    checks.push(check(
      "stripe.mode_warning",
      "stripe",
      isProduction ? "Stripe live keys required in production" : "Stripe test keys required in staging",
      "warning",
      modeWarning,
      false,
    ));
  }

  // Webhook endpoint
  const prodWebhook    = domain
    ? `https://${domain}/api/webhooks/stripe`
    : "https://YOUR_DOMAIN/api/webhooks/stripe";
  const stagingWebhook = "https://staging-sardar-security-project.doorstepmanchester.uk/api/webhooks/stripe";

  checks.push(check(
    "stripe.webhook_endpoint",
    "stripe",
    "Stripe webhook endpoint",
    "manual",
    `Register this endpoint in Stripe Dashboard → Webhooks:\n${prodWebhook}`,
    false,
    {
      evidence: [
        `Production: ${prodWebhook}`,
        `Staging: ${stagingWebhook}`,
      ],
      command: `curl -I ${prodWebhook}`,
    },
  ));

  // Test order checklist
  checks.push(check(
    "stripe.test_order",
    "stripe",
    "Test payment flow (manual)",
    "manual",
    "Manually test a Stripe payment using a test card (4242 4242 4242 4242) in staging before going live.",
    false,
    {
      evidence: [
        "Use card 4242 4242 4242 4242, any future date, any CVV",
        "Verify webhook fires and order is created",
        "Verify payment appears in Stripe test dashboard",
        "Verify order confirmation email sends",
      ],
    },
  ));

  return checks;
}

// ── Cloudinary checks ─────────────────────────────────────────────────────────

function buildCloudinaryChecks(
  findings:  EnvReadinessFinding[],
  projectId: string,
): ExternalServiceCheck[] {
  const checks: ExternalServiceCheck[] = [];

  const cloudName = buildKeyStatus(CLOUDINARY_VARS.cloudName, findings);
  const apiKey    = buildKeyStatus(CLOUDINARY_VARS.apiKey,    findings);
  const apiSecret = buildKeyStatus(CLOUDINARY_VARS.apiSecret, findings);

  const cloudinaryFound = findings.some((f) => f.name.startsWith("CLOUDINARY_"));
  if (!cloudinaryFound) {
    checks.push(check(
      "cloudinary.not_detected",
      "cloudinary",
      "Cloudinary detected",
      "manual",
      "Cloudinary env vars not found. If this project uses Cloudinary for image uploads, add CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET.",
      false,
      { linkHref: `/projects/${projectId}/env` },
    ));
    return checks;
  }

  const keyStatus = (s: string): ExternalServiceCheck["status"] => {
    if (s === "configured") return "pass";
    if (s === "placeholder" || s === "suspicious") return "warning";
    return "fail";
  };

  checks.push(check(
    "cloudinary.cloud_name",
    "cloudinary",
    "CLOUDINARY_CLOUD_NAME",
    keyStatus(cloudName.status),
    cloudName.status === "configured"
      ? "CLOUDINARY_CLOUD_NAME is configured."
      : cloudName.status === "placeholder"
      ? "CLOUDINARY_CLOUD_NAME is a placeholder — enter the real cloud name from Cloudinary dashboard."
      : "CLOUDINARY_CLOUD_NAME is missing.",
    true,
    { linkHref: `/projects/${projectId}/env` },
  ));

  checks.push(check(
    "cloudinary.api_key",
    "cloudinary",
    "CLOUDINARY_API_KEY",
    keyStatus(apiKey.status),
    apiKey.status === "configured"
      ? "CLOUDINARY_API_KEY is configured."
      : "CLOUDINARY_API_KEY is missing or placeholder.",
    true,
    { linkHref: `/projects/${projectId}/env` },
  ));

  checks.push(check(
    "cloudinary.api_secret",
    "cloudinary",
    "CLOUDINARY_API_SECRET",
    keyStatus(apiSecret.status),
    apiSecret.status === "configured"
      ? "CLOUDINARY_API_SECRET is configured."
      : "CLOUDINARY_API_SECRET is missing or placeholder.",
    true,
    { linkHref: `/projects/${projectId}/env` },
  ));

  // Upload flow checklist
  checks.push(check(
    "cloudinary.upload_test",
    "cloudinary",
    "Upload flow test (manual)",
    "manual",
    "Manually test the Cloudinary upload flow before going live.",
    false,
    {
      evidence: [
        "1. Upload a test product image via the admin panel",
        "2. Confirm image appears in the Cloudinary dashboard",
        "3. Confirm image appears correctly on the storefront",
        "4. Confirm old Replit-hosted images are replaced or copied to Cloudinary",
      ],
    },
  ));

  // Folder strategy
  checks.push(check(
    "cloudinary.folder_strategy",
    "cloudinary",
    "Folder / asset strategy (manual)",
    "manual",
    "Document your Cloudinary folder structure and transformation strategy.",
    false,
    {
      evidence: [
        "Recommended: use a per-project folder (e.g. sardar-security-supplies/products/)",
        "Enable eager transformations for thumbnails if needed",
        "Enable CDN delivery for production performance",
      ],
    },
  ));

  return checks;
}

// ── Email checks ──────────────────────────────────────────────────────────────

function buildEmailChecks(
  findings:  EnvReadinessFinding[],
  projectId: string,
): ExternalServiceCheck[] {
  const checks: ExternalServiceCheck[] = [];

  const provider = detectEmailProvider(findings);

  const emailFound = findings.some((f) => f.category === "email");
  if (!emailFound) {
    checks.push(check(
      "email.not_detected",
      "email",
      "Email provider detected",
      "manual",
      "No email env vars found. If this project sends emails (order confirmations, password resets), add provider keys.",
      false,
      {
        evidence: [
          "Resend: RESEND_API_KEY",
          "SendGrid: SENDGRID_API_KEY",
          "SMTP: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM",
        ],
        linkHref: `/projects/${projectId}/env`,
      },
    ));
    return checks;
  }

  checks.push(check(
    "email.provider",
    "email",
    "Email provider",
    "pass",
    `Email provider detected: ${provider.toUpperCase()}`,
    false,
  ));

  if (provider === "resend") {
    const apiKey = buildKeyStatus(EMAIL_VARS.resendApiKey, findings);
    checks.push(check(
      "email.resend_key",
      "email",
      "RESEND_API_KEY",
      apiKey.status === "configured" ? "pass" : apiKey.status === "placeholder" ? "warning" : "fail",
      apiKey.status === "configured"
        ? "RESEND_API_KEY is configured."
        : "RESEND_API_KEY is missing or placeholder.",
      true,
      { linkHref: `/projects/${projectId}/env` },
    ));
  } else if (provider === "sendgrid") {
    const apiKey = buildKeyStatus(EMAIL_VARS.sendgridApiKey, findings);
    checks.push(check(
      "email.sendgrid_key",
      "email",
      "SENDGRID_API_KEY",
      apiKey.status === "configured" ? "pass" : apiKey.status === "placeholder" ? "warning" : "fail",
      apiKey.status === "configured"
        ? "SENDGRID_API_KEY is configured."
        : "SENDGRID_API_KEY is missing or placeholder.",
      true,
      { linkHref: `/projects/${projectId}/env` },
    ));
  } else if (provider === "smtp") {
    for (const varName of [EMAIL_VARS.smtpHost, EMAIL_VARS.smtpUser, EMAIL_VARS.smtpPass] as string[]) {
      const ks = buildKeyStatus(varName, findings);
      checks.push(check(
        `email.smtp.${varName.toLowerCase()}`,
        "email",
        varName,
        ks.status === "configured" ? "pass" : ks.status === "placeholder" ? "warning" : "fail",
        ks.status === "configured" ? `${varName} is configured.` : `${varName} is missing or placeholder.`,
        true,
        { linkHref: `/projects/${projectId}/env` },
      ));
    }
  }

  // Sender / from address
  const senderVars = [EMAIL_VARS.smtpFrom, EMAIL_VARS.mailFrom, EMAIL_VARS.emailFrom] as string[];
  const senderFound = findings.find((f) => senderVars.includes(f.name));
  if (senderFound) {
    const ks = buildKeyStatus(senderFound.name, findings);
    checks.push(check(
      "email.sender_from",
      "email",
      `${senderFound.name} (sender address)`,
      ks.status === "configured" ? "pass" : "warning",
      ks.status === "configured"
        ? `Sender address (${senderFound.name}) is configured.`
        : `Sender address (${senderFound.name}) is missing or placeholder — outgoing emails may be rejected.`,
      false,
      { linkHref: `/projects/${projectId}/env` },
    ));
  } else {
    checks.push(check(
      "email.sender_from",
      "email",
      "Sender / From address",
      "warning",
      "No sender address configured (SMTP_FROM, MAIL_FROM, or EMAIL_FROM). Outgoing emails may be rejected.",
      false,
      { linkHref: `/projects/${projectId}/env` },
    ));
  }

  // Domain verification
  checks.push(check(
    "email.domain_verification",
    "email",
    "Sender domain verification (manual)",
    "manual",
    "Verify your sender domain with your email provider to avoid emails landing in spam.",
    false,
    {
      evidence: [
        "Add SPF record to your DNS: v=spf1 include:your-provider.com ~all",
        "Add DKIM record from your email provider dashboard",
        "Add DMARC record: v=DMARC1; p=none; rua=mailto:admin@yourdomain.com",
        "Verify domain in your email provider dashboard",
      ],
    },
  ));

  // Password reset test
  checks.push(check(
    "email.password_reset_test",
    "email",
    "Password reset email test (manual)",
    "manual",
    "Manually trigger a password reset email in staging and verify it arrives correctly.",
    false,
    {
      evidence: [
        "Go to the login page → Forgot Password",
        "Enter a test email address",
        "Verify email arrives and reset link works",
        "Check sender address and subject line",
      ],
    },
  ));

  // Order confirmation test
  checks.push(check(
    "email.order_confirmation_test",
    "email",
    "Order confirmation email test (manual)",
    "manual",
    "Place a test order in staging and verify the order confirmation email arrives.",
    false,
    {
      evidence: [
        "Complete a checkout with a Stripe test card",
        "Verify order confirmation email arrives",
        "Check order details, totals, and links are correct",
      ],
    },
  ));

  return checks;
}

// ── APP_URL checks ────────────────────────────────────────────────────────────

function buildAppUrlChecks(
  findings:  EnvReadinessFinding[],
  projectId: string,
  domain:    string | null,
): ExternalServiceCheck[] {
  const checks: ExternalServiceCheck[] = [];

  const appUrlFinding = findings.find((f) => APP_URL_VARS.includes(f.name as typeof APP_URL_VARS[number]));

  if (!appUrlFinding) {
    checks.push(check(
      "appurl.missing",
      "manual",
      "APP_URL / NEXTAUTH_URL",
      "warning",
      "No APP_URL configured. Set APP_URL (or NEXT_PUBLIC_APP_URL / NEXTAUTH_URL) to your production domain.",
      false,
      { linkHref: `/projects/${projectId}/env` },
    ));
    return checks;
  }

  const ks = buildKeyStatus(appUrlFinding.name, findings);
  checks.push(check(
    "appurl.configured",
    "manual",
    appUrlFinding.name,
    ks.status === "configured" ? "pass" : ks.status === "placeholder" ? "warning" : "fail",
    ks.status === "configured"
      ? `${appUrlFinding.name} is configured.`
      : `${appUrlFinding.name} is missing or placeholder — set to your production domain URL.`,
    false,
    { linkHref: `/projects/${projectId}/env` },
  ));

  // Check for localhost
  const preview = appUrlFinding.maskedPreview ?? "";
  if (preview.includes("localhost") || preview.includes("127.0.0.1")) {
    checks.push(check(
      "appurl.localhost",
      "manual",
      "APP_URL localhost detected",
      "fail",
      `${appUrlFinding.name} appears to point to localhost — this will not work in production.`,
      true,
      { linkHref: `/projects/${projectId}/env` },
    ));
  } else if (domain && ks.status === "configured" && !preview.includes(domain)) {
    checks.push(check(
      "appurl.mismatch",
      "manual",
      "APP_URL / domain mismatch",
      "warning",
      `${appUrlFinding.name} may not match the configured domain (${domain}). Verify it points to the correct production URL.`,
      false,
    ));
  }

  return checks;
}

// ── Webhook checks ────────────────────────────────────────────────────────────

function buildWebhookChecks(domain: string | null): ExternalServiceCheck[] {
  const checks: ExternalServiceCheck[] = [];

  const prodWebhook    = domain
    ? `https://${domain}/api/webhooks/stripe`
    : "https://YOUR_DOMAIN/api/webhooks/stripe";
  const stagingWebhook = "https://staging-sardar-security-project.doorstepmanchester.uk/api/webhooks/stripe";

  checks.push(check(
    "webhook.stripe_prod",
    "webhook",
    "Stripe production webhook URL",
    "manual",
    `Register ${prodWebhook} in Stripe Dashboard → Developers → Webhooks.`,
    false,
    {
      evidence: [prodWebhook],
      command:  `curl -I ${prodWebhook}`,
    },
  ));

  checks.push(check(
    "webhook.stripe_staging",
    "webhook",
    "Stripe staging webhook URL",
    "manual",
    `For staging, register ${stagingWebhook} in the Stripe test dashboard.`,
    false,
    { evidence: [stagingWebhook] },
  ));

  return checks;
}

// ── Main report generator ─────────────────────────────────────────────────────

export async function generateExternalServicesReadiness(
  projectId: string,
): Promise<ExternalServiceReadinessReport> {
  const generatedAt = new Date().toISOString();

  const domain = await db.domain
    .findFirst({
      where:   { projectId, isPrimary: true },
      select:  { hostname: true },
    })
    .then((d) => d?.hostname ?? null)
    .catch(() => null);

  let findings: EnvReadinessFinding[] = [];
  try {
    const { generateEnvReadinessReport } = await import("@/lib/env/env-readiness-detector");
    const report = await generateEnvReadinessReport(projectId);
    if (report) {
      findings = (report as unknown as { findings: EnvReadinessFinding[] }).findings ?? [];
    }
  } catch { /* non-fatal */ }

  // Determine if this is a production-like environment
  const isProduction = !!(domain && !domain.includes("staging"));

  const allChecks: ExternalServiceCheck[] = [
    ...buildStripeChecks(findings, projectId, domain, isProduction),
    ...buildCloudinaryChecks(findings, projectId),
    ...buildEmailChecks(findings, projectId),
    ...buildAppUrlChecks(findings, projectId, domain),
    ...buildWebhookChecks(domain),
  ];

  const status    = statusFromChecks(allChecks);
  const blockers  = allChecks.filter((c) => c.status === "fail" && c.required).map((c) => c.message);
  const warnings  = allChecks.filter((c) => c.status === "warning").map((c) => c.message);
  const nextSteps: string[] = [];

  if (blockers.length > 0) {
    nextSteps.push(`Resolve ${blockers.length} blocker(s) — missing required external service credentials.`);
  }
  if (warnings.length > 0) {
    nextSteps.push(`Review ${warnings.length} warning(s) — placeholder or suspicious credentials detected.`);
  }
  const manual = allChecks.filter((c) => c.status === "manual");
  if (manual.length > 0) {
    nextSteps.push(`Complete ${manual.length} manual checklist item(s) before going live.`);
  }
  if (status === "ready") {
    nextSteps.push("All required external service credentials are configured — complete manual checklist items.");
  }

  return {
    projectId,
    generatedAt,
    status,
    checks:  allChecks,
    blockers,
    warnings,
    nextSteps,
    summary: {
      total:    allChecks.length,
      passed:   allChecks.filter((c) => c.status === "pass").length,
      warnings: allChecks.filter((c) => c.status === "warning").length,
      failed:   allChecks.filter((c) => c.status === "fail").length,
      manual:   allChecks.filter((c) => c.status === "manual").length,
    },
  };
}
