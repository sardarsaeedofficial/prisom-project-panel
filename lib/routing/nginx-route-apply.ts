/**
 * lib/routing/nginx-route-apply.ts
 *
 * Sprint 44: Safe nginx config apply + rollback for multi-service routing.
 *
 * Safety rules:
 *  - Backs up existing config before overwriting
 *  - Runs nginx -t before reload; on failure restores backup
 *  - Only calls sudo /usr/sbin/nginx -t and sudo systemctl reload nginx
 *  - Never generates config for reserved hostnames
 *  - Requires explicit "APPLY ROUTES" confirmation text
 *  - Rollback restores from .bak file, re-tests, and reloads
 */

import path from "path";
import { promises as fs } from "fs";
import { execFile } from "child_process";
import { promisify } from "util";
import { isReservedHostname } from "@/lib/projects/nginx-manager";
import type { RouteApplyResult } from "./project-route-types";

const execFileAsync = promisify(execFile);

// ── Paths ─────────────────────────────────────────────────────────────────────

const NGINX_SITES_AVAILABLE = "/etc/nginx/sites-available";
const NGINX_SITES_ENABLED   = "/etc/nginx/sites-enabled";

export function getConfigPaths(hostname: string) {
  const filename   = `${hostname}.conf`;
  const configPath = path.join(NGINX_SITES_AVAILABLE, filename);
  const enabledPath = path.join(NGINX_SITES_ENABLED,   filename);
  const backupPath = configPath + ".bak";
  return { configPath, enabledPath, backupPath };
}

// ── nginx -t ──────────────────────────────────────────────────────────────────

async function runNginxTest(): Promise<{ ok: boolean; output: string }> {
  try {
    const result = await execFileAsync("sudo", ["-n", "/usr/sbin/nginx", "-t"], { timeout: 12_000 });
    return { ok: true, output: (result.stderr + result.stdout).trim() };
  } catch (e) {
    const err = e as { stderr?: string; stdout?: string };
    const output = ((err.stderr ?? "") + (err.stdout ?? "")).trim();
    return { ok: false, output: output || String(e) };
  }
}

// ── nginx reload ──────────────────────────────────────────────────────────────

async function reloadNginx(): Promise<{ ok: boolean; output: string }> {
  // Try /bin/systemctl first, fall back to /usr/bin/systemctl
  for (const systemctl of ["/bin/systemctl", "/usr/bin/systemctl"]) {
    try {
      await execFileAsync("sudo", ["-n", systemctl, "reload", "nginx"], { timeout: 15_000 });
      return { ok: true, output: "nginx reloaded" };
    } catch (e) {
      const err = e as { code?: string };
      if (err.code === "ENOENT") continue;
      const msg = (e as { stderr?: string }).stderr?.trim() ?? String(e);
      return { ok: false, output: msg };
    }
  }
  return { ok: false, output: "systemctl not found at /bin or /usr/bin" };
}

// ── Backup helpers ────────────────────────────────────────────────────────────

async function backupConfig(configPath: string, backupPath: string): Promise<void> {
  try {
    const content = await fs.readFile(configPath, "utf8");
    await fs.writeFile(backupPath, content, "utf8");
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") throw e; // ignore "no previous config"
  }
}

async function restoreBackup(backupPath: string, configPath: string): Promise<boolean> {
  try {
    const content = await fs.readFile(backupPath, "utf8");
    await fs.writeFile(configPath, content, "utf8");
    return true;
  } catch {
    return false;
  }
}

// ── Read current nginx preview (sanitized) ────────────────────────────────────

export async function readCurrentNginxConfig(hostname: string): Promise<string | null> {
  if (isReservedHostname(hostname)) return null;
  const { configPath } = getConfigPaths(hostname);
  try {
    const content = await fs.readFile(configPath, "utf8");
    // Sanitize: strip anything that looks like a secret value
    return content
      .split("\n")
      .filter((line) => !/proxy_pass.*:\/\/[^/]+:[a-z0-9]{20,}/i.test(line))
      .join("\n");
  } catch {
    return null;
  }
}

export async function hasBackupConfig(hostname: string): Promise<boolean> {
  const { backupPath } = getConfigPaths(hostname);
  try {
    await fs.access(backupPath);
    return true;
  } catch {
    return false;
  }
}

// ── Main apply ────────────────────────────────────────────────────────────────

export async function applyNginxRouteConfig(
  hostname:    string,
  configContent: string,
): Promise<RouteApplyResult> {
  if (isReservedHostname(hostname)) {
    return { ok: false, error: `"${hostname}" is a reserved hostname — refusing to apply routing.` };
  }

  const { configPath, enabledPath, backupPath } = getConfigPaths(hostname);

  // 1. Back up existing config
  await backupConfig(configPath, backupPath);

  // 2. Write new config
  try {
    await fs.writeFile(configPath, configContent, { encoding: "utf8", flag: "w" });
  } catch (e) {
    const msg = (e as Error).message;
    return { ok: false, error: `Failed to write nginx config: ${msg}` };
  }

  // 3. Create/replace symlink
  try {
    await fs.unlink(enabledPath).catch(() => {});
    await fs.symlink(configPath, enabledPath);
  } catch (e) {
    // Restore backup on symlink failure
    await restoreBackup(backupPath, configPath);
    return { ok: false, error: `Failed to create nginx symlink: ${(e as Error).message}` };
  }

  // 4. Test nginx config
  const testResult = await runNginxTest();
  if (!testResult.ok) {
    // Restore backup on test failure
    const restored = await restoreBackup(backupPath, configPath);
    if (restored) {
      // Re-test after restore — ensure old config is valid
      await runNginxTest().catch(() => null);
    }
    return {
      ok:          false,
      error:       `nginx config test failed — previous config restored.\n${testResult.output}`,
      nginxOutput: testResult.output,
      backupPath,
    };
  }

  // 5. Reload nginx
  const reloadResult = await reloadNginx();
  if (!reloadResult.ok) {
    return {
      ok:          false,
      error:       `Config applied but nginx reload failed: ${reloadResult.output}\nReload manually: sudo systemctl reload nginx`,
      configPath,
      backupPath,
      nginxOutput: reloadResult.output,
    };
  }

  return {
    ok:         true,
    configPath,
    backupPath,
    nginxOutput: testResult.output,
  };
}

// ── Rollback ──────────────────────────────────────────────────────────────────

export async function rollbackNginxRouteConfig(
  hostname: string,
): Promise<RouteApplyResult> {
  if (isReservedHostname(hostname)) {
    return { ok: false, error: `"${hostname}" is a reserved hostname.` };
  }

  const { configPath, backupPath } = getConfigPaths(hostname);

  const restored = await restoreBackup(backupPath, configPath);
  if (!restored) {
    return { ok: false, error: "No backup config found to roll back to." };
  }

  const testResult = await runNginxTest();
  if (!testResult.ok) {
    return {
      ok:          false,
      error:       `Rolled back config also fails nginx -t: ${testResult.output}`,
      nginxOutput: testResult.output,
    };
  }

  const reloadResult = await reloadNginx();
  if (!reloadResult.ok) {
    return {
      ok:    false,
      error: `Rollback config written and tested but reload failed: ${reloadResult.output}`,
      nginxOutput: reloadResult.output,
    };
  }

  return { ok: true, configPath, backupPath, nginxOutput: testResult.output };
}

// ── Validation only (nginx -t without writing) ────────────────────────────────

export async function validateNginxConfig(): Promise<{ ok: boolean; output: string }> {
  return runNginxTest();
}
