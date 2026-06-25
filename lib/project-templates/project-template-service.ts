/**
 * lib/project-templates/project-template-service.ts
 *
 * Sprint 72: Service functions for listing templates and generating
 * first-run migration plans. No DB writes, no secrets, no production mutation.
 */

import { BUILTIN_TEMPLATES }  from "./builtin-project-templates";
import type { ProjectTemplate, TemplateMigrationPlan, TemplateMigrationStep } from "./project-template-types";

// ── Template registry ─────────────────────────────────────────────────────────

export function listProjectTemplates(): ProjectTemplate[] {
  return BUILTIN_TEMPLATES;
}

export function getProjectTemplate(templateId: string): ProjectTemplate | null {
  return BUILTIN_TEMPLATES.find((t) => t.id === templateId) ?? null;
}

// ── Migration plan generation ─────────────────────────────────────────────────

export async function generateTemplateMigrationPlan(input: {
  projectId?: string;
  templateId: string;
}): Promise<TemplateMigrationPlan> {
  const { projectId, templateId } = input;

  const template = getProjectTemplate(templateId);
  if (!template) {
    throw new Error(`Unknown template: ${templateId}`);
  }

  const base = projectId ? `/projects/${projectId}` : "";

  const steps: TemplateMigrationStep[] = [
    {
      id: "step-profile",
      label: "Detect project profile",
      status: projectId ? "manual" : "pending",
      message: projectId
        ? "View the Project Profile card to confirm the detected kind matches your template."
        : "Create a project first, then run profile detection.",
      linkHref: projectId ? `${base}/migration` : undefined,
    },
    {
      id: "step-source",
      label: "Import source artifacts (Source Intake)",
      status: "manual",
      message: "Run Source Intake to import and validate source code before configuring services.",
      linkHref: projectId ? `${base}/publishing` : undefined,
    },
    {
      id: "step-env",
      label: "Configure environment variables",
      status: "manual",
      message: `Add the ${template.expectedEnv.filter((e) => e.required).length} required env key(s): ${template.expectedEnv.filter((e) => e.required).map((e) => e.name).slice(0, 3).join(", ")}${template.expectedEnv.filter((e) => e.required).length > 3 ? "…" : ""}.`,
      linkHref: projectId ? `${base}/settings` : undefined,
    },
    {
      id: "step-services",
      label: "Review expected services",
      status: "manual",
      message: `Confirm ${template.expectedServices.length} service(s): ${template.expectedServices.map((s) => s.name).join(", ") || "none configured"}.`,
      linkHref: projectId ? `${base}/migration` : undefined,
    },
    {
      id: "step-dry-run",
      label: "Run Deployment Dry Run",
      status: "pending",
      message: "Verify build commands succeed before attempting production deployment.",
      linkHref: projectId ? `${base}/migration` : undefined,
    },
    ...(template.kind === "ecommerce" ? [
      {
        id: "step-ecommerce",
        label: "Run Ecommerce Test Plan",
        status: "pending" as const,
        message: "Smoke-check product pages, cart, and checkout flow on staging.",
        linkHref: projectId ? `${base}/migration` : undefined,
      },
      {
        id: "step-trial",
        label: "Run Staging Trial Migration",
        status: "pending" as const,
        message: "Full DB snapshot + restore on staging environment.",
        linkHref: projectId ? `${base}/migration` : undefined,
      },
    ] : []),
    {
      id: "step-backup",
      label: "Create database backup",
      status: template.kind === "static_site" ? "pass" : "pending",
      message: template.kind === "static_site"
        ? "No database — backup step not required."
        : "Run a full DB backup from the Backups page before production cutover.",
      linkHref: projectId && template.kind !== "static_site" ? `${base}/backups` : undefined,
    },
    {
      id: "step-rc",
      label: "Approve Release Candidate",
      status: "pending",
      message: "Generate the RC report on the Releases page and confirm all checks pass.",
      linkHref: projectId ? `${base}/releases` : undefined,
    },
    {
      id: "step-cutover",
      label: "Execute Production Cutover",
      status: "pending",
      message: "Use the guarded Execution panel on the Releases page. Do not apply routes manually.",
      linkHref: projectId ? `${base}/releases` : undefined,
    },
    {
      id: "step-monitoring",
      label: "Post-cutover monitoring",
      status: "pending",
      message: "Monitor for at least 30 minutes after cutover. Review incident log if any alerts fire.",
      linkHref: projectId ? `${base}/monitoring` : undefined,
    },
    {
      id: "step-runbook",
      label: "Complete operator runbook",
      status: "manual",
      message: "Document go-live operations, incident response procedures, and handoff notes.",
      linkHref: projectId ? `${base}/runbook` : undefined,
    },
  ];

  const blockers: string[] = [];
  const warnings: string[] = [];

  if (!projectId) {
    blockers.push("Create a project to unlock project-specific steps and links.");
  }

  if (template.expectedEnv.some((e) => e.required && e.category === "stripe")) {
    warnings.push("Stripe webhook secret must match the configured Stripe endpoint exactly.");
  }

  if (template.kind === "ecommerce") {
    warnings.push("Verify Stripe test-mode charges before switching to live keys.");
    warnings.push("Confirm Cloudinary media URLs are accessible after cutover.");
  }

  const nextSteps = template.recommendedPages.slice(0, 3).map(
    (p) => `Open ${p.label} — ${p.reason}`,
  );

  return {
    template,
    generatedAt: new Date().toISOString(),
    steps,
    blockers,
    warnings,
    nextSteps,
  };
}
