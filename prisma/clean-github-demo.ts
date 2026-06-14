/**
 * Removes demo / seed GitHub data from the database.
 *
 * What gets deleted:
 *   • GitHubWebhookDelivery rows with installationId 987654, deliveryId "seed-delivery-*",
 *     or repositoryFullName "alexrivera/*"
 *   • DetectedRepository rows for owner "alexrivera" or installationId 987654
 *   • IgnoredRepository rows for owner "alexrivera"
 *   • GitHubRepository rows for owner "alexrivera" or installationId 987654
 *     (the linked Project is KEPT — only the GitHub link is severed)
 *   • GitCommit / GitSyncRun / ProjectFile rows attached to those demo repos
 *   • The GitHub Integration record's fake credentials are wiped so the real
 *     installation ID can be recorded via the UI
 *
 * Safe to run multiple times — idempotent.
 * Usage:  npm run db:clean-github-demo
 */

import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const DEMO_OWNER = "alexrivera";
const DEMO_INSTALLATION_ID = 987654;
const SEED_DELIVERY_PREFIX = "seed-delivery-";

async function main() {
  console.log("🧹  Cleaning demo GitHub data…\n");

  // ── 1. Webhook deliveries ────────────────────────────────────────────────
  const delDeliveries = await db.gitHubWebhookDelivery.deleteMany({
    where: {
      OR: [
        { installationId: DEMO_INSTALLATION_ID },
        { deliveryId: { startsWith: SEED_DELIVERY_PREFIX } },
        { repositoryFullName: { startsWith: `${DEMO_OWNER}/` } },
      ],
    },
  });
  console.log(`  ✓ Webhook deliveries removed: ${delDeliveries.count}`);

  // ── 2. Detected repositories ─────────────────────────────────────────────
  const delDetected = await db.detectedRepository.deleteMany({
    where: {
      OR: [
        { fullName: { startsWith: `${DEMO_OWNER}/` } },
        { installationId: DEMO_INSTALLATION_ID },
      ],
    },
  });
  console.log(`  ✓ Detected repositories removed: ${delDetected.count}`);

  // ── 3. Ignored repositories ──────────────────────────────────────────────
  const delIgnored = await db.ignoredRepository.deleteMany({
    where: { fullName: { startsWith: `${DEMO_OWNER}/` } },
  });
  console.log(`  ✓ Ignored repositories removed: ${delIgnored.count}`);

  // ── 4. Imported GitHub repositories + related synced content ────────────
  const demoRepos = await db.gitHubRepository.findMany({
    where: {
      OR: [
        { fullName: { startsWith: `${DEMO_OWNER}/` } },
        { installationId: DEMO_INSTALLATION_ID },
      ],
    },
    select: { id: true, fullName: true, projectId: true },
  });

  if (demoRepos.length === 0) {
    console.log("  ✓ No imported demo repositories found");
  }

  for (const repo of demoRepos) {
    console.log(`\n  → Cleaning demo repo: ${repo.fullName}`);

    // Delete synced project data (fake content from seed)
    const [commits, runs, files] = await Promise.all([
      db.gitCommit.deleteMany({ where: { projectId: repo.projectId } }),
      db.gitSyncRun.deleteMany({ where: { projectId: repo.projectId } }),
      db.projectFile.deleteMany({ where: { projectId: repo.projectId } }),
    ]);
    console.log(
      `    GitCommit: ${commits.count}  GitSyncRun: ${runs.count}  ProjectFile: ${files.count}`
    );

    // Unlink the repository record — the linked Project is intentionally kept
    await db.gitHubRepository.delete({ where: { id: repo.id } });
    console.log(`    GitHubRepository unlinked (Project kept)`);
  }

  if (demoRepos.length > 0) {
    console.log(`\n  ✓ Imported repositories cleaned: ${demoRepos.length}`);
  }

  // ── 5. Reset GitHub Integration credentials ──────────────────────────────
  // Wipe fake demo credentials so the real installation ID can be recorded.
  const updInt = await db.integration.updateMany({
    where: { type: "GITHUB", externalUsername: DEMO_OWNER },
    data: {
      externalUsername: null,
      externalId: null,
      installationId: null,
      encryptedToken: null,
      metadata: {},
      status: "PENDING",
    },
  });
  if (updInt.count > 0) {
    console.log(`  ✓ GitHub Integration credentials reset (${updInt.count} record)`);
  }

  console.log("\n✅  Demo GitHub data cleaned.\n");
  console.log("Next steps:");
  console.log("  1. Start the app:  npm run dev");
  console.log("  2. Go to /integrations/github");
  console.log("  3. Enter your real installation ID (e.g. 139364146) and click Save");
  console.log("  4. Click Refresh Repositories to pull real repos from GitHub");
}

main()
  .then(async () => {
    await db.$disconnect();
  })
  .catch(async (e) => {
    console.error("Cleanup failed:", e);
    await db.$disconnect();
    process.exit(1);
  });
