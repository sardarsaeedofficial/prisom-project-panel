/**
 * lib/smart-import/smart-import-fixes.ts
 *
 * Sprint 85: Maps known deployment error patterns to fix recommendations.
 * Server-side only. Pure data — no async, no DB.
 */

export type SmartImportFixClassification = {
  code: string;
  title: string;
  recommendedFix: string;
  safeAutoFixAvailable: boolean;
};

const FIXES: Array<{
  patterns: RegExp[];
  fix: SmartImportFixClassification;
}> = [
  {
    patterns: [/npm install failed/i, /use pnpm instead/i, /requires pnpm/i, /ERR_PNPM_MISSING/i],
    fix: {
      code: "USE_PNPM",
      title: "npm install failed — project requires pnpm",
      recommendedFix:
        "Switch install command to: pnpm install --frozen-lockfile --ignore-scripts. Apply the Sardar/Replit preset.",
      safeAutoFixAvailable: true,
    },
  },
  {
    patterns: [/Cannot GET \//i, /ENOENT.*index\.html/i],
    fix: {
      code: "STATIC_NOT_SERVED",
      title: "Frontend not served — static routing not configured",
      recommendedFix:
        "API is healthy but frontend static output is not served. Apply static_plus_api routing " +
        "with staticOutputPath set to artifacts/sardar-security/dist/public.",
      safeAutoFixAvailable: true,
    },
  },
  {
    patterns: [/enable-source-maps/i, /not allowed.*source-maps/i, /extra arguments.*not allowed/i],
    fix: {
      code: "SOURCE_MAPS_FLAG",
      title: "node --enable-source-maps blocked by validator",
      recommendedFix:
        "Use start command without the flag: node artifacts/api-server/dist/index.mjs. " +
        "The panel normalizes --enable-source-maps automatically.",
      safeAutoFixAvailable: true,
    },
  },
  {
    patterns: [/health.*\/.*fails/i, /GET \/ failed/i, /healthz.*not found/i],
    fix: {
      code: "WRONG_HEALTH_PATH",
      title: "Health path '/' fails — API uses /api/healthz",
      recommendedFix:
        "Change health path to /api/healthz. The Node API serves health at /api/healthz, not /.",
      safeAutoFixAvailable: true,
    },
  },
  {
    patterns: [/ERR_PNPM_IGNORED_BUILDS/i, /esbuild.*ignored/i, /pnpm.*ignored-builds/i],
    fix: {
      code: "PNPM_IGNORED_BUILDS",
      title: "esbuild blocked by pnpm --ignore-scripts",
      recommendedFix:
        "Add esbuild to onlyBuiltDependencies in package.json, or remove --ignore-scripts from " +
        "install command if the project is trusted.",
      safeAutoFixAvailable: false,
    },
  },
  {
    patterns: [/&&/i, /command.*contains.*disallowed/i, /shell.*injection/i],
    fix: {
      code: "CHAINED_COMMAND",
      title: "Chained commands with && are not allowed",
      recommendedFix:
        "Split compound commands. Use pnpm run build (single command) instead of " +
        "cd artifacts && pnpm build. The workspace root build script handles all sub-packages.",
      safeAutoFixAvailable: true,
    },
  },
  {
    patterns: [/DATABASE_URL.*missing/i, /missing.*DATABASE_URL/i],
    fix: {
      code: "MISSING_DATABASE_URL",
      title: "DATABASE_URL not configured",
      recommendedFix:
        "Add DATABASE_URL to project env vars (Environment tab). " +
        "Use a staging or production PostgreSQL URL — never a local or development one.",
      safeAutoFixAvailable: false,
    },
  },
  {
    patterns: [/STRIPE_WEBHOOK_SECRET.*missing/i, /missing.*STRIPE/i],
    fix: {
      code: "MISSING_STRIPE_SECRET",
      title: "Stripe webhook secret not configured",
      recommendedFix:
        "Add STRIPE_WEBHOOK_SECRET to project env vars before go-live. " +
        "Without this, Stripe webhook events will fail signature verification.",
      safeAutoFixAvailable: false,
    },
  },
];

/**
 * Classifies an error message and returns a fix recommendation.
 * Returns a generic fallback if no pattern matches.
 */
export function classifySmartImportError(message: string): SmartImportFixClassification {
  for (const entry of FIXES) {
    if (entry.patterns.some((re) => re.test(message))) {
      return entry.fix;
    }
  }
  return {
    code:                 "UNKNOWN",
    title:                "Unknown error",
    recommendedFix:       "Review the error message and check the panel logs for more context.",
    safeAutoFixAvailable: false,
  };
}

/**
 * Returns all known fix codes for display in the help/export.
 */
export function getAllKnownFixes(): SmartImportFixClassification[] {
  return FIXES.map((f) => f.fix);
}
