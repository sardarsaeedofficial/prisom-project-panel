/**
 * lib/debug/debug-summary-service.ts
 *
 * Sprint 58: Core service that generates a DebugSummary.
 *
 * Server-only — never call from client components.
 * Safety: all text passes through redactText before inclusion.
 */

import { db }                      from "@/lib/db";
import { redactText, redactExcerpt } from "./secret-redactor";
import {
  classifyLogText,
  findingsToStatus,
  derivelikelyCause,
  deriveNextSteps,
} from "./log-classifier";
import type { DebugSummary } from "./debug-types";

// ── Types ─────────────────────────────────────────────────────────────────────

export type GenerateDebugSummaryInput = {
  projectId:    string;
  source?:      DebugSummary["source"];
  logText?:     string;
  operationId?: string;
  jobId?:       string;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Fetch the lastError + meta from a project operation. */
async function fetchOperationText(projectId: string, operationId: string): Promise<string | null> {
  try {
    const op = await db.projectOperation.findFirst({
      where: { id: operationId, projectId },
      select: { lastError: true, status: true, title: true },
    });
    if (!op) return null;
    const parts: string[] = [];
    if (op.title)     parts.push(`Operation: ${op.title}`);
    if (op.status)    parts.push(`Status: ${op.status}`);
    if (op.lastError) parts.push(`Error: ${op.lastError}`);
    return parts.join("\n");
  } catch {
    return null;
  }
}

/** Fetch error text from a background job. */
async function fetchJobText(jobId: string): Promise<string | null> {
  try {
    const job = await db.backgroundJob.findFirst({
      where: { id: jobId },
      select: { lastError: true, status: true, jobType: true, lastLogLine: true },
    });
    if (!job) return null;
    const parts: string[] = [];
    if (job.jobType)    parts.push(`Job type: ${job.jobType}`);
    if (job.status)     parts.push(`Status: ${job.status}`);
    if (job.lastError)  parts.push(`Error: ${job.lastError}`);
    if (job.lastLogLine) parts.push(`Last log: ${job.lastLogLine}`);
    return parts.join("\n");
  } catch {
    return null;
  }
}

// ── Main service ──────────────────────────────────────────────────────────────

export async function generateDebugSummary(
  input: GenerateDebugSummaryInput,
): Promise<DebugSummary> {
  const { projectId, operationId, jobId } = input;
  const source = input.source ?? "unknown";
  const now    = new Date().toISOString();

  // ── Collect log text ────────────────────────────────────────────────────────
  const rawParts: string[] = [];

  if (input.logText?.trim()) {
    rawParts.push(input.logText.trim());
  }

  if (operationId) {
    const opText = await fetchOperationText(projectId, operationId);
    if (opText) rawParts.push(opText);
  }

  if (jobId) {
    const jobText = await fetchJobText(jobId);
    if (jobText) rawParts.push(jobText);
  }

  // No log text available — return unknown state
  if (rawParts.length === 0) {
    return {
      projectId,
      generatedAt: now,
      source,
      status: "unknown",
      findings: [],
      nextSteps: [
        "No log text was provided or found.",
        "Paste log output into the debug panel to analyze it.",
        "Check the Logs page for PM2 and application logs.",
      ],
    };
  }

  // ── Sanitize ────────────────────────────────────────────────────────────────
  const combined        = rawParts.join("\n\n");
  const sanitized       = redactText(combined);
  const sanitizedExcerpt = redactExcerpt(sanitized, 2000);

  // ── Classify ────────────────────────────────────────────────────────────────
  const findings    = classifyLogText(sanitized, projectId);
  const status      = findingsToStatus(findings);
  const likelyCause = derivelikelyCause(findings);
  const nextSteps   = deriveNextSteps(findings);

  return {
    projectId,
    generatedAt: now,
    source,
    status,
    findings,
    likelyCause,
    nextSteps,
    sanitizedExcerpt,
  };
}
