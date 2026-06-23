/**
 * lib/domains/domain-readiness-types.ts
 *
 * Sprint 47: Types for Domain + SSL + Nginx readiness checks.
 * Pure data — safe to import from client or server.
 *
 * Safety rules:
 *  - No nginx config file contents
 *  - No server credentials
 *  - configPath is basename only (no full FS path to client)
 */

// ── Overall status ────────────────────────────────────────────────────────────

export type DomainReadinessStatus = "ready" | "warning" | "blocked";

// ── DNS ───────────────────────────────────────────────────────────────────────

export type DomainDnsRecordStatus = {
  type:      "A" | "AAAA" | "CNAME";
  host:      string;
  values:    string[];
  expected?: string[];
  status:    "match" | "mismatch" | "missing" | "unknown";
  message:   string;
};

// ── SSL ───────────────────────────────────────────────────────────────────────

export type DomainSslStatus = {
  hasCertificate: boolean;
  issuer?:        string;
  subject?:       string;
  validFrom?:     string;
  validTo?:       string;
  daysRemaining?: number;
  /** valid = trusted + not expiring | expiring = within 14d | expired | missing | unknown */
  status:         "valid" | "expiring" | "expired" | "missing" | "unknown";
  message:        string;
};

// ── Nginx ownership ───────────────────────────────────────────────────────────

export type NginxOwnershipStatus = {
  domain:              string;
  /** Config basename only — no full path exposed to client */
  configPath?:         string;
  enabledPath?:        string;
  ownerProjectId?:     string | null;
  ownerProjectSlug?:   string | null;
  /** True if config has a Prisom-generated marker comment */
  managedByPrisom:     boolean;
  /** True if config is a protected system config (panel, doorstep, etc.) */
  protectedConfig:     boolean;
  /** True if another project or unmanaged config owns this domain */
  conflict:            boolean;
  message:             string;
};

// ── Full readiness report ─────────────────────────────────────────────────────

export type DomainReadinessReport = {
  projectId:   string;
  domain:      string;
  generatedAt: string;
  status:      DomainReadinessStatus;
  dns:         DomainDnsRecordStatus[];
  ssl:         DomainSslStatus;
  nginx:       NginxOwnershipStatus;
  blockers:    string[];
  warnings:    string[];
  nextSteps:   string[];
};

// ── Server action results ─────────────────────────────────────────────────────

export type DomainReadinessResult =
  | { ok: true;  report: DomainReadinessReport }
  | { ok: false; error: string };

export type DomainDnsResult =
  | { ok: true;  records: DomainDnsRecordStatus[] }
  | { ok: false; error: string };

export type DomainSslResult =
  | { ok: true;  ssl: DomainSslStatus }
  | { ok: false; error: string };

export type NginxOwnershipResult =
  | { ok: true;  nginx: NginxOwnershipStatus }
  | { ok: false; error: string };
