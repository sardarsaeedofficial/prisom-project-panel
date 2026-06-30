/**
 * lib/ai-import-agent/agent-error-classifier.ts
 *
 * Sprint 89: Classifies deployment/preview error text into a rich AgentError —
 * what happened, why, what the agent can do, and the fix safety level.
 * Pure function — no async, no DB, no side effects.
 */

import type { AgentError } from "./agent-run-types";

type Pattern = {
  patterns: RegExp[];
  build: () => AgentError;
};

const PATTERNS: Pattern[] = [
  // ── Panel preview proxy / panel DB unreachable ────────────────────────────
  // This is a PANEL-level failure (the proxy's own auth/workspace lookup),
  // not the imported app itself. The app may be running fine.
  {
    patterns: [/panel database is unreachable/i, /503.*service unavailable/i],
    build: () => ({
      kind: "panel_preview_proxy_db_unreachable",
      whatHappened: "The panel preview proxy returned 503 because it could not verify access to this project.",
      why: "The preview proxy depends on a panel-level database lookup for project/deployment metadata before it forwards your request to the app. That lookup failed, so the proxy never reached your app.",
      whatICanDo: "I'll verify the panel's database connection is healthy and retry the preview check.",
      fixSafetyLevel: "safe",
      safeFixAvailable: true,
      safeFixId: "refresh_panel_pm2_env_and_retry_preview",
      technicalReason: "Preview proxy auth/workspace lookup threw before reaching the upstream project port.",
    }),
  },

  // ── Cannot GET / ───────────────────────────────────────────────────────────
  {
    patterns: [/Cannot GET \//i, /404.*root/i],
    build: () => ({
      kind: "cannot_get_root",
      whatHappened: "Your API is working, but the frontend is not being served at /.",
      why: "The deployment is using fullstack routing instead of split API + static routing, so the static frontend build is never served.",
      whatICanDo: "I'll switch routing to static_plus_api and point it at your built frontend.",
      fixSafetyLevel: "safe",
      safeFixAvailable: true,
      safeFixId: "fix-static-frontend-routing",
      technicalReason: "Root path returns 'Cannot GET /' — static frontend is not wired into routing.",
    }),
  },

  // ── SPA route 404 ──────────────────────────────────────────────────────────
  {
    patterns: [/spa.*route.*404/i, /products.*404/i],
    build: () => ({
      kind: "spa_route_404",
      whatHappened: "Some frontend pages return 404 when loaded directly or refreshed.",
      why: "Client-side routes need a fallback to index.html so the browser router can take over — that fallback isn't enabled yet.",
      whatICanDo: "I'll enable SPA fallback for static routes.",
      fixSafetyLevel: "safe",
      safeFixAvailable: true,
      safeFixId: "fix-static-frontend-routing",
      technicalReason: "Non-root SPA routes 404 — missing SPA fallback to index.html.",
    }),
  },

  // ── API health failed ──────────────────────────────────────────────────────
  {
    patterns: [/api health failed/i, /health.*check.*failed/i, /healthz.*not.*found/i, /GET \/ failed/i],
    build: () => ({
      kind: "health_check_failed",
      whatHappened: "The app is not responding to health checks.",
      why: "Either the configured health path is wrong, or the app process isn't fully started yet.",
      whatICanDo: "I'll set the health path to /api/healthz and retry.",
      fixSafetyLevel: "safe",
      safeFixAvailable: true,
      safeFixId: "fix-health-path",
      technicalReason: "Configured healthPath does not return a successful response.",
    }),
  },

  // ── pnpm workspace required ────────────────────────────────────────────────
  {
    patterns: [/use pnpm instead/i, /npm.*install.*failed/i],
    build: () => ({
      kind: "npm_used_but_requires_pnpm",
      whatHappened: "The install step failed.",
      why: "This project is a pnpm workspace, but the install command used npm — npm cannot resolve a pnpm-workspace.yaml correctly.",
      whatICanDo: "I'll switch to pnpm with the approved safe flags and retry.",
      fixSafetyLevel: "safe",
      safeFixAvailable: true,
      safeFixId: "apply-sardar-preset",
      technicalReason: "Project has pnpm-workspace.yaml but the install command used npm.",
    }),
  },

  // ── ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL ──────────────────────────────────────
  {
    patterns: [/ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL/i],
    build: () => ({
      kind: "pnpm_recursive_run_first_fail",
      whatHappened: "One of the workspace packages failed during build.",
      why: "pnpm runs each workspace package's build script in turn, and one of them exited with an error.",
      whatICanDo: "I'll retry with the standard pnpm build sequence.",
      fixSafetyLevel: "safe",
      safeFixAvailable: true,
      safeFixId: "apply-sardar-preset",
      technicalReason: "ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL — a workspace package's build script exited non-zero.",
    }),
  },

  // ── vite command not found ─────────────────────────────────────────────────
  {
    patterns: [/vite:?\s*command not found/i, /'vite' is not recognized/i],
    build: () => ({
      kind: "vite_command_not_found",
      whatHappened: "The build tool (vite) wasn't found.",
      why: "Install likely ran with the wrong package manager, so workspace dependency binaries were never linked.",
      whatICanDo: "I'll reinstall with pnpm and retry the build.",
      fixSafetyLevel: "safe",
      safeFixAvailable: true,
      safeFixId: "apply-sardar-preset",
      technicalReason: "vite binary missing from node_modules/.bin.",
    }),
  },

  // ── node_modules missing ───────────────────────────────────────────────────
  {
    patterns: [/cannot find module/i, /node_modules.*not found/i, /MODULE_NOT_FOUND/],
    build: () => ({
      kind: "node_modules_missing",
      whatHappened: "Dependencies are missing.",
      why: "Install either didn't run, failed silently, or ran in the wrong directory.",
      whatICanDo: "I'll reinstall dependencies with the correct package manager.",
      fixSafetyLevel: "safe",
      safeFixAvailable: true,
      safeFixId: "apply-sardar-preset",
      technicalReason: "node_modules missing or incomplete — MODULE_NOT_FOUND at runtime.",
    }),
  },

  // ── install step failed ────────────────────────────────────────────────────
  {
    patterns: [/install step failed/i, /▶ Install:[\s\S]*exit code [1-9]/i],
    build: () => ({
      kind: "install_step_failed",
      whatHappened: "The install step failed.",
      why: "The configured install command exited with a non-zero status.",
      whatICanDo: "I'll rerun install with the approved pnpm settings.",
      fixSafetyLevel: "safe",
      safeFixAvailable: true,
      safeFixId: "apply-sardar-preset",
      technicalReason: "Install command exited non-zero.",
    }),
  },

  // ── build step failed ──────────────────────────────────────────────────────
  {
    patterns: [/build step failed/i, /▶ Build:[\s\S]*exit code [1-9]/i],
    build: () => ({
      kind: "build_step_failed",
      whatHappened: "The build step failed.",
      why: "The configured build command exited with a non-zero status.",
      whatICanDo: "I'll check the build command and retry.",
      fixSafetyLevel: "safe",
      safeFixAvailable: true,
      safeFixId: "apply-sardar-preset",
      technicalReason: "Build command exited non-zero.",
    }),
  },

  // ── port already in use ────────────────────────────────────────────────────
  {
    patterns: [/EADDRINUSE/i, /port already in use/i, /address already in use/i],
    build: () => ({
      kind: "port_already_in_use",
      whatHappened: "The app's port is already in use.",
      why: "A stale PM2 process for this same project is likely still holding the port from a previous deploy.",
      whatICanDo: "I'll restart the deployment to release the port.",
      fixSafetyLevel: "safe",
      safeFixAvailable: true,
      safeFixId: "retry-deploy",
      technicalReason: "EADDRINUSE — the assigned port is already bound.",
    }),
  },

  // ── PM2 process not online ─────────────────────────────────────────────────
  {
    patterns: [/pm2.*errored/i, /pm2.*process.*failed/i, /status.*errored/i, /pm2 process not online/i],
    build: () => ({
      kind: "pm2_process_not_online",
      whatHappened: "The app process crashed shortly after starting.",
      why: "PM2 reports the process as errored — the start command likely threw during boot.",
      whatICanDo: "I'll check the logs and retry the deployment.",
      fixSafetyLevel: "safe",
      safeFixAvailable: true,
      safeFixId: "retry-deploy",
      technicalReason: "PM2 reports the process status as errored shortly after start.",
    }),
  },

  // ── Missing DATABASE_URL ───────────────────────────────────────────────────
  {
    patterns: [/missing DATABASE_URL/i, /DATABASE_URL.*missing/i, /ECONNREFUSED.*5432/i],
    build: () => ({
      kind: "missing_database_url",
      whatHappened: "The app needs a database connection string.",
      why: "DATABASE_URL is not configured for this project, so the app cannot connect to its data store.",
      whatICanDo: "I need you to provide the Sardar app's DATABASE_URL — this is not the panel's own database.",
      fixSafetyLevel: "needs_approval",
      safeFixAvailable: false,
      technicalReason: "DATABASE_URL is not configured for this project.",
    }),
  },

  // ── Missing SESSION_SECRET ─────────────────────────────────────────────────
  {
    patterns: [/missing SESSION_SECRET/i, /SESSION_SECRET.*missing/i],
    build: () => ({
      kind: "missing_session_secret",
      whatHappened: "The app needs a session signing secret.",
      why: "SESSION_SECRET is not configured, so the app cannot sign or verify user sessions.",
      whatICanDo: "I need a SESSION_SECRET value from you — a long random string.",
      fixSafetyLevel: "needs_approval",
      safeFixAvailable: false,
      technicalReason: "SESSION_SECRET env var is not configured.",
    }),
  },

  // ── Missing Stripe env ─────────────────────────────────────────────────────
  {
    patterns: [/missing Stripe env/i, /STRIPE_SECRET_KEY.*missing/i, /STRIPE_WEBHOOK_SECRET.*missing/i],
    build: () => ({
      kind: "missing_stripe_env",
      whatHappened: "Payments are not configured.",
      why: "One or more STRIPE_* environment variables are missing.",
      whatICanDo: "I need your Stripe keys from the Stripe Dashboard before payments will work.",
      fixSafetyLevel: "needs_approval",
      safeFixAvailable: false,
      technicalReason: "One or more STRIPE_* env vars are missing.",
    }),
  },

  // ── Missing Cloudinary env ─────────────────────────────────────────────────
  {
    patterns: [/missing Cloudinary env/i, /CLOUDINARY_API_KEY.*missing/i],
    build: () => ({
      kind: "missing_cloudinary_env",
      whatHappened: "Media uploads are not configured.",
      why: "One or more CLOUDINARY_* environment variables are missing.",
      whatICanDo: "I need your Cloudinary keys before image/media uploads will work.",
      fixSafetyLevel: "needs_approval",
      safeFixAvailable: false,
      technicalReason: "One or more CLOUDINARY_* env vars are missing.",
    }),
  },
];

/** Classifies a block of deployment output / preview-check result text. */
export function classifyAgentError(text: string): AgentError | null {
  if (!text) return null;
  for (const p of PATTERNS) {
    if (p.patterns.some((re) => re.test(text))) {
      return p.build();
    }
  }
  return null;
}

/**
 * Fallback classification when no specific pattern matches but something
 * still clearly failed. Used so the console never shows a blank error card.
 */
export function classifyAgentErrorOrFallback(text: string, fallbackContext: string): AgentError {
  return (
    classifyAgentError(text) ?? {
      kind: "preview_proxy_runtime_error",
      whatHappened: `${fallbackContext} failed in a way I don't recognize yet.`,
      why: "The error doesn't match a known pattern.",
      whatICanDo: "Check the technical details below, or open Logs for the full output.",
      fixSafetyLevel: "needs_approval",
      safeFixAvailable: false,
      technicalReason: text.slice(0, 300),
    }
  );
}
