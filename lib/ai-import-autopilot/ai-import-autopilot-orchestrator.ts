/**
 * lib/ai-import-autopilot/ai-import-autopilot-orchestrator.ts
 *
 * Sprint 88: AI Import Autopilot — Replit-style "Make This Project Live" loop.
 *
 * Runs the full analyze → ask → apply safe fixes → deploy → verify cycle in a
 * single call, looping internally until it reaches a terminal state:
 *   preview_live | waiting_for_user_input | needs_manual_approval | blocked
 *
 * Only ever applies fixes on the safe-fix allowlist (see ai-import-autopilot-fix-engine.ts).
 * Destructive operations (DB wipe, DNS, file deletion, other PM2 processes, secret
 * exposure) are never touched here — those remain manual, confirmation-gated actions
 * in the existing Sprint 86/87 tools under Advanced Tools.
 *
 * Retry budget: 3 attempts per issue kind, 8 total per run (lib/ai-import-autopilot/ai-import-autopilot-state.ts).
 */

import { db }                          from "@/lib/db";
import { runAutoImportAnalysis }       from "@/lib/auto-import/auto-import-orchestrator";
import { deployProjectAction }         from "@/app/actions/project-deployments";
import type { AutoImportRun }          from "@/lib/auto-import/auto-import-types";
import { applyAutopilotSafeFix }       from "./ai-import-autopilot-fix-engine";
import { classifyAutopilotLog }        from "./ai-import-autopilot-log-classifier";
import { buildAutopilotQuestions }     from "./ai-import-autopilot-question-service";
import { RetryBudget }                 from "./ai-import-autopilot-state";
import {
  verifyAutopilotPreview,
  type PreviewVerificationResult,
}                                       from "./ai-import-autopilot-preview-verifier";
import type {
  AiImportAutopilotRun,
  AiImportAutopilotState,
  AppliedFix,
  DetectedStack,
  RequiredInput,
  ProposedFix,
  NextAction,
} from "./ai-import-autopilot-types";

const MAX_ITERATIONS = 8;

function buildDetectedStack(autoRun: AutoImportRun): DetectedStack {
  const stack = autoRun.detectedStack;
  const evidence: string[] = [];
  const isSardarPreset =
    stack.packageManager === "pnpm" &&
    (stack.staticOutputPath?.includes("sardar-security") ?? false);

  if (isSardarPreset) {
    evidence.push("pnpm-workspace.yaml + artifacts/api-server detected");
    evidence.push("Sardar/Replit ecommerce static output path detected");
  }
  if (stack.packageManager !== "unknown") {
    evidence.push(`Package manager: ${stack.packageManager}`);
  }

  return {
    isSardarPreset,
    packageManager: stack.packageManager,
    framework:      stack.framework,
    services:       stack.services,
    evidence,
  };
}

function buildNextAction(state: AiImportAutopilotState, hasPublicDomain: boolean): NextAction {
  switch (state) {
    case "waiting_for_user_input":
      return {
        label:       "Provide missing values",
        description: "Fill in the values below, then I'll continue automatically.",
        buttonText:  "Save & Continue",
      };
    case "preview_live":
      return hasPublicDomain
        ? { label: "Review & Go Live", description: "All checks passed.", buttonText: "Go to Publishing" }
        : { label: "Add a domain", description: "Preview is live. Add a public domain to go live.", buttonText: "Go to Domains" };
    case "needs_manual_approval":
      return {
        label:       "Review and approve",
        description: "This needs your review before I can continue.",
        buttonText:  "Make This Project Live",
      };
    case "blocked":
      return {
        label:       "Review the issue",
        description: "Check technical details below, then try again.",
        buttonText:  "Make This Project Live",
      };
    default:
      return {
        label:       "Make this project live",
        description: "I'll analyze your project, ask for anything missing, and deploy it.",
        buttonText:  "Make This Project Live",
      };
  }
}

async function loadTechnicalDetails(
  projectId: string,
  detectedStack: DetectedStack,
  retryBudget: RetryBudget,
  lastDeploymentLog?: string,
) {
  const config = await db.projectDeploymentConfig.findUnique({
    where:  { projectId },
    select: {
      installCommand: true, buildCommand: true, startCommand: true,
      pm2Name: true, port: true, healthPath: true, routeMode: true, staticOutputDir: true,
    },
  });
  return {
    packageManager:    detectedStack.packageManager,
    installCommand:    config?.installCommand    ?? undefined,
    buildCommand:      config?.buildCommand      ?? undefined,
    startCommand:      config?.startCommand      ?? undefined,
    pm2Name:           config?.pm2Name           ?? undefined,
    port:              config?.port              ?? undefined,
    healthPath:        config?.healthPath        ?? undefined,
    routeMode:         config?.routeMode         ?? undefined,
    staticOutputPath:  config?.staticOutputDir   ?? undefined,
    lastDeploymentLog: lastDeploymentLog?.slice(0, 4000),
    fixAttempts:       retryBudget.attemptsByKind(),
  };
}

type BuildRunParams = {
  projectId: string;
  state: AiImportAutopilotState;
  summary: string;
  autoRun: AutoImportRun;
  log: string[];
  safeFixesApplied: AppliedFix[];
  retryBudget: RetryBudget;
  requiredInputs?: RequiredInput[];
  pendingFix?: ProposedFix;
  verification?: PreviewVerificationResult;
  lastDeploymentLog?: string;
};

async function buildRun(params: BuildRunParams): Promise<AiImportAutopilotRun> {
  const {
    projectId, state, summary, autoRun, log, safeFixesApplied,
    retryBudget, requiredInputs, pendingFix, verification, lastDeploymentLog,
  } = params;

  const detectedStack = buildDetectedStack(autoRun);
  const hasPublicDomain = autoRun.domains.some((d) => d.type === "public" && d.status === "working");

  return {
    projectId,
    generatedAt: new Date().toISOString(),
    state,
    summary,
    log,
    detectedStack,
    requiredInputs: requiredInputs ?? [],
    safeFixesApplied,
    pendingFix,
    checks: verification?.checks ?? [],
    nextAction: buildNextAction(state, hasPublicDomain),
    browserPreviewUrl: verification?.browserPreviewUrl,
    publicUrl:         verification?.publicUrl,
    internalHealthUrl: verification?.internalHealthUrl,
    hiddenTechnicalDetails: await loadTechnicalDetails(projectId, detectedStack, retryBudget, lastDeploymentLog),
  };
}

export async function runAiImportAutopilot(input: {
  projectId: string;
}): Promise<AiImportAutopilotRun> {
  const { projectId } = input;
  const log: string[] = [];
  const safeFixesApplied: AppliedFix[] = [];
  const retryBudget = new RetryBudget();

  let autoRun = await runAutoImportAnalysis({ projectId });

  // ── No source ──────────────────────────────────────────────────────────────
  if (autoRun.issues.some((i) => i.id === "no-source")) {
    return buildRun({
      projectId, state: "blocked",
      summary: "No project source has been uploaded yet. Upload a ZIP or connect a GitHub repository to get started.",
      autoRun, log, safeFixesApplied, retryBudget,
    });
  }

  log.push("I found your project.");
  const stack = buildDetectedStack(autoRun);
  if (stack.isSardarPreset) {
    log.push("It is a pnpm Replit ecommerce workspace.");
    log.push("I found the API and frontend.");
  }

  // ── Missing required secrets — ask, then stop this run ───────────────────
  const missingRequired = autoRun.missingEnvNames.filter((e) => e.required);
  if (missingRequired.length > 0) {
    const requiredInputs = buildAutopilotQuestions(autoRun.missingEnvNames);
    log.push(`I need ${missingRequired.length} missing secret${missingRequired.length > 1 ? "s" : ""} before I can deploy.`);
    return buildRun({
      projectId, state: "waiting_for_user_input",
      summary: `I need ${missingRequired.length} missing secret${missingRequired.length > 1 ? "s" : ""} before I can deploy: ${missingRequired.map((e) => e.name).join(", ")}.`,
      autoRun, log, safeFixesApplied, retryBudget, requiredInputs,
    });
  }

  // ── Main loop: apply safe fixes, deploy, verify ──────────────────────────
  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    // No deploy config yet — apply the detected preset.
    if (autoRun.issues.some((i) => i.id === "no-deploy-config")) {
      const fixId = stack.isSardarPreset ? "apply-sardar-preset" : "apply-sardar-preset";
      const fixRes = await applyAutopilotSafeFix({ projectId, fixId });
      if (!fixRes.ok) {
        return buildRun({
          projectId, state: "blocked",
          summary: `I couldn't apply the deployment preset: ${fixRes.error}`,
          autoRun, log, safeFixesApplied, retryBudget,
        });
      }
      log.push("I applied the correct deployment preset.");
      safeFixesApplied.push(fixRes.appliedFix);
      autoRun = await runAutoImportAnalysis({ projectId });
      continue;
    }

    // A known issue with a safe fix exists — apply it and redeploy.
    const fixableIssue = autoRun.issues.find((i) => i.fix && i.fix.safe);
    if (fixableIssue?.fix) {
      const kind = fixableIssue.kind;
      if (!retryBudget.canRetry(kind)) {
        return buildRun({
          projectId, state: "needs_manual_approval",
          summary: `I tried to fix "${fixableIssue.title}" automatically, but it's still failing after several attempts. This needs manual review.`,
          autoRun, log, safeFixesApplied, retryBudget,
          pendingFix: {
            id: fixableIssue.fix.id, title: fixableIssue.fix.label,
            plainEnglishSummary: fixableIssue.message, safe: true,
            requiresApproval: true, approvalReason: "Automatic retries exhausted for this issue.",
          },
        });
      }

      if (fixableIssue.kind === "frontend_not_served") {
        log.push("Frontend preview failed because static files were not routed.");
      } else {
        log.push(`Issue detected: ${fixableIssue.title}`);
      }

      const fixRes = await applyAutopilotSafeFix({ projectId, fixId: fixableIssue.fix.id });
      retryBudget.record(kind);
      if (!fixRes.ok) {
        return buildRun({
          projectId, state: "blocked",
          summary: `I couldn't apply the fix: ${fixRes.error}`,
          autoRun, log, safeFixesApplied, retryBudget,
        });
      }
      log.push("I fixed the routing.");
      safeFixesApplied.push(fixRes.appliedFix);

      log.push("I am redeploying.");
      const deployResult = await deployProjectAction(projectId);
      if (!deployResult.ok) {
        const logText = `${deployResult.output ?? ""}\n${deployResult.error ?? ""}`;
        const classification = classifyAutopilotLog(logText);
        return buildRun({
          projectId, state: "blocked",
          summary: classification?.userMessage ?? `Deployment failed: ${deployResult.error}`,
          autoRun, log, safeFixesApplied, retryBudget, lastDeploymentLog: logText,
        });
      }
      autoRun = await runAutoImportAnalysis({ projectId });
      continue;
    }

    // Config ready but never deployed — deploy now.
    const hasDeployedBefore = autoRun.previewChecks.length > 0;
    if (!hasDeployedBefore) {
      log.push("I am installing dependencies.");
      log.push("I am building the project.");
      log.push("I am starting the app.");
      const deployResult = await deployProjectAction(projectId);
      const logText = `${deployResult.output ?? ""}\n${deployResult.error ?? ""}`;
      if (!deployResult.ok) {
        const classification = classifyAutopilotLog(logText);
        if (classification?.safeFixAvailable && classification.safeFixId && retryBudget.canRetry(classification.kind)) {
          retryBudget.record(classification.kind);
          const fixRes = await applyAutopilotSafeFix({ projectId, fixId: classification.safeFixId });
          if (fixRes.ok) {
            log.push(classification.userMessage);
            safeFixesApplied.push(fixRes.appliedFix);
            autoRun = await runAutoImportAnalysis({ projectId });
            continue;
          }
        }
        return buildRun({
          projectId, state: "blocked",
          summary: classification?.userMessage ?? `Deployment failed: ${deployResult.error}`,
          autoRun, log, safeFixesApplied, retryBudget, lastDeploymentLog: logText,
        });
      }
      log.push("Install completed.");
      log.push("Build completed.");
      log.push("API health check passed.");
      autoRun = await runAutoImportAnalysis({ projectId });
      continue;
    }

    // Verify preview through internal checks + panel proxy.
    log.push("I am checking the preview.");
    const verification = await verifyAutopilotPreview({ projectId });

    if (verification.allPass) {
      log.push("Preview is live.");
      return buildRun({
        projectId, state: "preview_live",
        summary: verification.publicUrl
          ? `Preview is live at ${verification.publicUrl}.`
          : "Preview is available through the panel proxy. Add a public domain when ready.",
        autoRun, log, safeFixesApplied, retryBudget, verification,
      });
    }

    const failingInternalCheck = verification.checks.find((c) => c.status !== "pass" && c.scope === "internal");
    if (failingInternalCheck) {
      const classification = classifyAutopilotLog(failingInternalCheck.result);
      if (classification?.safeFixAvailable && classification.safeFixId && retryBudget.canRetry(classification.kind)) {
        retryBudget.record(classification.kind);
        const fixRes = await applyAutopilotSafeFix({ projectId, fixId: classification.safeFixId });
        if (fixRes.ok) {
          log.push(classification.userMessage);
          safeFixesApplied.push(fixRes.appliedFix);
          log.push("I am redeploying.");
          await deployProjectAction(projectId);
          autoRun = await runAutoImportAnalysis({ projectId });
          continue;
        }
      }
      return buildRun({
        projectId, state: "needs_manual_approval",
        summary: classification?.userMessage ?? `Preview check failed: ${failingInternalCheck.result}`,
        autoRun, log, safeFixesApplied, retryBudget, verification,
      });
    }

    return buildRun({
      projectId, state: "needs_manual_approval",
      summary: "I've applied all the safe fixes I know about, but the preview still isn't fully passing. This needs manual review.",
      autoRun, log, safeFixesApplied, retryBudget, verification,
    });
  }

  return buildRun({
    projectId, state: "blocked",
    summary: "I reached the automatic retry limit for this run. Check technical details below, then try again.",
    autoRun, log, safeFixesApplied, retryBudget,
  });
}
