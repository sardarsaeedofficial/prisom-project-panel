"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  DatabaseType,
  DatabaseStatus,
  DeploymentStatus,
  FeatureStatus,
  TaskStatus,
  Priority,
} from "@prisma/client";
import {
  createDomain,
  deleteDomain,
  updateDomain,
  createProjectDatabase,
  deleteProjectDatabase,
  createDeploymentRecord,
  updateDeploymentStatus,
  createAiSession,
  savePromptWithPlaceholderReply,
  createFeature,
  updateFeature,
  deleteFeature,
  createTask,
  updateTask,
  deleteTask,
} from "@/lib/data/workspace-modules";

export type FormState = {
  success?: boolean;
  error?: string;
  fieldErrors?: Record<string, string[]>;
} | null;

// ── helpers ───────────────────────────────────────────────────────────────────

function revalidateProject(projectId: string, ...extra: string[]) {
  revalidatePath(`/projects/${projectId}`);
  for (const path of extra) revalidatePath(path);
}

// ─────────────────────────────────────────────────────────────────────────────
// DOMAINS
// ─────────────────────────────────────────────────────────────────────────────

const CreateDomainSchema = z.object({
  projectId: z.string().min(1),
  hostname: z
    .string()
    .min(3, "Hostname too short")
    .max(253)
    .regex(/^[a-z0-9.-]+$/i, "Invalid hostname format"),
  environmentId: z.string().optional(),
  isPrimary: z.boolean().default(false),
  provider: z.string().optional(),
});

export async function createDomainAction(formData: FormData): Promise<FormState> {
  const raw = {
    projectId: formData.get("projectId") as string,
    hostname: (formData.get("hostname") as string | null) ?? "",
    environmentId: (formData.get("environmentId") as string | null) || undefined,
    isPrimary: formData.get("isPrimary") === "true",
    provider: (formData.get("provider") as string | null) || undefined,
  };

  const parsed = CreateDomainSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: "Validation failed", fieldErrors: parsed.error.flatten().fieldErrors };
  }

  try {
    await createDomain(parsed.data);
    revalidateProject(
      parsed.data.projectId,
      `/projects/${parsed.data.projectId}/domains`
    );
    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to add domain";
    if (msg.includes("Unique constraint") || msg.includes("unique")) {
      return { error: "This hostname is already in use." };
    }
    return { error: msg };
  }
}

export async function updateDomainAction(
  domainId: string,
  projectId: string,
  formData: FormData
): Promise<void> {
  const isPrimary = formData.get("isPrimary") === "true";
  try {
    await updateDomain({ id: domainId, projectId, isPrimary });
  } catch {/* swallow */}
  revalidateProject(projectId, `/projects/${projectId}/domains`);
}

export async function deleteDomainAction(
  domainId: string,
  projectId: string
): Promise<void> {
  try {
    await deleteDomain(domainId);
  } catch {/* swallow */}
  revalidateProject(projectId, `/projects/${projectId}/domains`);
}

// ─────────────────────────────────────────────────────────────────────────────
// DATABASES
// ─────────────────────────────────────────────────────────────────────────────

const CreateDatabaseSchema = z.object({
  projectId: z.string().min(1),
  name: z.string().min(1, "Name is required").max(100),
  type: z.nativeEnum(DatabaseType).default(DatabaseType.POSTGRES),
  environmentId: z.string().optional(),
  host: z.string().optional(),
  port: z.coerce.number().int().positive().optional(),
  databaseName: z.string().optional(),
  username: z.string().optional(),
  storageLimitMb: z.coerce.number().positive().optional(),
});

export async function createDatabaseAction(formData: FormData): Promise<FormState> {
  const raw = {
    projectId: formData.get("projectId") as string,
    name: (formData.get("name") as string | null) ?? "",
    type: (formData.get("type") as string) || "POSTGRES",
    environmentId: (formData.get("environmentId") as string | null) || undefined,
    host: (formData.get("host") as string | null) || undefined,
    port: (formData.get("port") as string | null) || undefined,
    databaseName: (formData.get("databaseName") as string | null) || undefined,
    username: (formData.get("username") as string | null) || undefined,
    storageLimitMb: (formData.get("storageLimitMb") as string | null) || undefined,
  };

  const parsed = CreateDatabaseSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: "Validation failed", fieldErrors: parsed.error.flatten().fieldErrors };
  }

  try {
    await createProjectDatabase(parsed.data);
    revalidateProject(
      parsed.data.projectId,
      `/projects/${parsed.data.projectId}/database`
    );
    return { success: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to create database" };
  }
}

export async function deleteDatabaseAction(
  databaseId: string,
  projectId: string
): Promise<void> {
  try {
    await deleteProjectDatabase(databaseId);
  } catch {/* swallow */}
  revalidateProject(projectId, `/projects/${projectId}/database`);
}

// ─────────────────────────────────────────────────────────────────────────────
// DEPLOYMENTS
// ─────────────────────────────────────────────────────────────────────────────

const CreateDeploymentSchema = z.object({
  projectId: z.string().min(1),
  environmentId: z.string().optional(),
  branch: z.string().optional(),
  commitSha: z.string().max(40).optional(),
  commitMessage: z.string().max(300).optional(),
  url: z.string().url("Must be a valid URL").optional().or(z.literal("")),
});

export async function createDeploymentRecordAction(
  formData: FormData
): Promise<FormState> {
  const raw = {
    projectId: formData.get("projectId") as string,
    environmentId: (formData.get("environmentId") as string | null) || undefined,
    branch: (formData.get("branch") as string | null) || undefined,
    commitSha: (formData.get("commitSha") as string | null) || undefined,
    commitMessage: (formData.get("commitMessage") as string | null) || undefined,
    url: (formData.get("url") as string | null) || undefined,
  };

  const parsed = CreateDeploymentSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: "Validation failed", fieldErrors: parsed.error.flatten().fieldErrors };
  }

  try {
    await createDeploymentRecord({
      ...parsed.data,
      url: parsed.data.url || null,
    });
    revalidateProject(
      parsed.data.projectId,
      `/projects/${parsed.data.projectId}/publishing`
    );
    return { success: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to create deployment" };
  }
}

export async function updateDeploymentStatusAction(
  deploymentId: string,
  projectId: string,
  formData: FormData
): Promise<void> {
  const status = formData.get("status") as DeploymentStatus | null;
  if (!status) return;
  try {
    await updateDeploymentStatus({ id: deploymentId, status });
  } catch {/* swallow */}
  revalidateProject(projectId, `/projects/${projectId}/publishing`);
}

// ─────────────────────────────────────────────────────────────────────────────
// AI
// ─────────────────────────────────────────────────────────────────────────────

export async function createAiSessionAction(projectId: string): Promise<void> {
  const count = await import("@/lib/db").then((m) =>
    m.db.aiSession.count({ where: { projectId } })
  );
  await createAiSession({ projectId, title: `Session ${count + 1}` });
  revalidatePath(`/projects/${projectId}/ai`);
}

export async function saveAiPromptAction(
  sessionId: string,
  content: string
): Promise<{
  success?: boolean;
  error?: string;
  userMessage?: { id: string; role: string; content: string; createdAt: string };
  assistantMessage?: { id: string; role: string; content: string; createdAt: string };
}> {
  if (!content.trim()) return { error: "Prompt cannot be empty." };
  if (content.length > 4000) return { error: "Prompt too long (max 4000 chars)." };

  try {
    const { userMessage, assistantMessage } =
      await savePromptWithPlaceholderReply(sessionId, content);
    return { success: true, userMessage, assistantMessage };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to save prompt" };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// FEATURES
// ─────────────────────────────────────────────────────────────────────────────

const CreateFeatureSchema = z.object({
  projectId: z.string().min(1),
  title: z.string().min(1, "Title required").max(200),
  description: z.string().max(1000).optional(),
  status: z.nativeEnum(FeatureStatus).default(FeatureStatus.PLANNED),
  priority: z.nativeEnum(Priority).default(Priority.MEDIUM),
});

export async function createFeatureAction(formData: FormData): Promise<FormState> {
  const parsed = CreateFeatureSchema.safeParse({
    projectId: formData.get("projectId"),
    title: formData.get("title"),
    description: formData.get("description") || undefined,
    status: formData.get("status") || undefined,
    priority: formData.get("priority") || undefined,
  });
  if (!parsed.success) {
    return { error: "Validation failed", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  try {
    await createFeature(parsed.data);
    revalidateProject(parsed.data.projectId);
    return { success: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to create feature" };
  }
}

export async function updateFeatureAction(
  featureId: string,
  projectId: string,
  formData: FormData
): Promise<void> {
  const status = formData.get("status") as FeatureStatus | null;
  if (!status) return;
  try {
    await updateFeature({ id: featureId, status });
  } catch {/* swallow */}
  revalidatePath(`/projects/${projectId}`);
}

export async function deleteFeatureAction(
  featureId: string,
  projectId: string
): Promise<void> {
  try {
    await deleteFeature(featureId);
  } catch {/* swallow */}
  revalidatePath(`/projects/${projectId}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// TASKS
// ─────────────────────────────────────────────────────────────────────────────

const CreateTaskSchema = z.object({
  projectId: z.string().min(1),
  title: z.string().min(1, "Title required").max(200),
  status: z.nativeEnum(TaskStatus).default(TaskStatus.TODO),
  priority: z.nativeEnum(Priority).default(Priority.MEDIUM),
});

export async function createTaskAction(formData: FormData): Promise<FormState> {
  const parsed = CreateTaskSchema.safeParse({
    projectId: formData.get("projectId"),
    title: formData.get("title"),
    status: formData.get("status") || undefined,
    priority: formData.get("priority") || undefined,
  });
  if (!parsed.success) {
    return { error: "Validation failed", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  try {
    await createTask(parsed.data);
    revalidateProject(parsed.data.projectId);
    return { success: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to create task" };
  }
}

export async function updateTaskStatusAction(
  taskId: string,
  projectId: string,
  formData: FormData
): Promise<void> {
  const status = formData.get("status") as TaskStatus | null;
  if (!status) return;
  try {
    await updateTask({ id: taskId, status });
  } catch {/* swallow */}
  revalidatePath(`/projects/${projectId}`);
}

export async function deleteTaskAction(
  taskId: string,
  projectId: string
): Promise<void> {
  try {
    await deleteTask(taskId);
  } catch {/* swallow */}
  revalidatePath(`/projects/${projectId}`);
}
