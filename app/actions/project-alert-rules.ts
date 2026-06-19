"use server";

/**
 * app/actions/project-alert-rules.ts
 *
 * Sprint 15: Server actions for managing alert rules and running manual evaluations.
 *
 * Safety:
 *  - Ownership verified before any read/write
 *  - Only touches alert rules belonging to the verified project
 *  - Evaluation is read-only (no PM2/deploy/rollback)
 *  - Never returns env var values, DATABASE_URL, or secrets
 *  - No automatic notifications — manual evaluation only
 */

import { revalidatePath }           from "next/cache";
import { db }                       from "@/lib/db";
import { requireProjectPermission } from "@/lib/auth/project-membership";
import { writeProjectAuditEvent }   from "@/lib/audit/project-audit";
import { getAuditRequestContext }   from "@/lib/audit/request-context";
import {
  evaluateProjectAlertRules,
  type EvaluationBatchResult,
} from "@/lib/projects/alert-evaluator";
import {
  type AlertRule,
  type AlertRuleType,
  type AlertSeverity,
  type AlertRuleConfig,
  type AlertEvaluationResult,
  DEFAULT_ALERT_RULES,
  isValidRuleType,
  isValidSeverity,
  validateRuleConfig,
} from "@/lib/projects/alert-rules";

// Note: types are NOT re-exported here. Client components must import types
// directly from lib/projects/alert-rules.ts (which has no server-only deps).

export type ActionResult<T = unknown> =
  | { ok: true;  data: T }
  | { ok: false; error: string; code?: string };

// ── Ownership guard ───────────────────────────────────────────────────────────

async function verifyOwnership(
  projectId: string,
): Promise<{ ok: true; userId: string; role: string } | { ok: false; error: string }> {
  // Sprint 17: alert rule management requires monitoring.manage permission
  const auth = await requireProjectPermission(projectId, "monitoring.manage");
  if (!auth.ok) return { ok: false, error: auth.error };
  // Sprint 18: include auth data for audit
  return { ok: true, userId: auth.userId, role: auth.role };
}

// ── Map DB row → AlertRule ────────────────────────────────────────────────────

function mapRule(row: {
  id:              string;
  projectId:       string;
  name:            string;
  type:            string;
  severity:        string;
  enabled:         boolean;
  config:          unknown;
  lastCheckedAt:   Date | null;
  lastStatus:      string | null;
  lastMessage:     string | null;
  lastTriggeredAt: Date | null;
  createdAt:       Date;
  updatedAt:       Date;
}): AlertRule {
  return {
    id:              row.id,
    projectId:       row.projectId,
    name:            row.name,
    type:            row.type as AlertRuleType,
    severity:        (row.severity as AlertSeverity) ?? "warning",
    enabled:         row.enabled,
    config:          (row.config as AlertRuleConfig) ?? {},
    lastCheckedAt:   row.lastCheckedAt?.toISOString() ?? null,
    lastStatus:      (row.lastStatus as AlertRule["lastStatus"]) ?? null,
    lastMessage:     row.lastMessage,
    lastTriggeredAt: row.lastTriggeredAt?.toISOString() ?? null,
    createdAt:       row.createdAt.toISOString(),
    updatedAt:       row.updatedAt.toISOString(),
  };
}

// ── getProjectAlertRulesAction ────────────────────────────────────────────────

export async function getProjectAlertRulesAction(
  projectId: string,
): Promise<ActionResult<AlertRule[]>> {
  const auth = await verifyOwnership(projectId);
  if (!auth.ok) return { ok: false, error: auth.error, code: "FORBIDDEN" };

  const rows = await db.projectAlertRule.findMany({
    where:   { projectId },
    orderBy: { createdAt: "asc" },
  });

  return { ok: true, data: rows.map(mapRule) };
}

// ── createProjectAlertRuleAction ──────────────────────────────────────────────

export async function createProjectAlertRuleAction(input: {
  projectId: string;
  name:      string;
  type:      AlertRuleType;
  severity:  AlertSeverity;
  enabled?:  boolean;
  config?:   AlertRuleConfig;
}): Promise<ActionResult<AlertRule>> {
  const auth = await verifyOwnership(input.projectId);
  if (!auth.ok) return { ok: false, error: auth.error, code: "FORBIDDEN" };

  // Validate
  const name = input.name.trim();
  if (name.length < 3 || name.length > 80) {
    return { ok: false, error: "Name must be 3–80 characters.", code: "VALIDATION" };
  }
  if (!isValidRuleType(input.type)) {
    return { ok: false, error: `Invalid rule type: ${input.type}.`, code: "VALIDATION" };
  }
  if (!isValidSeverity(input.severity)) {
    return { ok: false, error: `Invalid severity: ${input.severity}.`, code: "VALIDATION" };
  }
  const configErr = validateRuleConfig(input.type, input.config ?? {});
  if (configErr) return { ok: false, error: configErr, code: "VALIDATION" };

  const row = await db.projectAlertRule.create({
    data: {
      projectId: input.projectId,
      name,
      type:     input.type,
      severity: input.severity,
      enabled:  input.enabled ?? true,
      config:   (input.config ?? {}) as object,
    },
  });

  revalidatePath(`/projects/${input.projectId}/monitoring`);

  // Sprint 18: audit
  const ctx = await getAuditRequestContext();
  void writeProjectAuditEvent({
    projectId: input.projectId,
    actorUserId: auth.userId,
    actorRole: auth.role,
    action: "alerts.rule.created",
    category: "alerts",
    result: "success",
    targetType: "alert_rule",
    targetId: row.id,
    targetLabel: name,
    summary: `Alert rule created: "${name}" (${input.type}, ${input.severity})`,
    metadata: { type: input.type, severity: input.severity, enabled: input.enabled ?? true },
    ...ctx,
  });

  return { ok: true, data: mapRule(row) };
}

// ── updateProjectAlertRuleAction ──────────────────────────────────────────────

export async function updateProjectAlertRuleAction(input: {
  projectId: string;
  ruleId:    string;
  name?:     string;
  severity?: AlertSeverity;
  enabled?:  boolean;
  config?:   AlertRuleConfig;
}): Promise<ActionResult<AlertRule>> {
  const auth = await verifyOwnership(input.projectId);
  if (!auth.ok) return { ok: false, error: auth.error, code: "FORBIDDEN" };

  // Verify rule belongs to this project
  const existing = await db.projectAlertRule.findUnique({
    where: { id: input.ruleId },
  });
  if (!existing || existing.projectId !== input.projectId) {
    return { ok: false, error: "Alert rule not found.", code: "NOT_FOUND" };
  }

  // Validate inputs
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (name.length < 3 || name.length > 80) {
      return { ok: false, error: "Name must be 3–80 characters.", code: "VALIDATION" };
    }
  }
  if (input.severity !== undefined && !isValidSeverity(input.severity)) {
    return { ok: false, error: `Invalid severity: ${input.severity}.`, code: "VALIDATION" };
  }
  if (input.config !== undefined) {
    const configErr = validateRuleConfig(existing.type as AlertRuleType, input.config);
    if (configErr) return { ok: false, error: configErr, code: "VALIDATION" };
  }

  const updated = await db.projectAlertRule.update({
    where: { id: input.ruleId },
    data: {
      ...(input.name     !== undefined ? { name:     input.name.trim() } : {}),
      ...(input.severity !== undefined ? { severity: input.severity }   : {}),
      ...(input.enabled  !== undefined ? { enabled:  input.enabled  }   : {}),
      ...(input.config   !== undefined ? { config:   input.config as object } : {}),
    },
  });

  revalidatePath(`/projects/${input.projectId}/monitoring`);

  // Sprint 18: audit
  const ctx = await getAuditRequestContext();
  void writeProjectAuditEvent({
    projectId: input.projectId,
    actorUserId: auth.userId,
    actorRole: auth.role,
    action: "alerts.rule.updated",
    category: "alerts",
    result: "success",
    targetType: "alert_rule",
    targetId: input.ruleId,
    targetLabel: updated.name,
    summary: `Alert rule updated: "${updated.name}"`,
    metadata: {
      name: input.name?.trim(),
      severity: input.severity,
      enabled: input.enabled,
    },
    ...ctx,
  });

  return { ok: true, data: mapRule(updated) };
}

// ── deleteProjectAlertRuleAction ──────────────────────────────────────────────

export async function deleteProjectAlertRuleAction(input: {
  projectId: string;
  ruleId:    string;
}): Promise<ActionResult<{ deleted: true }>> {
  const auth = await verifyOwnership(input.projectId);
  if (!auth.ok) return { ok: false, error: auth.error, code: "FORBIDDEN" };

  const existing = await db.projectAlertRule.findUnique({
    where:  { id: input.ruleId },
    select: { id: true, projectId: true },
  });
  if (!existing || existing.projectId !== input.projectId) {
    return { ok: false, error: "Alert rule not found.", code: "NOT_FOUND" };
  }

  await db.projectAlertRule.delete({ where: { id: input.ruleId } });

  revalidatePath(`/projects/${input.projectId}/monitoring`);

  // Sprint 18: audit
  const ctx = await getAuditRequestContext();
  void writeProjectAuditEvent({
    projectId: input.projectId,
    actorUserId: auth.userId,
    actorRole: auth.role,
    action: "alerts.rule.deleted",
    category: "alerts",
    result: "success",
    targetType: "alert_rule",
    targetId: input.ruleId,
    summary: `Alert rule deleted`,
    metadata: { ruleId: input.ruleId },
    ...ctx,
  });

  return { ok: true, data: { deleted: true } };
}

// ── evaluateProjectAlertRulesAction ──────────────────────────────────────────

export async function evaluateProjectAlertRulesAction(input: {
  projectId:    string;
  environment?: "production" | "preview" | "development";
  ruleIds?:     string[];
}): Promise<ActionResult<EvaluationBatchResult>> {
  const auth = await verifyOwnership(input.projectId);
  if (!auth.ok) return { ok: false, error: auth.error, code: "FORBIDDEN" };

  // Verify any supplied ruleIds belong to this project
  if (input.ruleIds && input.ruleIds.length > 0) {
    const owned = await db.projectAlertRule.findMany({
      where:  { id: { in: input.ruleIds }, projectId: input.projectId },
      select: { id: true },
    });
    const ownedIds = new Set(owned.map((r) => r.id));
    const bad = input.ruleIds.filter((id) => !ownedIds.has(id));
    if (bad.length > 0) {
      return { ok: false, error: "One or more rule IDs not found.", code: "NOT_FOUND" };
    }
  }

  const result = await evaluateProjectAlertRules({
    projectId:   input.projectId,
    environment: input.environment,
    ruleIds:     input.ruleIds,
    persist:     true,
  });

  if (result.ok) {
    revalidatePath(`/projects/${input.projectId}/monitoring`);
  }
  return result;
}

// ── createDefaultProjectAlertRulesAction ─────────────────────────────────────

export async function createDefaultProjectAlertRulesAction(
  projectId: string,
): Promise<ActionResult<{ created: number }>> {
  const auth = await verifyOwnership(projectId);
  if (!auth.ok) return { ok: false, error: auth.error, code: "FORBIDDEN" };

  // Only create rules that don't already exist for this project
  const existing = await db.projectAlertRule.findMany({
    where:  { projectId },
    select: { type: true },
  });
  const existingTypes = new Set(existing.map((r) => r.type));

  const toCreate = DEFAULT_ALERT_RULES.filter((t) => !existingTypes.has(t.type));
  if (toCreate.length === 0) {
    return { ok: true, data: { created: 0 } };
  }

  await db.projectAlertRule.createMany({
    data: toCreate.map((t) => ({
      projectId,
      name:     t.name,
      type:     t.type,
      severity: t.severity,
      enabled:  true,
      config:   t.config as object,
    })),
  });

  revalidatePath(`/projects/${projectId}/monitoring`);
  return { ok: true, data: { created: toCreate.length } };
}
