/**
 * lib/project-profiles/profile-labels.ts
 *
 * Sprint 71: Display helpers for project migration profiles.
 * Used in the profile card, exports, and anywhere a human-readable
 * representation of a profile is needed.
 */

import type { ProjectMigrationProfile } from "./project-profile-types";

export function getProjectDisplayName(profile: ProjectMigrationProfile): string {
  if (profile.label) return profile.label;
  if (profile.slug)  return profile.slug;
  if (profile.projectId) return profile.projectId;
  return "Unknown Project";
}

export function getProjectProfileBadge(profile: ProjectMigrationProfile): string {
  switch (profile.kind) {
    case "sardar_ecommerce":  return "Sardar Ecommerce";
    case "generic_ecommerce": return "Ecommerce";
    case "generic_web_app":   return "Web App";
    case "api_service":       return "API Service";
    case "static_site":       return "Static Site";
    default:                  return "Unknown";
  }
}

export function getDefaultStagingDomain(profile: ProjectMigrationProfile): string {
  if (!profile.domain) return "";
  const host = profile.domain.replace(/^https?:\/\//, "");
  return `staging-${host}`;
}

export function getDefaultProductionDomain(profile: ProjectMigrationProfile): string {
  return profile.domain ?? "";
}
