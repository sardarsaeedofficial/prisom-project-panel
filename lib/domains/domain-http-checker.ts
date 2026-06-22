/**
 * lib/domains/domain-http-checker.ts
 *
 * Sprint 29: HTTP and HTTPS reachability checks using fetch with AbortController.
 * Server-only — never imported from client code.
 */

import type { HttpCheckResult } from "./domain-health-types";

const HTTP_TIMEOUT_MS = 6_000;
const MAX_REDIRECTS   = 5;

export async function checkHttp(hostname: string): Promise<HttpCheckResult> {
  return fetchCheck(`http://${hostname}/`, hostname);
}

export async function checkHttps(hostname: string): Promise<HttpCheckResult> {
  return fetchCheck(`https://${hostname}/`, hostname);
}

async function fetchCheck(url: string, _hostname: string): Promise<HttpCheckResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  const startMs = Date.now();

  try {
    const response = await fetch(url, {
      method:   "HEAD",
      signal:   controller.signal,
      redirect: "follow",
    });
    clearTimeout(timer);

    const responseTimeMs = Date.now() - startMs;
    const redirectedTo   = response.redirected ? response.url : null;

    let status: HttpCheckResult["status"];
    const code = response.status;
    if (code >= 200 && code < 400) {
      status = "pass";
    } else if (code >= 400 && code < 500) {
      status = "warning";
    } else {
      status = "fail";
    }

    return { status, statusCode: code, redirectedTo, responseTimeMs, error: null };
  } catch (err) {
    clearTimeout(timer);
    const msg = (err as Error).name === "AbortError"
      ? "Connection timed out."
      : sanitiseHttpError((err as Error).message);
    return { status: "fail", statusCode: null, redirectedTo: null, responseTimeMs: null, error: msg };
  }
}

/** Strip internal node details (file paths, IPs) from fetch error messages. */
function sanitiseHttpError(raw: string): string {
  // Remove "fetch failed" prefix Node adds
  let msg = raw.replace(/^fetch failed\s*/i, "");
  // Remove file:// paths
  msg = msg.replace(/file:\/\/[^\s)]+/g, "");
  // Remove stack traces
  const firstLine = msg.split("\n")[0] ?? msg;
  return firstLine.length > 120 ? firstLine.substring(0, 117) + "…" : firstLine;
}

export { MAX_REDIRECTS };
