"use server";

/**
 * app/actions/project-ai.ts
 *
 * Sprint 5: server actions for the project AI assistant.
 *
 * Safety rules enforced here:
 *  - Ownership verified on every call.
 *  - Secret values are NEVER decrypted or passed to the AI provider.
 *  - Env var keys only — never values.
 *  - No shell execution, no file writes, no PM2 restarts.
 *  - ANTHROPIC_API_KEY is never returned to the client.
 *  - All user messages and context pass through redact().
 */

import { getCurrentWorkspaceId } from "@/lib/current-workspace";
import { db } from "@/lib/db";
import { buildProjectAiContext } from "@/lib/ai/project-context";
import { completeWithProjectAi, type AiMessage } from "@/lib/ai/provider";
import { redact } from "@/lib/ai/redaction";

// ── Shared result type ─────────────────────────────────────────────────────

export type ActionResult<T = unknown> =
  | { ok: true;  data?: T;  message?: string }
  | { ok: false; error: string; code?: string };

// ── Bootstrap ──────────────────────────────────────────────────────────────

export interface AiBootstrapInfo {
  projectName:   string;
  hasApiKey:     boolean;
  /** Safe summary of what context is available (no secret values). */
  contextSummary: string;
}

/**
 * Called once on page load to determine if the AI assistant is configured
 * and provide a summary of available project context.
 */
export async function getProjectAiBootstrapAction(
  projectId: string,
): Promise<ActionResult<AiBootstrapInfo>> {
  // Verify ownership
  const workspaceId = await getCurrentWorkspaceId().catch(() => null);
  if (!workspaceId) {
    return { ok: false, error: "Not authenticated.", code: "FORBIDDEN" };
  }
  const project = await db.project.findUnique({
    where:  { id: projectId },
    select: { id: true, name: true, workspaceId: true },
  });
  if (!project || project.workspaceId !== workspaceId) {
    return { ok: false, error: "Project not found.", code: "FORBIDDEN" };
  }

  const hasApiKey = !!process.env.ANTHROPIC_API_KEY;

  // Build a quick context summary (no secret values)
  const [deploymentConfig, envCount, domainCount] = await Promise.all([
    db.projectDeploymentConfig.findUnique({
      where:  { projectId },
      select: { port: true, pm2Name: true, runtime: true },
    }),
    db.projectEnvVar.count({ where: { projectId, isEnabled: true } }),
    db.domain.count({ where: { projectId } }),
  ]);

  const parts: string[] = [];
  if (deploymentConfig) {
    parts.push(`port ${deploymentConfig.port}`);
    if (deploymentConfig.pm2Name)  parts.push(`PM2: ${deploymentConfig.pm2Name}`);
    if (deploymentConfig.runtime)  parts.push(`runtime: ${deploymentConfig.runtime}`);
  }
  if (envCount > 0)    parts.push(`${envCount} env var key(s)`);
  if (domainCount > 0) parts.push(`${domainCount} domain(s)`);

  const contextSummary = parts.length > 0
    ? `Available: ${parts.join(", ")}.`
    : "No deployment config yet.";

  return {
    ok:   true,
    data: {
      projectName:    project.name,
      hasApiKey,
      contextSummary,
    },
  };
}

// ── Ask ────────────────────────────────────────────────────────────────────

export interface AiAskInput {
  projectId: string;
  /** Full conversation history (user + assistant turns). */
  messages: AiMessage[];
  /** Which context sections to include. */
  contextOptions?: {
    includeEnvKeys?:    boolean;
    includeDomains?:    boolean;
    includeDeployment?: boolean;
    includeLiveStatus?: boolean;
    includeGitInfo?:    boolean;
  };
}

export interface AiAskOutput {
  text:         string;
  model:        string;
  inputTokens:  number;
  outputTokens: number;
}

/**
 * Send a message to the AI assistant with project context.
 *
 * The caller provides the full conversation history (user + assistant turns).
 * The last message must have role "user".
 *
 * Returns the assistant's reply text.
 */
export async function askProjectAiAction(
  input: AiAskInput,
): Promise<ActionResult<AiAskOutput>> {
  const { projectId, messages, contextOptions = {} } = input;

  // Verify ownership
  const workspaceId = await getCurrentWorkspaceId().catch(() => null);
  if (!workspaceId) {
    return { ok: false, error: "Not authenticated.", code: "FORBIDDEN" };
  }
  const project = await db.project.findUnique({
    where:  { id: projectId },
    select: { id: true, workspaceId: true },
  });
  if (!project || project.workspaceId !== workspaceId) {
    return { ok: false, error: "Project not found.", code: "FORBIDDEN" };
  }

  // Validate messages
  if (!messages || messages.length === 0) {
    return { ok: false, error: "No messages provided." };
  }
  const lastMsg = messages[messages.length - 1];
  if (lastMsg.role !== "user") {
    return { ok: false, error: "Last message must be from the user." };
  }

  // Sanitise messages — redact any secrets that may have been pasted
  const safeMessages: AiMessage[] = messages.map((m) => ({
    role:    m.role,
    content: redact(m.content),
  }));

  // Build project context system prompt
  const contextResult = await buildProjectAiContext(projectId, contextOptions);
  if (!contextResult.ok) {
    return { ok: false, error: contextResult.error, code: "CONTEXT_ERROR" };
  }

  // Call AI provider
  const result = await completeWithProjectAi(
    contextResult.systemPrompt,
    safeMessages,
  );

  if (!result.ok) {
    return { ok: false, error: result.error, code: result.code };
  }

  return {
    ok:   true,
    data: {
      text:         result.text,
      model:        result.model,
      inputTokens:  result.inputTokens,
      outputTokens: result.outputTokens,
    },
  };
}
