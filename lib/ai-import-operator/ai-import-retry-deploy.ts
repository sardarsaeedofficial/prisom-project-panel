/**
 * lib/ai-import-operator/ai-import-retry-deploy.ts
 *
 * Sprint 87: Retry deploy executor for the AI Import Operator.
 * Requires deploy.trigger permission and RETRY DEPLOY confirmation.
 * After deploy completes, re-runs analysis and returns updated operator run.
 *
 * Confirmation phrase: RETRY DEPLOY
 */

import { deployProjectAction } from "@/app/actions/project-deployments";
import { generateAiImportOperatorRun } from "./ai-import-operator-service";
import type { AiImportOperatorRun } from "./ai-import-operator-types";

type RetryDeployResult =
  | { ok: true;  run: AiImportOperatorRun; deployStarted: boolean }
  | { ok: false; error: string };

export async function retryAiImportDeploy(input: {
  projectId: string;
  confirmation: string;
}): Promise<RetryDeployResult> {
  if (input.confirmation !== "RETRY DEPLOY") {
    return { ok: false, error: "Type RETRY DEPLOY to confirm." };
  }

  const deployResult = await deployProjectAction(input.projectId);

  if (!deployResult.ok) {
    return { ok: false, error: deployResult.error ?? "Deploy failed. Check logs for details." };
  }

  // Re-run analysis so the caller gets fresh preview checks
  const run = await generateAiImportOperatorRun({ projectId: input.projectId });

  return { ok: true, run, deployStarted: true };
}
