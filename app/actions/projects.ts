"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ProjectType, Visibility } from "@prisma/client";
import {
  createProject,
  updateProject,
  archiveProject,
  markProjectOpened,
} from "@/lib/data/projects";

// ── Zod schemas ───────────────────────────────────────────────────────────────

const slugPattern = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/;

const createSchema = z.object({
  name: z.string().min(1, "Name is required").max(100, "Name too long"),
  slug: z
    .string()
    .min(1, "Slug is required")
    .max(100, "Slug too long")
    .regex(slugPattern, "Lowercase letters, numbers, and hyphens only"),
  description: z.string().max(500, "Description too long").optional().or(z.literal("")),
  type: z.nativeEnum(ProjectType).default(ProjectType.APP),
  visibility: z.nativeEnum(Visibility).default(Visibility.PRIVATE),
  language: z.string().max(50).optional().or(z.literal("")),
  framework: z.string().max(50).optional().or(z.literal("")),
  githubUrl: z
    .string()
    .url("Must be a valid URL")
    .refine((u) => u.includes("github.com"), "Must be a GitHub URL")
    .optional()
    .or(z.literal("")),
  installCommand: z.string().max(200).optional().or(z.literal("")),
  buildCommand: z.string().max(200).optional().or(z.literal("")),
  startCommand: z.string().max(200).optional().or(z.literal("")),
  outputDirectory: z.string().max(200).optional().or(z.literal("")),
});

const updateSchema = z.object({
  name: z.string().min(1, "Name is required").max(100, "Name too long"),
  slug: z
    .string()
    .min(1, "Slug is required")
    .max(100)
    .regex(slugPattern, "Lowercase letters, numbers, and hyphens only"),
  description: z.string().max(500).optional().or(z.literal("")),
  type: z.nativeEnum(ProjectType),
  visibility: z.nativeEnum(Visibility),
  language: z.string().max(50).optional().or(z.literal("")),
  framework: z.string().max(50).optional().or(z.literal("")),
  installCommand: z.string().max(200).optional().or(z.literal("")),
  buildCommand: z.string().max(200).optional().or(z.literal("")),
  startCommand: z.string().max(200).optional().or(z.literal("")),
  outputDirectory: z.string().max(200).optional().or(z.literal("")),
  defaultBranch: z.string().max(100).optional().or(z.literal("")),
});

// ── Types ─────────────────────────────────────────────────────────────────────

export type FormState = {
  success?: boolean;
  error?: string;
  fieldErrors?: Record<string, string[]>;
} | null;

// ── Actions ───────────────────────────────────────────────────────────────────

export async function createProjectAction(
  _prevState: FormState,
  formData: FormData
): Promise<FormState> {
  const raw = Object.fromEntries(formData.entries());
  const parsed = createSchema.safeParse(raw);

  if (!parsed.success) {
    return {
      error: "Please fix the errors below.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  const d = parsed.data;

  let projectId: string;
  try {
    const project = await createProject({
      name: d.name,
      slug: d.slug,
      description: d.description || undefined,
      type: d.type,
      visibility: d.visibility,
      language: d.language || undefined,
      framework: d.framework || undefined,
      githubUrl: d.githubUrl || undefined,
      installCommand: d.installCommand || undefined,
      buildCommand: d.buildCommand || undefined,
      startCommand: d.startCommand || undefined,
      outputDirectory: d.outputDirectory || undefined,
    });
    projectId = project.id;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to create project.";
    if (msg.toLowerCase().includes("unique constraint")) {
      return { error: "A project with this slug already exists in your workspace." };
    }
    return { error: msg };
  }

  redirect(`/projects/${projectId}`);
}

export async function updateProjectAction(
  projectId: string,
  _prevState: FormState,
  formData: FormData
): Promise<FormState> {
  const raw = Object.fromEntries(formData.entries());
  const parsed = updateSchema.safeParse(raw);

  if (!parsed.success) {
    return {
      error: "Please fix the errors below.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  const d = parsed.data;

  try {
    await updateProject(projectId, {
      name: d.name,
      slug: d.slug,
      description: d.description || null,
      type: d.type,
      visibility: d.visibility,
      language: d.language || null,
      framework: d.framework || null,
      installCommand: d.installCommand || null,
      buildCommand: d.buildCommand || null,
      startCommand: d.startCommand || null,
      outputDirectory: d.outputDirectory || null,
      defaultBranch: d.defaultBranch || undefined,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to update project.";
    if (msg.toLowerCase().includes("unique constraint")) {
      return { error: "A project with this slug already exists in your workspace." };
    }
    return { error: msg };
  }

  revalidatePath(`/projects/${projectId}`);
  revalidatePath(`/projects/${projectId}/settings`);
  revalidatePath("/projects");

  return { success: true };
}

export async function archiveProjectAction(projectId: string): Promise<void> {
  await archiveProject(projectId);
  revalidatePath("/projects");
  redirect("/projects");
}

export async function markProjectOpenedAction(projectId: string): Promise<void> {
  try {
    await markProjectOpened(projectId);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (_) {
    // Non-critical — don't surface errors to the user
  }
}
