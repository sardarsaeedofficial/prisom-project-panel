/**
 * lib/projects/alert-scheduler.ts
 *
 * Sprint 16: Background scheduler for periodic per-project alert checks.
 *
 * Safety rules (identical to Sprint 14/15):
 *  - Read-only: no PM2 restart / deploy / rollback
 *  - Never exposes secrets, DATABASE_URL, or API keys
 *  - Only inspects each project's own configured PM2 process
 *  - Individual project failures do not crash the scheduler loop
 *  - Uses in-memory singleton guard (no duplicate instances)
 *  - Maximum 5 projects evaluated per tick
 *  - Minimum interval: 5 minutes per project
 *  - Notification delivery respects cooldown to avoid spam
 *
 * The scheduler runs inside the panel's Node.js process (prisom-projects).
 * It is started once from instrumentation.ts when the server boots.
 * It does NOT spawn external processes, modify crontab, or require root.
 */

import { db }                          from "@/lib/db";
import { evaluateProjectAlertRules }   from "@/lib/projects/alert-evaluator";
import {
  renderAlertNotification,
  renderTestNotification,
  deliverAlertNotification,
  maskEmail,
}                                      from "@/lib/projects/alert-notifications";
import {
  type AlertDeliveryMode,
  type ScheduledCheckResult,
  type AlertSettings,
  isValidDeliveryMode,
  isValidInterval,
  ALERT_INTERVALS,
} from "@/lib/projects/alert-rules";
import type { ActionResult }           from "@/lib/projects/project-monitoring";

// ── Singleton guard ───────────────────────────────────────────────────────────

const globalForScheduler = globalThis as unknown as {
  __prisomAlertSchedulerStarted?: boolean;
};

/** Projects currently being evaluated — prevents overlapping runs. */
const runningProjectIds = new Set<string>();

/** Tick interval — how often we check which projects are due. */
const SCHEDULER_TICK_MS = 60_000; // 60 seconds

const MIN_INTERVAL_MINS = 5; // safety floor
const MAX_BATCH         = 5; // max projects per tick

// ── Public: start scheduler ───────────────────────────────────────────────────

/**
 * Start the background alert scheduler.
 *
 * Idempotent — safe to call multiple times (will only start once).
 * Should only be called from server-side code (instrumentation.ts).
 * Respects ALERT_SCHEDULER_ENABLED=false to disable in test/CI.
 */
export function startAlertScheduler(): void {
  if (globalForScheduler.__prisomAlertSchedulerStarted) {
    return; // already running
  }

  // Allow disabling via env var (useful for test/CI environments)
  if (process.env.ALERT_SCHEDULER_ENABLED === "false") {
    console.log("[alert-scheduler] disabled via ALERT_SCHEDULER_ENABLED=false");
    return;
  }

  // Skip during Next.js build phase (no DB connection expected)
  if (
    process.env.NEXT_PHASE === "phase-production-build" ||
    process.env.NEXT_PHASE === "phase-export"
  ) {
    return;
  }

  globalForScheduler.__prisomAlertSchedulerStarted = true;

  setInterval(() => {
    runDueProjectAlertChecks().catch((err: unknown) => {
      console.error("[alert-scheduler] tick error:", err);
    });
  }, SCHEDULER_TICK_MS);

  console.log("[alert-scheduler] started — tick every 60 s, minimum interval 5 min per project");
}

// ── Public: scheduler tick ────────────────────────────────────────────────────

/**
 * Find and evaluate all projects whose scheduled check is due.
 * Called once per tick. Individual project failures are captured without
 * aborting the rest of the batch.
 */
export async function runDueProjectAlertChecks(): Promise<{
  checkedProjects:   number;
  triggeredProjects: number;
  errors:            number;
}> {
  const now = new Date();

  const dueSettings = await db.projectAlertSettings.findMany({
    where: {
      schedulerEnabled: true,
      nextRunAt:        { lte: now },
    },
    take:    MAX_BATCH,
    orderBy: { nextRunAt: "asc" },
    select:  { projectId: true },
  }).catch((err: unknown) => {
    console.error("[alert-scheduler] failed to query due settings:", err);
    return [];
  });

  if (dueSettings.length === 0) return { checkedProjects: 0, triggeredProjects: 0, errors: 0 };

  let triggeredProjects = 0;
  let errors            = 0;

  // Filter out projects already being evaluated (overlap guard)
  const toRun = dueSettings.filter((s) => !runningProjectIds.has(s.projectId));

  await Promise.allSettled(
    toRun.map(async (s) => {
      runningProjectIds.add(s.projectId);
      try {
        const res = await runScheduledAlertCheckForProject({
          projectId: s.projectId,
          reason:    "scheduled",
        });
        if (res.ok && res.data.triggeredCount > 0) {
          triggeredProjects++;
        }
      } catch (err: unknown) {
        console.error(
          `[alert-scheduler] error checking project ${s.projectId}:`,
          err,
        );
        errors++;

        // Record error in settings so the UI can show it
        await db.projectAlertSettings.update({
          where: { projectId: s.projectId },
          data: {
            lastRunAt:  now,
            nextRunAt:  computeNextRunAt(now, MIN_INTERVAL_MINS),
            lastStatus: "error",
            lastNotificationStatus: "eval_failed",
          },
        }).catch(() => null);
      } finally {
        runningProjectIds.delete(s.projectId);
      }
    }),
  );

  return {
    checkedProjects:   toRun.length,
    triggeredProjects,
    errors,
  };
}

// ── Public: per-project scheduled check ──────────────────────────────────────

/**
 * Run a full scheduled-style alert check for a single project.
 *
 * - Evaluates all enabled alert rules (persisted to DB)
 * - Computes notification decision (cooldown, delivery mode)
 * - Creates a ProjectAlertNotification record
 * - Updates ProjectAlertSettings (lastRunAt, nextRunAt, etc.)
 *
 * Used by:
 *  - The scheduler tick (reason="scheduled")
 *  - The "Run scheduled check now" UI action (reason="manual_scheduler_test")
 */
export async function runScheduledAlertCheckForProject(input: {
  projectId: string;
  reason:    "scheduled" | "manual_scheduler_test";
}): Promise<ActionResult<ScheduledCheckResult>> {
  const { projectId, reason } = input;

  const settings = await getOrCreateAlertSettings(projectId);
  const now      = new Date();
  const env      = "production" as const;

  // ── 1. Evaluate alert rules ────────────────────────────────────────────────
  const evalResult = await evaluateProjectAlertRules({
    projectId,
    environment: env,
    persist:     true,
    source:      reason,
  });

  if (!evalResult.ok) {
    const nextRunAt = reason === "scheduled"
      ? computeNextRunAt(now, settings.intervalMinutes)
      : settings.nextRunAt;

    await db.projectAlertSettings.update({
      where: { projectId },
      data: {
        lastRunAt:              now,
        nextRunAt,
        lastStatus:             "error",
        lastNotificationStatus: "eval_failed",
      },
    }).catch(() => null);

    return evalResult; // forward error to caller
  }

  const { results, triggeredCount } = evalResult.data;
  const triggeredResults = results.filter((r) => r.triggered);

  // ── 2. Notification decision ───────────────────────────────────────────────
  let notificationStatus = "no_alerts";

  if (triggeredCount > 0) {
    const cooldownMs     = settings.repeatCooldownMinutes * 60 * 1000;
    const cooldownCutoff = new Date(now.getTime() - cooldownMs);

    // Look for a recent non-suppressed notification within the cooldown window
    const recentNotification = await db.projectAlertNotification.findFirst({
      where: {
        projectId,
        status:    { in: ["log_only", "dry_run_sent", "sent"] },
        createdAt: { gte: cooldownCutoff },
        source:    { in: ["scheduled", "manual_scheduler_test"] },
      },
      orderBy: { createdAt: "desc" },
    }).catch(() => null);

    if (recentNotification) {
      // Suppress: a notification was sent within the cooldown window
      notificationStatus = "suppressed_cooldown";

      await db.projectAlertNotification.create({
        data: {
          projectId,
          channel:       "log",
          deliveryMode:  settings.deliveryMode,
          status:        "suppressed_cooldown",
          triggeredCount,
          source:        reason,
          messagePreview:
            `Suppressed: cooldown active (last notified ` +
            `${recentNotification.createdAt.toISOString()}, ` +
            `cooldown ${settings.repeatCooldownMinutes}m).`,
        },
      }).catch(() => null);
    } else {
      // Attempt delivery
      const rendered = renderAlertNotification({
        projectName:      settings.projectName,
        projectSlug:      settings.projectSlug,
        triggeredResults,
        generatedAt:      now.toISOString(),
      });

      const delivery = await deliverAlertNotification({
        deliveryMode:      settings.deliveryMode as AlertDeliveryMode,
        notificationEmail: settings.notificationEmail,
        rendered,
      });

      notificationStatus = delivery.status;

      await db.projectAlertNotification.create({
        data: {
          projectId,
          channel:         settings.deliveryMode === "email" ? "email" : "log",
          deliveryMode:    settings.deliveryMode,
          status:          delivery.status,
          recipientMasked: settings.notificationEmail
            ? maskEmail(settings.notificationEmail)
            : null,
          subject:         rendered.subject,
          messagePreview:  rendered.text.slice(0, 500),
          triggeredCount,
          source:          reason,
          error:
            delivery.status === "failed" || delivery.status === "unavailable"
              ? delivery.message
              : null,
        },
      }).catch(() => null);
    }
  }

  // ── 3. Update settings ─────────────────────────────────────────────────────
  // Only advance nextRunAt for true scheduled runs; manual tests leave schedule intact
  const nextRunAt = reason === "scheduled"
    ? computeNextRunAt(now, settings.intervalMinutes)
    : settings.nextRunAt;

  await db.projectAlertSettings.update({
    where: { projectId },
    data: {
      lastRunAt:              now,
      nextRunAt,
      lastStatus:             triggeredCount > 0 ? "triggered" : "ok",
      lastTriggeredCount:     triggeredCount,
      lastNotificationStatus: notificationStatus,
    },
  }).catch(() => null);

  return {
    ok: true,
    data: {
      projectId,
      triggeredCount,
      notificationStatus,
      nextRunAt: nextRunAt?.toISOString() ?? null,
      environment: env,
      evaluationResults: results,
    },
  };
}

// ── Public: test notification ─────────────────────────────────────────────────

/**
 * Send a test notification using the current delivery settings for a project.
 * Never uses production alert content — uses a safe test message.
 * Records the attempt in ProjectAlertNotification.
 */
export async function sendTestNotificationForProject(input: {
  projectId: string;
}): Promise<ActionResult<{ notificationStatus: string; message: string }>> {
  const { projectId } = input;

  const settings = await getOrCreateAlertSettings(projectId);

  const rendered = renderTestNotification({
    projectName: settings.projectName,
    projectSlug: settings.projectSlug,
  });

  const delivery = await deliverAlertNotification({
    deliveryMode:      settings.deliveryMode as AlertDeliveryMode,
    notificationEmail: settings.notificationEmail,
    rendered,
  });

  await db.projectAlertNotification.create({
    data: {
      projectId,
      channel:         settings.deliveryMode === "email" ? "email" : "log",
      deliveryMode:    settings.deliveryMode,
      status:          delivery.status,
      recipientMasked: settings.notificationEmail
        ? maskEmail(settings.notificationEmail)
        : null,
      subject:         rendered.subject,
      messagePreview:  rendered.text.slice(0, 500),
      triggeredCount:  0,
      source:          "test",
      error:
        delivery.status === "failed" || delivery.status === "unavailable"
          ? delivery.message
          : null,
    },
  }).catch(() => null);

  return {
    ok: true,
    data: {
      notificationStatus: delivery.status,
      message:            delivery.message,
    },
  };
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function computeNextRunAt(from: Date, intervalMinutes: number): Date {
  const safeMins = Math.max(intervalMinutes, MIN_INTERVAL_MINS);
  return new Date(from.getTime() + safeMins * 60 * 1000);
}

interface SettingsContext {
  intervalMinutes:       number;
  deliveryMode:          string;
  notificationEmail:     string | null;
  repeatCooldownMinutes: number;
  nextRunAt:             Date | null;
  projectName:           string;
  projectSlug:           string;
}

async function getOrCreateAlertSettings(projectId: string): Promise<SettingsContext> {
  const [settingsRow, project] = await Promise.all([
    db.projectAlertSettings.findUnique({ where: { projectId } }),
    db.project.findUnique({
      where:  { id: projectId },
      select: { name: true, slug: true },
    }),
  ]);

  const projectName = project?.name ?? projectId;
  const projectSlug = project?.slug ?? projectId;

  if (settingsRow) {
    return {
      intervalMinutes:       settingsRow.intervalMinutes,
      deliveryMode:          settingsRow.deliveryMode,
      notificationEmail:     settingsRow.notificationEmail,
      repeatCooldownMinutes: settingsRow.repeatCooldownMinutes,
      nextRunAt:             settingsRow.nextRunAt,
      projectName,
      projectSlug,
    };
  }

  // Create default settings row lazily (schedulerEnabled defaults to false)
  await db.projectAlertSettings.create({
    data: { projectId },
  }).catch(() => null);

  return {
    intervalMinutes:       15,
    deliveryMode:          "log_only",
    notificationEmail:     null,
    repeatCooldownMinutes: 60,
    nextRunAt:             null,
    projectName,
    projectSlug,
  };
}

// Re-export types used by the settings actions so they don't need to reach into
// alert-notifications.ts directly
export type { DeliveryResult } from "@/lib/projects/alert-notifications";
