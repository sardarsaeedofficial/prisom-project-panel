/**
 * lib/domains/domain-ssl-checker.ts
 *
 * Sprint 29: SSL/TLS certificate inspection using Node tls.connect.
 * Server-only — never imported from client code.
 *
 * rejectUnauthorized: false so we can report on expired/self-signed certs
 * without throwing.  We check and surface the authorized flag ourselves.
 */

import tls from "tls";
import type { SslCheckResult } from "./domain-health-types";

const SSL_TIMEOUT_MS       = 6_000;
const EXPIRY_WARNING_DAYS  = 30;

export function checkSsl(hostname: string): Promise<SslCheckResult> {
  return new Promise((resolve) => {
    let settled = false;

    function done(result: SslCheckResult) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { socket.destroy(); } catch { /* ignore */ }
      resolve(result);
    }

    const timer = setTimeout(() => {
      done({ status: "unknown", issuer: null, subject: null, validFrom: null, validTo: null, daysRemaining: null, authorized: null, error: "TLS connection timed out." });
    }, SSL_TIMEOUT_MS);

    const socket = tls.connect({
      host:               hostname,
      port:               443,
      servername:         hostname,
      rejectUnauthorized: false,
    });

    socket.on("secureConnect", () => {
      const cert       = socket.getPeerCertificate(false);
      const authorized = socket.authorized;

      if (!cert || !cert.valid_to) {
        done({ status: "unknown", issuer: null, subject: null, validFrom: null, validTo: null, daysRemaining: null, authorized, error: "Could not read certificate details." });
        return;
      }

      const validTo        = new Date(cert.valid_to);
      const validFrom      = new Date(cert.valid_from);
      const daysRemaining  = Math.floor((validTo.getTime() - Date.now()) / 86_400_000);

      const issuer  = (cert.issuer as Record<string, string> | undefined)?.O ?? null;
      const subject = (cert.subject as Record<string, string> | undefined)?.CN ?? null;

      let status: SslCheckResult["status"];
      if (!authorized) {
        status = daysRemaining <= 0 ? "fail" : "warning";
      } else if (daysRemaining <= 0) {
        status = "fail";
      } else if (daysRemaining <= EXPIRY_WARNING_DAYS) {
        status = "warning";
      } else {
        status = "pass";
      }

      const authError = !authorized
        ? ((socket.authorizationError as Error | string | undefined) instanceof Error
            ? (socket.authorizationError as Error).message
            : String(socket.authorizationError ?? "Certificate not trusted"))
        : null;

      done({
        status,
        issuer,
        subject,
        validFrom:     validFrom.toISOString(),
        validTo:       validTo.toISOString(),
        daysRemaining,
        authorized,
        error: authError,
      });
    });

    socket.on("error", (err) => {
      done({ status: "fail", issuer: null, subject: null, validFrom: null, validTo: null, daysRemaining: null, authorized: null, error: sanitiseTlsError(err.message) });
    });
  });
}

function sanitiseTlsError(raw: string): string {
  const firstLine = raw.split("\n")[0] ?? raw;
  return firstLine.length > 120 ? firstLine.substring(0, 117) + "…" : firstLine;
}
