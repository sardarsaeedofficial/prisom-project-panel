/**
 * lib/backups/disaster-recovery-types.ts
 *
 * Sprint 60: Types for the disaster recovery drill and backup/restore proof workflow.
 *
 * Pure types — no server imports, safe to reference from client components.
 */

export type DisasterRecoveryStatus =
  | "ready"
  | "warning"
  | "blocked"
  | "running"
  | "passed"
  | "failed"
  | "unknown";

export type DisasterRecoveryCategory =
  | "backup"
  | "restore"
  | "integrity"
  | "release_rollback"
  | "route_rollback"
  | "database"
  | "staging"
  | "monitoring"
  | "manual";

export type DisasterRecoveryCheck = {
  id: string;
  category: DisasterRecoveryCategory;
  label: string;
  status: "pass" | "warning" | "fail" | "manual" | "pending";
  required: boolean;
  message: string;
  evidence?: string[];
  command?: string;
  linkHref?: string;
  confirmationRequired?: string;
  warning?: string;
};

export type DisasterRecoveryReport = {
  projectId: string;
  generatedAt: string;
  status: DisasterRecoveryStatus;
  checks: DisasterRecoveryCheck[];
  blockers: string[];
  warnings: string[];
  nextSteps: string[];
  summary: {
    total: number;
    passed: number;
    warnings: number;
    failed: number;
    manual: number;
    pending: number;
  };
};

export type RestoreDrillPlan = {
  projectId: string;
  generatedAt: string;
  status: DisasterRecoveryStatus;
  recommendedTargetSlug: string;
  recommendedTargetDomain: string;
  sourceBackupId: string | null;
  sourceBackupRef: string | null;
  sourceBackupCreatedAt: string | null;
  steps: DisasterRecoveryCheck[];
  blockers: string[];
  warnings: string[];
  nextSteps: string[];
};

export type BackupIntegrityResult = {
  backupId: string;
  backupRef: string;
  checks: DisasterRecoveryCheck[];
  status: "passed" | "warning" | "failed";
  summary: string;
};
