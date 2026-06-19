"use server";

/**
 * app/actions/project-alert-settings.ts
 *
 * Sprint 16: Server actions for alert scheduler settings + scheduled checks.
 *
 * Safety:
 *  - Ownership verified before any read/write
 *  - Never returns env var values, DATABASE_URL, or secrets
 *  - Notification email is masked in all returned data
 *  - Minimum interval enforced: 5 minutes
 *  - Cooldown validated: 5–1440 minutes
 *  - Scheduled checks reuse Sprint 14/15 read-only monitoring logic
 *  - Manual "Sprint 15" evaluation still works unchanged — no notifications
 *  - Types NOT re-exported here; client must import from lib/projects/alert-rules.ts
 */

import { revalidatePath }                           from "next/cache";
import { getCurrentWorkspaceId }                    from "@/lib/current-workspace";
import { db }                                       from "@/lib/db";
import {
  runScheduledAlertCheckForProject,
  sendTestNotificationForProject,
}                                                   from "@/lib/projects/alert-scheduler";
import {
  type AlertSettings,
  type AlertNotificationRecord,
  type ScheduledCheckResult,
  isValidDeliveryMode,
  isValidInterval,
} from "@/lib/projects/alert-rules";
import { maskEmail }                                from "@/lib/projects/alert-notifications";

// ── Local ActionResult (not re-exported as runtime value) ─────────────────────

export type ActionResult<T = unknown> =
  | { ok: true;  data: T }
  | { ok: false; error: string; code?: string };

// ── Ownership guard ───────────────────────────────────────────────────────────

async function verifyOwnership(
  projectId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const workspaceId = await getCurrentWorkspaceId().catch(() => null);
  if (!workspaceId) return { ok: false, error: "Not authenticated." };

  const project = await db.project.findUnique({
    where:  { id: projectId },
    select: { id: true, workspaceId: true },
  });
  if (!project || project.workspaceId !== workspaceId) {
    return { ok: false, error: "Project not found." };
  }
  return { ok: true };
}

// ── Map DB row → AlertSettings ────────────────────────────────────────────────

function mapSettings(row: {
  id:                    string;
  projectId:             string;
  schedulerEnabled:      boolean;
  intervalMinutes:       number;
  deliveryMode:          string;
  notificationEmail:     string | null;
  notifyOnRecovery:      boolean;
  repeatCooldownMinutes: number;
  lastRunAt:             Date | null;
  nextRunAt:             Date | null;
  lastStatus:            string | null;
  lastTriggeredCount:    number;
  lastNotificationStatus: string | null;
  createdAt:             Date;
  updatedAt:             Date;
}): AlertSettings {
  return {
    id:                    row.id,
    projectId:             row.projectId,
    schedulerEnabled:      row.schedulerEnabled,
    intervalMinutes:       row.intervalMinutes,
    deliveryMode:          (isValidDeliveryMode(row.deliveryMode) ? row.deliveryMode : "log_only") as AlertSettings["deliveryMode"],
    // Never return the raw email — always masked in API responses
    notificationEmail:     row.notificationEmail ? maskEmail(row.notificationEmail) : null,
    notifyOnRecovery:      row.notifyOnRecovery,
    repeatCooldownMinutes: row.repeatCooldownMinutes,
    lastRunAt:             row.lastRunAt?.toISOString()  ?? null,
    nextRunAt:             row.nextRunAt?.toISOString()  ?? null,
    lastStatus:            row.lastStatus,
    lastTriggeredCount:    row.lastTriggeredCount,
    lastNotificationStatus: row.lastNotificationStatus,
    createdAt:             row.createdAt.toISOString(),
    updatedAt:             row.updatedAt.toISOString(),
  };
}

function mapNotification(row: {
  id:              string;
  projectId:       string;
  channel:         string;
  deliveryMode:    string;
  status:          string;
  recipientMasked: string | null;
  subject:         string | null;
  messagePreview:  string | null;
  triggeredCount:  number;
  source:          string;
  error:           string | null;
  createdAt:       Date;
}): AlertNotificationRecord {
  return {
    id:              row.id,
    projectId:       row.projectId,
    channel:         row.channel,
    deliveryMode:    row.deliveryMode,
    status:          row.status,
    recipientMasked: row.recipientMasked,
    subject:         row.subject,
    messagePreview:  row.messagePreview,
    triggeredCount:  row.triggeredCount,
    source:          row.source,
    error:           row.error,
    createdAt:       row.createdAt.toISOString(),
  };
}

// ── getProjectAlertSettingsAction ─────────────────────────────────────────────

/**
 * Load (or lazily create) the alert settings for a project.
 * The notificationEmail is always masked in the returned data.
 */
export async function getProjectAlertSettingsAction(
  projectId: string,
): Promise<ActionResult<AlertSettings>> {
  const auth = await verifyOwnership(projectId);
  if (!auth.ok) return { ok: false, error: auth.error, code: "FORBIDDEN" };

  let row = await db.projectAlertSettings.findUnique({ where: { projectId } });

  // Lazy create defaults: scheduler disabled, log_only, 15 min interval
  if (!row) {
    row = await db.projectAlertSettings.create({ data: { projectId } });
  }

  return { ok: true, data: mapSettings(row) };
}

// ── updateProjectAlertSettingsAction ─────────────────────────────────────────

export async function updateProjectAlertSettingsAction(input: {
  projectId:             string;
  schedulerEnabled?:     boolean;
  intervalMinutes?:      number;
  deliveryMode?:         "log_only" | "email_dry_run" | "email";
  /** Raw email — stored encrypted at rest (plain in this simple schema); never returned. */
  notificationEmail?:    string | null;
  notifyOnRecovery?:     boolean;
  repeatCooldownMinutes?: number;
}): Promise<ActionResult<AlertSettings>> {
  const auth = await verifyOwnership(input.projectId);
  if (!auth.ok) return { ok: false, error: auth.error, code: "FORBIDDEN" };

  // ── Validate inputs ────────────────────────────────────────────────────────
  if (
    input.intervalMinutes !== undefined &&
    !isValidInterval(input.intervalMinutes)
  ) {
    return {
      ok: false,
      error: `Invalid interval. Allowed: 5, 10, 15, 30, 60 minutes.`,
      code: "VALIDATION",
    };
  }

  if (
    input.deliveryMode !== undefined &&
    !isValidDeliveryMode(input.deliveryMode)
  ) {
    return {
      ok: false,
      error: "Invalid delivery mode.",
      code: "VALIDATION",
    };
  }

  if (input.notificationEmail !== undefined && input.notificationEmail !== null) {
    const email = input.notificationEmail.trim();
    if (email.length > 0 && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return {
        ok: false,
        error: "Invalid email address.",
        code: "VALIDATION",
      };
    }
    if (email.length > 320) {
      return {
        ok: false,
        error: "Email address too long.",
        code: "VALIDATION",
      };
    }
  }

  if (
    input.repeatCooldownMinutes !== undefined &&
    (input.repeatCooldownMinutes < 5 || input.repeatCooldownMinutes > 1440)
  ) {
    return {
      ok: false,
      error: "Cooldown must be between 5 and 1440 minutes.",
      code: "VALIDATION",
    };
  }

  // ── Upsert ─────────────────────────────────────────────────────────────────
  const data: Record<string, unknown> = {};
  if (input.schedulerEnabled      !== undefined) data.schedulerEnabled      = input.schedulerEnabled;
  if (input.intervalMinutes       !== undefined) data.intervalMinutes       = input.intervalMinutes;
  if (input.deliveryMode          !== undefined) data.deliveryMode          = input.deliveryMode;
  if (input.notificationEmail     !== undefined) {
    data.notificationEmail = input.notificationEmail?.trim() || null;
  }
  if (input.notifyOnRecovery      !== undefined) data.notifyOnRecovery      = input.notifyOnRecovery;
  if (input.repeatCooldownMinutes !== undefined) data.repeatCooldownMinutes = input.repeatCooldownMinutes;

  // If scheduler is being enabled and there's no nextRunAt, set an initial one
  if (input.schedulerEnabled === true) {
    const existing = await db.projectAlertSettings.findUnique({
      where:  { projectId: input.projectId },
      select: { nextRunAt: true, intervalMinutes: true },
    });
    if (!existing?.nextRunAt) {
      const mins = input.intervalMinutes ?? existing?.intervalMinutes ?? 15;
      data.nextRunAt = new Date(Date.now() + mins * 60 * 1000);
    }
  }

  const row = await db.projectAlertSettings.upsert({
    where:  { projectId: input.projectId },
    create: { projectId: input.projectId, ...data },
    update: data,
  });

  revalidatePath(`/projects/${input.projectId}/monitoring`);
  return { ok: true, data: mapSettings(row) };
}

// ── runScheduledAlertCheckNowAction ──────────────────────────────────────────

/**
 * Manually trigger a scheduled-style alert check for a project.
 *
 * Differences from the Sprint 15 manual check:
 *  - Uses scheduler pipeline (evaluates + computes cooldown + records notification)
 *  - Applies delivery mode (log_only/email_dry_run/email)
 *  - Records in ProjectAlertNotification
 *  - Does NOT advance nextRunAt (it's a test run, not a scheduled run)
 *
 * Still does NOT restart PM2, rollback, or deploy anything.
 */
export async function runScheduledAlertCheckNowAction(input: {
  projectId: string;
}): Promise<ActionResult<ScheduledCheckResult>> {
  const auth = await verifyOwnership(input.projectId);
  if (!auth.ok) return { ok: false, error: auth.error, code: "FORBIDDEN" };

  const result = await runScheduledAlertCheckForProject({
    projectId: input.projectId,
    reason:    "manual_scheduler_test",
  });

  if (result.ok) {
    revalidatePath(`/projects/${input.projectId}/monitoring`);
  }
  return result;
}

// ── sendTestAlertNotificationAction ──────────────────────────────────────────

/**
 * Send a test notification using the current delivery settings.
 * Uses a safe test message — no real alert content.
 * Records the attempt in ProjectAlertNotification.
 */
export async function sendTestAlertNotificationAction(input: {
  projectId: string;
}): Promise<ActionResult<{ notificationStatus: string; message: string }>> {
  const auth = await verifyOwnership(input.projectId);
  if (!auth.ok) return { ok: false, error: auth.error, code: "FORBIDDEN" };

  const result = await sendTestNotificationForProject({ projectId: input.projectId });

  if (result.ok) {
    revalidatePath(`/projects/${input.projectId}/monitoring`);
  }
  return result;
}

// ── getRecentAlertNotificationsAction ────────────────────────────────────────

/** Fetch the last N notification attempt records for a project. */
export async function getRecentAlertNotificationsAction(input: {
  projectId: string;
  limit?:    number;
}): Promise<ActionResult<AlertNotificationRecord[]>> {
  const auth = await verifyOwnership(input.projectId);
  if (!auth.ok) return { ok: false, error: auth.error, code: "FORBIDDEN" };

  const rows = await db.projectAlertNotification.findMany({
    where:   { projectId: input.projectId },
    orderBy: { createdAt: "desc" },
    take:    Math.min(input.limit ?? 20, 50),
  });

  return { ok: true, data: rows.map(mapNotification) };
}

// ── getRecentScheduledEvaluationsAction ──────────────────────────────────────

/** Fetch recent evaluation records from scheduled or manual-scheduler-test runs. */
export async function getRecentScheduledEvaluationsAction(input: {
  projectId: string;
  limit?:    number;
}): Promise<ActionResult<{
  ruleId:    string | null;
  ruleName:  string | null;
  type:      string;
  severity:  string;
  status:    string;
  message:   string;
  source:    string;
  createdAt: string;
}[]>> {
  const auth = await verifyOwnership(input.projectId);
  if (!auth.ok) return { ok: false, error: auth.error, code: "FORBIDDEN" };

  const rows = await db.projectAlertEvaluation.findMany({
    where: {
      projectId: input.projectId,
      source:    { in: ["scheduled", "manual_scheduler_test"] },
    },
    orderBy: { createdAt: "desc" },
    take:    Math.min(input.limit ?? 30, 100),
    select: {
      ruleId:    true,
      ruleName:  true,
      type:      true,
      severity:  true,
      status:    true,
      message:   true,
      source:    true,
      createdAt: true,
    },
  });

  return {
    ok: true,
    data: rows.map((r) => ({
      ruleId:    r.ruleId,
      ruleName:  r.ruleName,
      type:      r.type,
      severity:  r.severity,
      status:    r.status,
      message:   r.message,
      source:    r.source,
      createdAt: r.createdAt.toISOString(),
    })),
  };
}
