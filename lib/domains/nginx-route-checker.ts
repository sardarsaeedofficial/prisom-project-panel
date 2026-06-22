/**
 * lib/domains/nginx-route-checker.ts
 *
 * Sprint 29: Read-only nginx route summary for a given domain.
 *
 * Safety rules:
 *  - Only reads files under /etc/nginx/sites-enabled/ (fixed path)
 *  - Validates filenames: no path separators, no traversal
 *  - Returns only summary (label, server_name match, proxy target host:port)
 *  - Never returns raw config file contents
 *  - Handles EACCES / ENOENT gracefully — returns unavailableReason
 */

import { promises as fs } from "fs";
import path               from "path";
import type { NginxRouteSummary } from "./domain-health-types";

const NGINX_SITES_DIR = "/etc/nginx/sites-enabled";
const MAX_FILE_BYTES  = 256_000;

export async function getNginxRouteSummary(hostname: string): Promise<NginxRouteSummary> {
  let fileNames: string[];
  try {
    fileNames = await fs.readdir(NGINX_SITES_DIR);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return empty("nginx sites directory not found.");
    }
    if (code === "EACCES") {
      return empty("No read permission for nginx configuration.");
    }
    return empty(`Could not list nginx sites: ${code ?? "unknown error"}`);
  }

  for (const fileName of fileNames) {
    // Safety: skip any file with path separators (shouldn't happen from readdir, but belt-and-braces)
    if (fileName.includes("/") || fileName.includes("\\") || fileName.includes("..")) continue;

    const filePath = path.join(NGINX_SITES_DIR, fileName);

    let content: string;
    try {
      const buf = await fs.readFile(filePath);
      if (buf.length > MAX_FILE_BYTES) continue; // skip huge files
      content = buf.toString("utf8");
    } catch {
      continue;
    }

    if (!isServerNameMatch(content, hostname)) continue;

    return {
      configLabel:     fileName,
      serverNameMatch: true,
      proxyTarget:     extractProxyTarget(content),
      staticRoot:      extractStaticRoot(content),
      hasSslBlock:     hasSslBlock(content),
      unavailableReason: null,
    };
  }

  return {
    configLabel:     null,
    serverNameMatch: false,
    proxyTarget:     null,
    staticRoot:      null,
    hasSslBlock:     null,
    unavailableReason: null,
  };
}

// ── Parsers ───────────────────────────────────────────────────────────────────

function isServerNameMatch(content: string, hostname: string): boolean {
  const lines = content.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("server_name")) continue;
    // e.g. "server_name example.com www.example.com;"
    const names = trimmed
      .replace(/^server_name\s+/, "")
      .replace(/;.*$/, "")
      .split(/\s+/);
    if (names.some((n) => n === hostname || n === `www.${hostname}`)) return true;
  }
  return false;
}

/** Extract host:port from the first proxy_pass directive. */
function extractProxyTarget(content: string): string | null {
  const match = content.match(/proxy_pass\s+https?:\/\/([a-zA-Z0-9_.\-:]+)/);
  if (!match) return null;
  const target = match[1];
  // Only return host:port — strip any path
  const portMatch = target.match(/^([a-zA-Z0-9_.\-]+:\d+)/);
  return portMatch ? portMatch[1] : null;
}

/** Extract root directive value. */
function extractStaticRoot(content: string): string | null {
  const match = content.match(/^\s*root\s+([^\s;]+)/m);
  if (!match) return null;
  const root = match[1];
  // Only return paths under known safe locations
  if (root.startsWith("/var/www/") || root.startsWith("/srv/") || root.startsWith("/home/")) {
    return root;
  }
  return "<custom path>";
}

function hasSslBlock(content: string): boolean {
  return /listen\s+443/.test(content);
}

function empty(reason: string): NginxRouteSummary {
  return {
    configLabel:     null,
    serverNameMatch: null,
    proxyTarget:     null,
    staticRoot:      null,
    hasSslBlock:     null,
    unavailableReason: reason,
  };
}
