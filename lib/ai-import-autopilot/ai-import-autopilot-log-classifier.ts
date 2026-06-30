/**
 * lib/ai-import-autopilot/ai-import-autopilot-log-classifier.ts
 *
 * Sprint 88: Classifies deployment log / error text into a known failure kind.
 * Pure function — no async, no DB, no side effects.
 */

import type { LogClassification } from "./ai-import-autopilot-types";

type Pattern = {
  patterns: RegExp[];
  classification: LogClassification;
};

const PATTERNS: Pattern[] = [
  {
    patterns: [/npm.*install.*failed/i, /use pnpm instead/i, /pnpm-workspace\.yaml/i],
    classification: {
      kind:             "npm_used_but_requires_pnpm",
      userMessage:      "The build failed because dependency install scripts were blocked. I can safely rerun install with the approved pnpm settings.",
      safeFixAvailable: true,
      safeFixId:        "apply-sardar-preset",
      technicalReason:  "Project has a pnpm-workspace.yaml but the install command used npm.",
    },
  },
  {
    patterns: [/ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL/i],
    classification: {
      kind:             "pnpm_recursive_run_first_fail",
      userMessage:      "One of the workspace packages failed to build. I can retry with the standard pnpm build sequence.",
      safeFixAvailable: true,
      safeFixId:        "apply-sardar-preset",
      technicalReason:  "ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL — a workspace package's build script exited non-zero.",
    },
  },
  {
    patterns: [/ERR_PNPM_IGNORED_BUILDS/i, /postinstall.*conflict/i],
    classification: {
      kind:             "pnpm_ignored_builds",
      userMessage:      "Install completed but some build scripts were skipped for safety. This is expected — continuing.",
      safeFixAvailable: true,
      safeFixId:        "apply-sardar-preset",
      technicalReason:  "ERR_PNPM_IGNORED_BUILDS — --ignore-scripts intentionally skips postinstall scripts.",
    },
  },
  {
    patterns: [/vite:?\s*command not found/i, /'vite' is not recognized/i],
    classification: {
      kind:             "vite_command_not_found",
      userMessage:      "The build tool wasn't found, which usually means install used the wrong package manager. I can fix this automatically.",
      safeFixAvailable: true,
      safeFixId:        "apply-sardar-preset",
      technicalReason:  "vite binary missing from node_modules/.bin — install likely ran with the wrong package manager or in the wrong directory.",
    },
  },
  {
    patterns: [/cannot find module/i, /node_modules.*not found/i, /MODULE_NOT_FOUND/],
    classification: {
      kind:             "node_modules_missing",
      userMessage:      "Dependencies are missing. I'll reinstall them with the correct package manager.",
      safeFixAvailable: true,
      safeFixId:        "apply-sardar-preset",
      technicalReason:  "node_modules missing or incomplete — MODULE_NOT_FOUND at runtime.",
    },
  },
  {
    patterns: [/install step failed/i, /^▶ Install:.*\n.*exit code [1-9]/im],
    classification: {
      kind:             "install_step_failed",
      userMessage:      "The install step failed. I can safely rerun install with the approved pnpm settings.",
      safeFixAvailable: true,
      safeFixId:        "apply-sardar-preset",
      technicalReason:  "Install command exited non-zero.",
    },
  },
  {
    patterns: [/build step failed/i, /^▶ Build:.*\n.*exit code [1-9]/im],
    classification: {
      kind:             "build_step_failed",
      userMessage:      "The build step failed. I'll check the build command and retry.",
      safeFixAvailable: true,
      safeFixId:        "apply-sardar-preset",
      technicalReason:  "Build command exited non-zero.",
    },
  },
  {
    patterns: [/extra arguments are not allowed/i, /--enable-source-maps/i, /start command.*invalid/i],
    classification: {
      kind:             "start_command_invalid",
      userMessage:      "The start command used a flag that isn't allowed. I fixed it to use the standard start command.",
      safeFixAvailable: true,
      safeFixId:        "normalize-start-command",
      technicalReason:  "Start command failed the validator — likely --enable-source-maps or another disallowed flag.",
    },
  },
  {
    patterns: [/health.*path.*\/.*failed/i, /healthz.*not.*found/i, /health check.*404/i],
    classification: {
      kind:             "health_check_path_wrong",
      userMessage:      "The health check is pointing at the wrong path. I fixed it to use /api/healthz.",
      safeFixAvailable: true,
      safeFixId:        "fix-health-path",
      technicalReason:  "Configured healthPath does not return a successful response.",
    },
  },
  {
    patterns: [/Cannot GET \//i, /404.*root/i],
    classification: {
      kind:             "cannot_get_root",
      userMessage:      "The API is working, but the frontend is not being served at /. I can fix the routing automatically.",
      safeFixAvailable: true,
      safeFixId:        "fix-static-frontend-routing",
      technicalReason:  "Root path returns 'Cannot GET /' — static frontend is not wired into routing.",
    },
  },
  {
    patterns: [/spa.*route.*404/i, /products.*404/i],
    classification: {
      kind:             "spa_route_404",
      userMessage:      "Some frontend pages return 404 on refresh. I'll enable SPA fallback so client-side routes work.",
      safeFixAvailable: true,
      safeFixId:        "fix-static-frontend-routing",
      technicalReason:  "Non-root SPA routes 404 — missing SPA fallback to index.html.",
    },
  },
  {
    patterns: [/static.*output.*missing/i, /staticOutputDir.*not.*set/i, /dist.*not.*found/i],
    classification: {
      kind:             "static_output_missing",
      userMessage:      "The frontend build output directory isn't configured. I'll set it to the correct path.",
      safeFixAvailable: true,
      safeFixId:        "fix-static-output-path",
      technicalReason:  "staticOutputDir is unset or the build output directory does not exist on disk.",
    },
  },
  {
    patterns: [/api.*works.*frontend.*not.*served/i, /static.*not.*served/i],
    classification: {
      kind:             "api_works_frontend_not_served",
      userMessage:      "Your API is working, but the frontend is not being served. I can fix the routing automatically.",
      safeFixAvailable: true,
      safeFixId:        "fix-static-frontend-routing",
      technicalReason:  "API health check passes but the static frontend route is not wired up.",
    },
  },
  {
    patterns: [/DATABASE_URL.*missing/i, /database.*not.*configured/i, /ECONNREFUSED.*5432/i],
    classification: {
      kind:             "database_url_missing",
      userMessage:      "I need the Sardar app database connection string before I can continue.",
      safeFixAvailable: false,
      technicalReason:  "DATABASE_URL is not configured for this project.",
    },
  },
  {
    patterns: [/STRIPE_SECRET_KEY.*missing/i, /STRIPE_WEBHOOK_SECRET.*missing/i, /stripe.*not.*configured/i],
    classification: {
      kind:             "stripe_env_missing",
      userMessage:      "I need your Stripe payment keys before I can continue.",
      safeFixAvailable: false,
      technicalReason:  "One or more STRIPE_* env vars are missing.",
    },
  },
  {
    patterns: [/CLOUDINARY_API_KEY.*missing/i, /cloudinary.*not.*configured/i],
    classification: {
      kind:             "cloudinary_env_missing",
      userMessage:      "I need your Cloudinary media upload keys before I can continue.",
      safeFixAvailable: false,
      technicalReason:  "One or more CLOUDINARY_* env vars are missing.",
    },
  },
  {
    patterns: [/127\.0\.0\.1.*opened/i, /localhost.*opened.*browser/i, /ERR_CONNECTION_REFUSED/i],
    classification: {
      kind:             "localhost_opened_in_browser",
      userMessage:      "The app is running internally, but the browser preview link was using localhost. I fixed it to use the panel preview proxy.",
      safeFixAvailable: true,
      safeFixId:        "use-panel-preview-proxy",
      technicalReason:  "A 127.0.0.1/localhost URL was about to be shown in the browser instead of the panel proxy path.",
    },
  },
  {
    patterns: [/EADDRINUSE/i, /port already in use/i, /address already in use/i],
    classification: {
      kind:             "port_already_in_use",
      userMessage:      "The app's port is already in use by another process. I'll restart the deployment to release it.",
      safeFixAvailable: true,
      safeFixId:        "retry-deploy",
      technicalReason:  "EADDRINUSE — the assigned port is already bound, usually by a stale PM2 process for this same project.",
    },
  },
  {
    patterns: [/pm2.*errored/i, /pm2.*process.*failed/i, /status.*errored/i],
    classification: {
      kind:             "pm2_process_failed",
      userMessage:      "The app process crashed after starting. I'll check the logs and retry.",
      safeFixAvailable: true,
      safeFixId:        "retry-deploy",
      technicalReason:  "PM2 reports the process status as errored shortly after start.",
    },
  },
];

/** Classifies a block of deployment output/log text. Returns null if no known pattern matches. */
export function classifyAutopilotLog(log: string): LogClassification | null {
  if (!log) return null;
  for (const p of PATTERNS) {
    if (p.patterns.some((re) => re.test(log))) {
      return p.classification;
    }
  }
  return null;
}
