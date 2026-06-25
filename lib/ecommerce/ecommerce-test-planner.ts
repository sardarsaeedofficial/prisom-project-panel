/**
 * lib/ecommerce/ecommerce-test-planner.ts
 *
 * Sprint 62: Generate an ecommerce test report for the Sardar staging project.
 *
 * DB-backed where safe (env var name presence, deployment count).
 * Never reads env values — only names.
 *
 * Safety: no real charges, no production mutations, no secrets.
 */

import { db }                   from "@/lib/db";
import type {
  EcommerceTestCheck,
  EcommerceTestReport,
  EcommerceTestStatus,
} from "./ecommerce-test-types";

// ── Constants ─────────────────────────────────────────────────────────────────

export const ECOMMERCE_STAGING_DOMAIN =
  "staging-sardar-security-project.doorstepmanchester.uk";

const STRIPE_KEY_NAMES      = ["STRIPE_SECRET_KEY", "STRIPE_PUBLISHABLE_KEY", "STRIPE_WEBHOOK_SECRET"];
const CLOUDINARY_KEY_NAMES  = ["CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"];
const EMAIL_KEY_NAMES       = ["RESEND_API_KEY", "SENDGRID_API_KEY", "SMTP_HOST", "SMTP_USER", "MAIL_FROM", "EMAIL_FROM"];

// ── Helpers ───────────────────────────────────────────────────────────────────

function check(
  partial: Omit<EcommerceTestCheck, "message"> & { message?: string },
): EcommerceTestCheck {
  return { message: "", ...partial } as EcommerceTestCheck;
}

function deriveStatus(checks: EcommerceTestCheck[]): EcommerceTestStatus {
  const hasFail    = checks.some((c) => c.status === "fail"    && c.required);
  const hasWarning = checks.some((c) => c.status === "warning" && c.required);
  const allDone    = checks.every((c) => c.status === "pass" || c.status === "manual");

  if (hasFail)    return "blocked";
  if (allDone)    return "passed";
  if (hasWarning) return "warning";

  const hasPending = checks.some((c) => c.status === "pending");
  if (hasPending)  return "not_started";

  return "ready";
}

// ── Main ──────────────────────────────────────────────────────────────────────

export async function generateEcommerceTestReport(input: {
  projectId:    string;
  targetDomain?: string;
}): Promise<EcommerceTestReport> {
  const { projectId } = input;
  const targetDomain  = (input.targetDomain?.trim() || ECOMMERCE_STAGING_DOMAIN)
    .replace(/^https?:\/\//, "");

  // ── DB queries (parallel, safe) ───────────────────────────────────────────

  const [
    stripeEnvVars,
    cloudinaryEnvVars,
    emailEnvVars,
    totalEnvCount,
    deploymentCount,
    project,
  ] = await Promise.all([
    db.projectEnvVar.findMany({
      where:  { projectId, name: { in: STRIPE_KEY_NAMES } },
      select: { name: true },
    }).catch(() => []),
    db.projectEnvVar.findMany({
      where:  { projectId, name: { in: CLOUDINARY_KEY_NAMES } },
      select: { name: true },
    }).catch(() => []),
    db.projectEnvVar.findMany({
      where:  { projectId, name: { in: EMAIL_KEY_NAMES } },
      select: { name: true },
    }).catch(() => []),
    db.projectEnvVar.count({ where: { projectId } }).catch(() => 0),
    db.deployment.count({ where: { projectId } }).catch(() => 0),
    db.project.findUnique({
      where:  { id: projectId },
      select: { slug: true, name: true },
    }).catch(() => null),
  ]);

  const stripeNames     = new Set(stripeEnvVars.map((v) => v.name));
  const cloudinaryNames = new Set(cloudinaryEnvVars.map((v) => v.name));
  const emailNames      = new Set(emailEnvVars.map((v) => v.name));

  const projectEnvHref = `/projects/${projectId}/env`;
  const targetUrl      = `https://${targetDomain}`;

  // ── Build checks ──────────────────────────────────────────────────────────

  const checks: EcommerceTestCheck[] = [

    // ── Storefront ────────────────────────────────────────────────────────
    check({
      id:       "storefront-root",
      category: "storefront",
      label:    "Staging root URL accessible",
      status:   "pending",
      required: true,
      message:  `Run safe smoke checks to verify ${targetUrl}/ returns HTTP 200.`,
      linkHref: projectEnvHref,
      confirmationRequired: "RUN SAFE ECOMMERCE CHECKS",
    }),
    check({
      id:       "storefront-spa",
      category: "storefront",
      label:    "SPA fallback route returns 200",
      status:   "pending",
      required: true,
      message:  "Non-existent routes should return 200 (SPA fallback), not 404.",
      confirmationRequired: "RUN SAFE ECOMMERCE CHECKS",
    }),
    check({
      id:       "storefront-product-pages",
      category: "storefront",
      label:    "Product/category pages — manual review",
      status:   "manual",
      required: false,
      message:  "Manually browse product list and category pages on staging.",
      warning:  "Cannot be automated — requires manual browsing.",
    }),

    // ── Products ──────────────────────────────────────────────────────────
    check({
      id:       "products-list-endpoint",
      category: "products",
      label:    "Product list endpoint identified",
      status:   "pending",
      required: false,
      message:  "Verify /products or /shop returns correct product listing on staging.",
      confirmationRequired: "RUN SAFE ECOMMERCE CHECKS",
    }),
    check({
      id:       "products-images",
      category: "products",
      label:    "Product images load from Cloudinary",
      status:   cloudinaryNames.size >= 2 ? "manual" : "warning",
      required: false,
      message:  cloudinaryNames.size >= 2
        ? "Cloudinary env names detected. Manually verify product images load on staging."
        : "Cloudinary env vars not fully configured — product images may be broken.",
      warning:  cloudinaryNames.size < 2 ? "Add CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET." : undefined,
      linkHref: projectEnvHref,
    }),
    check({
      id:       "products-pricing",
      category: "products",
      label:    "Product pricing — manual review",
      status:   "manual",
      required: false,
      message:  "Manually verify product prices display correctly on staging.",
      warning:  "Cannot be automated — requires manual product page review.",
    }),

    // ── Cart ──────────────────────────────────────────────────────────────
    check({
      id:       "cart-add",
      category: "cart",
      label:    "Add-to-cart — manual test",
      status:   "manual",
      required: false,
      message:  "Manually add a product to cart on staging and confirm it appears.",
      warning:  "Cannot be automated safely. Use staging environment only.",
    }),
    check({
      id:       "cart-quantity",
      category: "cart",
      label:    "Cart quantity update — manual test",
      status:   "manual",
      required: false,
      message:  "Manually update cart item quantity and confirm total updates.",
      warning:  "Cannot be automated safely.",
    }),
    check({
      id:       "cart-remove",
      category: "cart",
      label:    "Cart item remove — manual test",
      status:   "manual",
      required: false,
      message:  "Manually remove a cart item and confirm cart empties correctly.",
      warning:  "Cannot be automated safely.",
    }),

    // ── Checkout ──────────────────────────────────────────────────────────
    check({
      id:       "checkout-flow",
      category: "checkout",
      label:    "Checkout flow — manual test only",
      status:   "manual",
      required: false,
      message:  "Manually navigate checkout on staging using Stripe test cards. Do not use real card numbers.",
      warning:  "Use Stripe test card 4242 4242 4242 4242 (any future expiry, any CVC). Do not use real card numbers.",
    }),
    check({
      id:       "checkout-form",
      category: "checkout",
      label:    "Shipping/billing form — manual review",
      status:   "manual",
      required: false,
      message:  "Manually fill shipping/billing form on staging and verify fields validate correctly.",
      warning:  "Cannot be automated safely.",
    }),
    check({
      id:       "checkout-validation",
      category: "checkout",
      label:    "Form validation errors — manual review",
      status:   "manual",
      required: false,
      message:  "Submit empty/invalid checkout form and confirm validation error messages display.",
    }),

    // ── Stripe ────────────────────────────────────────────────────────────
    check({
      id:       "stripe-secret-key",
      category: "stripe",
      label:    "STRIPE_SECRET_KEY configured (name only)",
      status:   stripeNames.has("STRIPE_SECRET_KEY") ? "pass" : "warning",
      required: true,
      message:  stripeNames.has("STRIPE_SECRET_KEY")
        ? "STRIPE_SECRET_KEY env name found in project secrets."
        : "STRIPE_SECRET_KEY not found. Add staging test key (sk_test_...) to env.",
      warning:  !stripeNames.has("STRIPE_SECRET_KEY")
        ? "Checkout will fail without STRIPE_SECRET_KEY."
        : "Verify this is a test key (sk_test_...) in staging — never use live key on staging.",
      evidence: stripeNames.has("STRIPE_SECRET_KEY") ? ["STRIPE_SECRET_KEY name present"] : undefined,
      linkHref: projectEnvHref,
    }),
    check({
      id:       "stripe-publishable-key",
      category: "stripe",
      label:    "STRIPE_PUBLISHABLE_KEY configured (name only)",
      status:   stripeNames.has("STRIPE_PUBLISHABLE_KEY") ? "pass" : "warning",
      required: true,
      message:  stripeNames.has("STRIPE_PUBLISHABLE_KEY")
        ? "STRIPE_PUBLISHABLE_KEY env name found."
        : "STRIPE_PUBLISHABLE_KEY not found. Add staging test key (pk_test_...).",
      warning:  !stripeNames.has("STRIPE_PUBLISHABLE_KEY")
        ? "Stripe Elements/Checkout UI will not load without STRIPE_PUBLISHABLE_KEY."
        : "Verify this is a test key (pk_test_...) — never use live key on staging.",
      evidence: stripeNames.has("STRIPE_PUBLISHABLE_KEY") ? ["STRIPE_PUBLISHABLE_KEY name present"] : undefined,
      linkHref: projectEnvHref,
    }),
    check({
      id:       "stripe-webhook-secret",
      category: "stripe",
      label:    "STRIPE_WEBHOOK_SECRET configured (name only)",
      status:   stripeNames.has("STRIPE_WEBHOOK_SECRET") ? "pass" : "warning",
      required: false,
      message:  stripeNames.has("STRIPE_WEBHOOK_SECRET")
        ? "STRIPE_WEBHOOK_SECRET env name found."
        : "STRIPE_WEBHOOK_SECRET not found. Webhooks will fail until configured.",
      warning:  "Webhook secret must match the staging webhook endpoint registered in Stripe Dashboard.",
      evidence: stripeNames.has("STRIPE_WEBHOOK_SECRET") ? ["STRIPE_WEBHOOK_SECRET name present"] : undefined,
      linkHref: projectEnvHref,
    }),
    check({
      id:       "stripe-test-mode",
      category: "stripe",
      label:    "Stripe test-mode — manual verification required",
      status:   "manual",
      required: true,
      message:  "Manually confirm STRIPE_SECRET_KEY starts with sk_test_ and STRIPE_PUBLISHABLE_KEY starts with pk_test_ in staging.",
      warning:  "Never use Stripe live keys (sk_live_ / pk_live_) in staging. Using live keys in staging may cause real charges.",
      confirmationRequired: undefined,
    }),

    // ── Webhooks ──────────────────────────────────────────────────────────
    check({
      id:       "webhooks-url",
      category: "webhooks",
      label:    "Stripe webhook URL documented",
      status:   "manual",
      required: false,
      message:  `Staging webhook URL: https://${targetDomain}/api/webhooks/stripe — register this in Stripe Dashboard → Webhooks.`,
      command:  `# Staging Stripe webhook endpoint:\nhttps://${targetDomain}/api/webhooks/stripe`,
      warning:  "Only register the staging webhook endpoint. Do not register the production webhook URL in staging.",
    }),
    check({
      id:       "webhooks-test-event",
      category: "webhooks",
      label:    "Test webhook event — manual only",
      status:   "manual",
      required: false,
      message:  "Use Stripe CLI to send a test event: stripe trigger payment_intent.succeeded",
      command:  "stripe trigger payment_intent.succeeded --stripe-account <test-account>",
      warning:  "Only send test events. Never trigger real payment events in staging.",
    }),

    // ── Orders ────────────────────────────────────────────────────────────
    check({
      id:       "orders-create",
      category: "orders",
      label:    "Test order creation — manual, staging only",
      status:   "manual",
      required: false,
      message:  "Place a test order on staging using Stripe test card 4242 4242 4242 4242. Confirm order is created in DB and admin.",
      warning:  "Only create orders in staging. Do not create orders in production.",
    }),
    check({
      id:       "orders-confirmation",
      category: "orders",
      label:    "Order confirmation page — manual review",
      status:   "manual",
      required: false,
      message:  "After test checkout, verify order confirmation page loads with correct order details.",
    }),
    check({
      id:       "orders-admin",
      category: "orders",
      label:    "Admin order visibility — manual review",
      status:   "manual",
      required: false,
      message:  "Log in to staging admin panel and verify test order appears in orders list.",
      warning:  "Admin route must be protected. Do not expose admin without authentication.",
    }),

    // ── Email ─────────────────────────────────────────────────────────────
    check({
      id:       "email-provider",
      category: "email",
      label:    "Email provider env configured (name only)",
      status:   emailNames.size > 0 ? "pass" : "warning",
      required: false,
      message:  emailNames.size > 0
        ? `Email provider env names found: ${[...emailNames].join(", ")}.`
        : "No email provider env vars found. Add RESEND_API_KEY, SENDGRID_API_KEY, or SMTP_* vars.",
      warning:  emailNames.size === 0 ? "Order confirmation emails will fail without an email provider." : undefined,
      evidence: emailNames.size > 0 ? [[...emailNames].join(", ")] : undefined,
      linkHref: projectEnvHref,
    }),
    check({
      id:       "email-test",
      category: "email",
      label:    "Test email delivery — manual only",
      status:   "manual",
      required: false,
      message:  "Trigger an order confirmation email on staging and verify delivery in test mailbox.",
      warning:  "Do not use real customer email addresses. Use a test mailbox (e.g., Mailtrap, Mailhog, or Resend dev mode).",
    }),

    // ── Cloudinary ────────────────────────────────────────────────────────
    check({
      id:       "cloudinary-env",
      category: "cloudinary",
      label:    "Cloudinary env configured (name only)",
      status:   cloudinaryNames.size >= 3 ? "pass" : cloudinaryNames.size > 0 ? "warning" : "warning",
      required: false,
      message:  cloudinaryNames.size >= 3
        ? `Cloudinary env names found: ${[...cloudinaryNames].join(", ")}.`
        : cloudinaryNames.size > 0
        ? `Only ${cloudinaryNames.size}/3 Cloudinary env names found: ${[...cloudinaryNames].join(", ")}.`
        : "No Cloudinary env vars found. Add CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET.",
      evidence: cloudinaryNames.size > 0 ? [[...cloudinaryNames].join(", ")] : undefined,
      linkHref: projectEnvHref,
    }),
    check({
      id:       "cloudinary-test-upload",
      category: "cloudinary",
      label:    "Test image upload — manual, staging only",
      status:   "manual",
      required: false,
      message:  "Upload a test product image via staging admin panel and confirm it appears in Cloudinary dashboard.",
      warning:  "Do not upload destructive or sensitive assets. Use test images only.",
    }),

    // ── Admin ─────────────────────────────────────────────────────────────
    check({
      id:       "admin-protected",
      category: "admin",
      label:    "Admin route protected — manual check",
      status:   "manual",
      required: true,
      message:  "Verify /admin or /dashboard redirects to login when unauthenticated on staging.",
      warning:  "Admin route must require authentication. An unprotected admin route is a critical security risk.",
    }),
    check({
      id:       "admin-orders-visible",
      category: "admin",
      label:    "Admin orders list — manual check",
      status:   "manual",
      required: false,
      message:  "Log in to staging admin and confirm orders list is visible and renders correctly.",
    }),

    // ── Database ──────────────────────────────────────────────────────────
    check({
      id:       "database-env",
      category: "database",
      label:    `${totalEnvCount} env var(s) configured`,
      status:   totalEnvCount > 0 ? "pass" : "warning",
      required: true,
      message:  totalEnvCount > 0
        ? `${totalEnvCount} env var(s) found. Verify DATABASE_URL points to staging DB (separate from production).`
        : "No env vars configured. Add DATABASE_URL pointing to staging/test database.",
      warning:  "Always use a separate staging database — never point staging to the production database.",
      linkHref: projectEnvHref,
      evidence: totalEnvCount > 0 ? [`${totalEnvCount} env var(s) configured`] : undefined,
    }),
    check({
      id:       "database-backup",
      category: "database",
      label:    "DB backup required before order tests",
      status:   "manual",
      required: false,
      message:  "Create a database backup before running any order-flow tests.",
      warning:  "Order creation mutates the DB. Always back up before order-flow testing.",
      linkHref: `/projects/${projectId}/backups`,
    }),
    check({
      id:       "database-schema",
      category: "database",
      label:    "Order schema/tables — manual review",
      status:   deploymentCount > 0 ? "manual" : "warning",
      required: false,
      message:  deploymentCount > 0
        ? "Project has deployments. Manually verify orders, products, cart tables exist."
        : "No deployments yet — schema may not be applied. Run deployment dry run before order tests.",
      linkHref: `/projects/${projectId}/releases`,
    }),

    // ── Security ──────────────────────────────────────────────────────────
    check({
      id:       "security-no-secrets",
      category: "security",
      label:    "No secrets exposed in test plan",
      status:   "pass",
      required: true,
      message:  "This test plan contains only env var names — no values. Values remain in the Secrets Vault.",
      evidence: ["No secret values included in this report"],
    }),
    check({
      id:       "security-test-cards",
      category: "security",
      label:    "Stripe test cards only",
      status:   "manual",
      required: true,
      message:  "Use Stripe test card 4242 4242 4242 4242 for all staging checkout tests. Never enter real card numbers.",
      warning:  "Using real card numbers in staging may cause actual charges.",
    }),
    check({
      id:       "security-no-production-orders",
      category: "security",
      label:    "No production orders created",
      status:   "pass",
      required: true,
      message:  "This harness does not create production orders. All order tests are manual and staging-only.",
      evidence: ["Harness is GET-only for automated checks — no POST to checkout/order"],
    }),
  ];

  // ── Summary ───────────────────────────────────────────────────────────────

  const summary = {
    total:    checks.length,
    passed:   checks.filter((c) => c.status === "pass").length,
    warnings: checks.filter((c) => c.status === "warning").length,
    failed:   checks.filter((c) => c.status === "fail").length,
    manual:   checks.filter((c) => c.status === "manual").length,
    pending:  checks.filter((c) => c.status === "pending").length,
  };

  // ── Blockers & warnings ───────────────────────────────────────────────────

  const blockers: string[] = [];
  const warnings: string[] = [];

  if (!stripeNames.has("STRIPE_SECRET_KEY")) {
    blockers.push("STRIPE_SECRET_KEY not configured — checkout will fail");
  }
  if (!stripeNames.has("STRIPE_PUBLISHABLE_KEY")) {
    blockers.push("STRIPE_PUBLISHABLE_KEY not configured — Stripe UI will not load");
  }
  if (totalEnvCount === 0) {
    blockers.push("No env vars configured — staging is not ready for testing");
  }
  if (!stripeNames.has("STRIPE_WEBHOOK_SECRET")) {
    warnings.push("STRIPE_WEBHOOK_SECRET not configured — webhooks will fail");
  }
  if (cloudinaryNames.size < 3) {
    warnings.push("Cloudinary not fully configured — product images may be broken");
  }
  if (emailNames.size === 0) {
    warnings.push("Email provider not configured — order confirmation emails will fail");
  }
  if (deploymentCount === 0) {
    warnings.push("No deployments yet — run a deployment dry run before order-flow testing");
  }

  // ── Next steps ────────────────────────────────────────────────────────────

  const nextSteps: string[] = [
    "Configure all Stripe env vars in the Secrets Vault (test keys only)",
    "Configure Cloudinary env vars",
    "Configure email provider env vars",
    "Run safe smoke checks (RUN SAFE ECOMMERCE CHECKS) to verify staging URLs",
    "Complete manual checklist: cart, checkout, order, admin, email, Cloudinary",
    "Register staging Stripe webhook in Stripe Dashboard",
    "Confirm test order created in staging DB and visible in admin",
    "Export ECOMMERCE_TEST_REPORT.md and review before production cutover",
    "Mark Ecommerce Proof Complete (MARK ECOMMERCE PROOF COMPLETE) after all items pass",
  ];

  return {
    projectId,
    generatedAt:  new Date().toISOString(),
    status:       deriveStatus(checks),
    targetDomain,
    checks,
    blockers,
    warnings,
    nextSteps,
    summary,
  };
}
