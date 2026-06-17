/**
 * scripts/backfill-deployment-config.ts
 *
 * Safe one-time backfill for ProjectDeploymentConfig records.
 *
 * Behaviour:
 *   - Iterates every Project
 *   - Skips projects that already have a complete config (unless --force is passed)
 *   - For projects without a config, nothing is created (initial setup belongs to the UI)
 *   - For projects WITH a config, fills only missing/null fields:
 *       - runtime         → "node" (default)
 *       - loginPath       → "/login" (default)
 *       - healthPath      → "/api/healthz" if currently "/", else keep existing
 *       - primaryDomain   → inferred from the project's first ACTIVE domain record
 *       - validationStatus → "unchecked" if not set
 *   - Preserves: port, pm2Name, startCommand, installCommand, buildCommand, nodeEnv
 *   - Never prints secrets
 *
 * Run:
 *   pnpm tsx scripts/backfill-deployment-config.ts
 *   pnpm tsx scripts/backfill-deployment-config.ts --force   (overwrite even non-null fields)
 *
 * Dry-run (preview only, no writes):
 *   pnpm tsx scripts/backfill-deployment-config.ts --dry-run
 */

import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const FORCE    = process.argv.includes("--force");
const DRY_RUN  = process.argv.includes("--dry-run");

async function main() {
  console.log("=== Prisom Project Panel — Deployment Config Backfill ===");
  if (DRY_RUN) console.log("DRY RUN — no writes will be made.\n");
  if (FORCE)   console.log("FORCE mode — existing values will be overwritten.\n");

  const projects = await db.project.findMany({
    select: {
      id:   true,
      name: true,
      slug: true,
      deploymentConfig: {
        select: {
          id:               true,
          port:             true,
          pm2Name:          true,
          runtime:          true,
          loginPath:        true,
          healthPath:       true,
          primaryDomain:    true,
          validationStatus: true,
          startCommand:     true,
          nodeEnv:          true,
        },
      },
    },
  });

  let checkedCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;
  let noConfigCount = 0;

  for (const project of projects) {
    checkedCount++;
    const config = project.deploymentConfig;

    if (!config) {
      console.log(`  [SKIP] ${project.name} (${project.slug}) — no config, needs initial setup via UI`);
      noConfigCount++;
      continue;
    }

    // Determine what needs to be filled
    const updates: Record<string, unknown> = {};

    // runtime: fill if missing or if forced
    if (!config.runtime || config.runtime === "" || FORCE) {
      updates.runtime = "node";
    }

    // loginPath: fill if missing or "/" (the old default before Sprint 3) or forced
    if (!config.loginPath || config.loginPath === "/" || FORCE) {
      updates.loginPath = "/login";
    }

    // healthPath: if it's just "/" (the Prisma schema default), upgrade to /api/healthz
    if (config.healthPath === "/" || (!config.healthPath && FORCE)) {
      updates.healthPath = "/api/healthz";
    }

    // primaryDomain: fill from ACTIVE domain if not set
    if (!config.primaryDomain || FORCE) {
      const activeDomain = await db.domain.findFirst({
        where:   { projectId: project.id, status: "ACTIVE" },
        orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
        select:  { hostname: true, sslStatus: true },
      });
      if (activeDomain) {
        const scheme = activeDomain.sslStatus === "ACTIVE" ? "https" : "http";
        updates.primaryDomain = `${scheme}://${activeDomain.hostname}`;
      }
    }

    // validationStatus: set to "unchecked" if null
    if (!config.validationStatus || FORCE) {
      updates.validationStatus = "unchecked";
    }

    if (Object.keys(updates).length === 0) {
      console.log(`  [OK]   ${project.name} (${project.slug}) — port ${config.port}, pm2 ${config.pm2Name} — already complete`);
      skippedCount++;
      continue;
    }

    // Log the changes
    const updateSummary = Object.entries(updates)
      .map(([k, v]) => `${k}=${v}`)
      .join(", ");
    console.log(`  [UPDATE] ${project.name} (${project.slug}) — port ${config.port}, pm2 ${config.pm2Name}: ${updateSummary}`);

    if (!DRY_RUN) {
      await db.projectDeploymentConfig.update({
        where: { projectId: project.id },
        data:  updates,
      });
    }
    updatedCount++;
  }

  console.log("\n=== Summary ===");
  console.log(`Checked  : ${checkedCount} projects`);
  console.log(`No config: ${noConfigCount} (needs UI setup first)`);
  console.log(`Updated  : ${updatedCount} configs`);
  console.log(`Skipped  : ${skippedCount} (already complete)`);
  if (DRY_RUN) console.log("\nDry-run complete — re-run without --dry-run to apply changes.");
}

main()
  .catch((e) => {
    console.error("Backfill failed:", e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
