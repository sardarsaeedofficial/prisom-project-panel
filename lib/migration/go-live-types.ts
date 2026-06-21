/**
 * lib/migration/go-live-types.ts
 *
 * Sprint 26: Types for the Replit Go-Live Readiness workflow.
 *
 * Pure data — no server deps. Safe to import from client or server.
 */

// ── Status types ──────────────────────────────────────────────────────────────

export type GoLiveCheckStatus   = "pass" | "warning" | "fail" | "manual" | "skip";
export type GoLiveOverallStatus = "blocked" | "needs_attention" | "ready";

export type GoLiveCheckCategory =
  | "backup"
  | "patches"
  | "secrets"
  | "database"
  | "services"
  | "build"
  | "domain"
  | "email"
  | "payments"
  | "media";

// ── Check ─────────────────────────────────────────────────────────────────────

export type GoLiveCheckAction = {
  /** Button label */
  label: string;
  /** Internal link to navigate to */
  href?: string;
  /** Copyable command or value */
  copyText?: string;
};

export type GoLiveCheck = {
  id:        string;
  title:     string;
  status:    GoLiveCheckStatus;
  category:  GoLiveCheckCategory;
  /** Human-readable detail (never includes secret values) */
  details:   string;
  action?:   GoLiveCheckAction;
};

// ── Service readiness ─────────────────────────────────────────────────────────

export type GoLiveServiceCheck = {
  serviceId:               string;
  serviceName:             string;
  serviceType:             "node" | "static" | string;
  slug:                    string;
  internalPort:            number | null;
  commandsValid:           boolean;
  portAssigned:            boolean;
  healthPathValid:         boolean;
  staticOutputConfigured:  boolean;
  isEnabled:               boolean;
  lastStatus:              string | null;
  pm2Name:                 string;
  issues:                  string[];
};

// ── External (manual) task ───────────────────────────────────────────────────

export type GoLiveExternalProvider =
  | "stripe"
  | "email"
  | "dns"
  | "database"
  | "cloudinary"
  | "manual";

export type GoLiveExternalTask = {
  id:           string;
  title:        string;
  provider:     GoLiveExternalProvider;
  status:       "manual_required" | "done" | "not_applicable";
  instructions: string[];
};

// ── Full report ───────────────────────────────────────────────────────────────

export type GoLiveReadinessReport = {
  projectId:     string;
  projectName:   string;
  projectSlug:   string;
  overallStatus: GoLiveOverallStatus;
  checks:        GoLiveCheck[];
  services:      GoLiveServiceCheck[];
  externalTasks: GoLiveExternalTask[];
  /** Copyable commands to run after all checks pass */
  nextCommands:  string[];
  failCount:     number;
  warningCount:  number;
  passCount:     number;
  generatedAt:   string;
};
