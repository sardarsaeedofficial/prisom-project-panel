/**
 * lib/ai/project-context.ts
 *
 * Builds a structured project context string for inclusion in the
 * AI assistant's system prompt.
 *
 * Safety rules:
 *  - NEVER decrypts env var values — only key names are included.
 *  - NEVER reads .env files from disk.
 *  - NEVER includes DATABASE_URL, JWT secrets, API keys, passwords,
 *    tokens, cookies, or other credentials.
 *  - All text passes through redact() as a final safety net.
 *  - Ownership is verified before any data is accessed.
 */

import { db } from "@/lib/db";
import { getCurrentWorkspaceId } from "@/lib/current-workspace";
import { resolveProjectLiveEndpoints } from "@/lib/projects/live-endpoint-resolver";
import { getPm2AppStatus } from "@/lib/projects/project-deploy-runner";
import { redact } from "@/lib/ai/redaction";

// ── Options ────────────────────────────────────────────────────────────────

export interface ProjectContextOptions {
  /** Include the env var KEY names (never values). Default: true */
  includeEnvKeys?:    boolean;
  /** Include domain list. Default: true */
  includeDomains?:    boolean;
  /** Include deployment config summary. Default: true */
  includeDeployment?: boolean;
  /** Include PM2 / live status. Default: true */
  includeLiveStatus?: boolean;
  /** Include recent commit list. Default: true */
  includeGitInfo?:    boolean;
}

// ── Result ─────────────────────────────────────────────────────────────────

export interface ProjectContext {
  /** Ownership verified and project found. */
  ok:          true;
  projectName: string;
  systemPrompt: string;
}

export interface ProjectContextError {
  ok:    false;
  error: string;
}

export type ProjectContextResult = ProjectContext | ProjectContextError;

// ── Builder ────────────────────────────────────────────────────────────────

export async function buildProjectAiContext(
  projectId: string,
  options: ProjectContextOptions = {},
): Promise<ProjectContextResult> {
  const {
    includeEnvKeys    = true,
    includeDomains    = true,
    includeDeployment = true,
    includeLiveStatus = true,
    includeGitInfo    = true,
  } = options;

  // ── Ownership check ──────────────────────────────────────────────────────
  let workspaceId: string;
  try {
    workspaceId = await getCurrentWorkspaceId();
  } catch {
    return { ok: false, error: "Could not determine workspace." };
  }

  const project = await db.project.findUnique({
    where:  { id: projectId },
    select: {
      id:             true,
      name:           true,
      slug:           true,
      description:    true,
      type:           true,
      status:         true,
      language:       true,
      framework:      true,
      installCommand: true,
      buildCommand:   true,
      startCommand:   true,
      workspaceId:    true,
    },
  });

  if (!project || project.workspaceId !== workspaceId) {
    return { ok: false, error: "Project not found or access denied." };
  }

  // ── Gather safe data in parallel ─────────────────────────────────────────
  const [
    deploymentConfig,
    envVars,
    domains,
    githubRepo,
    recentCommits,
    endpoints,
  ] = await Promise.all([
    includeDeployment
      ? db.projectDeploymentConfig.findUnique({
          where:  { projectId },
          select: {
            port:            true,
            pm2Name:         true,
            runtime:         true,
            healthPath:      true,
            loginPath:       true,
            primaryDomain:   true,
            validationStatus: true,
          },
        })
      : Promise.resolve(null),

    includeEnvKeys
      ? db.projectEnvVar.findMany({
          where:   { projectId },
          select:  { name: true, environment: true, isEnabled: true },
          orderBy: { name: "asc" },
        })
      : Promise.resolve([]),

    includeDomains
      ? db.domain.findMany({
          where:   { projectId },
          select:  { hostname: true, isPrimary: true, status: true, sslStatus: true },
          orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
        })
      : Promise.resolve([]),

    includeGitInfo
      ? db.gitHubRepository.findUnique({
          where:  { projectId },
          select: { fullName: true, defaultBranch: true },
        })
      : Promise.resolve(null),

    includeGitInfo
      ? db.gitCommit.findMany({
          where:   { projectId },
          select:  { message: true, authorName: true, committedAt: true },
          orderBy: { committedAt: "desc" },
          take:    5,
        })
      : Promise.resolve([]),

    includeLiveStatus
      ? resolveProjectLiveEndpoints(projectId).catch(() => null)
      : Promise.resolve(null),
  ]);

  // PM2 status — only if we have a pm2Name
  let pm2Status: string | null = null;
  if (includeLiveStatus && deploymentConfig?.pm2Name) {
    pm2Status = await getPm2AppStatus(deploymentConfig.pm2Name)
      .then((s) => s?.status ?? null)
      .catch(() => null);
  }

  // ── Assemble context sections ─────────────────────────────────────────────
  const lines: string[] = [];

  // Project identity
  lines.push("## Project Overview");
  lines.push(`Name:        ${redact(project.name)}`);
  lines.push(`Slug:        ${redact(project.slug)}`);
  if (project.description) {
    lines.push(`Description: ${redact(project.description)}`);
  }
  lines.push(`Type:        ${project.type}`);
  lines.push(`Status:      ${project.status}`);
  if (project.language)  lines.push(`Language:    ${project.language}`);
  if (project.framework) lines.push(`Framework:   ${project.framework}`);

  // Build / run commands (safe — no secrets here)
  if (project.installCommand || project.buildCommand || project.startCommand) {
    lines.push("");
    lines.push("## Build & Start");
    if (project.installCommand) lines.push(`Install: ${redact(project.installCommand)}`);
    if (project.buildCommand)   lines.push(`Build:   ${redact(project.buildCommand)}`);
    if (project.startCommand)   lines.push(`Start:   ${redact(project.startCommand)}`);
  }

  // Deployment config
  if (deploymentConfig) {
    lines.push("");
    lines.push("## Deployment Config");
    lines.push(`Port:    ${deploymentConfig.port}`);
    if (deploymentConfig.pm2Name)   lines.push(`PM2 name:    ${redact(deploymentConfig.pm2Name)}`);
    if (deploymentConfig.runtime)   lines.push(`Runtime:     ${deploymentConfig.runtime}`);
    if (deploymentConfig.healthPath) lines.push(`Health path: ${deploymentConfig.healthPath}`);
    if (deploymentConfig.loginPath)  lines.push(`Login path:  ${deploymentConfig.loginPath}`);
    if (deploymentConfig.primaryDomain) {
      lines.push(`Primary domain: ${redact(deploymentConfig.primaryDomain)}`);
    }
    if (deploymentConfig.validationStatus) {
      lines.push(`Validation: ${deploymentConfig.validationStatus}`);
    }
  }

  // Live status
  if (includeLiveStatus) {
    lines.push("");
    lines.push("## Live Status");
    lines.push(`PM2 process: ${pm2Status ?? "unknown"}`);
    if (endpoints) {
      lines.push(`Primary URL:  ${endpoints.primaryUrl ?? "none"}`);
      lines.push(`Internal URL: ${endpoints.internalUrl}`);
    } else {
      lines.push("No live endpoints resolved.");
    }
  }

  // Domains
  if (includeDomains && domains.length > 0) {
    lines.push("");
    lines.push("## Domains");
    for (const d of domains) {
      const primary = d.isPrimary ? " (primary)" : "";
      lines.push(`  ${d.hostname}${primary} — status: ${d.status}, SSL: ${d.sslStatus}`);
    }
  }

  // Env var KEYS only — never values
  if (includeEnvKeys && envVars.length > 0) {
    lines.push("");
    lines.push("## Environment Variable Keys (values are hidden)");
    lines.push("The following keys are configured. Values are encrypted and never shown.");
    const grouped: Record<string, string[]> = {};
    for (const v of envVars) {
      const env = v.environment ?? "all";
      if (!grouped[env]) grouped[env] = [];
      if (v.isEnabled) grouped[env].push(v.name);
    }
    for (const [env, keys] of Object.entries(grouped)) {
      lines.push(`  ${env}: ${keys.join(", ")}`);
    }
  }

  // GitHub / git info
  if (githubRepo) {
    lines.push("");
    lines.push("## GitHub Repository");
    lines.push(`Repo:   ${githubRepo.fullName}`);
    if (githubRepo.defaultBranch) {
      lines.push(`Branch: ${githubRepo.defaultBranch}`);
    }
    if (recentCommits.length > 0) {
      lines.push("Recent commits:");
      for (const c of recentCommits) {
        const date = c.committedAt instanceof Date
          ? c.committedAt.toISOString().slice(0, 10)
          : String(c.committedAt).slice(0, 10);
        const msg = redact(c.message.split("\n")[0].slice(0, 80));
        lines.push(`  ${date}  ${c.authorName}: ${msg}`);
      }
    }
  }

  const contextBody = lines.join("\n");

  // ── System prompt ─────────────────────────────────────────────────────────
  const systemPrompt = `You are an AI assistant for the Prisom Project Panel. You help developers understand, analyse, and improve their deployed Node.js / web projects.

## Your role
- Read and analyse the project context provided below.
- Answer questions about the project's configuration, live status, environment, and deployment.
- Suggest fixes, explain errors, and generate safe commands or code snippets the developer can run manually.
- You CANNOT make changes automatically. You CANNOT execute shell commands, edit files, restart PM2 processes, or modify Nginx. All suggestions must be reviewed and applied by the developer.
- Do NOT include secret values in your responses. If you see patterns that look like secrets, ignore them.
- Do NOT reference internal platform details (panel port, panel domain, other projects).
- Be concise and practical. If something is unclear from the context, say so.

## Project context
${contextBody}

Today's date: ${new Date().toISOString().slice(0, 10)}
`;

  return {
    ok:           true,
    projectName:  project.name,
    systemPrompt: redact(systemPrompt),
  };
}
