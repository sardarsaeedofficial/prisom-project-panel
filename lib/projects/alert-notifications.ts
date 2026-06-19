/**
 * lib/projects/alert-notifications.ts
 *
 * Sprint 16: Safe alert notification rendering and delivery.
 *
 * Safety rules:
 *  - Never includes env var values, DATABASE_URL, API keys, or secrets
 *  - Includes only: project name/slug, rule names, safe status messages, timestamp
 *  - Masks recipient email addresses in all logs and UI
 *  - "email" mode fails safely if no provider is configured
 *  - "log_only" mode never sends anything external
 *  - "email_dry_run" mode renders and records but never sends
 */

import type { AlertEvaluationResult, AlertDeliveryMode } from "@/lib/projects/alert-rules";

// ── Types ─────────────────────────────────────────────────────────────────────

export type RenderedNotification = {
  subject: string;
  text:    string;
};

export type DeliveryResult = {
  status:  "log_only" | "dry_run_sent" | "sent" | "failed" | "unavailable";
  message: string;
};

// ── Email masking ─────────────────────────────────────────────────────────────

export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at < 0) return "***";
  const local  = email.slice(0, at);
  const domain = email.slice(at + 1);
  // Show first char of local part only
  return `${local.slice(0, 1)}***@${domain}`;
}

// ── Notification rendering ────────────────────────────────────────────────────

export function renderAlertNotification(input: {
  projectName:      string;
  projectSlug:      string;
  triggeredResults: AlertEvaluationResult[];
  generatedAt:      string;
  monitoringUrl?:   string;
  recovery?:        boolean;
}): RenderedNotification {
  const {
    projectName,
    projectSlug,
    triggeredResults,
    generatedAt,
    monitoringUrl,
    recovery = false,
  } = input;

  const count  = triggeredResults.length;
  const prefix = recovery ? "[Prisom Recovery]" : "[Prisom Alert]";

  const subject = recovery
    ? `${prefix} ${projectName} — alerts resolved`
    : `${prefix} ${projectName} — ${count} alert${count !== 1 ? "s" : ""} triggered`;

  const lines: string[] = [
    subject,
    "=".repeat(subject.length),
    "",
    `Project : ${projectName} (${projectSlug})`,
    `Time    : ${new Date(generatedAt).toUTCString()}`,
    "",
  ];

  if (recovery) {
    lines.push("All previously triggered alerts have been resolved.");
    lines.push("No further action is needed at this time.");
  } else {
    lines.push(
      `${count} alert rule${count !== 1 ? "s" : ""} triggered:`,
      "",
    );
    for (const r of triggeredResults) {
      const sev = r.severity.toUpperCase().padEnd(8);
      // Truncate message to 200 chars — never include secret content
      const msg = r.message.slice(0, 200);
      lines.push(`  [${sev}] ${r.ruleName}`);
      lines.push(`           ${msg}`);
      lines.push("");
    }
  }

  if (monitoringUrl) {
    lines.push(`View monitoring dashboard:`);
    lines.push(`  ${monitoringUrl}`);
    lines.push("");
  }

  lines.push("─".repeat(60));
  lines.push("Sent by Prisom Project Panel.");
  lines.push("Background checks are read-only — they never deploy, restart,");
  lines.push("or rollback your app.");

  return { subject, text: lines.join("\n") };
}

export function renderTestNotification(input: {
  projectName: string;
  projectSlug: string;
}): RenderedNotification {
  const { projectName, projectSlug } = input;
  const subject = `[Prisom Test] ${projectName} — test notification`;
  const text = [
    subject,
    "=".repeat(subject.length),
    "",
    `Project : ${projectName} (${projectSlug})`,
    `Time    : ${new Date().toUTCString()}`,
    "",
    "This is a test notification from Prisom Project Panel.",
    "If you received this, your notification delivery is configured correctly.",
    "",
    "─".repeat(60),
    "Sent by Prisom Project Panel.",
    "Background checks are read-only — they never deploy, restart,",
    "or rollback your app.",
  ].join("\n");
  return { subject, text };
}

// ── Delivery ──────────────────────────────────────────────────────────────────

/** Email format validation (basic RFC check). */
function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * Deliver a notification according to the configured delivery mode.
 *
 * Safety:
 *  - log_only:      logs subject to server stdout, returns immediately
 *  - email_dry_run: validates recipient, logs, never sends
 *  - email:         attempts SMTP/Resend if provider env vars are set,
 *                   otherwise returns "unavailable" without crashing
 */
export async function deliverAlertNotification(input: {
  deliveryMode:      AlertDeliveryMode;
  notificationEmail: string | null;
  rendered:          RenderedNotification;
}): Promise<DeliveryResult> {
  const { deliveryMode, notificationEmail, rendered } = input;

  // ── log_only ─────────────────────────────────────────────────────────────
  if (deliveryMode === "log_only") {
    console.log(
      "[alert-notification] log_only |",
      rendered.subject,
    );
    return {
      status:  "log_only",
      message: "Logged only — no email sent.",
    };
  }

  // ── email_dry_run ─────────────────────────────────────────────────────────
  if (deliveryMode === "email_dry_run") {
    if (!notificationEmail) {
      return {
        status:  "failed",
        message: "Email dry-run failed: no recipient configured.",
      };
    }
    if (!isValidEmail(notificationEmail)) {
      return {
        status:  "failed",
        message: "Email dry-run failed: invalid recipient email address.",
      };
    }
    console.log(
      "[alert-notification] email_dry_run | to:",
      maskEmail(notificationEmail),
      "| subject:",
      rendered.subject,
    );
    return {
      status:  "dry_run_sent",
      message: "Dry-run rendered and logged — no email was sent.",
    };
  }

  // ── email ─────────────────────────────────────────────────────────────────
  if (deliveryMode === "email") {
    // Check for configured email provider
    const smtpHost = process.env.SMTP_HOST;
    const resendKey = process.env.RESEND_API_KEY;

    if (!smtpHost && !resendKey) {
      return {
        status:  "unavailable",
        message:
          "Email delivery unavailable: provider configuration missing. " +
          "Set SMTP_HOST or RESEND_API_KEY to enable email.",
      };
    }

    if (!notificationEmail) {
      return {
        status:  "failed",
        message: "Email send failed: no recipient configured.",
      };
    }
    if (!isValidEmail(notificationEmail)) {
      return {
        status:  "failed",
        message: "Email send failed: invalid recipient email address.",
      };
    }

    // Provider env vars are set but email integration not yet implemented.
    // Return unavailable rather than crash — this is safe and non-destructive.
    // TODO: Wire up SMTP (nodemailer) or Resend SDK once a provider package is added.
    console.log(
      "[alert-notification] email | provider detected but not yet wired |",
      "to:", maskEmail(notificationEmail),
      "| subject:", rendered.subject,
    );
    return {
      status:  "unavailable",
      message:
        "Email delivery unavailable: provider detected but email integration " +
        "not yet implemented. Add nodemailer or resend to package.json to enable.",
    };
  }

  return {
    status:  "failed",
    message: `Unknown delivery mode: ${deliveryMode}.`,
  };
}
