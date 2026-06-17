/**
 * GET|HEAD|POST|PUT|PATCH
 *   /api/projects/[projectId]/preview-proxy/[[...path]]
 *
 * Authenticated reverse-proxy that lets the panel embed an internal project
 * (running on 127.0.0.1:<port>) inside an iframe.
 *
 * ── Security guarantees ────────────────────────────────────────────────────
 *   • Session required   — 401 if not authenticated
 *   • Ownership check    — 404 if project not found or not owned
 *   • SSRF prevention    — target is ALWAYS 127.0.0.1:<config.port>
 *                          (never a user-supplied host)
 *   • Port validation    — must be 1024–65535, not in RESERVED_PROXY_PORTS
 *   • No credential leak — Cookie and Authorization are never forwarded
 *   • Set-Cookie strip   — project cookies are never forwarded to the panel
 *   • Frame headers      — X-Frame-Options and CSP frame-ancestors are
 *                          stripped so the panel iframe can render the content
 *                          (only for authenticated proxy responses, not Nginx)
 *   • Redirect rewrite   — relative Location headers are rewritten to stay
 *                          within the proxy path
 *   • 15-second timeout  — graceful 504 if upstream is unresponsive
 * ──────────────────────────────────────────────────────────────────────────
 */

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { db } from "@/lib/db";
import { getCurrentWorkspaceId } from "@/lib/current-workspace";

// ── Constants ──────────────────────────────────────────────────────────────

/**
 * Ports that are NEVER proxied, regardless of what the DB says.
 * This prevents accidentally proxying the panel itself or core services.
 */
const RESERVED_PROXY_PORTS = new Set([
  22,    // SSH
  80,    // HTTP (nginx)
  443,   // HTTPS (nginx)
  3000,  // panel dev
  3001,  // panel alt
  3002,  // prisom-projects (panel itself — MUST NOT proxy to self)
  3003,  // reserved
  5432,  // PostgreSQL
  6379,  // Redis
]);

const PROXY_TIMEOUT_MS = 15_000;

/** Request headers that are safe to forward to the upstream project. */
const SAFE_REQ_HEADERS = new Set([
  "accept",
  "accept-language",
  "cache-control",
  "content-type",
  "content-length",
  "if-none-match",
  "if-modified-since",
  "range",
  "user-agent",
]);

// ── Error HTML helper ──────────────────────────────────────────────────────

function errHtml(status: number, title: string, message: string): NextResponse {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:system-ui,sans-serif;min-height:100vh;display:flex;
         align-items:center;justify-content:center;background:#0f0f0f;color:#e4e4e7;padding:1rem}
    .card{max-width:400px;width:100%;text-align:center;padding:2rem}
    .code{font-size:3.5rem;font-weight:800;opacity:.2;line-height:1;margin-bottom:.5rem}
    h1{font-size:1.1rem;margin-bottom:.5rem}
    p{font-size:.85rem;opacity:.6;line-height:1.6}
  </style>
</head>
<body>
  <div class="card">
    <div class="code">${status}</div>
    <h1>${title}</h1>
    <p>${message}</p>
  </div>
</body>
</html>`;

  return new NextResponse(html, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "x-prisom-preview-proxy": "1",
    },
  });
}

// ── Core handler ───────────────────────────────────────────────────────────

async function handler(
  req: NextRequest,
  context: { params: Promise<{ projectId: string; path?: string[] }> }
): Promise<NextResponse> {
  const { projectId, path: pathParts = [] } = await context.params;

  // ── 1. Authentication ────────────────────────────────────────────────────
  const session = await getSession();
  if (!session) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: { "x-prisom-preview-proxy": "1" } }
    );
  }

  // ── 2. Ownership verification ────────────────────────────────────────────
  let workspaceId: string;
  try {
    workspaceId = await getCurrentWorkspaceId();
  } catch {
    return errHtml(503, "Service unavailable", "Panel database is unreachable.");
  }

  const project = await db.project.findUnique({
    where:  { id: projectId },
    select: { id: true, workspaceId: true },
  });
  if (!project || project.workspaceId !== workspaceId) {
    return errHtml(404, "Project not found", "This project does not exist or you do not have access.");
  }

  // ── 3. Deployment config ─────────────────────────────────────────────────
  const config = await db.projectDeploymentConfig.findUnique({
    where:  { projectId },
    select: { port: true },
  });
  if (!config) {
    return errHtml(
      404,
      "No deployment config",
      "Deploy the project first before using the preview proxy."
    );
  }

  // ── 4. SSRF prevention — port validation ─────────────────────────────────
  const { port } = config;
  if (port < 1024 || port > 65535) {
    return errHtml(403, "Forbidden", "Invalid port in deployment configuration.");
  }
  if (RESERVED_PROXY_PORTS.has(port)) {
    return errHtml(
      403,
      "Forbidden",
      `Port ${port} is reserved. Proxying to this port is not permitted.`
    );
  }

  // ── 5. Build target URL ──────────────────────────────────────────────────
  // Target is ALWAYS 127.0.0.1 — never any user-supplied hostname.
  const upstreamPath = "/" + pathParts.join("/");
  const upstreamSearch = req.nextUrl.search;
  const targetUrl = `http://127.0.0.1:${port}${upstreamPath}${upstreamSearch}`;

  // ── 6. Safe forwarded request headers ────────────────────────────────────
  const forwardHeaders: Record<string, string> = {
    host:                `127.0.0.1:${port}`,
    "x-forwarded-for":   "127.0.0.1",
    "x-forwarded-host":  req.headers.get("host") ?? "",
    "x-forwarded-proto": "http",
    "x-prisom-preview-proxy": "1",
  };

  for (const [key, value] of req.headers.entries()) {
    if (SAFE_REQ_HEADERS.has(key.toLowerCase())) {
      forwardHeaders[key.toLowerCase()] = value;
    }
  }

  // Belt-and-suspenders: explicitly drop sensitive headers regardless of above
  delete forwardHeaders["cookie"];
  delete forwardHeaders["authorization"];
  delete forwardHeaders["x-api-key"];

  // ── 7. Proxy the request ──────────────────────────────────────────────────
  let upstream: Response;
  try {
    const hasBody = req.method !== "GET" && req.method !== "HEAD";
    // Read body as ArrayBuffer to avoid duplex streaming complexity
    const body = hasBody ? await req.arrayBuffer() : undefined;

    upstream = await fetch(targetUrl, {
      method:   req.method,
      headers:  forwardHeaders,
      body:     body,
      redirect: "manual",
      signal:   AbortSignal.timeout(PROXY_TIMEOUT_MS),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);

    if (msg.includes("ECONNREFUSED") || msg.includes("ECONNRESET") || msg.includes("ENOTFOUND")) {
      return errHtml(
        502,
        "Project offline",
        "The project process is not responding. Deploy or restart from Publishing."
      );
    }
    if (msg.includes("TimeoutError") || msg.includes("timeout") || msg.includes("AbortError")) {
      return errHtml(504, "Gateway timeout", "The project did not respond within 15 seconds.");
    }
    return errHtml(502, "Proxy error", `Upstream error: ${msg.slice(0, 120)}`);
  }

  // ── 8. Build safe response headers ────────────────────────────────────────
  const resHeaders = new Headers();

  for (const [key, value] of upstream.headers.entries()) {
    const lkey = key.toLowerCase();

    // ① Strip X-Frame-Options entirely — we need the iframe to render
    if (lkey === "x-frame-options") continue;

    // ② Strip frame-ancestors from Content-Security-Policy
    if (lkey === "content-security-policy") {
      const cleaned = value
        .split(";")
        .map((d) => d.trim())
        .filter((d) => !d.toLowerCase().startsWith("frame-ancestors"))
        .join("; ")
        .trim();
      if (cleaned) resHeaders.set("content-security-policy", cleaned);
      continue;
    }

    // ③ Never forward project cookies back to the panel browser context
    if (lkey === "set-cookie") continue;

    resHeaders.set(key, value);
  }

  // Mark this response as proxy-generated
  resHeaders.set("x-prisom-preview-proxy", "1");

  // ── 9. Handle redirects ───────────────────────────────────────────────────
  if (upstream.status >= 300 && upstream.status < 400) {
    const location = upstream.headers.get("location") ?? "";

    if (location.startsWith("/")) {
      // Relative path redirect — rewrite through the proxy so the iframe stays on proxy URLs
      resHeaders.set("location", `/api/projects/${projectId}/preview-proxy${location}`);
    } else {
      // Absolute URL redirect — pass through as-is (e.g. external OAuth redirect)
      resHeaders.set("location", location);
    }

    return new NextResponse(null, { status: upstream.status, headers: resHeaders });
  }

  // ── 10. Stream response body ──────────────────────────────────────────────
  return new NextResponse(upstream.body, {
    status:  upstream.status,
    headers: resHeaders,
  });
}

// Export all safe HTTP methods
export {
  handler as GET,
  handler as HEAD,
  handler as POST,
  handler as PUT,
  handler as PATCH,
};
