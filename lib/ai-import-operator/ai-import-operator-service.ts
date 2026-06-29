/**
 * lib/ai-import-operator/ai-import-operator-service.ts
 *
 * Sprint 87: The AI Import Operator brain.
 * Reads project state from existing systems, synthesizes a plain-English
 * operator run, and decides the single best next action.
 *
 * Builds on Sprint 86 AutoImportAnalysis — no duplication.
 * No LLM call here; deterministic explanations (Feature Area 8 fallback).
 * No secrets returned.
 */

import { db }                      from "@/lib/db";
import { runAutoImportAnalysis }   from "@/lib/auto-import/auto-import-orchestrator";
import type { AutoImportRun }      from "@/lib/auto-import/auto-import-types";
import type {
  AiImportOperatorRun,
  AiImportOperatorStatus,
  AiImportUserInputRequest,
  AiImportFixPlan,
  AiImportOperatorStep,
} from "./ai-import-operator-types";

// ── Env input catalog (for surfacing missing inputs to user) ──────────────────

const ENV_INPUT_CATALOG: Record<string, Omit<AiImportUserInputRequest, "id">> = {
  APP_URL: {
    kind:        "env_var",
    label:       "App URL",
    description: "The public URL where your app will be accessed (e.g. https://yourdomain.com). Used in emails, OAuth, and links.",
    required:    true,
    secret:      false,
    fieldName:   "APP_URL",
    placeholder: "https://yourdomain.com",
  },
  DATABASE_URL: {
    kind:        "database_url",
    label:       "Database URL",
    description: "Your PostgreSQL connection string. This is the TARGET database — where your app stores live data. Not the old Replit database.",
    required:    true,
    secret:      true,
    fieldName:   "DATABASE_URL",
    placeholder: "postgresql://user:pass@host:5432/dbname",
    safetyNote:  "This value is encrypted and never shown again.",
  },
  SESSION_SECRET: {
    kind:        "env_var",
    label:       "Session Secret",
    description: "A long random string used to sign user sessions. Generate one with: openssl rand -hex 64",
    required:    true,
    secret:      true,
    fieldName:   "SESSION_SECRET",
    placeholder: "a random 64-character string",
    safetyNote:  "This value is encrypted and never shown again.",
  },
  STRIPE_SECRET_KEY: {
    kind:        "env_var",
    label:       "Stripe Secret Key",
    description: "Your Stripe secret API key. Found in the Stripe Dashboard → Developers → API keys.",
    required:    true,
    secret:      true,
    fieldName:   "STRIPE_SECRET_KEY",
    placeholder: "sk_live_...",
    safetyNote:  "This value is encrypted and never shown again.",
  },
  STRIPE_PUBLISHABLE_KEY: {
    kind:        "env_var",
    label:       "Stripe Publishable Key",
    description: "Your Stripe publishable key (used on the frontend checkout). Found in Stripe Dashboard.",
    required:    true,
    secret:      false,
    fieldName:   "STRIPE_PUBLISHABLE_KEY",
    placeholder: "pk_live_...",
  },
  STRIPE_WEBHOOK_SECRET: {
    kind:        "env_var",
    label:       "Stripe Webhook Secret",
    description: "Your Stripe webhook signing secret. Found in Stripe Dashboard → Developers → Webhooks.",
    required:    true,
    secret:      true,
    fieldName:   "STRIPE_WEBHOOK_SECRET",
    placeholder: "whsec_...",
    safetyNote:  "This value is encrypted and never shown again.",
  },
  CLOUDINARY_CLOUD_NAME: {
    kind:        "env_var",
    label:       "Cloudinary Cloud Name",
    description: "Your Cloudinary cloud name for media uploads. Found on the Cloudinary dashboard.",
    required:    true,
    secret:      false,
    fieldName:   "CLOUDINARY_CLOUD_NAME",
    placeholder: "your_cloud_name",
  },
  CLOUDINARY_API_KEY: {
    kind:        "env_var",
    label:       "Cloudinary API Key",
    description: "Your Cloudinary API key.",
    required:    true,
    secret:      true,
    fieldName:   "CLOUDINARY_API_KEY",
    placeholder: "1234567890",
    safetyNote:  "This value is encrypted and never shown again.",
  },
  CLOUDINARY_API_SECRET: {
    kind:        "env_var",
    label:       "Cloudinary API Secret",
    description: "Your Cloudinary API secret.",
    required:    true,
    secret:      true,
    fieldName:   "CLOUDINARY_API_SECRET",
    placeholder: "abc123...",
    safetyNote:  "This value is encrypted and never shown again.",
  },
};

// ── Plain-English error explainer ─────────────────────────────────────────────

function explainRun(run: AutoImportRun): {
  summary: string;
  question?: string;
  fixPlan?: AiImportFixPlan;
} {
  const { status, issues, previewChecks, missingEnvNames, database, domains } = run;

  const hasPublicDomain = domains.some((d) => d.type === "public" && d.status === "working");
  const hasPreviewUrl   = domains.some((d) => d.type !== "internal");
  const frontendFailing = issues.some((i) => i.kind === "frontend_not_served");
  const healthFailing   = issues.some((i) => i.kind === "health_failed" || i.kind === "start_failed");
  const missingRequired = missingEnvNames.filter((e) => e.required);
  const missingDb       = !database.targetConfigured;

  // ── Status: no source ──────────────────────────────────────────────────────
  if (status === "blocked" && issues.some((i) => i.id === "no-source")) {
    return {
      summary: "No project source has been uploaded yet. Upload a ZIP or connect a GitHub repository to get started.",
      question: "Upload your project source in the Source Intake section below.",
    };
  }

  // ── Status: no deploy config ───────────────────────────────────────────────
  if (issues.some((i) => i.id === "no-deploy-config")) {
    return {
      summary: "Your project source is uploaded but no deployment configuration has been set yet. I can detect the right configuration automatically.",
      fixPlan: {
        id:                   "apply-sardar-preset",
        title:                "Apply deployment configuration",
        plainEnglishSummary:  "I'll set the right install, build, and start commands for your project. You won't need to type anything technical.",
        technicalChanges:     [
          "Install command: pnpm install --frozen-lockfile --ignore-scripts",
          "Build command: pnpm run build",
          "Start command: node artifacts/api-server/dist/index.mjs",
          "Route mode: static_plus_api (API at /api, frontend at /)",
          "Health path: /api/healthz",
        ],
        safe:                 true,
        requiresConfirmation: true,
        confirmationPhrase:   "APPLY FIX",
      },
    };
  }

  // ── API works, frontend fails (the current Sardar state) ──────────────────
  if (frontendFailing) {
    const fix: AiImportFixPlan = {
      id:                   "fix-static-frontend-routing",
      title:                "Apply full Sardar/Replit pnpm deploy preset",
      plainEnglishSummary:  "Your API is working, but the frontend is not being served and the install/build commands need to be set for this pnpm workspace project. I'll apply the complete deployment preset.",
      technicalChanges:     [
        "Install → pnpm install --frozen-lockfile --ignore-scripts",
        "Build → pnpm run build",
        "Start → node artifacts/api-server/dist/index.mjs",
        "Health path → /api/healthz",
        "Route mode → static_plus_api",
        "Static output → artifacts/sardar-security/dist/public",
        "SPA fallback enabled (React Router links will work)",
      ],
      safe:                 true,
      requiresConfirmation: true,
      confirmationPhrase:   "APPLY FIX",
    };
    const envNames = missingRequired.map((e) => e.name).join(", ");
    const envNote  = envNames ? ` I also need ${envNames} from you.` : "";
    return {
      summary: `Your API is working, but the frontend is not being served at /.${envNote} I can fix the routing automatically.`,
      fixPlan: fix,
    };
  }

  // ── App not responding ─────────────────────────────────────────────────────
  if (healthFailing) {
    return {
      summary: "The app is not responding to health checks. This usually means it hasn't been deployed yet, or the last deploy failed. Deploy the project to continue.",
    };
  }

  // ── Missing required env vars ──────────────────────────────────────────────
  if (missingRequired.length > 0) {
    const names = missingRequired.slice(0, 3).map((e) => e.name).join(", ");
    const more  = missingRequired.length > 3 ? ` and ${missingRequired.length - 3} more` : "";
    return {
      summary: `Almost ready. I need ${names}${more} before deploying. These values are encrypted and never shown to anyone.`,
      question: `Please provide ${names}${more} in the fields below.`,
    };
  }

  // ── Missing database ───────────────────────────────────────────────────────
  if (missingDb) {
    return {
      summary: "Your app needs a database. Provide your PostgreSQL DATABASE_URL (this is your live/target database — not the old Replit one). I'll encrypt it and use it for the deployment.",
      question: "Please add DATABASE_URL below.",
    };
  }

  // ── No domain ─────────────────────────────────────────────────────────────
  if (!hasPublicDomain && status === "preview_live") {
    return {
      summary: "Preview is live and working! To go public, you need to add a domain in the Domains tab.",
      question: "Go to the Domains tab to add your public domain.",
    };
  }

  // ── Ready for go-live ──────────────────────────────────────────────────────
  if (status === "ready_for_go_live") {
    return {
      summary: "Everything is working. Preview is live, domain is attached. Review and confirm go-live when ready.",
    };
  }

  // ── Preview live ──────────────────────────────────────────────────────────
  if (status === "preview_live") {
    const url = domains.find((d) => d.type !== "internal")?.url ?? "";
    return {
      summary: `Preview is live${url ? ` at ${url}` : ""}. Add a public domain to go live.`,
    };
  }

  // ── Config ready but not deployed ─────────────────────────────────────────
  if (status === "config_ready") {
    return {
      summary: "Your project is configured and ready to deploy. Click Deploy to start the build.",
    };
  }

  // ── Fallback ──────────────────────────────────────────────────────────────
  return {
    summary: "Analyzing your project… click Make Project Live to start.",
  };
}

// ── Next best action picker ───────────────────────────────────────────────────

function pickNextBestAction(
  run: AutoImportRun,
  explanation: ReturnType<typeof explainRun>,
): AiImportOperatorRun["nextBestAction"] {
  const { status, missingEnvNames, database } = run;
  const missingRequired = missingEnvNames.filter((e) => e.required);
  const hasRequiredMissing = missingRequired.length > 0 || !database.targetConfigured;

  if (status === "blocked" && run.issues.some((i) => i.id === "no-source")) {
    return {
      label:       "Upload Source",
      description: "Use Source Intake below to upload a ZIP or clone from GitHub.",
      buttonText:  "Upload Source",
    };
  }

  if (explanation.fixPlan) {
    if (hasRequiredMissing) {
      return {
        label:       "Provide missing values, then Apply Fix",
        description: explanation.question ?? "Fill in the values below, then apply the fix.",
        buttonText:  "Apply Fix",
        confirmationPhrase: "APPLY FIX",
      };
    }
    return {
      label:               "Apply Fix",
      description:         explanation.fixPlan.plainEnglishSummary,
      buttonText:          "Apply Fix",
      confirmationPhrase:  "APPLY FIX",
    };
  }

  if (hasRequiredMissing) {
    return {
      label:       "Add missing values",
      description: explanation.question ?? "Fill in the required values below.",
      buttonText:  "Save & Continue",
    };
  }

  if (status === "config_ready") {
    return {
      label:       "Deploy Preview",
      description: "Configuration is ready. Deploy the project to start the preview.",
      buttonText:  "Retry Deploy",
      confirmationPhrase: "RETRY DEPLOY",
    };
  }

  if (status === "fix_available" || status === "retry_ready") {
    return {
      label:       "Retry Deploy",
      description: "Fixes have been applied. Retry the deploy to verify.",
      buttonText:  "Retry Deploy",
      confirmationPhrase: "RETRY DEPLOY",
    };
  }

  if (status === "preview_live") {
    return {
      label:       "Add Domain",
      description: "Preview is live. Add a public domain to go live.",
      buttonText:  "Go to Domains",
    };
  }

  if (status === "ready_for_go_live") {
    return {
      label:       "Review & Go Live",
      description: "All checks passed. Review final settings and confirm go-live.",
      buttonText:  "Go to Publishing",
    };
  }

  return {
    label:       "Analyze Import",
    description: "Click to analyze your project and get the next step.",
    buttonText:  "Make Project Live",
  };
}

// ── Operator status mapper ────────────────────────────────────────────────────

function mapToOperatorStatus(run: AutoImportRun): AiImportOperatorStatus {
  switch (run.status) {
    case "not_started":       return "not_started";
    case "needs_env":         return "needs_user_input";
    case "needs_database":    return "needs_user_input";
    case "config_ready":      return "ready_to_fix";
    case "deploying":         return "deploying";
    case "fix_available":     return "ready_to_fix";
    case "retry_ready":       return "ready_to_fix";
    case "preview_live":      return "preview_live";
    case "ready_for_go_live": return "ready_for_go_live";
    case "blocked":           return "blocked";
    default:                  return "reading_project";
  }
}

// ── Main service ──────────────────────────────────────────────────────────────

export async function generateAiImportOperatorRun(input: {
  projectId: string;
}): Promise<AiImportOperatorRun> {
  const { projectId } = input;
  const generatedAt = new Date().toISOString();

  // ── Load project name ─────────────────────────────────────────────────────
  const project = await db.project.findUnique({
    where:  { id: projectId },
    select: { slug: true },
  });

  // ── Run underlying analysis (Sprint 86) ───────────────────────────────────
  const autoRun = await runAutoImportAnalysis({ projectId });

  // ── Load deployment preset details ────────────────────────────────────────
  const deployConfig = await db.projectDeploymentConfig.findUnique({
    where:  { projectId },
    select: {
      installCommand:  true,
      buildCommand:    true,
      startCommand:    true,
      routeMode:       true,
      staticOutputDir: true,
      healthPath:      true,
      port:            true,
    },
  });

  // ── Build operator steps from autoRun issues ──────────────────────────────
  const steps: AiImportOperatorStep[] = [
    {
      id:      "source",
      label:   "Project source",
      status:  autoRun.issues.some((i) => i.id === "no-source") ? "blocked" : "passed",
      message: autoRun.issues.some((i) => i.id === "no-source")
        ? "No source uploaded yet"
        : "Source is available",
    },
    {
      id:      "config",
      label:   "Deployment config",
      status:  deployConfig ? "passed" : "warning",
      message: deployConfig ? "Config saved" : "No deployment config yet",
    },
    {
      id:      "env",
      label:   "Required secrets",
      status:  autoRun.missingEnvNames.filter((e) => e.required).length > 0 ? "warning" : "passed",
      message: autoRun.missingEnvNames.filter((e) => e.required).length > 0
        ? `Missing: ${autoRun.missingEnvNames.filter((e) => e.required).map((e) => e.name).join(", ")}`
        : "All required secrets configured",
    },
    {
      id:      "database",
      label:   "Database",
      status:  autoRun.database.targetConfigured ? "passed" : "warning",
      message: autoRun.database.targetConfigured ? "DATABASE_URL configured" : "DATABASE_URL missing",
    },
    {
      id:      "preview",
      label:   "Preview",
      status:  autoRun.previewChecks.length === 0 ? "pending" :
               autoRun.previewChecks.every((c) => c.status === "pass") ? "passed" :
               autoRun.previewChecks.some((c) => c.status === "blocked") ? "blocked" : "warning",
      message: autoRun.previewChecks.length === 0
        ? "Not checked yet — deploy first"
        : autoRun.previewChecks.map((c) => `${c.path}: ${c.result}`).join(" | "),
    },
    {
      id:      "domain",
      label:   "Public domain",
      status:  autoRun.domains.some((d) => d.type === "public" && d.status === "working")
        ? "passed"
        : "warning",
      message: autoRun.domains.some((d) => d.type === "public" && d.status === "working")
        ? autoRun.domains.find((d) => d.type === "public" && d.status === "working")!.url
        : "No public domain attached",
    },
  ];

  // ── Build user inputs needed ─────────────────────────────────────────────
  const userInputsNeeded: AiImportUserInputRequest[] = [];

  for (const missing of autoRun.missingEnvNames) {
    if (!missing.required) continue;
    const catalog = ENV_INPUT_CATALOG[missing.name];
    if (catalog) {
      userInputsNeeded.push({ id: missing.name, ...catalog });
    } else {
      userInputsNeeded.push({
        id:          missing.name,
        kind:        missing.secret ? "env_var" : "env_var",
        label:       missing.name,
        description: missing.purpose,
        required:    true,
        secret:      missing.secret,
        fieldName:   missing.name,
        placeholder: `Enter ${missing.name}`,
        safetyNote:  missing.secret ? "This value is encrypted and never shown again." : undefined,
      });
    }
  }

  // Also request domain if none attached
  const hasDomain = autoRun.domains.some((d) => d.type === "public" && d.status === "working");
  if (!hasDomain && autoRun.status !== "blocked") {
    userInputsNeeded.push({
      id:          "PUBLIC_DOMAIN",
      kind:        "domain",
      label:       "Public Domain",
      description: "Your domain hostname (e.g. yourdomain.com). Add DNS A record pointing to this server after saving.",
      required:    false,
      secret:      false,
      fieldName:   "PUBLIC_DOMAIN",
      placeholder: "yourdomain.com",
    });
  }

  // ── Explain the run ────────────────────────────────────────────────────────
  const explanation = explainRun(autoRun);
  const nextAction  = pickNextBestAction(autoRun, explanation);
  const opStatus    = mapToOperatorStatus(autoRun);

  // ── Derive preview/domain URLs ────────────────────────────────────────────
  const previewDomain = autoRun.domains.find((d) => d.type === "preview" || d.type === "public");
  const publicDomain  = autoRun.domains.find((d) => d.type === "public" && d.status === "working");
  const internalDomain = autoRun.domains.find((d) => d.type === "internal");
  const healthPath    = deployConfig?.healthPath ?? "/api/healthz";
  const previewUrl    = previewDomain?.url ?? internalDomain?.url;
  const healthUrl     = previewUrl ? `${previewUrl.replace(/\/$/, "")}${healthPath}` : undefined;

  return {
    projectId,
    generatedAt,
    status:               opStatus,
    plainEnglishSummary:  explanation.summary,
    currentQuestion:      explanation.question,
    userInputsNeeded,
    fixPlan:              explanation.fixPlan,
    steps,
    previewUrl,
    publicDomain:         publicDomain?.url,
    healthUrl,
    previewChecks:        autoRun.previewChecks.map((c) => ({
      label:     c.path,
      urlOrPath: c.path,
      status:    c.status,
      result:    c.result,
    })),
    nextBestAction: nextAction,
    hiddenTechnicalDetails: {
      packageManager:   autoRun.detectedStack.packageManager,
      installCommand:   deployConfig?.installCommand ?? undefined,
      buildCommand:     deployConfig?.buildCommand   ?? undefined,
      startCommand:     deployConfig?.startCommand   ?? undefined,
      routeMode:        autoRun.detectedStack.routeMode,
      staticOutputPath: autoRun.detectedStack.staticOutputPath,
      healthPath:       deployConfig?.healthPath     ?? undefined,
      missingEnvNames:  autoRun.missingEnvNames.map((e) => e.name),
      knownErrors:      autoRun.issues.map((i) => i.title),
    },
  };
}
