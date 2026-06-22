/**
 * lib/domains/domain-recommendations.ts
 *
 * Sprint 29: Generate actionable recommendations from a domain health entry.
 * Pure logic — no I/O, safe to test.
 */

import type {
  DomainHealthEntry,
  DomainRecommendation,
} from "./domain-health-types";

export function buildRecommendations(
  entry: DomainHealthEntry,
  projectId: string,
): DomainRecommendation[] {
  const recs: DomainRecommendation[] = [];

  // ── DNS issues ─────────────────────────────────────────────────────────────

  if (entry.dns.status === "fail" || (entry.dns.aRecords.length === 0 && !entry.dns.cnameValue)) {
    recs.push({
      id:       "dns_no_record",
      severity: "critical",
      title:    "No DNS record found",
      detail:   `No A, AAAA, or CNAME record resolves for ${entry.hostname}. Add an A record pointing to ${entry.dns.expectedIp} at your DNS provider.`,
    });
  } else if (entry.dns.status === "warning" && entry.dns.pointsToServer === false) {
    const found = [...entry.dns.aRecords, ...entry.dns.aaaaRecords].join(", ") || "unknown";
    recs.push({
      id:       "dns_wrong_ip",
      severity: "critical",
      title:    "DNS points to wrong server",
      detail:   `${entry.hostname} resolves to ${found}, but the expected server IP is ${entry.dns.expectedIp}. Update the A record at your DNS provider.`,
    });
  }

  // ── HTTP redirects to HTTPS ────────────────────────────────────────────────

  if (entry.http.status === "pass" && entry.https.status === "pass") {
    const redirect = entry.http.redirectedTo;
    if (redirect && !redirect.startsWith("https://")) {
      recs.push({
        id:       "http_no_redirect",
        severity: "warning",
        title:    "HTTP does not redirect to HTTPS",
        detail:   `${entry.hostname} serves content over plain HTTP. Configure nginx to redirect all HTTP traffic to HTTPS.`,
      });
    }
  }

  // ── HTTPS not reachable ────────────────────────────────────────────────────

  if (entry.https.status === "fail") {
    if (entry.ssl.status === "fail" && entry.ssl.daysRemaining !== null && entry.ssl.daysRemaining <= 0) {
      recs.push({
        id:       "ssl_expired",
        severity: "critical",
        title:    "SSL certificate has expired",
        detail:   `The SSL certificate for ${entry.hostname} expired ${Math.abs(entry.ssl.daysRemaining ?? 0)} day(s) ago. Renew via certbot or your SSL provider.`,
        href:     `/projects/${projectId}/domains`,
      });
    } else {
      recs.push({
        id:       "https_unreachable",
        severity: "critical",
        title:    "HTTPS is not reachable",
        detail:   `Could not connect to https://${entry.hostname}/ — ${entry.https.error ?? "unknown error"}. Check nginx config and SSL certificate status.`,
        href:     `/projects/${projectId}/domains`,
      });
    }
  }

  // ── SSL expiry warning ─────────────────────────────────────────────────────

  if (
    entry.ssl.status === "warning" &&
    entry.ssl.daysRemaining !== null &&
    entry.ssl.daysRemaining > 0
  ) {
    recs.push({
      id:       "ssl_expiring_soon",
      severity: "warning",
      title:    `SSL certificate expires in ${entry.ssl.daysRemaining} day(s)`,
      detail:   `The certificate for ${entry.hostname} (issued by ${entry.ssl.issuer ?? "unknown"}) expires on ${entry.ssl.validTo ? new Date(entry.ssl.validTo).toDateString() : "unknown"}. Renew it before it expires.`,
    });
  }

  // ── SSL not trusted ───────────────────────────────────────────────────────

  if (entry.ssl.authorized === false && entry.ssl.daysRemaining !== null && entry.ssl.daysRemaining > 0) {
    recs.push({
      id:       "ssl_not_trusted",
      severity: "warning",
      title:    "SSL certificate is not trusted by browsers",
      detail:   `The certificate for ${entry.hostname} is present but not trusted: ${entry.ssl.error ?? "unknown reason"}. Ensure you are using a CA-signed certificate.`,
    });
  }

  // ── nginx config not found ────────────────────────────────────────────────

  if (entry.nginx.serverNameMatch === false && !entry.nginx.unavailableReason) {
    recs.push({
      id:       "nginx_no_config",
      severity: "warning",
      title:    "No nginx config found for this domain",
      detail:   `No server_name block matching ${entry.hostname} was found in /etc/nginx/sites-enabled. Publish the domain from the Domains tab to generate it.`,
      href:     `/projects/${projectId}/domains`,
    });
  }

  // ── HTTP down but DNS ok ──────────────────────────────────────────────────

  if (
    entry.dns.status === "pass" &&
    entry.http.status === "fail" &&
    entry.https.status === "fail"
  ) {
    recs.push({
      id:       "server_not_responding",
      severity: "critical",
      title:    "Domain resolves but server is not responding",
      detail:   `DNS for ${entry.hostname} is correct but both HTTP and HTTPS are unreachable. Check that nginx is running and the project is deployed.`,
    });
  }

  return recs;
}
