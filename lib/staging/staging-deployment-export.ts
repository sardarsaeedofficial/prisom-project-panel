/**
 * lib/staging/staging-deployment-export.ts
 *
 * Sprint 64: Export STAGING_DEPLOYMENT_PROOF.md
 *
 * Safety: no secrets included.
 */

import type {
  StagingDeploymentProof,
  StagingDeploymentStep,
  StagingDeploymentStage,
} from "./staging-deployment-types";

// ── Helpers ───────────────────────────────────────────────────────────────────

function stepIcon(s: StagingDeploymentStep["status"]): string {
  switch (s) {
    case "pass":    return "✅";
    case "warning": return "⚠️";
    case "fail":    return "❌";
    case "manual":  return "🔧";
    case "pending": return "⏳";
  }
}

function overallIcon(s: StagingDeploymentProof["status"]): string {
  switch (s) {
    case "passed":
    case "complete":
    case "ready":   return "✅";
    case "warning": return "⚠️";
    case "blocked":
    case "failed":  return "❌";
    default:        return "❓";
  }
}

function smokeIcon(s: "pass" | "warning" | "fail"): string {
  return s === "pass" ? "✅" : s === "warning" ? "⚠️" : "❌";
}

const STAGE_LABELS: Record<StagingDeploymentStage, string> = {
  target:          "Target",
  source:          "Source",
  services:        "Services",
  env:             "Env / Secrets",
  database:        "Database",
  build:           "Build",
  routing_preview: "Routing Preview",
  smoke_checks:    "Smoke Checks",
  manual:          "Manual Review",
};

const STAGE_ORDER: StagingDeploymentStage[] = [
  "target", "source", "services", "env", "database",
  "build", "routing_preview", "smoke_checks", "manual",
];

// ── Main ──────────────────────────────────────────────────────────────────────

export function exportStagingDeploymentProof(
  proof:       StagingDeploymentProof,
  projectName: string,
): string {
  const lines: string[] = [];
  const plan = proof.plan;

  // ── Header ─────────────────────────────────────────────────────────────────
  lines.push(`# STAGING_DEPLOYMENT_PROOF — \`${projectName}\``);
  lines.push("");
  lines.push(`> Generated: ${new Date(proof.generatedAt).toUTCString()}`);
  lines.push(`> **Source project:** \`${plan.sourceProjectSlug}\``);
  lines.push(`> **Staging slug:** \`${proof.stagingSlug}\``);
  lines.push(`> **Staging domain:** \`https://${proof.stagingDomain}\``);
  lines.push(`> **Overall status:** ${overallIcon(proof.status)} ${proof.status.toUpperCase()}`);
  lines.push("");

  // ── Safety ─────────────────────────────────────────────────────────────────
  lines.push("## ⚠️  Safety Notice");
  lines.push("");
  lines.push("This document is a staging deployment proof only.");
  lines.push("");
  lines.push("- No production nginx routes were modified");
  lines.push("- No DNS changes were made");
  lines.push("- No PM2 production processes were restarted");
  lines.push("- No DB migrations were run against production");
  lines.push("- No production secrets are included in this document");
  lines.push("- Doorsteps/LocalShop untouched");
  lines.push("- Live Sardar project (port 4100) untouched");
  lines.push("");

  // ── Blockers ───────────────────────────────────────────────────────────────
  if (proof.blockers.length > 0) {
    lines.push("## ❌ Blockers");
    lines.push("");
    proof.blockers.forEach((b) => lines.push(`- ${b}`));
    lines.push("");
  }

  // ── Warnings ───────────────────────────────────────────────────────────────
  if (proof.warnings.length > 0) {
    lines.push("## ⚠️  Warnings");
    lines.push("");
    proof.warnings.forEach((w) => lines.push(`- ${w}`));
    lines.push("");
  }

  // ── Service plan ───────────────────────────────────────────────────────────
  lines.push("## Service Plan");
  lines.push("");
  lines.push("| Service | Kind | Root | Build | Start | Route |");
  lines.push("|---------|------|------|-------|-------|-------|");
  for (const svc of plan.servicePlan) {
    const build  = svc.buildCommand ?? "—";
    const start  = svc.startCommand ?? "—";
    const route  = svc.route ?? "—";
    lines.push(`| \`${svc.name}\` | ${svc.kind} | \`${svc.root}\` | \`${build}\` | \`${start}\` | \`${route}\` |`);
  }
  lines.push("");

  // ── Per-stage steps ─────────────────────────────────────────────────────────
  for (const stage of STAGE_ORDER) {
    const stageSteps = plan.steps.filter((s) => s.stage === stage);
    if (stageSteps.length === 0) continue;
    lines.push(`## ${STAGE_LABELS[stage]}`);
    lines.push("");
    for (const s of stageSteps) {
      const req = s.required ? " *(required)*" : "";
      lines.push(`### ${stepIcon(s.status)} ${s.label}${req}`);
      lines.push("");
      lines.push(s.message);
      if (s.warning) {
        lines.push("");
        lines.push(`> ⚠️  ${s.warning}`);
      }
      if (s.command) {
        lines.push("");
        lines.push("```bash");
        lines.push(s.command);
        lines.push("```");
      }
      if (s.evidence?.length) {
        lines.push("");
        s.evidence.forEach((e) => lines.push(`- Evidence: \`${e}\``));
      }
      lines.push("");
    }
  }

  // ── Source preparation plan ─────────────────────────────────────────────────
  lines.push("## Source Preparation Plan");
  lines.push("");
  lines.push("> Run these commands manually. Do not execute automatically.");
  lines.push("");
  lines.push("```bash");
  lines.push(`# Source: <project_storage>/${plan.sourceProjectSlug}`);
  lines.push(`# Target: <staging_storage>/${proof.stagingSlug}`);
  lines.push("");
  lines.push("# 1. Dry-run rsync (review output before running without --dry-run)");
  lines.push(`rsync -av --dry-run \\`);
  lines.push(`  --exclude='node_modules' \\`);
  lines.push(`  --exclude='.git' \\`);
  lines.push(`  --exclude='.env' \\`);
  lines.push(`  --exclude='.env.*' \\`);
  lines.push(`  <source>/ <staging_target>/`);
  lines.push("");
  lines.push("# 2. Remove any leaked .env files");
  lines.push(`find <staging_target> -name '.env*' -not -path '*/node_modules/*' -delete`);
  lines.push("");
  lines.push("# 3. Install");
  lines.push("pnpm install --frozen-lockfile");
  lines.push("");
  lines.push("# 4. Build");
  lines.push("pnpm --filter @workspace/api-server run build");
  lines.push("pnpm --filter @workspace/sardar-security run build");
  lines.push("```");
  lines.push("");

  // ── Env placeholder checklist ───────────────────────────────────────────────
  lines.push("## Env Placeholder Checklist");
  lines.push("");
  lines.push("> Set each var to staging-specific values. Never copy production secrets.");
  lines.push("");
  [
    `APP_URL=https://${proof.stagingDomain}`,
    "DATABASE_URL=<staging_postgres_url>",
    "STRIPE_SECRET_KEY=sk_test_<staging_key>",
    "STRIPE_PUBLISHABLE_KEY=pk_test_<staging_key>",
    "STRIPE_WEBHOOK_SECRET=<staging_webhook_secret>",
    "CLOUDINARY_CLOUD_NAME=<staging_cloud_name>",
    "CLOUDINARY_API_KEY=<staging_api_key>",
    "CLOUDINARY_API_SECRET=<staging_api_secret>",
    "RESEND_API_KEY=<staging_email_key>",
    "NODE_ENV=production",
    "PORT=<staging_port> (not 4100)",
  ].forEach((item) => lines.push(`- [ ] \`${item}\``));
  lines.push("");

  // ── Dry-run checklist ───────────────────────────────────────────────────────
  lines.push("## Build Dry-Run Checklist");
  lines.push("");
  [
    "pnpm install --frozen-lockfile completes without errors",
    "pnpm --filter @workspace/api-server run build completes",
    "pnpm --filter @workspace/sardar-security run build completes",
    "API dist/index.mjs exists",
    "Static dist/public/index.html exists",
    "No secrets in build output",
  ].forEach((item) => lines.push(`- [ ] ${item}`));
  lines.push("");

  // ── Smoke check results ─────────────────────────────────────────────────────
  if (proof.smokeChecks && proof.smokeChecks.length > 0) {
    lines.push("## Smoke Check Results");
    lines.push("");
    lines.push("| Check | URL | Status | HTTP |");
    lines.push("|-------|-----|--------|------|");
    for (const r of proof.smokeChecks) {
      const http = r.httpStatus ? String(r.httpStatus) : "—";
      lines.push(`| ${r.label} | \`${r.url}\` | ${smokeIcon(r.status)} | ${http} |`);
    }
    lines.push("");
  } else {
    lines.push("## Smoke Check Results");
    lines.push("");
    lines.push("> Smoke checks not yet run. Confirm with `RUN STAGING DRY RUN`.");
    lines.push("");
  }

  // ── Manual evidence checklist ───────────────────────────────────────────────
  lines.push("## Manual Evidence Checklist");
  lines.push("");
  lines.push("> Tick each item after verifying on staging.");
  lines.push("");
  [
    "Staging project target reviewed",
    "Staging source path reviewed",
    "Production source untouched (live Sardar at port 4100 still running)",
    "Staging env placeholders reviewed",
    "Staging DATABASE_URL uses staging DB (not production DB)",
    "API service command reviewed",
    "Static frontend command reviewed",
    "/api/* route preview reviewed",
    "/* static route preview reviewed",
    "Build dry run reviewed",
    "Staging root smoke check reviewed",
    "Staging API health reviewed",
    "Staging SPA fallback reviewed",
    "Logs reviewed after dry run",
    "Staging marked ready by owner",
  ].forEach((item) => lines.push(`- [ ] ${item}`));
  lines.push("");

  // ── Next steps ──────────────────────────────────────────────────────────────
  lines.push("## Next Steps Before Production Cutover");
  lines.push("");
  proof.nextSteps.forEach((s) => lines.push(`- ${s}`));
  lines.push("");

  // ── Footer ──────────────────────────────────────────────────────────────────
  lines.push("---");
  lines.push("");
  lines.push("> Generated by Prisom Project Panel — Sprint 64 Staging Deployment Workflow.");
  lines.push("> No secret values are included in this document.");
  lines.push("> No production changes were made by generating this document.");
  lines.push("");

  return lines.join("\n");
}
