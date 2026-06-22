/**
 * lib/domains/domain-health-types.ts
 *
 * Sprint 29: Types for Domain + SSL health checks.
 * Pure data — no server deps.  Safe to import from client or server.
 */

// ── Per-check status ──────────────────────────────────────────────────────────

export type CheckStatus = "pass" | "warning" | "fail" | "unknown";

// ── DNS ───────────────────────────────────────────────────────────────────────

export type DnsCheckResult = {
  status:        CheckStatus;
  aRecords:      string[];
  aaaaRecords:   string[];
  cnameValue:    string | null;
  /** The server's public IP we expect A records to point to */
  expectedIp:    string;
  pointsToServer: boolean | null;
  resolvedAt:    string;
  error:         string | null;
};

// ── HTTP / HTTPS ──────────────────────────────────────────────────────────────

export type HttpCheckResult = {
  status:        CheckStatus;
  statusCode:    number | null;
  redirectedTo:  string | null;
  responseTimeMs: number | null;
  error:         string | null;
};

// ── SSL / TLS ─────────────────────────────────────────────────────────────────

export type SslCheckResult = {
  status:        CheckStatus;
  issuer:        string | null;
  subject:       string | null;
  validFrom:     string | null;
  validTo:       string | null;
  daysRemaining: number | null;
  authorized:    boolean | null;
  error:         string | null;
};

// ── Nginx routing summary (safe — no raw config exposed) ─────────────────────

export type NginxRouteSummary = {
  /** Config file label (filename only, no path) */
  configLabel:       string | null;
  /** Whether server_name in the config matches the domain */
  serverNameMatch:   boolean | null;
  /** Proxy target extracted from proxy_pass (host:port only, no credentials) */
  proxyTarget:       string | null;
  /** Static root directory, if applicable */
  staticRoot:        string | null;
  /** Whether SSL (443) config was found in the file */
  hasSslBlock:       boolean | null;
  /** Explanation when config cannot be read (EACCES, ENOENT, etc.) */
  unavailableReason: string | null;
};

// ── Recommendation ────────────────────────────────────────────────────────────

export type RecommendationSeverity = "critical" | "warning" | "info";

export type DomainRecommendation = {
  id:       string;
  severity: RecommendationSeverity;
  title:    string;
  detail:   string;
  /** Optional link to the panel that fixes this */
  href?:    string;
};

// ── Full per-domain health entry ──────────────────────────────────────────────

export type DomainHealthEntry = {
  domainId:   string;
  hostname:   string;
  isPrimary:  boolean;
  dns:        DnsCheckResult;
  http:       HttpCheckResult;
  https:      HttpCheckResult;
  ssl:        SslCheckResult;
  nginx:      NginxRouteSummary;
  recommendations: DomainRecommendation[];
  checkedAt:  string;
};

// ── Full project domain health report ────────────────────────────────────────

export type DomainHealthReport = {
  projectId:   string;
  domains:     DomainHealthEntry[];
  generatedAt: string;
};

// ── Server action result ──────────────────────────────────────────────────────

export type GetDomainHealthResult =
  | { ok: true;  report: DomainHealthReport }
  | { ok: false; error: string };
