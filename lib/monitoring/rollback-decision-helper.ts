/**
 * lib/monitoring/rollback-decision-helper.ts
 *
 * Sprint 66: Generate rollback recommendation from monitoring checks.
 *
 * Safety: does NOT execute rollback. Documentation and decision support only.
 */

import type {
  MonitoringCheck,
  IncidentSeverity,
  PostCutoverMonitoringReport,
} from "./post-cutover-monitoring-types";

const ROLLBACK_CHECKLIST = [
  "Confirm incident severity — is this worth a rollback?",
  "Confirm latest backup location (Backups page)",
  "Confirm previous release target (Releases page)",
  "Review route rollback preview (Production Execution Guard)",
  "Acknowledge DB rollback limitation — app rollback does NOT rollback database schema/data",
  "Assign rollback owner — who will execute the manual steps?",
  "Draft customer/team communication for downtime or degraded state",
  "Perform manual operator rollback only after approval from Owner/Admin",
  "Run post-rollback smoke checks (curl + API health)",
  "Confirm rollback success and update incident log",
];

// ── Main ──────────────────────────────────────────────────────────────────────

export function generateRollbackRecommendation(input: {
  checks:   MonitoringCheck[];
  severity: IncidentSeverity;
}): PostCutoverMonitoringReport["rollbackRecommendation"] {
  const { checks, severity } = input;

  const hasCriticalFrontend = checks.some(
    (c) => c.id === "health-frontend-root" && c.status === "fail",
  );
  const hasCriticalApi = checks.some(
    (c) => c.id === "health-api-healthz" && c.status === "fail",
  );
  const hasCriticalDb = checks.some(
    (c) => c.category === "database" && c.status === "fail",
  );
  const hasCriticalSsl = checks.some(
    (c) => c.category === "ssl" && c.status === "fail",
  );
  const hasRepeatedFail = checks.filter((c) => c.status === "fail").length >= 3;

  const shouldConsiderRollback =
    hasCriticalFrontend ||
    hasCriticalApi ||
    hasCriticalDb ||
    hasCriticalSsl ||
    hasRepeatedFail ||
    severity === "critical" ||
    severity === "high";

  let reason = "";
  if (!shouldConsiderRollback) {
    reason =
      "No critical failures detected. Monitor for 10–15 minutes. Consider rollback only if " +
      "production root or API health checks fail.";
  } else if (hasCriticalFrontend && hasCriticalApi) {
    reason =
      "CRITICAL: Both production frontend and API health are down. " +
      "Consider rollback immediately if not resolved within 5 minutes.";
  } else if (hasCriticalFrontend) {
    reason =
      "Production root (/) is unreachable. Customers cannot access the storefront. " +
      "Consider rollback if nginx or PM2 cannot be fixed quickly.";
  } else if (hasCriticalApi) {
    reason =
      "API health endpoint (/api/healthz) is down. API-dependent features are failing. " +
      "Consider rollback if the API service cannot be restarted cleanly.";
  } else if (hasCriticalDb) {
    reason =
      "Database unreachable. Most application features will fail. " +
      "Consider rollback or DB restart procedure. WARNING: rollback does not fix DB issues automatically.";
  } else if (hasCriticalSsl) {
    reason =
      "SSL failure detected. HTTPS traffic is broken. " +
      "Investigate nginx SSL config. Rollback may restore previous SSL config if it was working.";
  } else if (hasRepeatedFail) {
    reason =
      `${checks.filter((c) => c.status === "fail").length} checks are failing. ` +
      "Multiple failures indicate a systemic problem. Consider rollback.";
  } else {
    reason =
      `Severity: ${severity}. Review the failing checks above and assess customer impact before deciding on rollback.`;
  }

  return {
    shouldConsiderRollback,
    severity,
    reason,
    checklist: ROLLBACK_CHECKLIST,
  };
}
