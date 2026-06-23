/**
 * lib/domains/domain-readiness-service.ts
 *
 * Sprint 47: Domain readiness orchestration service.
 * Combines DNS, SSL, and nginx ownership checks into a single
 * DomainReadinessReport.
 *
 * Safety rules:
 *  - Never exposes secret values or private key paths
 *  - DNS/SSL checks use controlled timeouts
 *  - Nginx scan is read-only
 *  - Panel domain is always blocked
 *  - All errors are caught and return structured results
 */

import { checkDns }               from "./domain-dns-checker";
import { checkSsl }               from "./domain-ssl-checker";
import { scanNginxOwnership }     from "./nginx-ownership-scanner";
import type {
  DomainReadinessReport,
  DomainReadinessStatus,
  DomainDnsRecordStatus,
  DomainSslStatus,
  NginxOwnershipStatus,
} from "./domain-readiness-types";
import type { DnsCheckResult, SslCheckResult } from "./domain-health-types";

const VPS_IP      = process.env.VPS_IP ?? process.env.SERVER_PUBLIC_IP ?? "178.105.105.59";
const PANEL_DOMAIN = "projects.doorstepmanchester.uk";

// ── DNS mapping ───────────────────────────────────────────────────────────────

function mapDns(hostname: string, result: DnsCheckResult): DomainDnsRecordStatus[] {
  const records: DomainDnsRecordStatus[] = [];

  // A records
  if (result.aRecords.length > 0) {
    const match = result.aRecords.includes(result.expectedIp);
    records.push({
      type:     "A",
      host:     hostname,
      values:   result.aRecords,
      expected: [result.expectedIp],
      status:   match ? "match" : "mismatch",
      message:  match
        ? `A record points to this VPS (${result.expectedIp}).`
        : `A record points to ${result.aRecords.join(", ")} — expected ${result.expectedIp}.`,
    });
  } else if (!result.cnameValue) {
    records.push({
      type:     "A",
      host:     hostname,
      values:   [],
      expected: [result.expectedIp],
      status:   "missing",
      message:  "No A record found. DNS is not configured.",
    });
  }

  // AAAA records
  if (result.aaaaRecords.length > 0) {
    const match = result.aaaaRecords.includes(result.expectedIp);
    records.push({
      type:    "AAAA",
      host:    hostname,
      values:  result.aaaaRecords,
      status:  match ? "match" : "mismatch",
      message: match
        ? `AAAA record configured.`
        : `AAAA record points to a different address (${result.aaaaRecords.join(", ")}).`,
    });
  }

  // CNAME
  if (result.cnameValue) {
    records.push({
      type:    "CNAME",
      host:    hostname,
      values:  [result.cnameValue],
      status:  "unknown",
      message: `CNAME points to ${result.cnameValue} — ensure it resolves to this VPS.`,
    });
  }

  return records;
}

// ── SSL mapping ───────────────────────────────────────────────────────────────

function mapSsl(result: SslCheckResult): DomainSslStatus {
  if (result.status === "unknown" && !result.issuer) {
    return {
      hasCertificate: false,
      status:         "missing",
      message:        result.error ?? "Could not connect to port 443 — SSL certificate may not be configured.",
    };
  }

  if (result.status === "fail" && (result.daysRemaining ?? 1) <= 0) {
    return {
      hasCertificate: true,
      issuer:         result.issuer ?? undefined,
      subject:        result.subject ?? undefined,
      validFrom:      result.validFrom ?? undefined,
      validTo:        result.validTo ?? undefined,
      daysRemaining:  result.daysRemaining ?? 0,
      status:         "expired",
      message:        `SSL certificate has expired (${result.daysRemaining} days ago).`,
    };
  }

  if (result.status === "warning" || (result.daysRemaining !== null && result.daysRemaining <= 14)) {
    return {
      hasCertificate: true,
      issuer:         result.issuer ?? undefined,
      subject:        result.subject ?? undefined,
      validFrom:      result.validFrom ?? undefined,
      validTo:        result.validTo ?? undefined,
      daysRemaining:  result.daysRemaining ?? undefined,
      status:         "expiring",
      message:        result.daysRemaining !== null
        ? `SSL certificate expires in ${result.daysRemaining} days — renew soon.`
        : "SSL certificate is expiring or untrusted.",
    };
  }

  if (result.status === "pass") {
    return {
      hasCertificate: true,
      issuer:         result.issuer ?? undefined,
      subject:        result.subject ?? undefined,
      validFrom:      result.validFrom ?? undefined,
      validTo:        result.validTo ?? undefined,
      daysRemaining:  result.daysRemaining ?? undefined,
      status:         "valid",
      message:        result.daysRemaining !== null
        ? `Valid SSL certificate — expires in ${result.daysRemaining} days.`
        : "Valid SSL certificate.",
    };
  }

  return {
    hasCertificate: false,
    issuer:         result.issuer ?? undefined,
    subject:        result.subject ?? undefined,
    status:         "unknown",
    message:        result.error ?? "SSL status could not be determined.",
  };
}

// ── Status computation ────────────────────────────────────────────────────────

function computeStatus(
  blockers: string[],
  warnings: string[],
): DomainReadinessStatus {
  if (blockers.length > 0) return "blocked";
  if (warnings.length > 0) return "warning";
  return "ready";
}

// ── Main function ─────────────────────────────────────────────────────────────

export async function generateDomainReadinessReport(input: {
  projectId:    string;
  domain:       string;
  projectSlug?: string;
}): Promise<DomainReadinessReport> {
  const { projectId, domain, projectSlug } = input;
  const generatedAt = new Date().toISOString();

  const blockers:   string[] = [];
  const warnings:   string[] = [];
  const nextSteps:  string[] = [];

  // ── Panel domain guard ────────────────────────────────────────────────────

  if (domain === PANEL_DOMAIN || domain.endsWith(`.${PANEL_DOMAIN}`)) {
    return {
      projectId,
      domain,
      generatedAt,
      status: "blocked",
      dns:    [],
      ssl: {
        hasCertificate: false,
        status:  "unknown",
        message: "Panel domain check skipped.",
      },
      nginx: {
        domain,
        managedByPrisom: false,
        protectedConfig: true,
        conflict:        true,
        message:         "This is the Prisom Projects Panel domain — it cannot be used as a project domain.",
      },
      blockers:  ["Panel domain cannot be used as a project domain."],
      warnings:  [],
      nextSteps: ["Choose a different domain for this project."],
    };
  }

  // ── Run all checks in parallel ────────────────────────────────────────────

  const [dnsResult, sslResult, nginxResult] = await Promise.all([
    checkDns(domain).catch((e) => ({
      status:        "unknown" as const,
      aRecords:      [] as string[],
      aaaaRecords:   [] as string[],
      cnameValue:    null,
      expectedIp:    VPS_IP,
      pointsToServer: null,
      resolvedAt:    new Date().toISOString(),
      error:         String(e),
    })),
    checkSsl(domain).catch(() => ({
      status:        "unknown" as const,
      issuer:        null,
      subject:       null,
      validFrom:     null,
      validTo:       null,
      daysRemaining: null,
      authorized:    null,
      error:         "SSL check failed.",
    })),
    scanNginxOwnership({ domain, projectId, projectSlug }).catch((e) => ({
      domain,
      managedByPrisom: false,
      protectedConfig: false,
      conflict:        false,
      message:         `Nginx scan failed: ${String(e)}`,
    } as NginxOwnershipStatus)),
  ]);

  const dns = mapDns(domain, dnsResult);
  const ssl = mapSsl(sslResult);

  // ── Compute blockers / warnings ───────────────────────────────────────────

  // DNS blockers
  const missingA = dns.find((r) => r.type === "A" && r.status === "missing");
  const mismatchA = dns.find((r) => r.type === "A" && r.status === "mismatch");
  if (missingA) {
    blockers.push(`No A record found — DNS is not configured for this domain.`);
    nextSteps.push(`Add an A record pointing ${domain} → ${VPS_IP} at your DNS provider.`);
  } else if (mismatchA) {
    blockers.push(`A record points to a different IP (${mismatchA.values.join(", ")}) — expected ${VPS_IP}.`);
    nextSteps.push(`Update the A record to point ${domain} → ${VPS_IP}.`);
  }

  const aaaaWrong = dns.find((r) => r.type === "AAAA" && r.status === "mismatch");
  if (aaaaWrong) {
    warnings.push(`AAAA (IPv6) record points to a different address — may cause routing issues.`);
  }

  // SSL blockers / warnings
  if (ssl.status === "expired") {
    blockers.push(`SSL certificate has expired — HTTPS will not work.`);
    nextSteps.push(`Renew the SSL certificate (run certbot renew or issue a new cert via Let's Encrypt).`);
  } else if (ssl.status === "missing") {
    warnings.push(`No SSL certificate — HTTPS is not configured for this domain.`);
    nextSteps.push(`Issue an SSL certificate after DNS is live (certbot --nginx -d ${domain}).`);
  } else if (ssl.status === "expiring") {
    warnings.push(`SSL certificate expires soon (${ssl.daysRemaining ?? "?"} days) — renew before it expires.`);
  }

  // Nginx ownership blockers
  if (nginxResult.conflict) {
    blockers.push(nginxResult.message);
    nextSteps.push(`Resolve the nginx config conflict before applying routes.`);
  } else if (!nginxResult.managedByPrisom && !nginxResult.conflict) {
    warnings.push(`No nginx config exists yet for this domain — routes must be applied first.`);
    nextSteps.push(`Apply routes in Publishing → Production Routing.`);
  }

  // Next steps for ready state
  if (blockers.length === 0 && warnings.length === 0) {
    nextSteps.push(`Domain is ready for production routing.`);
  }

  return {
    projectId,
    domain,
    generatedAt,
    status: computeStatus(blockers, warnings),
    dns,
    ssl,
    nginx: nginxResult,
    blockers,
    warnings,
    nextSteps,
  };
}
