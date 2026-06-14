/**
 * LocalShop / Doorsteps deployment service.
 *
 * Runs git, npm, and pm2 commands on the VPS where this panel is hosted.
 * The Prisom Project Panel and LocalShop share the same VPS, so all
 * commands run locally using cwd from the static deployment config.
 *
 * NEVER import this in client components.
 * NEVER accept arbitrary command strings from the frontend.
 */

import { runCommand, runPipeline, type PipelineResult } from "@/lib/server/command-runner";
import { getDeploymentConfig } from "@/lib/projects/deployment-config";

// ─── Config lookup ────────────────────────────────────────────────────────────

function requireConfig(projectSlug: string) {
  const config = getDeploymentConfig(projectSlug);
  if (!config) {
    throw new Error(
      `No deployment config found for project slug "${projectSlug}". ` +
        `Add it to lib/projects/deployment-config.ts first.`
    );
  }
  return config;
}

// ─── Read-only status queries ─────────────────────────────────────────────────

export interface GitStatus {
  branch: string;
  statusLines: string[];   // "M apps/backend/src/main.ts", "?? new-file.ts"
  recentCommits: string[]; // "abc1234 commit message"
}

export async function getGitStatus(projectSlug: string): Promise<GitStatus> {
  const { repoPath } = requireConfig(projectSlug);

  const [statusRes, branchRes, logRes] = await Promise.all([
    runCommand("git", ["status", "--short"], { cwd: repoPath }),
    runCommand("git", ["branch", "--show-current"], { cwd: repoPath }),
    runCommand("git", ["log", "--oneline", "-10"], { cwd: repoPath }),
  ]);

  return {
    branch: branchRes.stdout.trim(),
    statusLines: statusRes.stdout.trim().split("\n").filter(Boolean),
    recentCommits: logRes.stdout.trim().split("\n").filter(Boolean),
  };
}

export async function getRecentCommits(
  projectSlug: string,
  count = 20
): Promise<string[]> {
  const { repoPath } = requireConfig(projectSlug);
  const res = await runCommand(
    "git",
    ["log", "--oneline", `-${count}`],
    { cwd: repoPath }
  );
  return res.stdout.trim().split("\n").filter(Boolean);
}

// ─── PM2 status ───────────────────────────────────────────────────────────────

export interface Pm2App {
  name: string;
  status: string;
  pid: number | null;
  memoryMb: number;
  cpu: number;
  restarts: number;
  uptime: number | null;
}

export interface Pm2Status {
  apps: Pm2App[];
  error?: string;
}

export async function getPm2Status(projectSlug: string): Promise<Pm2Status> {
  const config = requireConfig(projectSlug);
  const result = await runCommand("pm2", ["jlist"], {
    cwd: config.repoPath,
    timeoutMs: 15_000,
  });

  if (result.exitCode !== 0) {
    return { apps: [], error: result.stderr || "pm2 returned a non-zero exit code" };
  }

  let list: unknown[];
  try {
    list = JSON.parse(result.stdout);
    if (!Array.isArray(list)) list = [];
  } catch {
    return { apps: [], error: "Failed to parse pm2 jlist JSON output" };
  }

  const apps: Pm2App[] = (list as Record<string, unknown>[])
    .filter((p) => config.pm2Apps.includes(p.name as string))
    .map((p) => {
      const env = p.pm2_env as Record<string, unknown> | undefined;
      const monit = p.monit as Record<string, unknown> | undefined;
      return {
        name: p.name as string,
        status: (env?.status as string) ?? "unknown",
        pid: (p.pid as number | null) ?? null,
        memoryMb: Math.round(((monit?.memory as number) ?? 0) / 1024 / 1024),
        cpu: (monit?.cpu as number) ?? 0,
        restarts: (env?.restart_time as number) ?? 0,
        uptime: (env?.pm_uptime as number | null) ?? null,
      };
    });

  return { apps };
}

// ─── PM2 logs ─────────────────────────────────────────────────────────────────

export async function getPm2Logs(projectSlug: string): Promise<string> {
  const config = requireConfig(projectSlug);
  const sections: string[] = [];

  for (const appName of config.pm2Apps) {
    sections.push(`\n═══ ${appName} ═══`);
    const res = await runCommand(
      "pm2",
      ["logs", appName, "--lines", "80", "--nostream"],
      { cwd: config.repoPath, timeoutMs: 30_000 }
    );
    const text = (res.stdout || res.stderr || "(no output)").trimEnd();
    sections.push(text);
  }

  return sections.join("\n");
}

// ─── Deploy latest ────────────────────────────────────────────────────────────

export interface DeployResult extends PipelineResult {
  commitSha?: string;
}

export async function deployLatest(projectSlug: string): Promise<DeployResult> {
  const config = requireConfig(projectSlug);
  const cwd = config.repoPath;

  const result = await runPipeline(
    [
      {
        label: "git fetch origin",
        cmd: "git",
        args: ["fetch", "origin"],
        timeoutMs: 30_000,
      },
      {
        label: `git pull origin ${config.branch}`,
        cmd: "git",
        args: ["pull", "origin", config.branch],
        timeoutMs: 60_000,
      },
      {
        label: "npm run db:generate",
        cmd: "npm",
        args: ["run", "db:generate"],
        timeoutMs: 120_000,
      },
      {
        label: "build apps/backend",
        cmd: "npm",
        args: ["--workspace=apps/backend", "run", "build"],
        timeoutMs: 300_000,
      },
      {
        label: "build apps/manager-web",
        cmd: "npm",
        args: ["--workspace=apps/manager-web", "run", "build"],
        timeoutMs: 300_000,
      },
      {
        label: "pm2 restart prisom-backend",
        cmd: "pm2",
        args: ["restart", "prisom-backend", "--update-env"],
        timeoutMs: 30_000,
      },
      {
        label: "pm2 restart prisom-manager",
        cmd: "pm2",
        args: ["restart", "prisom-manager"],
        timeoutMs: 30_000,
      },
      {
        label: "pm2 save",
        cmd: "pm2",
        args: ["save"],
        timeoutMs: 15_000,
      },
    ],
    cwd
  );

  // Resolve the HEAD commit SHA after the pull (non-critical)
  let commitSha: string | undefined;
  try {
    const shaRes = await runCommand(
      "git",
      ["rev-parse", "--short", "HEAD"],
      { cwd, timeoutMs: 5_000 }
    );
    if (shaRes.exitCode === 0) commitSha = shaRes.stdout.trim() || undefined;
  } catch {
    /* non-critical */
  }

  return { ...result, commitSha };
}

// ─── Rollback to commit ───────────────────────────────────────────────────────

export async function rollbackToCommit(
  projectSlug: string,
  commitHash: string
): Promise<PipelineResult> {
  // Strict hex validation — reject before running any command
  if (!/^[a-f0-9]{7,40}$/i.test(commitHash)) {
    return {
      success: false,
      output: `Rejected: invalid commit hash "${commitHash}". Must be 7–40 hex characters.`,
      durationMs: 0,
    };
  }

  const config = requireConfig(projectSlug);
  const cwd = config.repoPath;

  // Verify commit exists in the repository before touching working tree
  const verify = await runCommand(
    "git",
    ["cat-file", "-e", `${commitHash}^{commit}`],
    { cwd, timeoutMs: 10_000 }
  );
  if (verify.exitCode !== 0) {
    return {
      success: false,
      output: `Commit ${commitHash} not found in this repository.`,
      durationMs: 0,
    };
  }

  return runPipeline(
    [
      {
        label: `git checkout ${commitHash}`,
        cmd: "git",
        args: ["checkout", commitHash],
        timeoutMs: 30_000,
      },
      {
        label: "npm run db:generate",
        cmd: "npm",
        args: ["run", "db:generate"],
        timeoutMs: 120_000,
      },
      {
        label: "build apps/backend",
        cmd: "npm",
        args: ["--workspace=apps/backend", "run", "build"],
        timeoutMs: 300_000,
      },
      {
        label: "build apps/manager-web",
        cmd: "npm",
        args: ["--workspace=apps/manager-web", "run", "build"],
        timeoutMs: 300_000,
      },
      {
        label: "pm2 restart prisom-backend",
        cmd: "pm2",
        args: ["restart", "prisom-backend", "--update-env"],
        timeoutMs: 30_000,
      },
      {
        label: "pm2 restart prisom-manager",
        cmd: "pm2",
        args: ["restart", "prisom-manager"],
        timeoutMs: 30_000,
      },
      {
        label: "pm2 save",
        cmd: "pm2",
        args: ["save"],
        timeoutMs: 15_000,
      },
    ],
    cwd
  );
}
