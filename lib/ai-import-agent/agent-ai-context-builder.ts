/**
 * lib/ai-import-agent/agent-ai-context-builder.ts
 *
 * Sprint 93: Builds a redacted project context specifically for the AI
 * Coding Import Agent. Includes deployment config, key source files,
 * release dir inspection, PM2 logs, and preview check results.
 *
 * Safety rules:
 *  - Never includes env var VALUES — only key names.
 *  - All text is passed through redact() before leaving this module.
 *  - Logs are capped at 200 lines.
 *  - File contents are capped at 60 KB each.
 *  - No .env or credential files are read.
 *  - Never exposes DATABASE_URL, SESSION_SECRET, or any other secret.
 */

import path    from "path";
import { promises as fs } from "fs";
import { db }  from "@/lib/db";
import { redact } from "@/lib/ai/redaction";
import { getProjectFileRoot } from "@/lib/projects/file-manager";
import { getPm2AppLogs }      from "@/lib/projects/project-deploy-runner";
import { findLatestReleasePath, checkIndexHtmlAt, FRONTEND_INDEX_HTML_CANDIDATE_DIRS } from "./agent-output-inspector";
import type { AgentPreviewResult } from "./agent-preview-checker";

export type ImportAiContext = {
  systemPrompt: string;
  userDiagnosticBlock: string;
};

// ── Key source files to inspect ───────────────────────────────────────────────

const KEY_SOURCE_FILES = [
  "package.json",
  "pnpm-workspace.yaml",
  "vite.config.ts",
  "vite.config.js",
  "artifacts/sardar-security/package.json",
  "artifacts/sardar-security/vite.config.ts",
  "artifacts/sardar-security/vite.config.js",
  "artifacts/api-server/package.json",
];

const MAX_FILE_CHARS = 8_000;
const MAX_LOG_LINES  = 200;

// ── Safe read of a source file relative to project root ──────────────────────

async function safeReadSourceFile(projectRoot: string, relPath: string): Promise<string | null> {
  try {
    const abs = path.resolve(projectRoot, relPath);
    // Ensure within project root (prevent traversal)
    if (!abs.startsWith(projectRoot)) return null;
    const stat = await fs.stat(abs).catch(() => null);
    if (!stat || !stat.isFile() || stat.size > 200_000) return null;
    const content = await fs.readFile(abs, "utf8");
    return content.length > MAX_FILE_CHARS
      ? content.slice(0, MAX_FILE_CHARS) + "\n... [truncated]"
      : content;
  } catch {
    return null;
  }
}

// ── Build context for AI ──────────────────────────────────────────────────────

export async function buildImportAiContext(input: {
  projectId: string;
  previewResult?: AgentPreviewResult;
  deployLog?: string;
  errorKind?: string;
}): Promise<{ ok: true; context: ImportAiContext } | { ok: false; error: string }> {
  const { projectId, previewResult, deployLog, errorKind } = input;

  // ── Load project + deployment config ──────────────────────────────────────
  const project = await db.project.findUnique({
    where:  { id: projectId },
    select: {
      id: true, slug: true, name: true,
      installCommand: true, buildCommand: true, startCommand: true,
    },
  });
  if (!project) return { ok: false, error: "Project not found." };

  const config = await db.projectDeploymentConfig.findUnique({
    where:  { projectId },
    select: {
      port: true, pm2Name: true, runtime: true,
      routeMode: true, staticOutputDir: true, publicStaticPath: true,
      apiPrefix: true, healthPath: true,
      installCommand: true, buildCommand: true, startCommand: true,
    },
  });

  // ── Env var keys (never values) ───────────────────────────────────────────
  const envVars = await db.projectEnvVar.findMany({
    where:   { projectId },
    select:  { name: true, isEnabled: true },
    orderBy: { name: "asc" },
  });
  const envKeyList = envVars.filter((v) => v.isEnabled).map((v) => v.name);

  // ── PM2 logs (last 200 lines, sanitized) ──────────────────────────────────
  let pm2Logs = "";
  if (config?.pm2Name) {
    try {
      const rawLogs = await getPm2AppLogs(config.pm2Name, MAX_LOG_LINES);
      pm2Logs = redact(rawLogs.slice(0, 8_000));
    } catch {
      pm2Logs = "(could not read PM2 logs)";
    }
  }

  // ── Source file root ──────────────────────────────────────────────────────
  const rootResult = await getProjectFileRoot(projectId);
  const projectRoot = rootResult.ok ? rootResult.root : null;

  // ── Key config file contents ──────────────────────────────────────────────
  const fileSnippets: string[] = [];
  if (projectRoot) {
    for (const relPath of KEY_SOURCE_FILES) {
      const content = await safeReadSourceFile(projectRoot, relPath);
      if (content) {
        fileSnippets.push(
          `### ${relPath}\n\`\`\`\n${redact(content)}\n\`\`\``
        );
      }
    }
  }

  // ── Release dir inspection ────────────────────────────────────────────────
  const releasePath = findLatestReleasePath(project.slug);
  const releaseLines: string[] = [];
  if (releasePath) {
    releaseLines.push(`Latest release snapshot: ${path.basename(releasePath)}`);
    for (const candidate of FRONTEND_INDEX_HTML_CANDIDATE_DIRS) {
      const exists = checkIndexHtmlAt(releasePath, candidate);
      releaseLines.push(`  ${exists ? "✓" : "✗"} ${candidate}/index.html`);
    }
  } else {
    releaseLines.push("No release snapshot found.");
  }

  // ── Preview check results ─────────────────────────────────────────────────
  const previewLines: string[] = [];
  if (previewResult) {
    for (const check of previewResult.checks) {
      previewLines.push(`  ${check.status === "success" ? "✓" : "✗"} ${check.title}: ${check.summary}`);
    }
    if (previewResult.staticOutputMissing) {
      previewLines.push("  staticOutputMissing: true");
    }
  }

  // ── Deploy log snippet ────────────────────────────────────────────────────
  let deployLogSnippet = "";
  if (deployLog) {
    const lines = redact(deployLog).split("\n");
    const tail = lines.slice(-100).join("\n");
    deployLogSnippet = tail.slice(0, 4_000);
  }

  // ── System prompt ─────────────────────────────────────────────────────────
  const installCmd  = config?.installCommand ?? project.installCommand ?? "(none)";
  const buildCmd    = config?.buildCommand   ?? project.buildCommand   ?? "(none)";
  const startCmd    = config?.startCommand   ?? project.startCommand   ?? "(none)";

  const systemPrompt = `You are an AI Coding Import Agent for the Prisom Project Panel.
Your job is to diagnose why this project is not live and produce a precise, safe fix plan.

## Rules
- Prefer deployment config changes over source code changes.
- If source code changes are needed, propose the COMPLETE new file content.
- NEVER include secret values, DATABASE_URL, or any credentials.
- NEVER suggest db:seed, DROP DATABASE, or destructive operations.
- NEVER touch prisom-manager, prisom-backend, or unrelated PM2 processes.
- NEVER edit files outside this project's source root.
- Return ONLY valid JSON matching the AiImportPlan schema. No prose. No markdown fences.

## AiImportPlan JSON schema
{
  "summary": "one-line summary",
  "confidence": "low" | "medium" | "high",
  "diagnosis": "detailed explanation of root cause",
  "recommendedActions": [
    {
      "id": "action-1",
      "kind": "update_deployment_config" | "edit_file" | "run_command" | "inspect_file" | "ask_user" | "manual_blocker",
      "title": "short action title",
      "reason": "why this action is needed",
      "safety": "safe" | "needs_approval" | "blocked",
      // For update_deployment_config:
      "configPatch": { "staticOutputDir": "artifacts/sardar-security/dist" },
      // For edit_file:
      "filePath": "artifacts/sardar-security/vite.config.ts",
      "proposedContent": "...complete new file content...",
      "unifiedDiff": "...diff...",
      // For run_command:
      "command": "pnpm install --frozen-lockfile"
    }
  ],
  "stopReason": "optional — only set if you cannot fix this"
}

## Allowed configPatch keys
staticOutputDir, routeMode, apiPrefix, healthPath, installCommand, buildCommand, startCommand

## Project: ${redact(project.name)} (${project.slug})
Port: ${config?.port ?? "?"}
PM2: ${redact(config?.pm2Name ?? "?")}
Route mode: ${config?.routeMode ?? "fullstack_node"}
staticOutputDir: ${config?.staticOutputDir ?? "(not set)"}
publicStaticPath: ${config?.publicStaticPath ?? "(not set)"}
apiPrefix: ${config?.apiPrefix ?? "/api"}
healthPath: ${config?.healthPath ?? "/"}
installCommand: ${redact(installCmd)}
buildCommand: ${redact(buildCmd)}
startCommand: ${redact(startCmd)}
Environment keys configured (values hidden): ${envKeyList.join(", ") || "(none)"}`;

  // ── User diagnostic block ─────────────────────────────────────────────────
  const userDiagnosticBlock = [
    "## Current error",
    errorKind ? `Error kind: ${errorKind}` : "Unknown error — check preview results and logs below.",
    "",
    "## Preview check results",
    previewLines.length > 0 ? previewLines.join("\n") : "(no preview result available)",
    "",
    "## Release directory — index.html search",
    releaseLines.join("\n"),
    "",
    fileSnippets.length > 0 ? "## Key source files" : "",
    ...fileSnippets,
    "",
    pm2Logs ? "## PM2 application logs (last 200 lines)" : "",
    pm2Logs ? pm2Logs : "",
    "",
    deployLogSnippet ? "## Last deploy log (tail)" : "",
    deployLogSnippet ? deployLogSnippet : "",
    "",
    "Produce a fix plan as JSON. Return ONLY the JSON object, no prose, no markdown fences.",
  ].filter((l) => l !== undefined).join("\n");

  return {
    ok: true,
    context: {
      systemPrompt: redact(systemPrompt),
      userDiagnosticBlock: redact(userDiagnosticBlock),
    },
  };
}
