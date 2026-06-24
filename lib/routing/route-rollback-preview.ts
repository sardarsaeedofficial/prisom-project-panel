/**
 * lib/routing/route-rollback-preview.ts
 *
 * Sprint 52: Read-only rollback preview.
 * Shows what a rollback would restore WITHOUT executing anything.
 *
 * Safety:
 *  - Read-only — never writes nginx config
 *  - Never reloads nginx
 *  - Reserved hostnames blocked
 *  - Only reads backup file created by applyNginxRouteConfig
 */

import { promises as fs }          from "fs";
import { isReservedHostname }       from "@/lib/projects/nginx-manager";
import { getConfigPaths, hasBackupConfig } from "@/lib/routing/nginx-route-apply";
import type { RouteRollbackPreview }       from "@/lib/routing/routing-diagnostics-types";

// ── Read backup config (safe preview) ────────────────────────────────────────

async function readBackupPreview(backupPath: string): Promise<string | null> {
  try {
    const content = await fs.readFile(backupPath, "utf8");
    // Strip any line that looks like it might contain credential-style values
    const safe = content
      .split("\n")
      .filter((line) => !/proxy_pass.*:\/\/[^/]+:[a-z0-9]{20,}/i.test(line))
      .slice(0, 40)           // cap at 40 lines for preview
      .join("\n");
    return safe || null;
  } catch {
    return null;
  }
}

// ── Main preview ──────────────────────────────────────────────────────────────

export async function buildRouteRollbackPreview(
  hostname: string,
): Promise<RouteRollbackPreview> {
  const warnings: string[] = [];

  if (!hostname) {
    return {
      domain:              "",
      hasBackup:           false,
      backupConfigSnippet: null,
      manualChecklist:     ["No domain configured — rollback not applicable."],
      nginxTestCommand:    "sudo nginx -t",
      nginxReloadCommand:  "sudo systemctl reload nginx",
      warnings:            ["No domain configured."],
    };
  }

  if (isReservedHostname(hostname)) {
    return {
      domain:              hostname,
      hasBackup:           false,
      backupConfigSnippet: null,
      manualChecklist:     ["This domain is a reserved hostname and cannot be rolled back via this panel."],
      nginxTestCommand:    "sudo nginx -t",
      nginxReloadCommand:  "sudo systemctl reload nginx",
      warnings:            [`"${hostname}" is a reserved hostname — rollback blocked.`],
    };
  }

  const { configPath, backupPath } = getConfigPaths(hostname);
  const hasBackup                  = await hasBackupConfig(hostname);

  if (!hasBackup) {
    warnings.push("No backup config found — apply routes at least once to create a rollback snapshot.");
  }

  const backupConfigSnippet = hasBackup
    ? await readBackupPreview(backupPath)
    : null;

  const configFilename = `${hostname}.conf`;

  const manualChecklist = [
    `1. Locate backup: ${backupPath}`,
    `2. Review backup contents before restoring (shown below if available).`,
    `3. Restore backup: sudo cp "${backupPath}" "${configPath}"`,
    `4. Run nginx syntax test: sudo nginx -t`,
    `5. If test passes, reload nginx: sudo systemctl reload nginx`,
    `6. Run route health checks to confirm the rollback is working.`,
    `7. Remove the stale backup when done: sudo rm "${backupPath}"`,
  ];

  if (!hasBackup) {
    return {
      domain:              hostname,
      hasBackup:           false,
      backupConfigSnippet: null,
      manualChecklist:     [
        `No backup file found at ${backupPath}.`,
        "Apply routes at least once to create a rollback snapshot.",
        `If you have a manual backup, restore it with: sudo cp <your-backup> ${configPath}`,
        "Then run: sudo nginx -t && sudo systemctl reload nginx",
      ],
      nginxTestCommand:    "sudo nginx -t",
      nginxReloadCommand:  "sudo systemctl reload nginx",
      warnings,
    };
  }

  return {
    domain:              hostname,
    hasBackup:           true,
    backupConfigSnippet,
    manualChecklist,
    nginxTestCommand:    `sudo nginx -t  # config file: /etc/nginx/sites-available/${configFilename}`,
    nginxReloadCommand:  "sudo systemctl reload nginx",
    warnings,
  };
}
