/**
 * lib/ecommerce/ecommerce-test-export.ts
 *
 * Sprint 62: Generate ECOMMERCE_TEST_REPORT.md from an ecommerce test report.
 *
 * Safety: no secrets included. Only env var names and check metadata.
 */

import type {
  EcommerceTestReport,
  EcommerceTestCheck,
  EcommerceSmokeReport,
} from "./ecommerce-test-types";

// ── Helpers ───────────────────────────────────────────────────────────────────

function statusIcon(status: EcommerceTestCheck["status"]): string {
  switch (status) {
    case "pass":    return "✅";
    case "warning": return "⚠️";
    case "fail":    return "❌";
    case "manual":  return "🔧";
    case "pending": return "⏳";
  }
}

function overallIcon(status: EcommerceTestReport["status"]): string {
  switch (status) {
    case "passed":      return "✅";
    case "complete":    return "✅";
    case "ready":       return "🟢";
    case "warning":     return "⚠️";
    case "blocked":     return "🔴";
    case "failed":      return "🔴";
    case "running":     return "⏳";
    case "not_started": return "⬜";
    case "unknown":     return "❓";
  }
}

function smokeIcon(s: "pass" | "passed" | "warning" | "fail" | "failed"): string {
  return s === "pass" || s === "passed" ? "✅" : s === "warning" ? "⚠️" : "❌";
}

// ── Main export ───────────────────────────────────────────────────────────────

export function exportEcommerceTestReport(
  report:      EcommerceTestReport,
  projectName: string,
  smokeReport?: EcommerceSmokeReport | null,
): string {
  const lines: string[] = [];

  // ── Header ────────────────────────────────────────────────────────────────
  lines.push(`# ECOMMERCE_TEST_REPORT — \`${projectName}\``);
  lines.push("");
  lines.push(`> Generated: ${new Date(report.generatedAt).toUTCString()}`);
  lines.push(`> **Target domain:** \`https://${report.targetDomain}\``);
  lines.push(`> **Overall status:** ${overallIcon(report.status)} ${report.status.toUpperCase().replace("_", " ")}`);
  lines.push("");
  lines.push("| Passed | Warnings | Failed | Manual | Pending | Total |");
  lines.push("|--------|----------|--------|--------|---------|-------|");
  lines.push(`| ${report.summary.passed} | ${report.summary.warnings} | ${report.summary.failed} | ${report.summary.manual} | ${report.summary.pending} | ${report.summary.total} |`);
  lines.push("");

  // ── Safety notice ─────────────────────────────────────────────────────────
  lines.push("## ⚠️  Safety Notice");
  lines.push("");
  lines.push("This report covers **staging/test-mode only**.");
  lines.push("");
  lines.push("- No real charges were made");
  lines.push("- No production orders were created");
  lines.push("- No provider APIs were mutated");
  lines.push("- No live Sardar production was affected");
  lines.push("- No secret values are included in this document");
  lines.push("");

  // ── Blockers ──────────────────────────────────────────────────────────────
  if (report.blockers.length > 0) {
    lines.push("## ❌ Blockers");
    lines.push("");
    report.blockers.forEach((b) => lines.push(`- ${b}`));
    lines.push("");
  }

  // ── Warnings ──────────────────────────────────────────────────────────────
  if (report.warnings.length > 0) {
    lines.push("## ⚠️  Warnings");
    lines.push("");
    report.warnings.forEach((w) => lines.push(`- ${w}`));
    lines.push("");
  }

  // ── Provider readiness ────────────────────────────────────────────────────
  lines.push("## Provider Readiness");
  lines.push("");
  lines.push("| Provider | Check | Status |");
  lines.push("|----------|-------|--------|");
  const providerChecks = report.checks.filter((c) =>
    ["stripe", "email", "cloudinary"].includes(c.category)
  );
  for (const c of providerChecks) {
    lines.push(`| ${c.category.charAt(0).toUpperCase() + c.category.slice(1)} | ${c.label} | ${statusIcon(c.status)} |`);
  }
  lines.push("");

  // ── Safe smoke check results ──────────────────────────────────────────────
  if (smokeReport) {
    lines.push("## Safe Smoke Check Results");
    lines.push("");
    lines.push(`**Domain:** \`${smokeReport.targetDomain}\``);
    lines.push(`**Checked at:** ${new Date(smokeReport.generatedAt).toUTCString()}`);
    lines.push(`**Overall:** ${smokeIcon(smokeReport.status)} ${smokeReport.status.toUpperCase()}`);
    lines.push("");
    lines.push("| Check | URL | Status | HTTP |");
    lines.push("|-------|-----|--------|------|");
    for (const r of smokeReport.results) {
      const http = r.httpStatus ? String(r.httpStatus) : "—";
      lines.push(`| ${r.label} | \`${r.url}\` | ${smokeIcon(r.status)} | ${http} |`);
    }
    if (smokeReport.warnings.length > 0) {
      lines.push("");
      smokeReport.warnings.forEach((w) => lines.push(`> ⚠️  ${w}`));
    }
    lines.push("");
  } else {
    lines.push("## Safe Smoke Check Results");
    lines.push("");
    lines.push("> Smoke checks not yet run. Use **Run Safe Ecommerce Checks** (confirm: `RUN SAFE ECOMMERCE CHECKS`) to run HTTP checks.");
    lines.push("");
  }

  // ── Check categories detail ───────────────────────────────────────────────
  const categories = [
    "storefront", "products", "cart", "checkout",
    "stripe", "webhooks", "orders", "email", "cloudinary",
    "admin", "database", "security",
  ] as const;

  for (const cat of categories) {
    const catChecks = report.checks.filter((c) => c.category === cat);
    if (catChecks.length === 0) continue;

    const catTitle = cat.charAt(0).toUpperCase() + cat.slice(1);
    lines.push(`## ${catTitle} Checks`);
    lines.push("");
    for (const c of catChecks) {
      const req = c.required ? " *(required)*" : "";
      lines.push(`### ${statusIcon(c.status)} ${c.label}${req}`);
      lines.push("");
      lines.push(c.message);
      if (c.warning) {
        lines.push("");
        lines.push(`> ⚠️  ${c.warning}`);
      }
      if (c.command) {
        lines.push("");
        lines.push("```bash");
        lines.push(c.command);
        lines.push("```");
      }
      if (c.evidence?.length) {
        lines.push("");
        c.evidence.forEach((e) => lines.push(`- Evidence: \`${e}\``));
      }
      lines.push("");
    }
  }

  // ── Stripe test-mode instructions ─────────────────────────────────────────
  lines.push("## Stripe Test-Mode Instructions");
  lines.push("");
  lines.push("> **Use test mode only.** Do not use real customer cards or create production orders.");
  lines.push("");
  lines.push("### Test Cards");
  lines.push("");
  lines.push("| Scenario | Card Number | Expiry | CVC |");
  lines.push("|----------|-------------|--------|-----|");
  lines.push("| Success | `4242 4242 4242 4242` | Any future | Any |");
  lines.push("| Insufficient funds | `4000 0000 0000 9995` | Any future | Any |");
  lines.push("| Requires auth | `4000 0025 0000 3155` | Any future | Any |");
  lines.push("| Declined | `4000 0000 0000 0002` | Any future | Any |");
  lines.push("");
  lines.push("### Verification Steps");
  lines.push("");
  lines.push("1. Confirm STRIPE_SECRET_KEY starts with `sk_test_` in staging");
  lines.push("2. Confirm STRIPE_PUBLISHABLE_KEY starts with `pk_test_` in staging");
  lines.push("3. Register staging webhook URL in Stripe Dashboard (test environment)");
  lines.push("4. Use Stripe CLI to send test events: `stripe trigger payment_intent.succeeded`");
  lines.push("5. Verify test payment appears in Stripe test dashboard — NOT in live dashboard");
  lines.push("");

  // ── Manual evidence checklist ─────────────────────────────────────────────
  lines.push("## Manual Evidence Checklist");
  lines.push("");
  lines.push("> Tick each item after manually verifying on staging. Do not mark complete before all items pass.");
  lines.push("");
  const evidenceItems = [
    "Storefront loads on staging",
    "Product list visible on staging",
    "Product detail page visible",
    "Product image loads (Cloudinary)",
    "Add-to-cart works",
    "Cart quantity update works",
    "Cart item remove works",
    "Checkout form loads",
    "Checkout validation errors display",
    "Stripe test card path reviewed (4242 4242 4242 4242)",
    "Stripe webhook endpoint documented",
    "Test order created in staging/test mode ONLY",
    "Order confirmation page reviewed",
    "Admin orders page reviewed",
    "Test email reviewed (no real customer address)",
    "Cloudinary test upload reviewed safely",
    "Refund/cancel path reviewed manually",
    "Database backup exists before order-flow test",
  ];
  evidenceItems.forEach((item) => lines.push(`- [ ] ${item}`));
  lines.push("");

  // ── Webhook readiness ─────────────────────────────────────────────────────
  lines.push("## Webhook Readiness");
  lines.push("");
  lines.push(`**Staging webhook URL:** \`https://${report.targetDomain}/api/webhooks/stripe\``);
  lines.push("");
  lines.push("### Steps to Register Staging Webhook");
  lines.push("");
  lines.push("1. Go to Stripe Dashboard → Developers → Webhooks (test mode)");
  lines.push("2. Click Add endpoint");
  lines.push(`3. Endpoint URL: \`https://${report.targetDomain}/api/webhooks/stripe\``);
  lines.push("4. Select events: `payment_intent.succeeded`, `payment_intent.payment_failed`, `checkout.session.completed`");
  lines.push("5. Copy the signing secret → add to STRIPE_WEBHOOK_SECRET in staging Secrets Vault");
  lines.push("6. Use Stripe CLI to test: `stripe trigger payment_intent.succeeded`");
  lines.push("");

  // ── Next steps ────────────────────────────────────────────────────────────
  lines.push("## Next Steps Before Production Cutover");
  lines.push("");
  lines.push("> Only proceed to production ecommerce launch after all staging tests pass.");
  lines.push("");
  report.nextSteps.forEach((s) => lines.push(`- ${s}`));
  lines.push("");
  lines.push("### Production Ecommerce Checklist (after staging proof)");
  lines.push("");
  lines.push("- [ ] Switch STRIPE_SECRET_KEY to `sk_live_*` in production");
  lines.push("- [ ] Switch STRIPE_PUBLISHABLE_KEY to `pk_live_*` in production");
  lines.push("- [ ] Register production Stripe webhook endpoint");
  lines.push("- [ ] Verify Cloudinary production account/credentials");
  lines.push("- [ ] Verify email provider production credentials");
  lines.push("- [ ] Run smoke checks on live domain after production deploy");
  lines.push("- [ ] Place a real test order with a real (refundable) card to confirm end-to-end flow");
  lines.push("- [ ] Monitor Stripe dashboard for payment events");
  lines.push("- [ ] Monitor PM2 logs for errors");
  lines.push("");

  // ── Footer ────────────────────────────────────────────────────────────────
  lines.push("---");
  lines.push("");
  lines.push("> Generated by Prisom Project Panel — Sprint 62 Ecommerce Test Harness.");
  lines.push("> No secret values are included in this document.");
  lines.push("> This report covers staging/test-mode only. No real charges were made.");
  lines.push("");

  return lines.join("\n");
}
