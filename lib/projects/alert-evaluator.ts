/**
 * lib/projects/alert-evaluator.ts
 *
 * Sprint 15: Evaluate per-project alert rules against a live monitoring snapshot.
 *
 * Safety rules (same as Sprint 14):
 *  - Read-only: no PM2 restart / deploy / rollback
 *  - Never sends notifications
 *  - Never exposes env var values or DATABASE_URL
 *  - Only reads the project's configured PM2 process
 *  - Individual rule failures do not crash the batch
 */

import { db }                            from "@/lib/db";
import { getProjectMonitoringSnapshot }  from "@/lib/projects/project-monitoring";
import type { ProjectMonitoringSnapshot, ActionResult } from "@/lib/projects/project-monitoring";
import {
  type AlertRuleType,
  type AlertSeverity,
  type AlertEvaluationStatus,
  type AlertEvaluationResult,
  type AlertRuleConfig,
  type EvaluationBatchResult,
  DEFAULT_THRESHOLDS,
  isValidRuleType,
  isValidSeverity,
} from "@/lib/projects/alert-rules";

// EvaluationBatchResult is defined in alert-rules.ts so client components can
// import it without pulling in server-only dependencies.
export type { EvaluationBatchResult };

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * Evaluate all enabled alert rules for a project.
 *
 * @param persist  If true, update rule.lastCheckedAt / lastStatus / lastMessage /
 *                 lastTriggeredAt in DB and create ProjectAlertEvaluation records.
 *                 Set false for a dry-run preview.
 */
export async function evaluateProjectAlertRules(input: {
  projectId:    string;
  environment?: "production" | "preview" | "development";
  ruleIds?:     string[];
  persist?:     boolean;
}): Promise<ActionResult<EvaluationBatchResult>> {
  const { projectId, environment = "production", ruleIds, persist = false } = input;

  // ── Load rules ──────────────────────────────────────────────────────────────
  const rulesFromDb = await db.projectAlertRule.findMany({
    where: {
      projectId,
      ...(ruleIds ? { id: { in: ruleIds } } : {}),
    },
    orderBy: { createdAt: "asc" },
  });

  if (rulesFromDb.length === 0) {
    return {
      ok: true,
      data: {
        generatedAt:          new Date().toISOString(),
        snapshotSeverity:     "unknown",
        environment,
        results:              [],
        triggeredCount:       0,
        notificationDelivery: "disabled_in_sprint_15",
      },
    };
  }

  // ── Fetch monitoring snapshot (single call shared by all rules) ─────────────
  const snapshotResult = await getProjectMonitoringSnapshot({ projectId, environment });
  const snapshot: ProjectMonitoringSnapshot | null = snapshotResult.ok ? snapshotResult.data : null;

  const generatedAt = new Date().toISOString();
  const results: AlertEvaluationResult[] = [];

  // ── Evaluate each rule ──────────────────────────────────────────────────────
  for (const rule of rulesFromDb) {
    const type     = rule.type as AlertRuleType;
    const severity = (isValidSeverity(rule.severity) ? rule.severity : "warning") as AlertSeverity;
    const config   = (rule.config ?? {}) as AlertRuleConfig;

    let status:   AlertEvaluationStatus = "unknown";
    let message:  string                = "Could not evaluate — monitoring snapshot unavailable.";
    let triggered = false;

    if (!rule.enabled) {
      status  = "disabled";
      message = "Rule is disabled.";
    } else if (!snapshot || !isValidRuleType(type)) {
      status  = "unknown";
      message = snapshot
        ? `Unknown rule type: ${rule.type}.`
        : "Monitoring snapshot unavailable.";
    } else {
      const eval_ = evaluateRule(type, config, snapshot);
      status   = eval_.triggered ? "triggered" : "ok";
      message  = eval_.message;
      triggered = eval_.triggered;
    }

    const result: AlertEvaluationResult = {
      ruleId:    rule.id,
      ruleName:  rule.name,
      type,
      severity,
      status,
      message,
      triggered,
      checkedAt: generatedAt,
    };
    results.push(result);
  }

  // ── Persist if requested ────────────────────────────────────────────────────
  if (persist) {
    await Promise.allSettled(
      results.map(async (r) => {
        const now = new Date(generatedAt);

        await db.projectAlertRule.update({
          where: { id: r.ruleId },
          data: {
            lastCheckedAt:  now,
            lastStatus:     r.status,
            lastMessage:    r.message,
            ...(r.triggered ? { lastTriggeredAt: now } : {}),
          },
        });

        await db.projectAlertEvaluation.create({
          data: {
            projectId,
            ruleId:   r.ruleId,
            ruleName: r.ruleName,
            type:     r.type,
            severity: r.severity,
            status:   r.status,
            message:  r.message,
            // Only store the minimal snapshot for triggered rules to avoid large JSON blobs
            snapshot: r.triggered && snapshot
              ? {
                  severity:         snapshot.severity,
                  pm2Online:        snapshot.pm2.online,
                  pm2Status:        snapshot.pm2.status,
                  frontendStatus:   snapshot.endpoints.find((e) => e.name === "frontend")?.status,
                  healthStatus:     snapshot.endpoints.find((e) => e.name === "health")?.status,
                  databaseStatus:   snapshot.database.status,
                  secretsMissing:   snapshot.secrets.missingKeys,
                  recentFailures:   snapshot.deployments.recentFailureCount,
                }
              : undefined,
          },
        });
      }),
    );
  }

  const triggeredCount = results.filter((r) => r.triggered).length;

  return {
    ok: true,
    data: {
      generatedAt,
      snapshotSeverity: snapshot?.severity ?? "unknown",
      environment,
      results,
      triggeredCount,
      notificationDelivery: "disabled_in_sprint_15",
    },
  };
}

// ── Rule evaluation logic ─────────────────────────────────────────────────────

function evaluateRule(
  type:     AlertRuleType,
  config:   AlertRuleConfig,
  snap:     ProjectMonitoringSnapshot,
): { triggered: boolean; message: string } {

  switch (type) {

    case "frontend_down": {
      const ep = snap.endpoints.find((e) => e.name === "frontend");
      if (!ep || !ep.url) {
        return { triggered: false, message: "No public frontend URL configured — skipped." };
      }
      if (ep.status === "fail") {
        const detail = ep.httpStatus
          ? `HTTP ${ep.httpStatus}`
          : ep.error ?? "unreachable";
        return {
          triggered: true,
          message:   `Frontend is down: ${detail}${ep.latencyMs != null ? ` in ${ep.latencyMs}ms` : ""}.`,
        };
      }
      return {
        triggered: false,
        message:   `Frontend is reachable: ${ep.httpStatus ?? "2xx"} in ${ep.latencyMs ?? "?"}ms.`,
      };
    }

    case "health_endpoint_down": {
      const ep =
        snap.endpoints.find((e) => e.name === "health") ??
        snap.endpoints.find((e) => e.name === "internal-health");
      if (!ep || !ep.url) {
        return { triggered: false, message: "No health endpoint configured — skipped." };
      }
      if (ep.status === "fail") {
        const detail = ep.httpStatus
          ? `HTTP ${ep.httpStatus}`
          : ep.error ?? "unreachable";
        return {
          triggered: true,
          message:   `Health endpoint failed: ${detail}${ep.latencyMs != null ? ` in ${ep.latencyMs}ms` : ""}.`,
        };
      }
      return {
        triggered: false,
        message:   `Health endpoint OK: ${ep.httpStatus ?? "2xx"} in ${ep.latencyMs ?? "?"}ms.`,
      };
    }

    case "pm2_offline": {
      if (!snap.pm2.configured) {
        return { triggered: false, message: "PM2 not configured for this project — skipped." };
      }
      if (!snap.pm2.online) {
        return {
          triggered: true,
          message:   `PM2 process ${snap.pm2.processName ?? "(unknown)"} is offline (status: ${snap.pm2.status ?? "unknown"}).`,
        };
      }
      return {
        triggered: false,
        message:   `PM2 process ${snap.pm2.processName ?? "(unknown)"} is online (${snap.pm2.status ?? "online"}).`,
      };
    }

    case "database_down": {
      if (!snap.database.configured) {
        return { triggered: false, message: "No database configured for this project — skipped." };
      }
      if (snap.database.status === "fail") {
        return {
          triggered: true,
          message:   `Database connection failed: ${snap.database.error ?? "unknown error"}.`,
        };
      }
      if (snap.database.status === "unknown") {
        return { triggered: false, message: "Database check returned unknown status." };
      }
      return {
        triggered: false,
        message:   `Database connected${snap.database.latencyMs != null ? ` in ${snap.database.latencyMs}ms` : ""}.`,
      };
    }

    case "required_secrets_missing": {
      // Only trigger based on explicitly configured requiredKeys in the rule.
      // The monitoring snapshot's missingKeys uses broad common-framework defaults
      // (TYPICAL_KEYS) which are informational only — do NOT use them here.
      const requiredKeys: string[] = (config.requiredKeys ?? [])
        .map((k) => k.trim().toUpperCase())
        .filter((k) => k.length > 0);

      if (requiredKeys.length === 0) {
        return {
          triggered: false,
          message:   "No project-defined required secret keys configured — skipped.",
        };
      }

      const configuredSet = new Set(snap.secrets.configuredKeyNames);
      const missing = requiredKeys.filter((k) => !configuredSet.has(k));

      if (missing.length > 0) {
        return {
          triggered: true,
          message:   `Missing required project secret key${missing.length !== 1 ? "s" : ""}: ${missing.join(", ")}.`,
        };
      }
      return {
        triggered: false,
        message:   `All ${requiredKeys.length} required secret key${requiredKeys.length !== 1 ? "s" : ""} are present.`,
      };
    }

    case "domain_ssl_problem": {
      const activeDomains = snap.domains.filter(
        (d) => d.isPrimary || d.status === "ACTIVE",
      );
      if (activeDomains.length === 0) {
        return { triggered: false, message: "No active domains configured — skipped." };
      }
      const problems: string[] = [];
      for (const d of activeDomains) {
        if (d.sslStatus && ["FAILED", "NONE", "EXPIRED"].includes(d.sslStatus)) {
          problems.push(`${d.hostname} SSL ${d.sslStatus}`);
        } else if (d.httpStatus && d.httpStatus >= 400) {
          problems.push(`${d.hostname} HTTP ${d.httpStatus}`);
        } else if (d.error) {
          problems.push(`${d.hostname}: ${d.error}`);
        }
      }
      if (problems.length > 0) {
        return {
          triggered: true,
          message:   `Domain/SSL problem: ${problems.join("; ")}.`,
        };
      }
      return {
        triggered: false,
        message:   `All ${activeDomains.length} active domain${activeDomains.length !== 1 ? "s" : ""} OK.`,
      };
    }

    case "recent_deployment_failed": {
      const {
        unresolvedDeploymentFailure,
        lastDeploymentStatus,
        recentFailureCount,
        lastSuccessfulDeploymentAt,
      } = snap.deployments;

      if (lastDeploymentStatus == null && recentFailureCount === 0) {
        return { triggered: false, message: "No deployment history available." };
      }

      if (unresolvedDeploymentFailure) {
        // Most recent terminal deployment is failed — not resolved by a later success
        return {
          triggered: true,
          message:   lastSuccessfulDeploymentAt == null
            ? "Latest deployment failed — no successful deployment on record."
            : "Latest deployment failed. The most recent failure has not been followed by a successful deployment.",
        };
      }

      // Latest terminal deployment is successful — historical failures are resolved
      if (recentFailureCount > 0) {
        return {
          triggered: false,
          message:   `Latest deployment is successful. ${recentFailureCount} historical failure${recentFailureCount !== 1 ? "s" : ""} exist but do not require action.`,
        };
      }

      return {
        triggered: false,
        message:   `Latest deployment is successful (last status: ${lastDeploymentStatus ?? "—"}).`,
      };
    }

    case "high_memory": {
      if (!snap.pm2.configured || snap.pm2.memoryBytes == null) {
        return { triggered: false, message: "PM2 memory data unavailable — skipped." };
      }
      const thresholdMb = config.memoryMbThreshold ?? DEFAULT_THRESHOLDS.memoryMbThreshold;
      const thresholdBytes = thresholdMb * 1024 * 1024;
      const currentMb = snap.pm2.memoryBytes / 1024 / 1024;
      if (snap.pm2.memoryBytes > thresholdBytes) {
        return {
          triggered: true,
          message:   `Memory is ${currentMb.toFixed(0)} MB, above threshold ${thresholdMb} MB.`,
        };
      }
      return {
        triggered: false,
        message:   `Memory is ${currentMb.toFixed(0)} MB (threshold ${thresholdMb} MB).`,
      };
    }

    case "high_restart_count": {
      if (!snap.pm2.configured || snap.pm2.restartCount == null) {
        return { triggered: false, message: "PM2 restart count unavailable — skipped." };
      }
      const threshold = config.restartCountThreshold ?? DEFAULT_THRESHOLDS.restartCountThreshold;
      if (snap.pm2.restartCount > threshold) {
        return {
          triggered: true,
          message:   `Restart count is ${snap.pm2.restartCount}, above threshold ${threshold}.`,
        };
      }
      return {
        triggered: false,
        message:   `Restart count is ${snap.pm2.restartCount} (threshold ${threshold}).`,
      };
    }

    case "high_latency": {
      const epName = config.endpointName ?? "frontend";
      const ep = snap.endpoints.find((e) => e.name === epName);
      if (!ep || ep.latencyMs == null) {
        return {
          triggered: false,
          message:   `No latency data for ${epName} endpoint — skipped.`,
        };
      }
      const threshold = config.latencyMsThreshold ?? DEFAULT_THRESHOLDS.latencyMsThreshold;
      if (ep.latencyMs > threshold) {
        return {
          triggered: true,
          message:   `${epName} latency is ${ep.latencyMs}ms, above threshold ${threshold}ms.`,
        };
      }
      return {
        triggered: false,
        message:   `${epName} latency is ${ep.latencyMs}ms (threshold ${threshold}ms).`,
      };
    }

    default: {
      // Exhaustive type narrowing — should never reach here
      const _exhaustive: never = type;
      return { triggered: false, message: `Unknown rule type: ${String(_exhaustive)}.` };
    }
  }
}
