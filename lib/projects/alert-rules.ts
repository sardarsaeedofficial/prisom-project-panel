/**
 * lib/projects/alert-rules.ts
 *
 * Sprint 15: Alert rule type definitions and constants.
 *
 * Read-only types used by the evaluator, server actions, and UI.
 * No side effects — safe to import anywhere.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type AlertRuleType =
  | "frontend_down"
  | "health_endpoint_down"
  | "pm2_offline"
  | "database_down"
  | "required_secrets_missing"
  | "domain_ssl_problem"
  | "recent_deployment_failed"
  | "high_memory"
  | "high_restart_count"
  | "high_latency";

export type AlertSeverity = "info" | "warning" | "critical";

export type AlertEvaluationStatus = "ok" | "triggered" | "unknown" | "disabled";

/** Optional config stored as JSON alongside a rule. */
export type AlertRuleConfig = {
  memoryMbThreshold?:      number;   // default 512
  restartCountThreshold?:  number;   // default 5
  latencyMsThreshold?:     number;   // default 3000
  endpointName?:           "frontend" | "health" | "login";
};

/** Full rule as returned from the database. */
export type AlertRule = {
  id:              string;
  projectId:       string;
  name:            string;
  type:            AlertRuleType;
  severity:        AlertSeverity;
  enabled:         boolean;
  config:          AlertRuleConfig;
  lastCheckedAt:   string | null;   // ISO
  lastStatus:      AlertEvaluationStatus | null;
  lastMessage:     string | null;
  lastTriggeredAt: string | null;   // ISO
  createdAt:       string;
  updatedAt:       string;
};

/** Per-rule result returned from evaluateProjectAlertRules. */
export type AlertEvaluationResult = {
  ruleId:     string;
  ruleName:   string;
  type:       AlertRuleType;
  severity:   AlertSeverity;
  status:     AlertEvaluationStatus;
  message:    string;
  triggered:  boolean;
  checkedAt:  string;   // ISO
};

/**
 * Result of a full evaluation batch.
 * Defined here (not in alert-evaluator.ts) so client components can import it
 * without pulling in any server-only code.
 */
export type EvaluationBatchResult = {
  generatedAt:          string;
  snapshotSeverity:     string;
  environment:          string;
  results:              AlertEvaluationResult[];
  triggeredCount:       number;
  notificationDelivery: "disabled_in_sprint_15";
};

// ── Constants ─────────────────────────────────────────────────────────────────

export const ALERT_RULE_TYPES: AlertRuleType[] = [
  "frontend_down",
  "health_endpoint_down",
  "pm2_offline",
  "database_down",
  "required_secrets_missing",
  "domain_ssl_problem",
  "recent_deployment_failed",
  "high_memory",
  "high_restart_count",
  "high_latency",
];

export const ALERT_RULE_TYPE_LABELS: Record<AlertRuleType, string> = {
  frontend_down:             "Frontend Down",
  health_endpoint_down:      "Health Endpoint Down",
  pm2_offline:               "PM2 Offline",
  database_down:             "Database Down",
  required_secrets_missing:  "Required Secrets Missing",
  domain_ssl_problem:        "Domain / SSL Problem",
  recent_deployment_failed:  "Recent Deployment Failed",
  high_memory:               "High Memory Usage",
  high_restart_count:        "High Restart Count",
  high_latency:              "High Latency",
};

export const ALERT_SEVERITY_LABELS: Record<AlertSeverity, string> = {
  info:     "Info",
  warning:  "Warning",
  critical: "Critical",
};

/** Default thresholds when not overridden in config. */
export const DEFAULT_THRESHOLDS = {
  memoryMbThreshold:     512,
  restartCountThreshold: 5,
  latencyMsThreshold:    3000,
} as const;

/** True if this rule type uses numeric threshold config. */
export function ruleHasThreshold(type: AlertRuleType): boolean {
  return type === "high_memory" || type === "high_restart_count" || type === "high_latency";
}

// ── Default rule set ──────────────────────────────────────────────────────────

export type DefaultRuleTemplate = {
  name:     string;
  type:     AlertRuleType;
  severity: AlertSeverity;
  config:   AlertRuleConfig;
};

export const DEFAULT_ALERT_RULES: DefaultRuleTemplate[] = [
  { name: "Frontend Down",             type: "frontend_down",            severity: "critical", config: {} },
  { name: "Health Endpoint Down",      type: "health_endpoint_down",     severity: "critical", config: {} },
  { name: "PM2 Offline",               type: "pm2_offline",              severity: "critical", config: {} },
  { name: "Database Down",             type: "database_down",            severity: "warning",  config: {} },
  { name: "Required Secrets Missing",  type: "required_secrets_missing", severity: "warning",  config: {} },
  { name: "Domain / SSL Problem",      type: "domain_ssl_problem",       severity: "warning",  config: {} },
  { name: "Recent Deployment Failed",  type: "recent_deployment_failed", severity: "warning",  config: {} },
  { name: "High Memory Usage",         type: "high_memory",              severity: "warning",  config: { memoryMbThreshold: 512 } },
  { name: "High Restart Count",        type: "high_restart_count",       severity: "warning",  config: { restartCountThreshold: 5 } },
];

// ── Validation helpers ────────────────────────────────────────────────────────

export function isValidRuleType(t: string): t is AlertRuleType {
  return (ALERT_RULE_TYPES as string[]).includes(t);
}

export function isValidSeverity(s: string): s is AlertSeverity {
  return s === "info" || s === "warning" || s === "critical";
}

export function validateRuleConfig(
  type: AlertRuleType,
  config: AlertRuleConfig,
): string | null {
  if (type === "high_memory") {
    const v = config.memoryMbThreshold;
    if (v !== undefined && (v < 32 || v > 8192)) {
      return "memoryMbThreshold must be between 32 and 8192 MB.";
    }
  }
  if (type === "high_restart_count") {
    const v = config.restartCountThreshold;
    if (v !== undefined && (v < 1 || v > 1000)) {
      return "restartCountThreshold must be between 1 and 1000.";
    }
  }
  if (type === "high_latency") {
    const v = config.latencyMsThreshold;
    if (v !== undefined && (v < 100 || v > 60000)) {
      return "latencyMsThreshold must be between 100 and 60000 ms.";
    }
  }
  return null;
}
