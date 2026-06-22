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
