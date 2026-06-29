/**
 * lib/smart-import/smart-import-service.ts
 *
 * Sprint 85: Generates a SmartImportReport for a project by:
 *   1. Detecting source type
 *   2. Detecting stack
 *   3. Selecting a deployment preset
 *   4. Checking missing env names (by name only — no secret values)
 *   5. Checking deploy config readiness
 *   6. Checking preview readiness if a deployment exists
 *   7. Generating recommended next steps
 *
 * No secrets returned. No deployment mutations.
 */

import path from "path";
import fsSync from "fs";
import { db } from "@/lib/db";
import { detectSmartImportStack } from "./smart-import-detector";
import { selectSmartImportPreset } from "./smart-import-presets";
import type {
  SmartImportReport,
  SmartImportStep,
  SmartImportSourceType,
  SmartImportStatus,
} from "./smart-import-types";

const PROJECT_STORAGE = path.resolve(process.cwd(), "storage", "projects");

function existsSync(p: string): boolean {
  try { return fsSync.existsSync(p); } catch { return false; }
}

function step(
  id: string,
  stage: SmartImportStep["stage"],
  label: string,
  status: SmartImportStatus,
  message: string,
  opts: Partial<Pick<SmartImportStep, "evidence" | "recommendedFix" | "safeToRetry">> = {},
): SmartImportStep {
  return { id, stage, label, status, message, safeToRetry: true, ...opts };
}

export async function generateSmartImportReport(input: {
  projectId: string;
}): Promise<SmartImportReport> {
  const { projectId } = input;
  const generatedAt = new Date().toISOString();
  const steps: SmartImportStep[] = [];
  const blockers: string[] = [];
  const warnings: string[] = [];

  // ── Load project ───────────────────────────────────────────────────────────
  const project = await db.project.findUnique({
    where:  { id: projectId },
    select: { slug: true, name: true },
  });
  if (!project) {
    return {
      projectId,
      generatedAt,
      sourceType: "existing_project_storage",
      detectedStack: {
        packageManager: "unknown", framework: [], language: [],
        database: { tool: "unknown", provider: "unknown", requiredEnvNames: [] },
        services: [], envNames: [], replitMarkers: [],
      },
      steps: [
        step("project_not_found", "source", "Project lookup", "blocked",
          "Project not found.", { safeToRetry: false }),
      ],
      blockers: ["Project not found."],
      warnings: [],
      missingEnvNames: [],
      previewChecks: [],
      recommendedNextSteps: [],
    };
  }

  const sourceDir = path.join(PROJECT_STORAGE, project.slug);

  // ── Step 1: Source detection ───────────────────────────────────────────────
  let sourceType: SmartImportSourceType = "existing_project_storage";
  const sourceExists = existsSync(sourceDir);

  if (!sourceExists) {
    steps.push(step("source_exists", "source", "Source directory",
      "blocked",
      `No source found at storage/projects/${project.slug}/. Upload a ZIP or clone a repository first.`,
      { recommendedFix: "Use Source Intake to upload a ZIP or clone from GitHub.", safeToRetry: false },
    ));
    blockers.push("Source directory not found. Upload source before running Smart Import.");
  } else {
    const hasReplit = existsSync(path.join(sourceDir, ".replit"));
    const hasPnpmWs = existsSync(path.join(sourceDir, "pnpm-workspace.yaml"));
    if (hasReplit || hasPnpmWs) sourceType = "replit_export";
    steps.push(step("source_exists", "source", "Source directory", "passed",
      `Source found at storage/projects/${project.slug}/`,
      { evidence: hasPnpmWs ? "pnpm-workspace.yaml present" : undefined },
    ));
  }

  // ── Step 2: Stack detection ────────────────────────────────────────────────
  let detectedStack: SmartImportReport["detectedStack"];
  try {
    detectedStack = await detectSmartImportStack({ projectId, slug: project.slug });
    const summary = [
      `packageManager: ${detectedStack.packageManager}`,
      detectedStack.services.length > 0
        ? `services: ${detectedStack.services.map((s) => s.name).join(", ")}`
        : "no services detected",
      detectedStack.replitMarkers.length > 0
        ? `markers: ${detectedStack.replitMarkers.join(", ")}`
        : "",
    ].filter(Boolean).join(" | ");
    steps.push(step("stack_detected", "detect", "Stack detection", "passed", summary));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    steps.push(step("stack_detected", "detect", "Stack detection", "warning",
      `Stack detection error: ${msg}. Using fallback.`));
    detectedStack = {
      packageManager: "unknown", framework: [], language: [],
      database: { tool: "unknown", provider: "unknown", requiredEnvNames: [] },
      services: [], envNames: [], replitMarkers: [],
    };
    warnings.push(`Stack detection failed: ${msg}`);
  }

  // ── Step 3: Preset selection ───────────────────────────────────────────────
  const selectedPreset = selectSmartImportPreset({ detectedStack });
  steps.push(step("preset_selected", "configure", "Deployment preset",
    selectedPreset.confidence === "low" ? "warning" : "passed",
    `Selected: ${selectedPreset.label} (${selectedPreset.confidence} confidence)`,
    { evidence: selectedPreset.notes[0] ?? undefined },
  ));
  if (selectedPreset.confidence === "low") {
    warnings.push("Deployment preset confidence is low — manual review of commands recommended.");
  }

  // ── Step 4: Env name check (names only, no values) ─────────────────────────
  const requiredEnvNames = detectedStack.envNames
    .filter((e) => e.required)
    .map((e) => e.name);

  const configuredEnvNames = await db.projectEnvVar.findMany({
    where:  { projectId, isEnabled: true },
    select: { name: true },
  }).then((rows) => new Set(rows.map((r) => r.name)));

  const missingEnvNames = requiredEnvNames.filter((n) => !configuredEnvNames.has(n));

  if (missingEnvNames.length > 0) {
    steps.push(step("env_check", "secrets", "Required env vars",
      "warning",
      `Missing env vars (names only): ${missingEnvNames.join(", ")}`,
      { recommendedFix: "Add the missing env vars in the Environment tab. Values are secret — use the panel.", safeToRetry: true },
    ));
    warnings.push(`Missing env vars: ${missingEnvNames.join(", ")}`);
  } else {
    steps.push(step("env_check", "secrets", "Required env vars", "passed",
      requiredEnvNames.length === 0
        ? "No required env vars detected"
        : `All ${requiredEnvNames.length} required env var(s) configured`,
    ));
  }

  // ── Step 5: Database readiness (env name check only) ──────────────────────
  const dbTool = detectedStack.database.tool;
  if (dbTool && dbTool !== "none" && dbTool !== "unknown") {
    const dbEnvMissing = (detectedStack.database.requiredEnvNames ?? [])
      .filter((n) => !configuredEnvNames.has(n));
    if (dbEnvMissing.length > 0) {
      steps.push(step("db_check", "database", "Database env", "warning",
        `${dbTool} detected — missing: ${dbEnvMissing.join(", ")}`,
        { recommendedFix: "Add DATABASE_URL to env vars before deploying." },
      ));
      warnings.push(`Database env vars missing: ${dbEnvMissing.join(", ")}`);
    } else {
      steps.push(step("db_check", "database", "Database env", "passed",
        `${dbTool}/${detectedStack.database.provider} — env vars present`,
      ));
    }
  } else {
    steps.push(step("db_check", "database", "Database env", "skipped",
      "No database detected or configured",
    ));
  }

  // ── Step 6: Deploy config readiness ───────────────────────────────────────
  const deployConfig = await db.projectDeploymentConfig.findUnique({
    where:  { projectId },
    select: { id: true, startCommand: true, healthPath: true, routeMode: true, staticOutputDir: true },
  });

  if (!deployConfig) {
    steps.push(step("deploy_config", "configure", "Deployment config", "warning",
      "No deployment config saved yet.",
      { recommendedFix: "Apply the recommended preset to save a deployment config.", safeToRetry: true },
    ));
    warnings.push("No deployment config. Apply the recommended preset.");
  } else {
    const issues: string[] = [];
    if (!deployConfig.startCommand) issues.push("missing start command");
    if (
      selectedPreset.routeMode === "static_plus_api" &&
      deployConfig.routeMode !== "static_plus_api"
    ) {
      issues.push(`routeMode is ${deployConfig.routeMode ?? "unset"}, recommended: static_plus_api`);
    }
    if (
      selectedPreset.staticOutputPath &&
      !deployConfig.staticOutputDir
    ) {
      issues.push("staticOutputDir not set — frontend will not be served");
    }

    if (issues.length > 0) {
      steps.push(step("deploy_config", "configure", "Deployment config", "warning",
        `Config exists but has issues: ${issues.join("; ")}`,
        { recommendedFix: "Apply the recommended preset to fix the config.", safeToRetry: true },
      ));
      warnings.push(`Deployment config issues: ${issues.join("; ")}`);
    } else {
      steps.push(step("deploy_config", "configure", "Deployment config", "passed",
        `Config saved — routeMode: ${deployConfig.routeMode ?? "fullstack_node"}`,
      ));
    }
  }

  // ── Step 7: Preview readiness (check deployment record) ───────────────────
  const latestDeploy = await db.deployment.findFirst({
    where:   { projectId, status: "SUCCESS" },
    orderBy: { startedAt: "desc" },
    select:  { id: true, startedAt: true },
  });

  if (!latestDeploy) {
    steps.push(step("preview_readiness", "deploy_preview", "Preview readiness", "pending",
      "No successful deployment yet. Deploy the project to enable preview checks.",
    ));
  } else {
    steps.push(step("preview_readiness", "verify_preview", "Preview readiness", "passed",
      `Last successful deployment: ${new Date(latestDeploy.startedAt).toLocaleString()}. Run Preview Checks to verify.`,
    ));
  }

  // ── Recommended next steps ─────────────────────────────────────────────────
  const recommendedNextSteps: string[] = [];

  if (!sourceExists) {
    recommendedNextSteps.push("Upload source: use Source Intake to upload a ZIP or clone from GitHub.");
  }
  if (!deployConfig) {
    recommendedNextSteps.push("Apply the recommended deployment preset (button above).");
  }
  if (missingEnvNames.length > 0) {
    recommendedNextSteps.push(`Add missing env vars: ${missingEnvNames.join(", ")} (Environment tab).`);
  }
  if (deployConfig && blockers.length === 0 && !latestDeploy) {
    recommendedNextSteps.push("Deploy the project (Publishing tab → Deploy).");
  }
  if (latestDeploy && deployConfig) {
    recommendedNextSteps.push("Run Preview Checks to verify API and frontend are both serving.");
  }
  if (blockers.length === 0 && latestDeploy && missingEnvNames.length === 0) {
    recommendedNextSteps.push("Ready for go-live review. Add a domain and configure SSL (Domains tab).");
  }

  return {
    projectId,
    generatedAt,
    sourceType,
    detectedStack,
    selectedPreset,
    steps,
    blockers,
    warnings,
    missingEnvNames,
    previewChecks: [],
    recommendedNextSteps,
  };
}
