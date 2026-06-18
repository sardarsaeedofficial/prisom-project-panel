/**
 * lib/ai/project-patches.ts
 *
 * Sprint 6: AI patch suggestion logic.
 *
 * Safety rules:
 *  - AI may only propose diffs/patches; it cannot apply them.
 *  - No secret values are passed to the AI (files already sanitised by caller).
 *  - .env and blocked file types are rejected before being sent.
 *  - All proposed patch paths are validated against the project root.
 *  - Raw AI response is parsed defensively; JSON failure is surfaced cleanly.
 */

import { completeWithProjectAi, MAX_TOKENS_PATCH_GEN } from "@/lib/ai/provider";
import { redact }                    from "@/lib/ai/redaction";
import { buildProjectAiContext }     from "@/lib/ai/project-context";
import { isEditableTextFile, MAX_FILE_AI_BYTES } from "@/lib/projects/file-manager";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SelectedFileForPatch {
  path:    string;
  content: string;
}

export interface PatchHunk {
  path:             string;
  type:             "modify" | "create";
  unifiedDiff:      string;
  proposedContent?: string;
  warnings:         string[];
}

export interface PatchSuggestion {
  summary:                string;
  patches:                PatchHunk[];
  commandsToRunManually?: string[];
  risks:                  string[];
  /** Raw AI text, populated if JSON parsing failed. */
  rawFallback?:           string;
}

// ── System prompt for patch mode ──────────────────────────────────────────────

function buildPatchSystemPrompt(projectSystemPrompt: string): string {
  return `${projectSystemPrompt}

---

## PATCH SUGGESTION MODE

You are now in safe patch suggestion mode.

**You may:**
- Propose changes as unified diffs.
- Suggest new safe text files.
- Explain why the change is needed.
- List commands the developer should run manually.

**You must NOT:**
- Claim to have edited files — you can only suggest.
- Execute commands.
- Reveal secret values.
- Modify .env or secret files.
- Suggest \`chmod 777\`, \`pm2 restart all\`, or destructive commands without clear justification.
- Propose patches for files not listed in the "Selected files" section below.

**Response format — return ONLY valid JSON matching this schema:**

\`\`\`json
{
  "summary": "One-sentence description of the change",
  "patches": [
    {
      "path": "src/App.tsx",
      "type": "modify",
      "unifiedDiff": "--- a/src/App.tsx\\n+++ b/src/App.tsx\\n@@ -1,3 +1,4 @@...",
      "proposedContent": "...the full file content after the change...",
      "warnings": ["Note: this uses a deprecated API"]
    }
  ],
  "commandsToRunManually": ["pnpm run typecheck", "pnpm run build"],
  "risks": ["This removes error handling from the login flow"]
}
\`\`\`

- \`unifiedDiff\`: proper unified diff format (--- a/..., +++ b/..., @@ ... @@)
- \`proposedContent\`: the COMPLETE file content after applying the patch (optional but preferred)
- \`warnings\`: per-patch cautions
- \`commandsToRunManually\`: commands the developer should run manually after applying
- \`risks\`: potential risks or things to verify

If no patch is needed, return:
\`\`\`json
{ "summary": "No changes needed", "patches": [], "commandsToRunManually": [], "risks": [] }
\`\`\`

Return ONLY the JSON object — no markdown fences around it, no other text.`;
}

// ── Blocked patterns in AI patch paths ───────────────────────────────────────

const BLOCKED_PATH_PATTERNS = [
  /\.env($|\.)/i,         // .env, .env.local, etc.
  /\/etc\//,
  /\/home\/prisom\/prisom-panel/,
  /\.pem$/i,
  /\.key$/i,
  /\.crt$/i,
  /node_modules/,
  /\.git\//,
  /\.next\//,
  /\/dist\//,
  /\/build\//,
];

function isBlockedPatchPath(p: string): boolean {
  return BLOCKED_PATH_PATTERNS.some((rx) => rx.test(p));
}

// ── Main patch suggestion function ────────────────────────────────────────────

/**
 * Ask the AI to suggest patches for the given instruction and selected files.
 *
 * Returns a structured PatchSuggestion.
 * Caller must verify ownership and sanitise file paths before calling.
 */
export async function buildPatchSuggestion(
  projectId:     string,
  instruction:   string,
  selectedFiles: SelectedFileForPatch[],
): Promise<{ ok: true; data: PatchSuggestion } | { ok: false; error: string; code?: string }> {
  // Build base project context
  const contextResult = await buildProjectAiContext(projectId, {
    includeEnvKeys:    true,
    includeDomains:    false,
    includeDeployment: true,
    includeLiveStatus: false,
    includeGitInfo:    false,
  });
  if (!contextResult.ok) {
    return { ok: false, error: contextResult.error, code: "CONTEXT_ERROR" };
  }

  const patchSystemPrompt = buildPatchSystemPrompt(contextResult.systemPrompt);

  // Build user message: instruction + selected file contents
  const fileBlocks = selectedFiles.map((f) => {
    // Trim to AI context limit
    const content = f.content.length > MAX_FILE_AI_BYTES
      ? f.content.slice(0, MAX_FILE_AI_BYTES) + "\n\n[... file truncated for AI context ...]"
      : f.content;
    return `### Selected file: ${f.path}\n\`\`\`\n${redact(content)}\n\`\`\``;
  });

  const userMessage = [
    `## Instruction`,
    redact(instruction),
    "",
    `## Selected files`,
    ...fileBlocks,
    "",
    "Respond with only the JSON patch object as described in the system prompt.",
  ].join("\n");

  // Call AI provider
  const aiResult = await completeWithProjectAi(patchSystemPrompt, [
    { role: "user", content: userMessage },
  ]);

  if (!aiResult.ok) {
    return { ok: false, error: aiResult.error, code: aiResult.code };
  }

  // Parse JSON response defensively
  const raw = aiResult.text.trim();
  let parsed: PatchSuggestion | null = null;

  // Strip markdown fences if the AI added them despite instructions
  const jsonText = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();

  try {
    const obj = JSON.parse(jsonText);
    parsed = normaliseParsedPatch(obj, selectedFiles);
  } catch {
    // JSON parse failed — return raw text as fallback
    return {
      ok:   true,
      data: {
        summary:     "AI returned a suggestion (could not parse as structured patch)",
        patches:     [],
        risks:       ["Manually review the suggestion below before making any changes."],
        rawFallback: raw,
      },
    };
  }

  return { ok: true, data: parsed };
}

// ── Normalise and validate parsed patch ────────────────────────────────────────

function normaliseParsedPatch(
  obj:           unknown,
  selectedFiles: SelectedFileForPatch[],
): PatchSuggestion {
  if (typeof obj !== "object" || obj === null) {
    return { summary: "Invalid AI response", patches: [], risks: ["Could not parse AI response."] };
  }

  const o = obj as Record<string, unknown>;

  const summary = typeof o.summary === "string" ? o.summary.slice(0, 500) : "AI patch suggestion";

  const risks = Array.isArray(o.risks)
    ? (o.risks as unknown[]).filter((r) => typeof r === "string").map((r) => String(r).slice(0, 500))
    : [];

  const commandsToRunManually = Array.isArray(o.commandsToRunManually)
    ? (o.commandsToRunManually as unknown[]).filter((c) => typeof c === "string").map((c) => String(c).slice(0, 300))
    : [];

  const allowedPaths = new Set(selectedFiles.map((f) => f.path));

  const rawPatches = Array.isArray(o.patches) ? (o.patches as unknown[]) : [];
  const patches: PatchHunk[] = [];

  for (const raw of rawPatches.slice(0, 10)) {
    if (typeof raw !== "object" || raw === null) continue;
    const p = raw as Record<string, unknown>;

    const patchPath = typeof p.path === "string" ? p.path.trim() : "";
    if (!patchPath) continue;

    const type = p.type === "create" ? "create" : "modify";

    // Validate: must be in selected files (modify) or a safe new path (create)
    if (type === "modify" && !allowedPaths.has(patchPath)) {
      patches.push({
        path:        patchPath,
        type:        "modify",
        unifiedDiff: "",
        warnings:    [`⛔ Patch rejected: "${patchPath}" was not in the selected files.`],
      });
      continue;
    }

    // Block dangerous paths
    if (isBlockedPatchPath(patchPath)) {
      patches.push({
        path:        patchPath,
        type,
        unifiedDiff: "",
        warnings:    [`⛔ Patch rejected: "${patchPath}" is a blocked file path.`],
      });
      continue;
    }

    // Validate new file paths for "create" type
    if (type === "create" && !isEditableTextFile(patchPath)) {
      patches.push({
        path:        patchPath,
        type:        "create",
        unifiedDiff: "",
        warnings:    [`⛔ Patch rejected: "${patchPath}" is not an editable file type.`],
      });
      continue;
    }

    const unifiedDiff      = typeof p.unifiedDiff      === "string" ? p.unifiedDiff.slice(0, 100_000)      : "";
    const proposedContent  = typeof p.proposedContent  === "string" ? p.proposedContent.slice(0, 300_000)  : undefined;
    const rawWarnings      = Array.isArray(p.warnings) ? (p.warnings as unknown[]).filter((w) => typeof w === "string") : [];
    const warnings         = rawWarnings.map((w) => String(w).slice(0, 300));

    patches.push({ path: patchPath, type, unifiedDiff, proposedContent, warnings });
  }

  return { summary, patches, commandsToRunManually, risks };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Sprint 11 — Structured AI Patch Plan
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Sprint 11 patch plan — replaces the old PatchSuggestion for the review
 * workflow.  Validation (safeToApply, blockedReason) is set server-side
 * in the action after running the validator; oldContent is also set
 * server-side from open editor contents or disk.
 */
export interface AiPatchPlan {
  summary:           string;
  riskLevel:         "low" | "medium" | "high";
  warnings:          string[];
  verificationSteps: string[];
  patches:           AiFilePatch[];
  /** Populated if JSON parsing failed — show raw text to user. */
  rawFallback?: string;
}

export interface AiFilePatch {
  /** UUID assigned server-side after parsing. */
  id:             string;
  path:           string;
  action:         "modify" | "create" | "delete";
  title:          string;
  explanation:    string;
  /** Current content — populated server-side from open editor tabs or disk. */
  oldContent?:    string;
  /** AI-proposed full content after the change. */
  newContent?:    string;
  /** AI-generated unified diff (display hint — not used for apply). */
  unifiedDiff?:   string;
  /** Set by server-side validator. */
  safeToApply:    boolean;
  blockedReason?: string;
}

// ── System prompt for Sprint 11 structured patch plan ─────────────────────────

function buildPatchPlanSystemPrompt(projectSystemPrompt: string): string {
  return `${projectSystemPrompt}

---

## STRUCTURED PATCH PLAN MODE (Sprint 11)

You are operating in safe, structured patch plan mode.

### Rules you MUST follow:
- Propose ONLY changes to the files explicitly listed in the "Selected files" section.
- For new files ("create" action), use a relative path like \`docs/notes.md\` — never absolute.
- Never propose changes to: .env, .env.*, .git/config, node_modules/*, .next/*, dist/*, build/*, binary files, or secret files.
- Never reveal secret values or database credentials.
- Never include shell commands, npm install instructions, or pm2 restart commands in newContent.
- Never propose more than 10 patches in one plan.
- For "modify" action: return the COMPLETE new file content in newContent, not just the changed lines.
- For "create" action: return the COMPLETE new file content in newContent.
- For "delete" action: do NOT include newContent; just set the action to "delete" with a clear explanation.

### Response format — return ONLY valid JSON, no markdown fences, no prose:

{
  "summary": "One concise sentence describing the overall change",
  "riskLevel": "low",
  "warnings": ["Any caution the user should know before applying"],
  "verificationSteps": ["pnpm run typecheck", "pnpm run build"],
  "patches": [
    {
      "path": "src/App.tsx",
      "action": "modify",
      "title": "Add loading state to root component",
      "explanation": "Adds a boolean isLoading state and renders a spinner...",
      "newContent": "...complete file content after the change..."
    }
  ]
}

riskLevel values: "low" (cosmetic/safe), "medium" (logic change), "high" (deletes data, changes auth, touches config)

If no change is needed:
{ "summary": "No changes needed", "riskLevel": "low", "warnings": [], "verificationSteps": [], "patches": [] }

Return ONLY the JSON — nothing else.`;
}

// ── Raw shape returned by AI (before validation) ──────────────────────────────

interface RawAiPatchItem {
  path?:        unknown;
  action?:      unknown;
  title?:       unknown;
  explanation?: unknown;
  newContent?:  unknown;
  unifiedDiff?: unknown;
}

interface RawAiPatchPlanObj {
  summary?:           unknown;
  riskLevel?:         unknown;
  warnings?:          unknown;
  verificationSteps?: unknown;
  patches?:           unknown;
}

// ── Normalise raw parsed plan (no validation — caller does that) ──────────────

function normaliseAiPatchPlan(
  raw:           unknown,
  selectedPaths: Set<string>,
): Omit<AiPatchPlan, "patches"> & { rawPatches: RawAiPatchItem[] } {
  if (typeof raw !== "object" || raw === null) {
    return {
      summary:           "Invalid AI response",
      riskLevel:         "high",
      warnings:          ["Could not parse AI response as JSON."],
      verificationSteps: [],
      rawPatches:        [],
    };
  }

  const o = raw as RawAiPatchPlanObj;

  const summary = typeof o.summary === "string" ? o.summary.slice(0, 500) : "AI patch plan";

  const riskLevelRaw = typeof o.riskLevel === "string" ? o.riskLevel.toLowerCase() : "medium";
  const riskLevel: AiPatchPlan["riskLevel"] =
    riskLevelRaw === "low" ? "low" : riskLevelRaw === "high" ? "high" : "medium";

  const warnings = Array.isArray(o.warnings)
    ? (o.warnings as unknown[]).filter((w) => typeof w === "string").map((w) => String(w).slice(0, 400))
    : [];

  const verificationSteps = Array.isArray(o.verificationSteps)
    ? (o.verificationSteps as unknown[]).filter((s) => typeof s === "string").map((s) => String(s).slice(0, 200))
    : [];

  const rawPatches: RawAiPatchItem[] = Array.isArray(o.patches)
    ? (o.patches as unknown[]).filter((p) => typeof p === "object" && p !== null) as RawAiPatchItem[]
    : [];

  return { summary, riskLevel, warnings, verificationSteps, rawPatches };
}

// ── Main Sprint 11 function ───────────────────────────────────────────────────

/**
 * Generate a structured AI patch plan for the given instruction and files.
 *
 * Returns raw parsed patches (not yet validated for path safety — that step
 * happens in the server action which has access to the project root).
 *
 * Caller must:
 *  - Verify ownership.
 *  - Sanitise + redact file content before calling.
 *  - Run each patch through ai-patch-validator.ts after receiving the plan.
 */
export async function generateAiPatchPlan(
  projectId:     string,
  instruction:   string,
  selectedFiles: SelectedFileForPatch[],
): Promise<
  | { ok: true;  data: { raw: ReturnType<typeof normaliseAiPatchPlan> } }
  | { ok: false; error: string; code?: string }
> {
  // Build base project context
  const contextResult = await buildProjectAiContext(projectId, {
    includeEnvKeys:    true,
    includeDomains:    false,
    includeDeployment: true,
    includeLiveStatus: false,
    includeGitInfo:    false,
  });
  if (!contextResult.ok) {
    return { ok: false, error: contextResult.error, code: "CONTEXT_ERROR" };
  }

  const systemPrompt = buildPatchPlanSystemPrompt(contextResult.systemPrompt);

  // Build user message
  const fileBlocks = selectedFiles.map((f) => {
    const content = f.content.length > MAX_FILE_AI_BYTES
      ? f.content.slice(0, MAX_FILE_AI_BYTES) + "\n\n[... file truncated ...]"
      : f.content;
    return `### File: ${f.path}\n\`\`\`\n${redact(content)}\n\`\`\``;
  });

  const userMessage = [
    `## Instruction`,
    redact(instruction),
    "",
    `## Selected files`,
    ...fileBlocks,
    "",
    "Return ONLY the JSON patch plan object. No markdown. No prose.",
  ].join("\n");

  // Call AI with larger token budget for patch generation
  const aiResult = await completeWithProjectAi(
    systemPrompt,
    [{ role: "user", content: userMessage }],
    { maxTokens: MAX_TOKENS_PATCH_GEN },
  );

  if (!aiResult.ok) {
    return { ok: false, error: aiResult.error, code: aiResult.code };
  }

  // Parse JSON
  const rawText = aiResult.text.trim();
  const jsonText = rawText
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return {
      ok: true,
      data: {
        raw: {
          summary:           "AI returned a suggestion (could not parse as JSON)",
          riskLevel:         "high" as const,
          warnings:          ["The AI response could not be parsed as a structured patch plan."],
          verificationSteps: [],
          rawPatches:        [],
          rawFallback:       rawText,
        },
      },
    };
  }

  const selectedPaths = new Set(selectedFiles.map((f) => f.path));
  const normalised = normaliseAiPatchPlan(parsed, selectedPaths);

  return { ok: true, data: { raw: normalised } };
}

// Re-export normaliseAiPatchPlan return type helper for use in server action
export type NormalisedPatchPlanRaw = ReturnType<typeof normaliseAiPatchPlan>;
