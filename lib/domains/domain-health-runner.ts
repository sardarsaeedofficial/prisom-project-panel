/**
 * lib/domains/domain-health-runner.ts
 *
 * Sprint 29: Orchestrates all domain checks for every domain attached to a project.
 * Server-only — uses Node dns, tls, fetch, and fs.
 */

import { checkDns }             from "./domain-dns-checker";
import { checkHttp, checkHttps }  from "./domain-http-checker";
import { checkSsl }             from "./domain-ssl-checker";
import { getNginxRouteSummary } from "./nginx-route-checker";
import { buildRecommendations } from "./domain-recommendations";
import type {
  DomainHealthEntry,
  DomainHealthReport,
  HttpCheckResult,
  SslCheckResult,
  DnsCheckResult,
  NginxRouteSummary,
} from "./domain-health-types";

type DomainInput = {
  id:        string;
  hostname:  string;
  isPrimary: boolean;
};

const unknownHttp = (): HttpCheckResult => ({
  status: "unknown", statusCode: null, redirectedTo: null, responseTimeMs: null, error: null,
});

const unknownSsl = (): SslCheckResult => ({
  status: "unknown", issuer: null, subject: null, validFrom: null, validTo: null, daysRemaining: null, authorized: null, error: null,
});

const unknownDns = (): DnsCheckResult => ({
  status: "unknown", aRecords: [], aaaaRecords: [], cnameValue: null,
  expectedIp: process.env.SERVER_PUBLIC_IP ?? process.env.VPS_IP ?? "178.105.105.59",
  pointsToServer: null, resolvedAt: new Date().toISOString(), error: null,
});

const unknownNginx = (): NginxRouteSummary => ({
  configLabel: null, serverNameMatch: null, proxyTarget: null,
  staticRoot: null, hasSslBlock: null, unavailableReason: null,
});

async function checkOneDomain(
  domain: DomainInput,
  projectId: string,
): Promise<DomainHealthEntry> {
  const { hostname } = domain;

  // Run all checks in parallel with individual crash guards
  const [dns, http, https, ssl, nginx] = await Promise.all([
    checkDns(hostname).catch((): DnsCheckResult => ({ ...unknownDns(), error: "DNS check crashed." })),
    checkHttp(hostname).catch((): HttpCheckResult => ({ ...unknownHttp(), status: "fail", error: "HTTP check crashed." })),
    checkHttps(hostname).catch((): HttpCheckResult => ({ ...unknownHttp(), status: "fail", error: "HTTPS check crashed." })),
    checkSsl(hostname).catch((): SslCheckResult => ({ ...unknownSsl(), status: "unknown", error: "SSL check crashed." })),
    getNginxRouteSummary(hostname).catch((): NginxRouteSummary => ({ ...unknownNginx(), unavailableReason: "nginx check crashed." })),
  ]);

  const entry: DomainHealthEntry = {
    domainId:  domain.id,
    hostname,
    isPrimary: domain.isPrimary,
    dns,
    http,
    https,
    ssl,
    nginx,
    recommendations: [],
    checkedAt: new Date().toISOString(),
  };

  entry.recommendations = buildRecommendations(entry, projectId);

  return entry;
}

export async function runDomainHealthReport(
  projectId: string,
  domains: DomainInput[],
): Promise<DomainHealthReport> {
  const entries = await Promise.all(
    domains.map((d) => checkOneDomain(d, projectId)),
  );

  return {
    projectId,
    domains: entries,
    generatedAt: new Date().toISOString(),
  };
}
