/**
 * lib/ai-import-agent/agent-ai-planner.ts
 *
 * Sprint 93: Calls the existing Anthropic SDK provider to get an AiImportPlan
 * from Sonnet. Parses and normalizes the JSON response defensively.
 *
 * Safety: no secrets in context (enforced by buildImportAiContext).
 */

import { completeWithProjectAi, MAX_TOKENS_PATCH_GEN } from "@/lib/ai/provider";
import type { AiImportPlan, AiImportPlanAction }       from "./agent-run-types";
import type { ImportAiContext }                         from "./agent-ai-context-builder";

// ── Allowed kinds (prevents the AI from inventing new unsafe kinds) ──────────

const ALLOWED_KINDS = new Set([
  "update_deployment_config",
  "edit_file",
  "run_command",
  "inspect_file",
  "ask_user",
  "manual_blocker",
]);

// ── Check if AI provider is configured ───────────────────────────────────────

export function isAiProviderAvailable(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

// ── Normalise raw parsed plan ─────────────────────────────────────────────────

function normalisePlan(raw: unknown): AiImportPlan {
  if (typeof raw !== "object" || raw === null) {
    return {
      summary:    "AI returned an unrecognized response.",
      confidence: "low",
      diagnosis:  "Could not parse the AI response as a plan.",
      recommendedActions: [],
      stopReason: "JSON parse failed.",
    };
  }

  const o = raw as Record<string, unknown>;

  const summary    = typeof o.summary    === "string" ? o.summary.slice(0, 500)    : "AI import plan";
  const diagnosis  = typeof o.diagnosis  === "string" ? o.diagnosis.slice(0, 2000) : "";
  const stopReason = typeof o.stopReason === "string" ? o.stopReason.slice(0, 500) : undefined;

  const rawConf   = typeof o.confidence === "string" ? o.confidence.toLowerCase() : "medium";
  const confidence: AiImportPlan["confidence"] =
    rawConf === "low" ? "low" : rawConf === "high" ? "high" : "medium";

  const rawActions = Array.isArray(o.recommendedActions) ? o.recommendedActions : [];
  const recommendedActions: AiImportPlanAction[] = [];

  for (const a of rawActions.slice(0, 10)) {
    if (typeof a !== "object" || a === null) continue;
    const act = a as Record<string, unknown>;

    const kind = typeof act.kind === "string" ? act.kind : "";
    if (!ALLOWED_KINDS.has(kind)) continue;

    const safety = typeof act.safety === "string" && ["safe", "needs_approval", "blocked"].includes(act.safety)
      ? (act.safety as AiImportPlanAction["safety"])
      : "needs_approval";

    const configPatch = (typeof act.configPatch === "object" && act.configPatch !== null)
      ? sanitiseConfigPatch(act.configPatch as Record<string, unknown>)
      : undefined;

    recommendedActions.push({
      id:              typeof act.id    === "string" ? act.id.slice(0, 100)    : `action-${recommendedActions.length + 1}`,
      kind:            kind as AiImportPlanAction["kind"],
      title:           typeof act.title  === "string" ? act.title.slice(0, 200)  : kind,
      reason:          typeof act.reason === "string" ? act.reason.slice(0, 500) : "",
      safety,
      command:         typeof act.command         === "string" ? act.command.slice(0, 500)         : undefined,
      filePath:        typeof act.filePath        === "string" ? act.filePath.slice(0, 500)        : undefined,
      proposedContent: typeof act.proposedContent === "string" ? act.proposedContent.slice(0, 200_000) : undefined,
      unifiedDiff:     typeof act.unifiedDiff     === "string" ? act.unifiedDiff.slice(0, 50_000)  : undefined,
      configPatch,
    });
  }

  return { summary, confidence, diagnosis, recommendedActions, stopReason };
}

const ALLOWED_CONFIG_PATCH_KEYS = new Set([
  "staticOutputDir", "routeMode", "apiPrefix", "healthPath",
  "installCommand", "buildCommand", "startCommand",
]);

function sanitiseConfigPatch(
  raw: Record<string, unknown>,
): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!ALLOWED_CONFIG_PATCH_KEYS.has(key)) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null) {
      out[key] = value as string | number | boolean | null;
    }
  }
  return out;
}

// ── Main planner function ─────────────────────────────────────────────────────

export async function planWithAi(
  context: ImportAiContext,
): Promise<
  | { ok: true; plan: AiImportPlan; rawText: string }
  | { ok: false; error: string; code?: string }
> {
  if (!isAiProviderAvailable()) {
    return {
      ok: false,
      error: "AI provider not configured — ANTHROPIC_API_KEY is missing.",
      code: "NO_API_KEY",
    };
  }

  const aiResult = await completeWithProjectAi(
    context.systemPrompt,
    [{ role: "user", content: context.userDiagnosticBlock }],
    { maxTokens: MAX_TOKENS_PATCH_GEN },
  );

  if (!aiResult.ok) {
    return { ok: false, error: aiResult.error, code: aiResult.code };
  }

  const rawText = aiResult.text.trim();

  // Strip markdown fences if the model added them despite instructions
  const jsonText = rawText
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return {
      ok:   true,
      plan: {
        summary:    "AI returned a non-JSON response.",
        confidence: "low",
        diagnosis:  `Raw AI response:\n${rawText.slice(0, 1000)}`,
        recommendedActions: [],
        stopReason: "Response was not valid JSON. Review raw output above.",
      },
      rawText,
    };
  }

  return { ok: true, plan: normalisePlan(parsed), rawText };
}
