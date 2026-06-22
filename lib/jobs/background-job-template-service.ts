/**
 * lib/jobs/background-job-template-service.ts
 *
 * Sprint 36: Create a BackgroundJob from an allowlisted template.
 *
 * Safety rules:
 *  - templateId must be in JOB_TEMPLATES (server-side allowlist)
 *  - projectId required if template.requiresProject
 *  - confirmation must match exactly if template.requiresConfirmation
 *  - metadata is generated server-side; no client-supplied metadata accepted
 *  - No secrets, no arbitrary shell commands, no storage_cleanup
 */

import { Prisma }            from "@prisma/client";
import { db }                from "@/lib/db";
import {
  JOB_TEMPLATES,
  isValidTemplateId,
  type TemplateId,
  type JobTemplate,
} from "./background-job-templates";

// ── Input type ────────────────────────────────────────────────────────────────

export type CreateJobFromTemplateInput = {
  templateId:    string;       // validated server-side against JOB_TEMPLATES
  projectId?:    string;       // required if template.requiresProject
  scheduledFor?: Date;         // defaults to now
  actorUserId:   string;
  confirmation?: string;       // required if template.requiresConfirmation
};

export type CreateJobFromTemplateResult =
  | { ok: true;  jobId: string; jobRef: string }
  | { ok: false; error: string };

// ── Service ───────────────────────────────────────────────────────────────────

export async function createJobFromTemplate(
  input: CreateJobFromTemplateInput,
): Promise<CreateJobFromTemplateResult> {
  const { templateId, projectId, scheduledFor, actorUserId, confirmation } = input;

  // 1. Validate template
  if (!isValidTemplateId(templateId)) {
    return { ok: false, error: `Unknown job template: ${templateId}` };
  }
  // Cast to JobTemplate — the `as const satisfies` union loses optional fields
  const template = JOB_TEMPLATES[templateId as TemplateId] as JobTemplate;

  // 2. Validate project requirement
  if (template.requiresProject) {
    if (!projectId || typeof projectId !== "string" || projectId.trim() === "") {
      return { ok: false, error: `Template "${template.title}" requires a project to be selected.` };
    }
    // Verify project exists
    const project = await db.project.findUnique({
      where:  { id: projectId },
      select: { id: true },
    });
    if (!project) {
      return { ok: false, error: "Selected project not found." };
    }
  }

  // 3. Validate confirmation
  if (template.requiresConfirmation) {
    if (!confirmation || confirmation !== template.confirmationText) {
      return {
        ok:    false,
        error: `Confirmation required: type "${template.confirmationText}" exactly to proceed.`,
      };
    }
  }

  // 4. Generate job ref
  const ts   = new Date().toISOString().replace(/[-T:.Z]/g, "").slice(0, 14);
  const rand = Math.random().toString(36).slice(2, 6);
  const pid  = projectId ? `_${projectId.slice(-6)}` : "";
  const jobRef = `bgjob_${template.jobType.replace(/_/g, "")}${pid}_${ts}_${rand}`;

  // 5. Build server-side metadata (no client fields)
  const safeMetadata: Record<string, unknown> = {
    templateId,
    createdByUserId: actorUserId,
    requestedAt:     new Date().toISOString(),
  };

  if (projectId) {
    safeMetadata.projectId = projectId;
  }

  // For scheduled_backup: store the BACKUP confirmation so the handler can verify
  if (template.requiresConfirmation && confirmation === template.confirmationText) {
    safeMetadata.confirmation = confirmation;
  }

  // 6. Create job row
  try {
    const row = await db.backgroundJob.create({
      data: {
        jobRef,
        jobType:     template.jobType,
        scopeType:   template.scopeType,
        projectId:   projectId ?? null,
        status:      "queued",
        priority:    5,
        title:       template.title,
        description: template.description,
        scheduledFor: scheduledFor ?? new Date(),
        maxAttempts:  3,
        metadataJson: safeMetadata as unknown as Prisma.InputJsonValue,
      },
      select: { id: true, jobRef: true },
    });

    return { ok: true, jobId: row.id, jobRef: row.jobRef };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to create job";
    return { ok: false, error: msg };
  }
}
