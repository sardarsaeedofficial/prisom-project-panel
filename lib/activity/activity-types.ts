/**
 * lib/activity/activity-types.ts
 *
 * Sprint 37: Normalized activity item type for the unified activity timeline.
 * No server dependencies — safe to import from client components.
 */

export type ActivityCategory =
  | "deployment"
  | "operation"
  | "background_job"
  | "backup"
  | "domain"
  | "storage"
  | "alert"
  | "audit"
  | "security"
  | "system";

export type ActivitySeverity = "info" | "success" | "warning" | "error";

export type ActivityItem = {
  id:          string;
  occurredAt:  string;           // ISO string
  projectId?:  string;
  projectName?: string;
  projectSlug?: string;
  actorEmail?: string | null;

  category:   ActivityCategory;
  severity:   ActivitySeverity;
  title:      string;
  description?: string;
  href?:       string;

  sourceType: string;
  sourceId:   string;
};

export type ListActivityInput = {
  projectId?:  string;
  category?:   ActivityCategory;
  severity?:   ActivitySeverity;
  search?:     string;
  from?:       Date;
  to?:         Date;
  page?:       number;
  pageSize?:   number;
};

export type ListActivityOutput = {
  items:      ActivityItem[];
  total:      number;
  page:       number;
  pageSize:   number;
  totalPages: number;
};
