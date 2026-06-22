/**
 * lib/domains/domain-dns-checker.ts
 *
 * Sprint 29: DNS resolution checks using Node dns.promises.
 * Server-only — never imported from client code.
 */

import { promises as dnsPromises } from "dns";
import type { DnsCheckResult } from "./domain-health-types";

const SERVER_PUBLIC_IP = process.env.SERVER_PUBLIC_IP ?? process.env.VPS_IP ?? "178.105.105.59";
const DNS_TIMEOUT_MS   = 5_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms),
    ),
  ]);
}

function normalise(ip: string): string {
  return ip.trim().toLowerCase();
}

export async function checkDns(hostname: string): Promise<DnsCheckResult> {
  const resolver = new dnsPromises.Resolver();
  resolver.setServers(["8.8.8.8", "1.1.1.1"]);

  const expectedIp = normalise(SERVER_PUBLIC_IP);

  let aRecords:    string[] = [];
  let aaaaRecords: string[] = [];
  let cnameValue:  string | null = null;
  const errors: string[] = [];

  await Promise.all([
    withTimeout(resolver.resolve4(hostname), DNS_TIMEOUT_MS, "A-record lookup")
      .then((r: string[]) => { aRecords = r.map(normalise); })
      .catch((err: unknown) => {
        const e = err as NodeJS.ErrnoException;
        if (e.code !== "ENOTFOUND" && e.code !== "ENODATA" && !e.message?.includes("timed out")) {
          errors.push(`A: ${e.message ?? String(err)}`);
        }
      }),

    withTimeout(resolver.resolve6(hostname), DNS_TIMEOUT_MS, "AAAA-record lookup")
      .then((r: string[]) => { aaaaRecords = r.map(normalise); })
      .catch(() => { /* AAAA absence is fine */ }),

    withTimeout(resolver.resolveCname(hostname), DNS_TIMEOUT_MS, "CNAME lookup")
      .then((r: string[]) => { cnameValue = r[0] ?? null; })
      .catch(() => { /* No CNAME is fine */ }),
  ]);

  const allAddresses = [...aRecords, ...aaaaRecords];
  const pointsToServer = allAddresses.length > 0
    ? allAddresses.includes(expectedIp)
    : null;

  let status: DnsCheckResult["status"];
  if (allAddresses.length === 0 && !cnameValue) {
    status = errors.length > 0 ? "fail" : "unknown";
  } else if (pointsToServer === true) {
    status = "pass";
  } else if (pointsToServer === false) {
    status = "warning";
  } else {
    status = "unknown";
  }

  return {
    status,
    aRecords,
    aaaaRecords,
    cnameValue,
    expectedIp,
    pointsToServer,
    resolvedAt: new Date().toISOString(),
    error: errors.length > 0 ? errors.join("; ") : null,
  };
}
