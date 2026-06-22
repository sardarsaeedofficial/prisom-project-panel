/**
 * lib/storage/storage-types.ts
 *
 * Sprint 34: Pure types for the Storage Center.
 * No server deps — safe to import from client components.
 */

// ── Storage items ─────────────────────────────────────────────────────────────

export type StorageItemKind = "release" | "backup";

export type StorageItem = {
  /** Unique key: DB id for backups, dir name for releases */
  id:        string;
  label:     string;
  kind:      StorageItemKind;
  /** Safe display label (no absolute paths) */
  pathLabel: string;
  sizeBytes: number;
  createdAt?: string;  // ISO
  status?:    string;

  protected:       boolean;
  reasonProtected?: string;

  cleanupEligible:  boolean;
  cleanupReason?:   string;
};

// ── Totals ────────────────────────────────────────────────────────────────────

export type ProjectStorageTotals = {
  sourceBytes:   number;
  releasesBytes: number;
  backupsBytes:  number;
  totalBytes:    number;
};

// ── Policy ────────────────────────────────────────────────────────────────────

export type ProjectStoragePolicyDTO = {
  keepSuccessfulReleases: number;
  keepFailedReleases:     number;
  keepScheduledBackups:   number;
  autoCleanupEnabled:     boolean;
  maxStorageBytes:        number | null;  // null = unlimited
};

export const DEFAULT_STORAGE_POLICY: ProjectStoragePolicyDTO = {
  keepSuccessfulReleases: 5,
  keepFailedReleases:     2,
  keepScheduledBackups:   7,
  autoCleanupEnabled:     false,
  maxStorageBytes:        null,
};

// ── Report ────────────────────────────────────────────────────────────────────

export type ProjectStorageReport = {
  projectId:   string;
  projectSlug: string;
  projectName: string;
  generatedAt: string;
  totals:      ProjectStorageTotals;
  releases:    StorageItem[];
  backups:     StorageItem[];
  policy:      ProjectStoragePolicyDTO;
  recommendations: string[];
};

// ── Cleanup plan ──────────────────────────────────────────────────────────────

export type StorageCleanupPlan = {
  projectId:        string;
  generatedAt:      string;
  eligibleItems:    StorageItem[];
  protectedItems:   StorageItem[];
  totalBytesToFree: number;
  warnings:         string[];
};

// ── Cleanup result ────────────────────────────────────────────────────────────

export type CleanupDeletedItem = {
  id:         string;
  label:      string;
  kind:       StorageItemKind;
  bytesFreed: number;
};

export type CleanupFailedItem = {
  id:     string;
  label:  string;
  reason: string;
};

export type CleanupResult = {
  projectId:       string;
  completedAt:     string;
  deletedItems:    CleanupDeletedItem[];
  failedItems:     CleanupFailedItem[];
  totalBytesFreed: number;
  operationId:     string;
};

// ── Action return types ───────────────────────────────────────────────────────

export type GetStorageReportResult =
  | { ok: true;  report: ProjectStorageReport }
  | { ok: false; error: string };

export type GetCleanupPlanResult =
  | { ok: true;  plan: StorageCleanupPlan }
  | { ok: false; error: string };

export type RunCleanupResult =
  | { ok: true;  result: CleanupResult }
  | { ok: false; error: string };

export type SaveStoragePolicyResult =
  | { ok: true }
  | { ok: false; error: string };

// ── Admin storage summary (for Admin Console) ─────────────────────────────────

export type AdminProjectStorageSummary = {
  projectId:   string;
  projectSlug: string;
  projectName: string;
  totalBackupBytes: number;
  backupCount:      number;
  scheduledEnabled: boolean;
};

export type AdminStorageSectionItem = AdminProjectStorageSummary;
