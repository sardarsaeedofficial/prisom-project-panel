"use server";

/**
 * app/actions/project-domain-readiness.ts
 *
 * Sprint 47: Server actions for Domain / SSL / Nginx readiness checks.
 *
 * Safety rules:
 *  - All actions verify project ownership via requireProjectPermission (IDOR prevention)
 *  - No private key paths or secret values returned
 *  - configPath returned as basename only (never full FS path)
 *  - DNS/SSL/nginx checks use controlled timeouts and crash guards
 *  - No shell commands executed
 */

import { db }                            from "@/lib/db";
import { requireProjectPermission }      from "@/lib/auth/project-membership";
import { generateDomainReadinessReport } from "@/lib/domains/domain-readiness-service";
import { checkDns }                      from "@/lib/domains/domain-dns-checker";
import { checkSsl }                      from "@/lib/domains/domain-ssl-checker";
import { scanNginxOwnership }            from "@/lib/domains/nginx-ownership-scanner";
import type {
  DomainReadinessResult,
  DomainDnsResult,
  DomainSslResult,
  NginxOwnershipResult,
  DomainDnsRecordStatus,
  DomainSslStatus,
} from "@/lib/domains/domain-readiness-types";
import type { DnsCheckResult, SslCheckResult } from "@/lib/domains/domain-health-types";

// ── Helpers ───────────────────────────────────────────────────────────────────

const VPS_IP = process.env.VPS_IP ?? process.env.SERVER_PUBLIC_IP ?? "178.105.105.59";

async function verifyAccess(projectId: string): Promise<void> {
  await requireProjectPermission(projectId, "project.view");
}

async function getPrimaryDomain(projectId: string): Promise<string | null> {
  const domain = await db.domain.findFirst({
    where:  { projectId, isPrimary: true },
    select: { hostname: true },
  });
  return domain?.hostname ?? null;
}

async function getProjectSlug(projectId: string): Promise<string | undefined> {
  const project = await db.project.findUnique({
    where:  { id: projectId },
    select: { slug: true },
  });
  return project?.slug ?? undefined;
}

function mapDnsRecords(hostname: string, result: DnsCheckResult): DomainDnsRecordStatus[] {
  const records: DomainDnsRecordStatus[] = [];

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

  if (result.aaaaRecords.length > 0) {
    const match = result.aaaaRecords.includes(result.expectedIp);
    records.push({
      type:    "AAAA",
      host:    hostname,
      values:  result.aaaaRecords,
      status:  match ? "match" : "mismatch",
      message: match ? "AAAA record configured." : `AAAA points to ${result.aaaaRecords.join(", ")}.`,
    });
  }

  if (result.cnameValue) {
    records.push({
      type:    "CNAME",
      host:    hostname,
      values:  [result.cnameValue],
      status:  "unknown",
      message: `CNAME → ${result.cnameValue}`,
    });
  }

  return records;
}

function mapSslStatus(result: SslCheckResult): DomainSslStatus {
  if (result.status === "unknown" && !result.issuer) {
    return {
      hasCertificate: false,
      status:         "missing",
      message:        result.error ?? "No SSL certificate found.",
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
      message:        "SSL certificate has expired.",
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
      message:        `SSL expires in ${result.daysRemaining ?? "?"} days — renew soon.`,
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
      message:        `Valid certificate — expires in ${result.daysRemaining ?? "?"} days.`,
    };
  }
  return {
    hasCertificate: false,
    status:         "unknown",
    message:        result.error ?? "SSL status could not be determined.",
  };
}

// ── Action 1: Full domain readiness report ────────────────────────────────────

export async function generateDomainReadinessAction(input: {
  projectId: string;
  domain?:   string;
}): Promise<DomainReadinessResult> {
  const { projectId } = input;
  try {
    await verifyAccess(projectId);

    const [domain, projectSlug] = await Promise.all([
      input.domain ? Promise.resolve(input.domain) : getPrimaryDomain(projectId),
      getProjectSlug(projectId),
    ]);

    if (!domain) {
      return { ok: false, error: "No domain configured for this project." };
    }

    const report = await generateDomainReadinessReport({ projectId, domain, projectSlug });
    return { ok: true, report };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    if (msg.includes("Unauthorized") || msg.includes("Forbidden")) {
      return { ok: false, error: "Access denied." };
    }
    return { ok: false, error: `Domain readiness check failed: ${msg}` };
  }
}

// ── Action 2: DNS check only ──────────────────────────────────────────────────

export async function checkDomainDnsAction(input: {
  projectId: string;
  domain:    string;
}): Promise<DomainDnsResult> {
  const { projectId, domain } = input;
  try {
    await verifyAccess(projectId);
    const result  = await checkDns(domain);
    const records = mapDnsRecords(domain, result);
    return { ok: true, records };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    if (msg.includes("Unauthorized") || msg.includes("Forbidden")) return { ok: false, error: "Access denied." };
    return { ok: false, error: `DNS check failed: ${msg}` };
  }
}

// ── Action 3: SSL check only ──────────────────────────────────────────────────

export async function checkDomainSslAction(input: {
  projectId: string;
  domain:    string;
}): Promise<DomainSslResult> {
  const { projectId, domain } = input;
  try {
    await verifyAccess(projectId);
    const result = await checkSsl(domain);
    const ssl    = mapSslStatus(result);
    return { ok: true, ssl };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    if (msg.includes("Unauthorized") || msg.includes("Forbidden")) return { ok: false, error: "Access denied." };
    return { ok: false, error: `SSL check failed: ${msg}` };
  }
}

// ── Action 4: Nginx ownership scan only ──────────────────────────────────────

export async function scanNginxOwnershipAction(input: {
  projectId: string;
  domain:    string;
}): Promise<NginxOwnershipResult> {
  const { projectId, domain } = input;
  try {
    await verifyAccess(projectId);
    const projectSlug = await getProjectSlug(projectId);
    const nginx       = await scanNginxOwnership({ domain, projectId, projectSlug });
    return { ok: true, nginx };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    if (msg.includes("Unauthorized") || msg.includes("Forbidden")) return { ok: false, error: "Access denied." };
    return { ok: false, error: `Nginx ownership scan failed: ${msg}` };
  }
}
