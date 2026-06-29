/**
 * lib/auto-import/auto-import-fix-classifier.ts
 *
 * Sprint 86: Maps known deploy error messages to safe, describable fixes.
 * Pure function — no async, no DB, no side effects.
 */

import type { AutoImportSafeFix, AutoImportIssueKind } from "./auto-import-types";

type FixPattern = {
  patterns: RegExp[];
  fix: AutoImportSafeFix;
};

const FIX_PATTERNS: FixPattern[] = [
  // ── Wrong package manager ─────────────────────────────────────────────────
  {
    patterns: [
      /npm.*install.*failed/i,
      /use pnpm instead/i,
      /ERR_PNPM_IGNORED_BUILDS/i,
      /pnpm.*workspace/i,
    ],
    fix: {
      id:                  "switch-to-pnpm-preset",
      issueKind:           "wrong_package_manager",
      label:               "Switch to pnpm preset",
      description:         "This project uses a pnpm workspace. Switch the deployment preset to use pnpm with --ignore-scripts to avoid esbuild postinstall conflicts.",
      confirmationRequired: true,
      confirmationPhrase:  "APPLY SAFE FIX",
      changes: [
        "Set install command to: pnpm install --frozen-lockfile --ignore-scripts",
        "Set build command to: pnpm run build",
        "Set start command to: node artifacts/api-server/dist/index.mjs",
      ],
      safe: true,
    },
  },

  // ── Frontend not served ───────────────────────────────────────────────────
  {
    patterns: [
      /Cannot GET \//i,
      /404.*root/i,
      /api.*healthz.*works.*\/ fails/i,
      /frontend.*not.*served/i,
      /static.*not.*served/i,
    ],
    fix: {
      id:                  "fix-static-frontend-routing",
      issueKind:           "frontend_not_served",
      label:               "Apply full Sardar/Replit pnpm deploy preset",
      description:         "The API is healthy but the frontend is returning 404 or 'Cannot GET /'. Applying the full pnpm preset: install/build/start commands + static_plus_api routing.",
      confirmationRequired: true,
      confirmationPhrase:  "APPLY SAFE FIX",
      changes: [
        "Set installCommand to: pnpm install --frozen-lockfile --ignore-scripts",
        "Set buildCommand to: pnpm run build",
        "Set startCommand to: node artifacts/api-server/dist/index.mjs",
        "Set healthPath to: /api/healthz",
        "Set routeMode to: static_plus_api",
        "Set staticOutputDir to: artifacts/sardar-security/dist/public",
        "Enable SPA fallback so React Router routes work",
      ],
      safe: true,
    },
  },

  // ── Wrong health path ─────────────────────────────────────────────────────
  {
    patterns: [
      /health.*path.*\/.*failed/i,
      /healthz.*not.*found/i,
      /GET \/ failed/i,
      /health check.*404/i,
    ],
    fix: {
      id:                  "fix-health-path",
      issueKind:           "health_failed",
      label:               "Set health path to /api/healthz",
      description:         "The health check is pointing at the wrong path. For pnpm workspace projects, the health endpoint is /api/healthz.",
      confirmationRequired: true,
      confirmationPhrase:  "APPLY SAFE FIX",
      changes: [
        "Set healthPath to: /api/healthz",
      ],
      safe: true,
    },
  },

  // ── node --enable-source-maps rejected ───────────────────────────────────
  {
    patterns: [
      /--enable-source-maps/i,
      /node.*flag.*not.*allowed/i,
      /extra arguments are not allowed/i,
    ],
    fix: {
      id:                  "normalize-start-command",
      issueKind:           "start_failed",
      label:               "Normalize start command (remove --enable-source-maps)",
      description:         "The start command contains --enable-source-maps which is not allowed by the safety validator. The correct command is: node artifacts/api-server/dist/index.mjs",
      confirmationRequired: true,
      confirmationPhrase:  "APPLY SAFE FIX",
      changes: [
        "Set start command to: node artifacts/api-server/dist/index.mjs",
      ],
      safe: true,
    },
  },

  // ── Missing DATABASE_URL ──────────────────────────────────────────────────
  {
    patterns: [
      /DATABASE_URL.*missing/i,
      /database.*not.*configured/i,
      /ECONNREFUSED.*5432/i,
      /could not connect.*database/i,
      /relation.*does not exist/i,
    ],
    fix: {
      id:                  "add-database-url",
      issueKind:           "missing_database",
      label:               "Add DATABASE_URL env var",
      description:         "The app requires a PostgreSQL DATABASE_URL. Add it in the Environment tab. This is your target/runtime database — not the old Replit database.",
      confirmationRequired: false,
      changes: [
        "Go to Environment tab",
        "Add DATABASE_URL = your PostgreSQL connection string",
      ],
      safe: true,
    },
  },

  // ── Missing SESSION_SECRET ────────────────────────────────────────────────
  {
    patterns: [
      /SESSION_SECRET.*missing/i,
      /session.*secret.*not.*set/i,
      /secret.*required/i,
    ],
    fix: {
      id:                  "add-session-secret",
      issueKind:           "missing_env",
      label:               "Add SESSION_SECRET env var",
      description:         "The app requires a SESSION_SECRET for signing sessions. Generate a long random string and add it in the Environment tab.",
      confirmationRequired: false,
      changes: [
        "Go to Environment tab",
        "Add SESSION_SECRET = a random 64-character string",
      ],
      safe: true,
    },
  },

  // ── Missing STRIPE_WEBHOOK_SECRET ────────────────────────────────────────
  {
    patterns: [
      /STRIPE_WEBHOOK_SECRET.*missing/i,
      /webhook.*secret.*not.*set/i,
      /stripe.*webhook.*error/i,
    ],
    fix: {
      id:                  "add-stripe-webhook-secret",
      issueKind:           "missing_env",
      label:               "Add STRIPE_WEBHOOK_SECRET env var",
      description:         "Stripe webhook verification requires STRIPE_WEBHOOK_SECRET. Get it from your Stripe dashboard webhook settings.",
      confirmationRequired: false,
      changes: [
        "Go to Environment tab",
        "Add STRIPE_WEBHOOK_SECRET = whsec_... from Stripe dashboard",
      ],
      safe: true,
    },
  },

  // ── Static output path missing ────────────────────────────────────────────
  {
    patterns: [
      /static.*output.*missing/i,
      /staticOutputDir.*not.*set/i,
      /dist.*not.*found/i,
      /build.*output.*missing/i,
    ],
    fix: {
      id:                  "fix-static-output-path",
      issueKind:           "static_output_missing",
      label:               "Set static output directory",
      description:         "The static output directory is not configured. For the Sardar ecommerce project, the frontend builds to artifacts/sardar-security/dist/public.",
      confirmationRequired: true,
      confirmationPhrase:  "APPLY SAFE FIX",
      changes: [
        "Set staticOutputDir to: artifacts/sardar-security/dist/public",
        "Set routeMode to: static_plus_api",
      ],
      safe: true,
    },
  },

  // ── Route mode wrong ─────────────────────────────────────────────────────
  {
    patterns: [
      /route.*mode.*wrong/i,
      /routeMode.*fullstack_node.*static/i,
      /should.*use.*static_plus_api/i,
    ],
    fix: {
      id:                  "fix-route-mode",
      issueKind:           "route_mode_wrong",
      label:               "Set route mode to static_plus_api",
      description:         "The route mode is not configured for a split API + static frontend project. Set it to static_plus_api.",
      confirmationRequired: true,
      confirmationPhrase:  "APPLY SAFE FIX",
      changes: [
        "Set routeMode to: static_plus_api",
        "API routes at /api/* served from Node process",
        "Frontend at /* served from static files",
      ],
      safe: true,
    },
  },

  // ── Public domain missing ─────────────────────────────────────────────────
  {
    patterns: [
      /domain.*missing/i,
      /no.*public.*domain/i,
      /domain.*not.*configured/i,
    ],
    fix: {
      id:                  "add-domain",
      issueKind:           "domain_missing",
      label:               "Add a public domain",
      description:         "No public domain is attached to this project. Go to the Domains tab to add and verify your domain.",
      confirmationRequired: false,
      changes: [
        "Go to Domains tab",
        "Add your domain hostname",
        "Point DNS A record to this server's IP",
        "SSL will be issued automatically",
      ],
      safe: true,
    },
  },
];

// ── Classifier ────────────────────────────────────────────────────────────────

export function classifyAutoImportIssue(input: {
  message: string;
}): AutoImportSafeFix | null {
  const { message } = input;
  for (const pattern of FIX_PATTERNS) {
    if (pattern.patterns.some((re) => re.test(message))) {
      return pattern.fix;
    }
  }
  return null;
}

export function classifyIssueKind(message: string): AutoImportIssueKind {
  const fix = classifyAutoImportIssue({ message });
  return fix?.issueKind ?? "unknown";
}
