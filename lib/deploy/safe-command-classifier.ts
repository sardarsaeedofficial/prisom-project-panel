/**
 * lib/deploy/safe-command-classifier.ts
 *
 * Sprint 53: Classify deployment commands as safe, warning, or blocked.
 *
 * Safety rules:
 *  - blocked commands must never be auto-executed
 *  - warning commands require explicit user review
 *  - safe commands may still be read-only validated (not executed in dry run)
 */

export type CommandSafety = "safe" | "warning" | "blocked";

export type CommandClassification = {
  safety:   CommandSafety;
  reason:   string;
  matched?: string;
};

// ── Blocked patterns ──────────────────────────────────────────────────────────
// These commands must never be auto-executed; they can cause data loss or
// take down live infrastructure.

const BLOCKED_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /rm\s+-rf\s+\//, reason: "Destructive rm -rf / detected" },
  { pattern: /mkfs/,           reason: "Filesystem format command detected" },
  { pattern: /\bshutdown\b/,   reason: "System shutdown command detected" },
  { pattern: /\breboot\b/,     reason: "System reboot command detected" },
  { pattern: /\bsudo\b/,       reason: "sudo usage not allowed in automated commands" },
  { pattern: /\bsystemctl\b/,  reason: "systemctl not allowed; use PM2 for service management" },
  { pattern: /service\s+nginx/, reason: "nginx service management not allowed in dry run" },
  { pattern: /nginx\s+-s\b/,   reason: "nginx signal (reload/stop) not allowed in dry run" },
  { pattern: /docker\s+system\s+prune/, reason: "Docker prune is destructive" },
  { pattern: /drop\s+database/i,        reason: "Database drop is destructive" },
  { pattern: /prisma\s+migrate\s+reset/, reason: "prisma migrate reset resets the database" },
  { pattern: /drizzle-kit\s+drop/,       reason: "drizzle-kit drop is destructive" },
  { pattern: /pm2\s+(restart|stop|delete|kill)\b/, reason: "PM2 process management not allowed in dry run" },
];

// ── Warning patterns ──────────────────────────────────────────────────────────
// These commands mutate the database or run migrations; require user review.

const WARNING_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /prisma\s+db\s+push/,       reason: "prisma db push applies schema changes to the database" },
  { pattern: /prisma\s+migrate\s+deploy/, reason: "prisma migrate deploy runs pending migrations" },
  { pattern: /drizzle-kit\s+push/,        reason: "drizzle-kit push applies schema changes" },
  { pattern: /\bseed\b/,                  reason: "Seed scripts may mutate the database" },
  { pattern: /\bmigration\b/,             reason: "Migration commands should be reviewed carefully" },
];

// ── Classifier ────────────────────────────────────────────────────────────────

export function classifyCommand(command: string | null | undefined): CommandClassification {
  if (!command || command.trim() === "") {
    return { safety: "safe", reason: "No command" };
  }

  const normalized = command.trim().toLowerCase();

  for (const { pattern, reason } of BLOCKED_PATTERNS) {
    if (pattern.test(normalized)) {
      return { safety: "blocked", reason, matched: pattern.source };
    }
  }

  for (const { pattern, reason } of WARNING_PATTERNS) {
    if (pattern.test(normalized)) {
      return { safety: "warning", reason, matched: pattern.source };
    }
  }

  return { safety: "safe", reason: "Command appears safe for dry-run validation" };
}

export function isSafeInstallCommand(command: string | null | undefined): boolean {
  if (!command) return false;
  const norm = command.trim().toLowerCase();
  return (
    /^pnpm\s+install/.test(norm) ||
    /^npm\s+(install|ci)/.test(norm) ||
    /^yarn\s+install/.test(norm) ||
    /^yarn$/.test(norm)
  );
}

export function isSafeBuildCommand(command: string | null | undefined): boolean {
  if (!command) return false;
  const cls = classifyCommand(command);
  return cls.safety !== "blocked";
}
