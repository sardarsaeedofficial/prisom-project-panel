/**
 * Data-access functions for the six project workspace modules:
 * Logs · Domains · Databases · Deployments · AI Sessions · Features + Tasks
 *
 * All write operations are metadata-only — no shell commands, no real
 * DB connections, no deployment pipelines.
 */
import { db } from "@/lib/db";
import {
  LogLevel,
  LogSource,
  DomainStatus,
  SslStatus,
  DatabaseType,
  DatabaseStatus,
  DeploymentStatus,
  DeploymentSource,
  FeatureStatus,
  TaskStatus,
  Priority,
  AiRole,
  EnvironmentName,
} from "@prisma/client";
import { getCurrentUser } from "@/lib/current-workspace";

// ─────────────────────────────────────────────────────────────────────────────
// LOGS
// ─────────────────────────────────────────────────────────────────────────────

export async function getProjectLogs(
  projectId: string,
  options?: { level?: LogLevel; source?: LogSource; limit?: number }
) {
  return db.projectLog.findMany({
    where: {
      projectId,
      ...(options?.level ? { level: options.level } : {}),
      ...(options?.source ? { source: options.source } : {}),
    },
    orderBy: { timestamp: "desc" },
    take: options?.limit ?? 200,
  });
}

export async function createProjectLog(input: {
  projectId: string;
  level: LogLevel;
  source: LogSource;
  message: string;
  metadata?: Record<string, unknown>;
}) {
  return db.projectLog.create({
    data: {
      projectId: input.projectId,
      level: input.level,
      source: input.source,
      message: input.message,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...(input.metadata !== undefined && { metadata: input.metadata as any }),
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// DOMAINS
// ─────────────────────────────────────────────────────────────────────────────

export async function getProjectDomains(projectId: string) {
  return db.domain.findMany({
    where: { projectId },
    include: { environment: { select: { id: true, name: true } } },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
  });
}

export async function createDomain(input: {
  projectId: string;
  hostname: string;
  isPrimary?: boolean;
  environmentId?: string | null;
  provider?: string | null;
  cnameTarget?: string | null;
  verificationTxt?: string | null;
}) {
  if (input.isPrimary) {
    await db.domain.updateMany({
      where: { projectId: input.projectId, isPrimary: true },
      data: { isPrimary: false },
    });
  }
  return db.domain.create({
    data: {
      projectId: input.projectId,
      hostname: input.hostname.toLowerCase().trim(),
      isPrimary: input.isPrimary ?? false,
      status: DomainStatus.PENDING,
      sslStatus: SslStatus.NONE,
      environmentId: input.environmentId ?? null,
      provider: input.provider ?? null,
      cnameTarget: input.cnameTarget ?? null,
      verificationTxt: input.verificationTxt ?? null,
    },
  });
}

export async function updateDomain(input: {
  id: string;
  projectId: string;
  isPrimary?: boolean;
  status?: DomainStatus;
  sslStatus?: SslStatus;
  provider?: string | null;
}) {
  if (input.isPrimary) {
    await db.domain.updateMany({
      where: { projectId: input.projectId, isPrimary: true },
      data: { isPrimary: false },
    });
  }
  return db.domain.update({
    where: { id: input.id },
    data: {
      ...(input.isPrimary !== undefined && { isPrimary: input.isPrimary }),
      ...(input.status && { status: input.status }),
      ...(input.sslStatus && { sslStatus: input.sslStatus }),
      ...(input.provider !== undefined && { provider: input.provider }),
    },
  });
}

export async function deleteDomain(domainId: string) {
  return db.domain.delete({ where: { id: domainId } });
}

// ─────────────────────────────────────────────────────────────────────────────
// DATABASES
// ─────────────────────────────────────────────────────────────────────────────

export async function getProjectDatabases(projectId: string) {
  return db.projectDatabase.findMany({
    where: { projectId },
    include: {
      environment: { select: { id: true, name: true } },
      _count: { select: { migrations: true } },
    },
    orderBy: { createdAt: "asc" },
  });
}

export async function createProjectDatabase(input: {
  projectId: string;
  name: string;
  type?: DatabaseType;
  environmentId?: string | null;
  host?: string | null;
  port?: number | null;
  databaseName?: string | null;
  username?: string | null;
  storageLimitMb?: number | null;
}) {
  return db.projectDatabase.create({
    data: {
      projectId: input.projectId,
      name: input.name,
      type: input.type ?? DatabaseType.POSTGRES,
      status: DatabaseStatus.PROVISIONING,
      environmentId: input.environmentId ?? null,
      host: input.host ?? null,
      port: input.port ?? null,
      databaseName: input.databaseName ?? null,
      username: input.username ?? null,
      storageLimitMb: input.storageLimitMb ?? null,
    },
  });
}

export async function updateProjectDatabase(input: {
  id: string;
  name?: string;
  status?: DatabaseStatus;
  host?: string | null;
  port?: number | null;
  databaseName?: string | null;
  username?: string | null;
  storageUsedMb?: number | null;
  storageLimitMb?: number | null;
}) {
  return db.projectDatabase.update({
    where: { id: input.id },
    data: {
      ...(input.name && { name: input.name }),
      ...(input.status && { status: input.status }),
      ...(input.host !== undefined && { host: input.host }),
      ...(input.port !== undefined && { port: input.port }),
      ...(input.databaseName !== undefined && { databaseName: input.databaseName }),
      ...(input.username !== undefined && { username: input.username }),
      ...(input.storageUsedMb !== undefined && { storageUsedMb: input.storageUsedMb }),
      ...(input.storageLimitMb !== undefined && { storageLimitMb: input.storageLimitMb }),
    },
  });
}

export async function deleteProjectDatabase(databaseId: string) {
  return db.projectDatabase.delete({ where: { id: databaseId } });
}

// ─────────────────────────────────────────────────────────────────────────────
// DEPLOYMENTS
// ─────────────────────────────────────────────────────────────────────────────

export async function getProjectDeployments(projectId: string, limit = 25) {
  return db.deployment.findMany({
    where: { projectId },
    include: {
      environment: { select: { id: true, name: true } },
      triggeredBy: { select: { id: true, name: true } },
    },
    orderBy: { startedAt: "desc" },
    take: limit,
  });
}

export async function createDeploymentRecord(input: {
  projectId: string;
  environmentId?: string | null;
  branch?: string | null;
  commitSha?: string | null;
  commitMessage?: string | null;
  url?: string | null;
}) {
  const user = await getCurrentUser();
  const deployment = await db.deployment.create({
    data: {
      projectId: input.projectId,
      status: DeploymentStatus.QUEUED,
      source: DeploymentSource.MANUAL,
      environmentId: input.environmentId ?? null,
      branch: input.branch ?? null,
      commitSha: input.commitSha ?? null,
      commitMessage: input.commitMessage ?? null,
      url: input.url ?? null,
      triggeredById: user.id,
    },
  });
  // Track last deployed timestamp on project
  await db.project.update({
    where: { id: input.projectId },
    data: { lastDeployedAt: new Date() },
  });
  return deployment;
}

export async function updateDeploymentStatus(input: {
  id: string;
  status: DeploymentStatus;
  errorMessage?: string | null;
}) {
  return db.deployment.update({
    where: { id: input.id },
    data: {
      status: input.status,
      ...(input.errorMessage !== undefined && { errorMessage: input.errorMessage }),
      ...(input.status === DeploymentStatus.SUCCESS ||
        input.status === DeploymentStatus.FAILED ||
        input.status === DeploymentStatus.CANCELLED
        ? { finishedAt: new Date() }
        : {}),
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// AI SESSIONS
// ─────────────────────────────────────────────────────────────────────────────

export async function getProjectAiSessions(projectId: string) {
  return db.aiSession.findMany({
    where: { projectId },
    include: { _count: { select: { messages: true } } },
    orderBy: { updatedAt: "desc" },
  });
}

/**
 * Returns the most-recently-updated session for the project, creating
 * a default one if none exists yet.
 */
export async function getOrCreateDefaultSession(projectId: string) {
  const user = await getCurrentUser();

  let session = await db.aiSession.findFirst({
    where: { projectId },
    orderBy: { updatedAt: "desc" },
  });

  if (!session) {
    session = await db.aiSession.create({
      data: {
        projectId,
        userId: user.id,
        title: "Session 1",
        model: "claude-sonnet-4-5",
      },
    });
  }

  const messages = await db.aiMessage.findMany({
    where: { sessionId: session.id },
    orderBy: { createdAt: "asc" },
    select: { id: true, role: true, content: true, createdAt: true },
  });

  return { session, messages };
}

export async function createAiSession(input: { projectId: string; title?: string }) {
  const user = await getCurrentUser();
  return db.aiSession.create({
    data: {
      projectId: input.projectId,
      userId: user.id,
      title: input.title ?? null,
      model: "claude-sonnet-4-5",
    },
  });
}

/**
 * Saves a user prompt and immediately appends a placeholder assistant reply.
 * Returns both messages as plain serializable objects (ISO date strings).
 */
export async function savePromptWithPlaceholderReply(
  sessionId: string,
  content: string
) {
  const userMsg = await db.aiMessage.create({
    data: { sessionId, role: AiRole.USER, content },
    select: { id: true, role: true, content: true, createdAt: true },
  });

  const assistantMsg = await db.aiMessage.create({
    data: {
      sessionId,
      role: AiRole.ASSISTANT,
      content:
        "Prompt saved. Claude API integration will be connected in a future phase — your prompts are stored and will be sent to Claude once that step is complete.",
    },
    select: { id: true, role: true, content: true, createdAt: true },
  });

  // Bump session updatedAt so it surfaces in recent-sessions lists
  await db.aiSession.update({
    where: { id: sessionId },
    data: { updatedAt: new Date() },
  });

  return {
    userMessage: { ...userMsg, createdAt: userMsg.createdAt.toISOString() },
    assistantMessage: { ...assistantMsg, createdAt: assistantMsg.createdAt.toISOString() },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// FEATURES
// ─────────────────────────────────────────────────────────────────────────────

export async function getProjectFeatures(projectId: string) {
  return db.projectFeature.findMany({
    where: { projectId },
    include: { _count: { select: { tasks: true } } },
    orderBy: [{ status: "asc" }, { createdAt: "asc" }],
  });
}

export async function createFeature(input: {
  projectId: string;
  title: string;
  description?: string | null;
  status?: FeatureStatus;
  priority?: Priority;
}) {
  return db.projectFeature.create({
    data: {
      projectId: input.projectId,
      title: input.title,
      description: input.description ?? null,
      status: input.status ?? FeatureStatus.PLANNED,
      priority: input.priority ?? Priority.MEDIUM,
    },
  });
}

export async function updateFeature(input: {
  id: string;
  title?: string;
  description?: string | null;
  status?: FeatureStatus;
  priority?: Priority;
}) {
  return db.projectFeature.update({
    where: { id: input.id },
    data: {
      ...(input.title && { title: input.title }),
      ...(input.description !== undefined && { description: input.description }),
      ...(input.status && { status: input.status }),
      ...(input.priority && { priority: input.priority }),
    },
  });
}

export async function deleteFeature(featureId: string) {
  return db.projectFeature.delete({ where: { id: featureId } });
}

// ─────────────────────────────────────────────────────────────────────────────
// TASKS
// ─────────────────────────────────────────────────────────────────────────────

export async function getProjectTasks(projectId: string) {
  return db.projectTask.findMany({
    where: { projectId },
    orderBy: [{ status: "asc" }, { createdAt: "asc" }],
  });
}

export async function createTask(input: {
  projectId: string;
  title: string;
  description?: string | null;
  status?: TaskStatus;
  priority?: Priority;
  featureId?: string | null;
}) {
  return db.projectTask.create({
    data: {
      projectId: input.projectId,
      title: input.title,
      description: input.description ?? null,
      status: input.status ?? TaskStatus.TODO,
      priority: input.priority ?? Priority.MEDIUM,
      featureId: input.featureId ?? null,
      source: "MANUAL",
    },
  });
}

export async function updateTask(input: {
  id: string;
  title?: string;
  status?: TaskStatus;
  priority?: Priority;
}) {
  return db.projectTask.update({
    where: { id: input.id },
    data: {
      ...(input.title && { title: input.title }),
      ...(input.status && {
        status: input.status,
        ...(input.status === TaskStatus.DONE && { completedAt: new Date() }),
        ...(input.status !== TaskStatus.DONE && { completedAt: null }),
      }),
      ...(input.priority && { priority: input.priority }),
    },
  });
}

export async function deleteTask(taskId: string) {
  return db.projectTask.delete({ where: { id: taskId } });
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/** Returns project environments for use in form dropdowns. */
export async function getProjectEnvironments(projectId: string) {
  return db.environment.findMany({
    where: { projectId },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

export { LogLevel, LogSource, EnvironmentName };
