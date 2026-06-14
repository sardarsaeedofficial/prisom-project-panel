/**
 * Seed script: upsert Doorsteps / LocalShop as a managed project.
 *
 * Prerequisites: run `npm run db:seed` first to create the owner user
 * and workspace, then run this script:
 *
 *   npm run db:seed-doorsteps
 */

import {
  PrismaClient,
  UserRole,
  ProjectStatus,
  ProjectType,
  Visibility,
  EnvironmentName,
  EnvironmentStatus,
  DomainStatus,
  SslStatus,
} from "@prisma/client";

const db = new PrismaClient();

async function main() {
  // ── 1. Find the workspace owner ──────────────────────────────────────────────
  const owner = await db.user.findFirst({
    where: { role: UserRole.OWNER },
    orderBy: { createdAt: "asc" },
  });

  if (!owner) {
    console.error(
      "❌  No OWNER user found.\n   Run `npm run db:seed` first to create the base workspace."
    );
    process.exit(1);
  }

  const workspace = await db.workspace.findFirst({
    where: { members: { some: { userId: owner.id } } },
  });

  if (!workspace) {
    console.error(
      "❌  No workspace found.\n   Run `npm run db:seed` first to create the base workspace."
    );
    process.exit(1);
  }

  console.log(`✓  Found workspace: ${workspace.name} (${workspace.id})`);

  // ── 2. Upsert the project ────────────────────────────────────────────────────
  const project = await db.project.upsert({
    where: {
      workspaceId_slug: {
        workspaceId: workspace.id,
        slug: "doorsteps-localshop",
      },
    },
    update: {
      name: "Doorsteps / LocalShop",
      description:
        "Food & grocery delivery platform — NestJS backend + Next.js manager web — deployed on Hetzner VPS.",
      status: ProjectStatus.ACTIVE,
      liveUrl: "https://doorstepmanchester.uk",
      language: "TypeScript",
      framework: "NestJS + Next.js",
    },
    create: {
      workspaceId: workspace.id,
      ownerId: owner.id,
      name: "Doorsteps / LocalShop",
      slug: "doorsteps-localshop",
      description:
        "Food & grocery delivery platform — NestJS backend + Next.js manager web — deployed on Hetzner VPS.",
      type: ProjectType.APP,
      status: ProjectStatus.ACTIVE,
      visibility: Visibility.PRIVATE,
      language: "TypeScript",
      framework: "NestJS + Next.js",
      liveUrl: "https://doorstepmanchester.uk",
      buildCommand: "npm run build",
      startCommand: "pm2 restart prisom-backend prisom-manager",
    },
  });

  console.log(`✓  Project upserted: ${project.name} (${project.id})`);

  // ── 3. Upsert GitHub repository ───────────────────────────────────────────────
  await db.gitHubRepository.upsert({
    where: { projectId: project.id },
    update: {
      fullName: "sardarsaeedofficial/localshop",
      name: "localshop",
      htmlUrl: "https://github.com/sardarsaeedofficial/localshop",
      defaultBranch: "master",
    },
    create: {
      projectId: project.id,
      // Placeholder numeric ID — real ID will be populated when GitHub App syncs
      githubRepoId: 888001,
      fullName: "sardarsaeedofficial/localshop",
      name: "localshop",
      htmlUrl: "https://github.com/sardarsaeedofficial/localshop",
      url: "https://api.github.com/repos/sardarsaeedofficial/localshop",
      cloneUrl: "https://github.com/sardarsaeedofficial/localshop.git",
      defaultBranch: "master",
      private: false,
    },
  });

  console.log("✓  GitHub repository upserted: sardarsaeedofficial/localshop");

  // ── 4. Create environments if missing ────────────────────────────────────────
  const existingEnvs = await db.environment.findMany({
    where: { projectId: project.id },
    select: { name: true },
  });
  const existingNames = existingEnvs.map((e) => e.name);
  const missingEnvs = (
    [EnvironmentName.PRODUCTION, EnvironmentName.DEVELOPMENT] as const
  ).filter((n) => !existingNames.includes(n));

  if (missingEnvs.length > 0) {
    await db.environment.createMany({
      data: missingEnvs.map((name) => ({
        projectId: project.id,
        name,
        status: EnvironmentStatus.ACTIVE,
      })),
    });
    console.log(`✓  Created environments: ${missingEnvs.join(", ")}`);
  } else {
    console.log("✓  Environments already exist");
  }

  // ── 5. Upsert primary domain ──────────────────────────────────────────────────
  await db.domain.upsert({
    where: { hostname: "doorstepmanchester.uk" },
    update: {
      projectId: project.id,
      isPrimary: true,
      status: DomainStatus.ACTIVE,
      sslStatus: SslStatus.ACTIVE,
    },
    create: {
      projectId: project.id,
      hostname: "doorstepmanchester.uk",
      isPrimary: true,
      status: DomainStatus.ACTIVE,
      sslStatus: SslStatus.ACTIVE,
    },
  });

  console.log("✓  Domain upserted: doorstepmanchester.uk");
  console.log("\n🎉  Doorsteps / LocalShop project is ready in Prisom Panel.");
}

main()
  .catch((e) => {
    console.error("Seed error:", e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
