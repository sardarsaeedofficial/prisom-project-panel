/**
 * lib/admin/admin-pm2-health.ts
 *
 * Sprint 31: Read-only PM2 process health for the Admin Console.
 *
 * Fetches all PM2 processes via `pm2 jlist` and returns status for:
 *   - prisom-projects          (this app)
 *   - project-*                (managed project processes)
 *   - prisom-manager           (Doorsteps — status-only, no controls)
 *   - prisom-backend           (Doorsteps — status-only, no controls)
 *
 * No kill / restart / delete operations are exposed here.
 */

import { runCommand } from "@/lib/server/command-runner";
import type { AdminPm2Process } from "./admin-health-types";

// ── Internal PM2 jlist entry shape ────────────────────────────────────────────

type Pm2Entry = {
  name?:    string;
  pid?:     number | null;
  pm2_env?: {
    status?:       string;
    pm_uptime?:    number | null;
    restart_time?: number;
  };
  monit?: {
    memory?: number;
    cpu?:    number;
  };
};

// ── Process name classifiers ──────────────────────────────────────────────────

function isKnownProcess(name: string): boolean {
  if (name === "prisom-projects") return true;
  if (name === "prisom-manager")  return true;
  if (name === "prisom-backend")  return true;
  if (name.startsWith("project-")) return true;
  return false;
}

/** True = created/managed by this Prisom Panel app */
function isManagedProcess(name: string): boolean {
  return name === "prisom-projects" || name.startsWith("project-");
}

// ── PM2 status → health colour ────────────────────────────────────────────────

export function pm2OverallStatus(
  processes: AdminPm2Process[],
): "healthy" | "warning" | "critical" | "unknown" {
  if (processes.length === 0) return "unknown";
  const managed = processes.filter((p) => p.isManaged);
  if (managed.length === 0) return "unknown";

  const hasErrored  = managed.some((p) => p.status === "errored");
  const hasStopped  = managed.some((p) => p.status === "stopped");
  const allOnline   = managed.every((p) => p.status === "online");

  if (hasErrored)  return "critical";
  if (hasStopped)  return "warning";
  if (allOnline)   return "healthy";
  return "warning";
}

// ── Public ────────────────────────────────────────────────────────────────────

export type Pm2HealthResult = {
  status:    "healthy" | "warning" | "critical" | "unknown";
  processes: AdminPm2Process[];
};

export async function getPm2Health(): Promise<Pm2HealthResult> {
  const r = await runCommand("pm2", ["jlist"], {
    cwd:       process.cwd(),
    timeoutMs: 12_000,
  }).catch(() => null);

  if (!r || r.exitCode !== 0) {
    return { status: "unknown", processes: [] };
  }

  let list: Pm2Entry[];
  try {
    const raw = r.stdout.trim() || "[]";
    list = JSON.parse(raw) as Pm2Entry[];
    if (!Array.isArray(list)) list = [];
  } catch {
    return { status: "unknown", processes: [] };
  }

  const processes: AdminPm2Process[] = list
    .filter((p) => typeof p.name === "string" && isKnownProcess(p.name))
    .map((p): AdminPm2Process => ({
      name:      p.name ?? "unknown",
      status:    p.pm2_env?.status ?? "unknown",
      pid:       p.pid ?? null,
      uptimeMs:  p.pm2_env?.pm_uptime ?? null,
      memoryMb:  p.monit?.memory != null
                   ? Math.round(p.monit.memory / 1024 / 1024)
                   : null,
      cpu:       p.monit?.cpu ?? null,
      restarts:  p.pm2_env?.restart_time ?? 0,
      isManaged: isManagedProcess(p.name ?? ""),
    }))
    .sort((a, b) => {
      // prisom-projects first, then project-*, then others
      if (a.name === "prisom-projects") return -1;
      if (b.name === "prisom-projects") return  1;
      if (a.name.startsWith("project-") && !b.name.startsWith("project-")) return -1;
      if (!a.name.startsWith("project-") && b.name.startsWith("project-")) return  1;
      return a.name.localeCompare(b.name);
    });

  const status = pm2OverallStatus(processes);
  return { status, processes };
}
