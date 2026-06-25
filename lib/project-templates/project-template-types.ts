/**
 * lib/project-templates/project-template-types.ts
 *
 * Sprint 72: Type definitions for reusable client project migration templates.
 * These describe what a new project of a given kind should look like —
 * services, env requirements, onboarding checklist, and recommended pages.
 */

export type ProjectTemplateKind =
  | "ecommerce"
  | "web_app"
  | "api_service"
  | "static_site"
  | "custom";

export type ProjectTemplateService = {
  name: string;
  kind: "api" | "static" | "worker" | "fullstack" | "unknown";
  rootHint?: string;
  buildCommandHint?: string;
  startCommandHint?: string;
  outputPathHint?: string;
  healthPathHint?: string;
  routeHint?: string;
};

export type ProjectTemplateEnvRequirement = {
  name: string;
  category:
    | "app"
    | "database"
    | "auth"
    | "stripe"
    | "cloudinary"
    | "email"
    | "webhook"
    | "storage"
    | "other";
  required: boolean;
  secret: boolean;
  description: string;
};

export type ProjectTemplate = {
  id: string;
  kind: ProjectTemplateKind;
  label: string;
  description: string;
  bestFor: string[];
  expectedServices: ProjectTemplateService[];
  expectedEnv: ProjectTemplateEnvRequirement[];
  recommendedPages: Array<{
    label: string;
    hrefSuffix: string;
    reason: string;
  }>;
  onboardingChecklist: Array<{
    id: string;
    label: string;
    description: string;
    required: boolean;
  }>;
  safetyNotes: string[];
};

// Plan types returned by generateTemplateMigrationPlan

export type TemplateMigrationStep = {
  id: string;
  label: string;
  status: "pending" | "manual" | "warning" | "pass";
  message: string;
  linkHref?: string;
};

export type TemplateMigrationPlan = {
  template: ProjectTemplate;
  generatedAt: string;
  steps: TemplateMigrationStep[];
  blockers: string[];
  warnings: string[];
  nextSteps: string[];
};
