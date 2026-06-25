/**
 * lib/project-profiles/project-profile-types.ts
 *
 * Sprint 71: Type definitions for the reusable project migration profile framework.
 * These types describe what we know (or can detect) about a project's architecture,
 * expected services, routes, and env requirements — without storing any secret values.
 */

export type ProjectProfileKind =
  | "sardar_ecommerce"
  | "generic_ecommerce"
  | "generic_web_app"
  | "api_service"
  | "static_site"
  | "unknown";

export type ProjectProfileService = {
  name: string;
  kind: "api" | "static" | "worker" | "fullstack" | "unknown";
  root?: string;
  buildCommand?: string;
  startCommand?: string;
  outputPath?: string;
  healthPath?: string;
  route?: string;
};

export type ProjectProfileEnvRequirement = {
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

export type ProjectMigrationProfile = {
  kind: ProjectProfileKind;
  label: string;
  description: string;
  projectId?: string;
  slug?: string;
  domain?: string;
  isSardar: boolean;
  isEcommerce: boolean;
  expectedServices: ProjectProfileService[];
  expectedEnv: ProjectProfileEnvRequirement[];
  expectedRoutes: Array<{
    path: string;
    target: string;
    type: "api" | "static" | "spa_fallback" | "unknown";
  }>;
  safetyNotes: string[];
  recommendedNextSteps: string[];
};
