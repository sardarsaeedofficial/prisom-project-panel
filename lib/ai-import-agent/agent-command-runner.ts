/**
 * lib/ai-import-agent/agent-command-runner.ts
 *
 * Sprint 89: Runs the actual install/build/start cycle via the existing
 * deployProjectAction() (lib/projects/project-deploy-runner.ts) and splits
 * its combined log output into per-phase segments for the live timeline.
 *
 * deployProjectAction runs install → build → PM2 start synchronously and
 * returns the full combined log as `output`. This module never re-implements
 * command execution — it only parses the existing log markers
 * ("▶ Install:", "▶ Build:", "▶ Starting PM2 process:") that
 * lib/projects/project-deploy-runner.ts already writes.
 */

import { deployProjectAction, type DeployActionResult } from "@/app/actions/project-deployments";

export type DeploySegments = {
  install?: string;
  build?: string;
  start?: string;
};

const MARKERS = [
  { key: "install" as const, re: /▶ Install:/ },
  { key: "build"   as const, re: /▶ Build:/ },
  { key: "start"   as const, re: /▶ Starting PM2 process:/ },
];

export function splitDeployOutput(output: string): DeploySegments {
  if (!output) return {};

  const indices: { key: keyof DeploySegments; start: number }[] = [];
  for (const m of MARKERS) {
    const match = m.re.exec(output);
    if (match) indices.push({ key: m.key, start: match.index });
  }
  indices.sort((a, b) => a.start - b.start);

  const segments: DeploySegments = {};
  for (let i = 0; i < indices.length; i++) {
    const start = indices[i].start;
    const end   = i + 1 < indices.length ? indices[i + 1].start : output.length;
    segments[indices[i].key] = output.slice(start, end).trim();
  }
  return segments;
}

export type AgentDeployResult = DeployActionResult & { segments: DeploySegments };

/** Runs install+build+start via the existing deploy runner and parses segments for the timeline. */
export async function runAgentDeploy(projectId: string): Promise<AgentDeployResult> {
  const result = await deployProjectAction(projectId);
  const segments = splitDeployOutput(result.output ?? "");
  return { ...result, segments };
}
