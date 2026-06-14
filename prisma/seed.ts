/**
 * Prisom Project Panel — Database Seed
 * Run: npm run db:seed  (requires a live DATABASE_URL)
 *
 * Creates: 1 owner user · 1 workspace · 6 projects · 1 GitHub-connected project
 *          sample commits · sync runs · environments · secrets (placeholder) ·
 *          domains · deployments · logs · portfolio item
 */

import {
  PrismaClient,
  UserRole,
  ProjectType,
  ProjectStatus,
  Visibility,
  GitSyncStatus,
  GitSyncSource,
  FileType,
  FeatureStatus,
  TaskStatus,
  TaskSource,
  Priority,
  EnvironmentName,
  EnvironmentStatus,
  DomainStatus,
  SslStatus,
  DatabaseType,
  DatabaseStatus,
  DeploymentStatus,
  DeploymentSource,
  LogLevel,
  LogSource,
  IntegrationType,
  IntegrationStatus,
} from "@prisma/client";

const db = new PrismaClient();

async function main() {
  console.log("🌱 Seeding Prisom Project Panel database...\n");

  // ── Clean slate (cascade order matters) ─────────────────────────────────
  await db.aiToolCall.deleteMany();
  await db.aiMessage.deleteMany();
  await db.aiSession.deleteMany();
  await db.projectLog.deleteMany();
  await db.deployment.deleteMany();
  await db.databaseMigration.deleteMany();
  await db.projectDatabase.deleteMany();
  await db.domain.deleteMany();
  await db.secret.deleteMany();
  await db.environment.deleteMany();
  await db.projectTask.deleteMany();
  await db.projectFeature.deleteMany();
  await db.projectFile.deleteMany();
  await db.gitSyncRun.deleteMany();
  await db.gitCommit.deleteMany();
  await db.gitHubRepository.deleteMany();
  await db.ignoredRepository.deleteMany();
  await db.detectedRepository.deleteMany();
  await db.gitHubWebhookDelivery.deleteMany();
  await db.portfolioItem.deleteMany();
  await db.project.deleteMany();
  await db.integration.deleteMany();
  await db.apiKey.deleteMany();
  await db.workspaceMember.deleteMany();
  await db.workspace.deleteMany();
  await db.user.deleteMany();
  console.log("  ✓ Cleaned existing data");

  // ── User ─────────────────────────────────────────────────────────────────
  const user = await db.user.create({
    data: {
      id: "user_seed_001",
      email: "alex@prisom.dev",
      name: "Alex Rivera",
      avatarUrl: undefined,
      role: UserRole.OWNER,
    },
  });
  console.log(`  ✓ User: ${user.email}`);

  // ── Workspace ─────────────────────────────────────────────────────────────
  const workspace = await db.workspace.create({
    data: {
      id: "ws_seed_001",
      name: "Alex's Workspace",
      slug: "alexrivera",
      description: "Personal development workspace",
      ownerId: user.id,
    },
  });
  console.log(`  ✓ Workspace: ${workspace.slug}`);

  // ── Workspace member (owner) ──────────────────────────────────────────────
  await db.workspaceMember.create({
    data: {
      workspaceId: workspace.id,
      userId: user.id,
      role: UserRole.OWNER,
    },
  });

  // ── GitHub integration (minimal placeholder — real credentials set via UI) ──
  await db.integration.create({
    data: {
      workspaceId: workspace.id,
      type: IntegrationType.GITHUB,
      status: IntegrationStatus.PENDING,
      // No fake token/username in the default seed.
      // Use the "Record Installation ID" panel in /integrations/github
      // or run with SEED_DEMO_GITHUB=true to seed demo credentials.
    },
  });
  console.log(`  ✓ Integration: GITHUB (pending — add real installation ID via UI)`);

  // ── API key ───────────────────────────────────────────────────────────────
  await db.apiKey.create({
    data: {
      userId: user.id,
      name: "Production API Key",
      // SHA-256 hash placeholder — real keys hashed in lib/crypto.ts
      keyHash: "a".repeat(64),
      prefix: "ppm_prod",
      scopes: ["read:projects", "write:projects", "deploy"],
    },
  });

  // ── Projects ─────────────────────────────────────────────────────────────
  const projectDefs = [
    {
      id: "proj_seed_001",
      name: "ai-chat-assistant",
      slug: "ai-chat-assistant",
      description: "A real-time AI chat application with streaming responses and multi-turn conversations.",
      type: ProjectType.APP,
      status: ProjectStatus.ACTIVE,
      visibility: Visibility.PUBLIC,
      language: "TypeScript",
      framework: "Next.js",
      liveUrl: "https://ai-chat.prisom.dev",
      lastDeployedAt: new Date("2024-12-10T14:22:00Z"),
    },
    {
      id: "proj_seed_002",
      name: "data-pipeline",
      slug: "data-pipeline",
      description: "ETL pipeline for processing large datasets with real-time monitoring and alerting.",
      type: ProjectType.SERVICE,
      status: ProjectStatus.ACTIVE,
      visibility: Visibility.PRIVATE,
      language: "Python",
      framework: "FastAPI",
      liveUrl: null,
      lastDeployedAt: new Date("2024-12-08T11:05:00Z"),
    },
    {
      id: "proj_seed_003",
      name: "portfolio-site",
      slug: "portfolio-site",
      description: "Personal portfolio with blog, projects showcase, and contact form.",
      type: ProjectType.STATIC,
      status: ProjectStatus.ACTIVE,
      visibility: Visibility.PUBLIC,
      language: "TypeScript",
      framework: "Astro",
      liveUrl: "https://alexrivera.dev",
      lastDeployedAt: new Date("2024-12-05T16:40:00Z"),
    },
    {
      id: "proj_seed_004",
      name: "rust-cli-tool",
      slug: "rust-cli-tool",
      description: "High-performance CLI tool for file processing and data transformation.",
      type: ProjectType.LIBRARY,
      status: ProjectStatus.BUILDING,
      visibility: Visibility.PRIVATE,
      language: "Rust",
      framework: null,
      liveUrl: null,
      lastDeployedAt: null,
    },
    {
      id: "proj_seed_005",
      name: "legacy-dashboard",
      slug: "legacy-dashboard",
      description: "Internal analytics dashboard (deprecated, replaced by v2).",
      type: ProjectType.APP,
      status: ProjectStatus.ARCHIVED,
      visibility: Visibility.PRIVATE,
      language: "JavaScript",
      framework: null,
      liveUrl: null,
      lastDeployedAt: null,
    },
    {
      id: "proj_seed_006",
      name: "api-gateway",
      slug: "api-gateway",
      description: "Microservice API gateway with rate limiting, auth, and request routing.",
      type: ProjectType.API,
      status: ProjectStatus.ERROR,
      visibility: Visibility.PRIVATE,
      language: "Go",
      framework: "Gin",
      liveUrl: null,
      lastDeployedAt: new Date("2024-12-07T09:15:00Z"),
    },
  ];

  const projects: Record<string, { id: string }> = {};
  for (const def of projectDefs) {
    const p = await db.project.create({
      data: { ...def, workspaceId: workspace.id, ownerId: user.id },
    });
    projects[p.name] = p;
  }
  console.log(`  ✓ Projects: ${Object.keys(projects).join(", ")}`);

  const chatProject = projects["ai-chat-assistant"];
  const portfolioProject = projects["portfolio-site"];

  // ── Demo GitHub data (only when SEED_DEMO_GITHUB=true) ────────────────────
  // By default the seed ships with no fake GitHub repositories so real testing
  // is not confused by demo "alexrivera" repos and installation ID 987654.
  //
  // To seed the demo data for UI screenshots / dev exploration run:
  //   SEED_DEMO_GITHUB=true npm run db:seed
  const seedDemoGitHub = process.env.SEED_DEMO_GITHUB === "true";

  if (seedDemoGitHub) {
    const githubRepo = await db.gitHubRepository.create({
      data: {
        projectId: chatProject.id,
        githubRepoId: 123456789,
        fullName: "alexrivera/ai-chat-assistant",
        name: "ai-chat-assistant",
        description: "Real-time AI chat with streaming",
        private: false,
        defaultBranch: "main",
        language: "TypeScript",
        stargazersCount: 42,
        url: "https://api.github.com/repos/alexrivera/ai-chat-assistant",
        htmlUrl: "https://github.com/alexrivera/ai-chat-assistant",
        cloneUrl: "https://github.com/alexrivera/ai-chat-assistant.git",
        installationId: 987654,
        pushedAt: new Date("2024-12-10T14:00:00Z"),
        syncedAt: new Date("2024-12-10T14:05:00Z"),
      },
    });

    await db.detectedRepository.createMany({
      data: [
        {
          workspaceId: workspace.id,
          githubRepoId: 987654321,
          fullName: "alexrivera/new-side-project",
          name: "new-side-project",
          description: "A fun side project",
          private: true,
          language: "TypeScript",
          defaultBranch: "main",
          url: "https://api.github.com/repos/alexrivera/new-side-project",
          installationId: 987654,
        },
        {
          workspaceId: workspace.id,
          githubRepoId: 111222333,
          fullName: "alexrivera/dotfiles",
          name: "dotfiles",
          description: "My personal dotfiles",
          private: false,
          language: "Shell",
          defaultBranch: "main",
          url: "https://api.github.com/repos/alexrivera/dotfiles",
          installationId: 987654,
        },
      ],
    });

    await db.ignoredRepository.create({
      data: {
        workspaceId: workspace.id,
        githubRepoId: 444555666,
        fullName: "alexrivera/old-deprecated-thing",
        reason: "Too old, not relevant",
      },
    });

    const commitData = [
      {
        sha: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
        message: "feat: add streaming support for multi-turn conversations",
        authorName: "Alex Rivera",
        authorEmail: "alex@prisom.dev",
        authoredAt: new Date("2024-12-10T13:45:00Z"),
        committedAt: new Date("2024-12-10T13:50:00Z"),
        additions: 234,
        deletions: 45,
        changedFiles: 8,
        url: "https://github.com/alexrivera/ai-chat-assistant/commit/a1b2c3d",
      },
      {
        sha: "e4f5g6h7i8j9e4f5g6h7i8j9e4f5g6h7i8j9e4f5",
        message: "fix: resolve hydration mismatch on SSR render",
        authorName: "Alex Rivera",
        authorEmail: "alex@prisom.dev",
        authoredAt: new Date("2024-12-09T10:20:00Z"),
        committedAt: new Date("2024-12-09T10:25:00Z"),
        additions: 12,
        deletions: 18,
        changedFiles: 2,
        url: "https://github.com/alexrivera/ai-chat-assistant/commit/e4f5g6h",
      },
      {
        sha: "k1l2m3n4o5p6k1l2m3n4o5p6k1l2m3n4o5p6k1l2",
        message: "chore: upgrade to Next.js 16 and update dependencies",
        authorName: "Alex Rivera",
        authorEmail: "alex@prisom.dev",
        authoredAt: new Date("2024-12-08T09:00:00Z"),
        committedAt: new Date("2024-12-08T09:05:00Z"),
        additions: 102,
        deletions: 89,
        changedFiles: 5,
        url: "https://github.com/alexrivera/ai-chat-assistant/commit/k1l2m3n",
      },
      {
        sha: "q7r8s9t0u1v2q7r8s9t0u1v2q7r8s9t0u1v2q7r8",
        message: "docs: add deployment guide and environment variable docs",
        authorName: "Alex Rivera",
        authorEmail: "alex@prisom.dev",
        authoredAt: new Date("2024-12-07T15:30:00Z"),
        committedAt: new Date("2024-12-07T15:35:00Z"),
        additions: 88,
        deletions: 0,
        changedFiles: 3,
        url: "https://github.com/alexrivera/ai-chat-assistant/commit/q7r8s9t",
      },
    ];
    await db.gitCommit.createMany({
      data: commitData.map((c) => ({ ...c, projectId: chatProject.id })),
    });

    await db.gitSyncRun.createMany({
      data: [
        {
          projectId: chatProject.id,
          status: GitSyncStatus.SUCCESS,
          source: GitSyncSource.WEBHOOK,
          branch: "main",
          beforeSha: "k1l2m3n4o5p6k1l2m3n4o5p6k1l2m3n4o5p6k1l2",
          afterSha: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
          changedFiles: 8,
          startedAt: new Date("2024-12-10T13:51:00Z"),
          finishedAt: new Date("2024-12-10T13:52:30Z"),
        },
        {
          projectId: chatProject.id,
          status: GitSyncStatus.SUCCESS,
          source: GitSyncSource.WEBHOOK,
          branch: "main",
          beforeSha: "q7r8s9t0u1v2q7r8s9t0u1v2q7r8s9t0u1v2q7r8",
          afterSha: "k1l2m3n4o5p6k1l2m3n4o5p6k1l2m3n4o5p6k1l2",
          changedFiles: 5,
          startedAt: new Date("2024-12-08T09:06:00Z"),
          finishedAt: new Date("2024-12-08T09:07:15Z"),
        },
        {
          projectId: chatProject.id,
          status: GitSyncStatus.FAILED,
          source: GitSyncSource.MANUAL,
          branch: "feature/new-ui",
          changedFiles: 0,
          errorMessage: "Branch not found on remote",
          startedAt: new Date("2024-12-06T11:00:00Z"),
          finishedAt: new Date("2024-12-06T11:00:05Z"),
        },
      ],
    });

    await db.projectFile.createMany({
      data: [
        { projectId: chatProject.id, path: "app", name: "app", type: FileType.DIRECTORY },
        { projectId: chatProject.id, path: "app/layout.tsx", name: "layout.tsx", type: FileType.FILE, size: 512, mimeType: "text/typescript", sha: "abc001" },
        { projectId: chatProject.id, path: "app/page.tsx", name: "page.tsx", type: FileType.FILE, size: 1024, mimeType: "text/typescript", sha: "abc002" },
        { projectId: chatProject.id, path: "app/globals.css", name: "globals.css", type: FileType.FILE, size: 2048, mimeType: "text/css", sha: "abc003" },
        { projectId: chatProject.id, path: "components", name: "components", type: FileType.DIRECTORY },
        { projectId: chatProject.id, path: "lib", name: "lib", type: FileType.DIRECTORY },
        { projectId: chatProject.id, path: "lib/utils.ts", name: "utils.ts", type: FileType.FILE, size: 256, mimeType: "text/typescript", sha: "abc004" },
        { projectId: chatProject.id, path: "package.json", name: "package.json", type: FileType.FILE, size: 1800, mimeType: "application/json", sha: "abc005" },
      ],
    });

    // Update the Integration record with demo credentials
    await db.integration.updateMany({
      where: { workspaceId: workspace.id, type: IntegrationType.GITHUB },
      data: {
        status: IntegrationStatus.CONNECTED,
        encryptedToken: "PLACEHOLDER_ENCRYPTED_TOKEN",
        externalId: "12345678",
        externalUsername: "alexrivera",
        installationId: 987654,
        metadata: { scope: "repo,read:user,read:org", installedAt: new Date().toISOString() },
        lastSyncedAt: new Date("2024-12-10T14:00:00Z"),
      },
    });

    await db.gitHubWebhookDelivery.createMany({
      data: [
        {
          deliveryId: "seed-delivery-001",
          event: "ping",
          status: "ok",
          message: 'Ping received: "Speak softly and carry a big stick."',
          workspaceId: workspace.id,
          payloadSummary: { zen: "Speak softly and carry a big stick.", hookId: 12345 },
          processedAt: new Date("2024-12-01T09:00:00Z"),
          receivedAt: new Date("2024-12-01T09:00:00Z"),
        },
        {
          deliveryId: "seed-delivery-002",
          event: "installation",
          action: "created",
          installationId: 987654,
          workspaceId: workspace.id,
          status: "ok",
          message: "installation / created — 2 repo(s) upserted",
          payloadSummary: { action: "created", repoCount: 2, installationId: 987654 },
          processedAt: new Date("2024-12-01T09:01:00Z"),
          receivedAt: new Date("2024-12-01T09:01:00Z"),
        },
        {
          deliveryId: "seed-delivery-003",
          event: "push",
          action: "synced",
          repositoryFullName: "alexrivera/ai-chat-assistant",
          installationId: 987654,
          workspaceId: workspace.id,
          status: "ok",
          message: "push to alexrivera/ai-chat-assistant@main — 2 commit(s), 8 file change(s) synced",
          payloadSummary: { branch: "main", before: "e4f5g6h", after: "a1b2c3d", commits: 2, filesChanged: 8 },
          processedAt: new Date("2024-12-10T13:51:30Z"),
          receivedAt: new Date("2024-12-10T13:51:30Z"),
        },
        {
          deliveryId: "seed-delivery-004",
          event: "push",
          action: "detected",
          repositoryFullName: "alexrivera/new-side-project",
          installationId: 987654,
          workspaceId: workspace.id,
          status: "ok",
          message: "push to alexrivera/new-side-project@main — repo detected, not yet imported",
          payloadSummary: { branch: "main", after: "f9a8b7c", commitCount: 1 },
          processedAt: new Date("2024-12-10T16:20:00Z"),
          receivedAt: new Date("2024-12-10T16:20:00Z"),
        },
        {
          deliveryId: "seed-delivery-005",
          event: "member",
          status: "ignored",
          message: 'Event type "member" is not handled',
          workspaceId: workspace.id,
          processedAt: new Date("2024-12-10T17:00:00Z"),
          receivedAt: new Date("2024-12-10T17:00:00Z"),
        },
      ],
    });

    console.log(`  ✓ Demo GitHub data: repo ${githubRepo.fullName}, detected repos, commits, sync runs, deliveries`);
  } else {
    console.log("  ℹ  Skipping demo GitHub data (set SEED_DEMO_GITHUB=true to seed fake alexrivera repos)");
  }

  // ── Environments ──────────────────────────────────────────────────────────
  const envs: Record<string, { id: string }> = {};
  for (const [projectName, project] of Object.entries(projects)) {
    if (projectName === "legacy-dashboard") continue; // archived projects skip
    const env = await db.environment.create({
      data: {
        projectId: project.id,
        name: EnvironmentName.PRODUCTION,
        status: EnvironmentStatus.ACTIVE,
      },
    });
    envs[projectName] = env;
    // Also add development environment for active projects
    if (
      projectName === "ai-chat-assistant" ||
      projectName === "data-pipeline"
    ) {
      await db.environment.create({
        data: {
          projectId: project.id,
          name: EnvironmentName.DEVELOPMENT,
          status: EnvironmentStatus.ACTIVE,
        },
      });
    }
  }
  console.log(`  ✓ Environments created`);

  const chatProdEnv = envs["ai-chat-assistant"];

  // ── Secrets (encrypted placeholder values) ────────────────────────────────
  // TODO: In production, encrypt values with lib/crypto.ts before storing
  await db.secret.createMany({
    data: [
      {
        environmentId: chatProdEnv.id,
        key: "DATABASE_URL",
        encryptedValue: "ENCRYPTED:postgresql://...",
        isActive: true,
      },
      {
        environmentId: chatProdEnv.id,
        key: "NEXTAUTH_SECRET",
        encryptedValue: "ENCRYPTED:super-secret-value",
        isActive: true,
      },
      {
        environmentId: chatProdEnv.id,
        key: "NEXT_PUBLIC_APP_URL",
        encryptedValue: "ENCRYPTED:https://ai-chat.prisom.dev",
        isActive: true,
      },
    ],
  });

  // ── Domains ───────────────────────────────────────────────────────────────
  await db.domain.createMany({
    data: [
      {
        projectId: chatProject.id,
        environmentId: chatProdEnv.id,
        hostname: "ai-chat.prisom.dev",
        isPrimary: true,
        status: DomainStatus.ACTIVE,
        sslStatus: SslStatus.ACTIVE,
        verifiedAt: new Date("2024-10-20T12:00:00Z"),
      },
      {
        projectId: chatProject.id,
        environmentId: chatProdEnv.id,
        hostname: "ai-chat.alexrivera.dev",
        isPrimary: false,
        status: DomainStatus.PENDING,
        sslStatus: SslStatus.NONE,
        verificationToken: "prisom-verify-abc123xyz",
      },
      {
        projectId: portfolioProject.id,
        hostname: "alexrivera.dev",
        isPrimary: true,
        status: DomainStatus.ACTIVE,
        sslStatus: SslStatus.ACTIVE,
        verifiedAt: new Date("2024-08-25T10:00:00Z"),
      },
    ],
  });
  console.log(`  ✓ Domains: 3`);

  // ── Deployments ───────────────────────────────────────────────────────────
  const dep1 = await db.deployment.create({
    data: {
      projectId: chatProject.id,
      environmentId: chatProdEnv.id,
      triggeredById: user.id,
      status: DeploymentStatus.SUCCESS,
      source: DeploymentSource.PUSH,
      url: "https://ai-chat.prisom.dev",
      commitSha: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
      commitMessage: "feat: add streaming support for multi-turn conversations",
      duration: 42000,
      startedAt: new Date("2024-12-10T14:00:00Z"),
      finishedAt: new Date("2024-12-10T14:00:42Z"),
    },
  });

  const dep2 = await db.deployment.create({
    data: {
      projectId: chatProject.id,
      environmentId: chatProdEnv.id,
      triggeredById: user.id,
      status: DeploymentStatus.FAILED,
      source: DeploymentSource.PUSH,
      commitSha: "e4f5g6h7i8j9e4f5g6h7i8j9e4f5g6h7i8j9e4f5",
      commitMessage: "fix: resolve hydration mismatch on SSR render",
      errorMessage: "Build failed: Cannot resolve module '@/components/old-chat'",
      duration: 18000,
      startedAt: new Date("2024-12-09T10:25:00Z"),
      finishedAt: new Date("2024-12-09T10:25:18Z"),
    },
  });

  await db.deployment.create({
    data: {
      projectId: chatProject.id,
      environmentId: chatProdEnv.id,
      triggeredById: user.id,
      status: DeploymentStatus.SUCCESS,
      source: DeploymentSource.PUSH,
      url: "https://ai-chat.prisom.dev",
      commitSha: "k1l2m3n4o5p6k1l2m3n4o5p6k1l2m3n4o5p6k1l2",
      commitMessage: "chore: upgrade to Next.js 16 and update dependencies",
      duration: 55000,
      startedAt: new Date("2024-12-08T09:05:00Z"),
      finishedAt: new Date("2024-12-08T09:06:00Z"),
    },
  });
  console.log(`  ✓ Deployments: 3`);

  // ── Project logs ──────────────────────────────────────────────────────────
  await db.projectLog.createMany({
    data: [
      {
        projectId: chatProject.id,
        deploymentId: dep1.id,
        level: LogLevel.INFO,
        source: LogSource.BUILD,
        message: "Build started — Next.js 16, Turbopack",
        timestamp: new Date("2024-12-10T14:00:01Z"),
      },
      {
        projectId: chatProject.id,
        deploymentId: dep1.id,
        level: LogLevel.INFO,
        source: LogSource.BUILD,
        message: "Compiled successfully in 38.2s",
        timestamp: new Date("2024-12-10T14:00:39Z"),
      },
      {
        projectId: chatProject.id,
        deploymentId: dep1.id,
        level: LogLevel.INFO,
        source: LogSource.DEPLOY,
        message: "Deployment promoted to production",
        timestamp: new Date("2024-12-10T14:00:42Z"),
      },
      {
        projectId: chatProject.id,
        deploymentId: dep2.id,
        level: LogLevel.ERROR,
        source: LogSource.BUILD,
        message: "Build failed: Cannot resolve module '@/components/old-chat'",
        timestamp: new Date("2024-12-09T10:25:17Z"),
      },
      {
        projectId: chatProject.id,
        level: LogLevel.INFO,
        source: LogSource.APP,
        message: "Server started on port 3000",
        timestamp: new Date("2024-12-10T14:00:45Z"),
      },
      {
        projectId: chatProject.id,
        level: LogLevel.INFO,
        source: LogSource.APP,
        message: "GET /api/health 200 4ms",
        timestamp: new Date("2024-12-10T14:01:00Z"),
      },
      {
        projectId: chatProject.id,
        level: LogLevel.WARN,
        source: LogSource.APP,
        message: "Rate limit approaching for IP 192.168.1.1 (85/100 req/min)",
        timestamp: new Date("2024-12-10T14:22:10Z"),
        metadata: { ip: "192.168.1.1", count: 85, limit: 100 },
      },
    ],
  });
  console.log(`  ✓ Project logs: 7`);

  // ── Features & Tasks ──────────────────────────────────────────────────────
  const feature = await db.projectFeature.create({
    data: {
      projectId: chatProject.id,
      assigneeId: user.id,
      title: "Persistent chat history",
      description: "Store conversation history in the database so users can resume sessions",
      status: FeatureStatus.IN_PROGRESS,
      priority: Priority.HIGH,
    },
  });

  await db.projectTask.createMany({
    data: [
      {
        projectId: chatProject.id,
        featureId: feature.id,
        assigneeId: user.id,
        title: "Design conversation schema",
        status: TaskStatus.DONE,
        source: TaskSource.MANUAL,
        priority: Priority.HIGH,
        completedAt: new Date("2024-12-08T16:00:00Z"),
      },
      {
        projectId: chatProject.id,
        featureId: feature.id,
        assigneeId: user.id,
        title: "Implement GET /api/sessions endpoint",
        status: TaskStatus.IN_PROGRESS,
        source: TaskSource.MANUAL,
        priority: Priority.HIGH,
      },
      {
        projectId: chatProject.id,
        featureId: feature.id,
        title: "Add session list UI component",
        status: TaskStatus.TODO,
        source: TaskSource.AI,
        priority: Priority.MEDIUM,
      },
    ],
  });
  console.log(`  ✓ Features & tasks`);

  // ── Portfolio item ────────────────────────────────────────────────────────
  await db.portfolioItem.create({
    data: {
      workspaceId: workspace.id,
      userId: user.id,
      projectId: chatProject.id,
      title: "AI Chat Assistant",
      description:
        "Full-stack AI chat application with streaming responses, multi-turn conversations, and tool use. Built with Next.js 16, TypeScript, and the Claude API.",
      slug: "ai-chat-assistant",
      tags: ["Next.js", "TypeScript", "AI", "Real-time", "Claude"],
      liveUrl: "https://ai-chat.prisom.dev",
      githubUrl: "https://github.com/alexrivera/ai-chat-assistant",
      featured: true,
      sortOrder: 0,
    },
  });

  await db.portfolioItem.create({
    data: {
      workspaceId: workspace.id,
      userId: user.id,
      projectId: portfolioProject.id,
      title: "Developer Portfolio",
      description:
        "Personal portfolio with blog, dark mode, and interactive project showcase. Built with Astro and TypeScript.",
      slug: "developer-portfolio",
      tags: ["Astro", "TypeScript", "Blog", "Portfolio"],
      liveUrl: "https://alexrivera.dev",
      githubUrl: "https://github.com/alexrivera/portfolio-site",
      featured: false,
      sortOrder: 1,
    },
  });
  console.log(`  ✓ Portfolio items: 2`);

  console.log("\n✅ Seed complete!\n");
  if (seedDemoGitHub) {
    console.log("  Demo GitHub data included (SEED_DEMO_GITHUB=true).");
    console.log("  Run `npm run db:clean-github-demo` to remove it before real testing.");
  } else {
    console.log("  No demo GitHub data — ready for real GitHub App testing.");
    console.log("  Tip: set SEED_DEMO_GITHUB=true to include demo repos for UI screenshots.");
  }
  console.log("  Run `npm run db:studio` to browse the data.");
}

main()
  .then(async () => {
    await db.$disconnect();
  })
  .catch(async (e) => {
    console.error("Seed failed:", e);
    await db.$disconnect();
    process.exit(1);
  });
