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

import { completeWithProjectAi }     from "@/lib/ai/provider";
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
