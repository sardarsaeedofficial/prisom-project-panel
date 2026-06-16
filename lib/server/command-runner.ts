/**
 * Safe server-side command runner.
 *
 * Uses execFile (never a raw shell string) to prevent shell injection.
 * All output is scrubbed of known secrets before being returned.
 *
 * IMPORTANT: Import this only from server-side code (server actions, route
 * handlers, lib/ modules called by those). Never import in client components.
 */

import { execFile } from "child_process";
import type { ExecFileException } from "child_process";

// ─── Secret scrubbing ─────────────────────────────────────────────────────────

const SECRET_PATTERNS: RegExp[] = [
  // Key=value pairs on a single line
  /DATABASE_URL\s*=\s*\S+/gi,
  /JWT_SECRET\s*=\s*\S+/gi,
  /JWT_ACCESS_SECRET\s*=\s*\S+/gi,
  /JWT_REFRESH_SECRET\s*=\s*\S+/gi,
  /SESSION_SECRET\s*=\s*\S+/gi,
  /NEXTAUTH_SECRET\s*=\s*\S+/gi,
  /ENCRYPTION_KEY\s*=\s*\S+/gi,
  /ENV_ENCRYPTION_KEY\s*=\s*\S+/gi,
  /STRIPE_SECRET_KEY\s*=\s*\S+/gi,
  /STRIPE_WEBHOOK_SECRET\s*=\s*\S+/gi,
  /STRIPE_PUBLISHABLE_KEY\s*=\s*\S+/gi,
  /VITE_STRIPE_PUBLISHABLE_KEY\s*=\s*\S+/gi,
  /CLOUDINARY_URL\s*=\s*\S+/gi,
  /CLOUDINARY_API_SECRET\s*=\s*\S+/gi,
  /CLOUDINARY_API_KEY\s*=\s*\S+/gi,
  /SMTP_PASS\s*=\s*\S+/gi,
  /SMTP_PASSWORD\s*=\s*\S+/gi,
  /R2_SECRET_ACCESS_KEY\s*=\s*\S+/gi,
  /FIREBASE_SERVICE_ACCOUNT\s*=\s*\S+/gi,
  /GITHUB_APP_PRIVATE_KEY\s*=\s*\S+/gi,
  /GITHUB_CLIENT_SECRET\s*=\s*\S+/gi,
  /GITHUB_WEBHOOK_SECRET\s*=\s*\S+/gi,
  /PROJECT_PANEL_ADMIN_PASSWORD\s*=\s*\S+/gi,
  // Any key ending in _SECRET, _KEY, _TOKEN, _PASSWORD, _PASS
  /\b\w+(?:_SECRET|_KEY|_TOKEN|_PASSWORD|_PASS)\s*=\s*\S+/gi,
  // Neon connection passwords (npg_ prefix)
  /npg_[A-Za-z0-9]+/g,
  // Full PostgreSQL/MySQL/Redis connection URLs (inline credentials)
  /(?:postgresql|postgres|mysql|redis):\/\/[^\s"'`]+/gi,
  // Generic bearer tokens / API keys in Authorization header style
  /Bearer\s+[A-Za-z0-9._~+\-=/]{20,}/gi,
  // Stripe keys (sk_live_, sk_test_, pk_live_, pk_test_, whsec_)
  /(?:sk|pk)_(?:live|test)_[A-Za-z0-9]{20,}/g,
  /whsec_[A-Za-z0-9]{20,}/g,
];

export function sanitizeOutput(text: string): string {
  return SECRET_PATTERNS.reduce(
    (s, pattern) => s.replace(pattern, "[REDACTED]"),
    text
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface RunOptions {
  /** Working directory for the command */
  cwd: string;
  /** Milliseconds before the child process is killed (default 30 000) */
  timeoutMs?: number;
  /** Extra environment variables merged on top of process.env */
  env?: Record<string, string>;
}

// ─── Runner ───────────────────────────────────────────────────────────────────

/**
 * Runs `executable` with `args` inside `options.cwd`.
 * Never goes through a shell — no shell injection risk.
 * Resolves (never rejects) with a RunResult; caller checks exitCode.
 */
export function runCommand(
  executable: string,
  args: string[],
  options: RunOptions
): Promise<RunResult> {
  const start = Date.now();

  return new Promise<RunResult>((resolve) => {
    execFile(
      executable,
      args,
      {
        cwd: options.cwd,
        timeout: options.timeoutMs ?? 30_000,
        maxBuffer: 10 * 1024 * 1024, // 10 MB
        encoding: "utf8",
        env: {
          ...process.env,
          ...options.env,
          // Suppress interactive git credential prompts
          GIT_TERMINAL_PROMPT: "0",
          GIT_ASKPASS: "echo",
        },
      },
      (err: ExecFileException | null, stdout: string, stderr: string) => {
        const durationMs = Date.now() - start;

        // Derive exit code: numeric code = process exit, string = OS error (e.g. ENOENT)
        let exitCode = 0;
        if (err) {
          const raw = (err as NodeJS.ErrnoException).code;
          exitCode = typeof raw === "number" ? raw : 1;
        }

        resolve({
          exitCode,
          stdout: sanitizeOutput(String(stdout ?? "")),
          stderr: sanitizeOutput(String(stderr ?? "")),
          durationMs,
        });
      }
    );
  });
}

// ─── Pipeline helper ──────────────────────────────────────────────────────────

export interface PipelineStep {
  label: string;
  cmd: string;
  args: string[];
  timeoutMs?: number;
}

export interface PipelineResult {
  success: boolean;
  output: string;
  durationMs: number;
}

/**
 * Runs an ordered list of commands, stopping at the first failure.
 * Returns a human-readable combined output log.
 */
export async function runPipeline(
  steps: PipelineStep[],
  cwd: string
): Promise<PipelineResult> {
  const lines: string[] = [];
  const pipelineStart = Date.now();

  for (const step of steps) {
    lines.push(`\n▶ ${step.label}`);

    const result = await runCommand(step.cmd, step.args, {
      cwd,
      timeoutMs: step.timeoutMs ?? 300_000,
    });

    if (result.stdout.trim()) lines.push(result.stdout.trimEnd());
    if (result.stderr.trim()) lines.push(result.stderr.trimEnd());

    if (result.exitCode !== 0) {
      lines.push(`✗ FAILED (exit ${result.exitCode})`);
      return {
        success: false,
        output: lines.join("\n"),
        durationMs: Date.now() - pipelineStart,
      };
    }

    lines.push("✓ done");
  }

  return {
    success: true,
    output: lines.join("\n"),
    durationMs: Date.now() - pipelineStart,
  };
}
