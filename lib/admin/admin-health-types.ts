/**
 * lib/admin/admin-health-types.ts
 *
 * Sprint 31: Shared types for the Admin Health Console.
 *
 * Pure types — no server dependencies, safe to import anywhere.
 */

// ── Sub-types ─────────────────────────────────────────────────────────────────

export type AdminOverallStatus = "healthy" | "warning" | "critical";

export type AdminDeploymentFailure = {
  projectId:   string;
  projectName: string;
  projectSlug: string;
  deploymentId: string;
  errorMessage: string | null;
  startedAt:   string; // ISO
};

export type AdminPm2Process = {
  name:      string;
  status:    string;       // "online" | "stopped" | "errored" | "launching" | "unknown" | …
  pid:       number | null;
  uptimeMs:  number | null;
  memoryMb:  number | null;
  cpu:       number | null;
  restarts:  number;
  isManaged: boolean;      // true = prisom-managed project process
};

export type AdminSystemWarning = {
  severity:    "info" | "warning" | "critical";
  title:       string;
  description: string;
  href?:       string;
};

export type AdminSchedulerSummary = {
  name:            string;
  status:          "running" | "stale" | "unknown" | "disabled";
  lastHeartbeatAt?: string;
  tickCount?:       number;
  lastError?:       string;
};

// ── Main report ───────────────────────────────────────────────────────────────

export type AdminHealthReport = {
  generatedAt:   string; // ISO
  overallStatus: AdminOverallStatus;

  totals: {
    projects:         number;
    publishedProjects: number;
    domains:          number;
    backups:          number;
    users:            number;
  };

  operations: {
    active:   number;
    failed24h: number;
    stale:    number;
  };

  deployments: {
    success24h:     number;
    failed24h:      number;
    latestFailures: AdminDeploymentFailure[];
  };

  pm2: {
    status:    "healthy" | "warning" | "critical" | "unknown";
    processes: AdminPm2Process[];
  };

  disk: {
    status:               "healthy" | "warning" | "critical" | "unknown";
    totalBytes?:          number;
    usedBytes?:           number;
    freeBytes?:           number;
    usagePct?:            number;
    projectStorageBytes?: number;
    releaseStorageBytes?: number;
    backupStorageBytes?:  number;
  };

  backups: {
    scheduledEnabled:           number;
    scheduledFailed24h:         number;
    projectsWithoutRecentBackup: number;
  };

  domains: {
    total:   number;
    active:  number;
    errored: number;
  };

  schedulers: {
    alerts:  AdminSchedulerSummary;
    backups: AdminSchedulerSummary;
  };

  recentAuditEvents: {
    id:        string;
    action:    string;
    summary:   string;
    result:    string;
    createdAt: string;
  }[];

  warnings: AdminSystemWarning[];
};

// ── Action result ─────────────────────────────────────────────────────────────

export type GetAdminHealthResult =
  | { ok: true;  report: AdminHealthReport }
  | { ok: false; error: string };

// ─────────────────────────────────────────────────────────────────────────────
// Sprint 33: Split health types — fast summary + async sections
// ─────────────────────────────────────────────────────────────────────────────

export type AdminCacheStatus = "fresh" | "stale" | "miss";
// AdminOverallStatus is defined above (line 11) — not re-declared here

// ── Fast summary (DB-only, renders on initial page load) ──────────────────────

export type AdminFastSummary = {
  generatedAt:  string;
  cacheStatus:  AdminCacheStatus;

  totals: {
    projects:          number;
    publishedProjects: number;
    domains:           number;
    backups:           number;
    users:             number;
  };

  operations: {
    active:    number;
    failed24h: number;
    stale:     number;
  };

  deployments: {
    success24h:     number;
    failed24h:      number;
    latestFailures: AdminDeploymentFailure[];
  };

  backups: {
    scheduledEnabled:            number;
    scheduledFailed24h:          number;
    projectsWithoutRecentBackup: number;
  };

  domains: {
    total:   number;
    active:  number;
    errored: number;
  };

  recentAuditEvents: {
    id:        string;
    action:    string;
    summary:   string;
    result:    string;
    createdAt: string;
  }[];

  // Warnings derivable from DB data alone
  fastWarnings: AdminSystemWarning[];
};

// ── Async sections (loaded client-side after mount) ───────────────────────────

export type AdminPm2Section = {
  generatedAt: string;
  cacheStatus: AdminCacheStatus;
  status:      "healthy" | "warning" | "critical" | "unknown";
  processes:   AdminPm2Process[];
  warnings:    AdminSystemWarning[];
};

export type AdminDiskSection = {
  generatedAt:          string;
  cacheStatus:          AdminCacheStatus;
  status:               "healthy" | "warning" | "critical" | "unknown";
  totalBytes?:          number;
  usedBytes?:           number;
  freeBytes?:           number;
  usagePct?:            number;
  projectStorageBytes?: number;
  releaseStorageBytes?: number;
  backupStorageBytes?:  number;
  warnings:             AdminSystemWarning[];
};

export type AdminSchedulersSection = {
  generatedAt: string;
  cacheStatus: AdminCacheStatus;
  alerts:      AdminSchedulerSummary;
  backups:     AdminSchedulerSummary;
  warnings:    AdminSystemWarning[];
};

// ── Section action results ────────────────────────────────────────────────────

export type GetFastSummaryResult =
  | { ok: true;  summary: AdminFastSummary }
  | { ok: false; error: string };

export type GetPm2SectionResult =
  | { ok: true;  data: AdminPm2Section }
  | { ok: false; error: string };

export type GetDiskSectionResult =
  | { ok: true;  data: AdminDiskSection }
  | { ok: false; error: string };

export type GetSchedulersSectionResult =
  | { ok: true;  data: AdminSchedulersSection }
  | { ok: false; error: string };
