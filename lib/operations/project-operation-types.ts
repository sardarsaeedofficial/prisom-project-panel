/**
 * lib/operations/project-operation-types.ts
 *
 * Sprint 27: Pure types for the project operation locking system.
 * No server dependencies — safe to import from client or server.
 */

// ── Operation types ───────────────────────────────────────────────────────────

export type OperationType =
  | "deploy"
  | "multi_service_deploy"
  | "backup_create"
  | "backup_restore"
  | "backup_delete"
  | "patch_apply"
  | "storage_cleanup";

export const OPERATION_TYPES: OperationType[] = [
  "deploy",
  "multi_service_deploy",
  "backup_create",
  "backup_restore",
  "backup_delete",
  "patch_apply",
  "storage_cleanup",
];

// ── Status ────────────────────────────────────────────────────────────────────

export type OperationStatus =
  | "running"
  | "success"
  | "failed"
  | "cancelled"
  | "stale";

// ── DTO (safe to send to client) ─────────────────────────────────────────────

export type ProjectOperationDTO = {
  id:                 string;
  projectId:          string;
  operationType:      OperationType;
  title:              string;
  status:             OperationStatus;
  /** User display name or email (never userId) */
  initiatedByName:    string | null;
  serviceId:          string | null;
  /** Operation-specific safe metadata (no secret values) */
  meta:               Record<string, unknown> | null;
  lastError:          string | null;
  startedAt:          string;   // ISO
  completedAt:        string | null;
  updatedAt:          string;
};

// ── Labels ────────────────────────────────────────────────────────────────────

export const OPERATION_TYPE_LABELS: Record<OperationType, string> = {
  deploy:               "Deploy",
  multi_service_deploy: "Multi-service deploy",
  backup_create:        "Create backup",
  backup_restore:       "Restore backup",
  backup_delete:        "Delete backup",
  patch_apply:          "Apply patch",
  storage_cleanup:      "Storage cleanup",
};

export const OPERATION_STATUS_LABELS: Record<OperationStatus, string> = {
  running:   "Running",
  success:   "Completed",
  failed:    "Failed",
  cancelled: "Cancelled",
  stale:     "Stale (timed out)",
};

// ── Input for creating an operation ─────────────────────────────────────────

export type StartOperationInput = {
  projectId:          string;
  operationType:      OperationType;
  title:              string;
  initiatedByUserId?: string;
  serviceId?:         string;
  meta?:              Record<string, unknown>;
};
