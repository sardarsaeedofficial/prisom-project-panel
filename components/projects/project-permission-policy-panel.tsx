"use client";

/**
 * components/projects/project-permission-policy-panel.tsx
 *
 * Sprint 59: Permission Hardening Panel.
 *
 * Shows the current user's role, their access to each dangerous action,
 * blocked actions, warnings, and next steps.
 *
 * Used on /projects/[projectId]/team.
 */

import { useState, useTransition, useCallback, useRef } from "react";
import {
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Loader2,
} from "lucide-react";
import { Badge }               from "@/components/ui/badge";
import { ActionLoadingButton } from "@/components/common/action-loading-button";
import { generateProjectPermissionPolicyReportAction } from "@/app/actions/project-permission-policy";
import type {
  ProjectPermissionPolicyReport,
  ProjectPermissionPolicyCheck,
  ActionGroup,
} from "@/lib/permissions/project-permission-policy-types";
import {
  ACTION_GROUPS,
  DANGEROUS_ACTION_LABELS,
} from "@/lib/permissions/project-permission-policy-types";

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: ProjectPermissionPolicyCheck["status"] }) {
  if (status === "allowed") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-green-700 dark:text-green-400">
        <CheckCircle2 className="h-3.5 w-3.5" />
        Allowed
      </span>
    );
  }
  if (status === "blocked") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-red-600 dark:text-red-400">
        <XCircle className="h-3.5 w-3.5" />
        Blocked
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs text-yellow-600 dark:text-yellow-400">
      <AlertTriangle className="h-3.5 w-3.5" />
      Warning
    </span>
  );
}

// ── Single check row ──────────────────────────────────────────────────────────

function CheckRow({ check }: { check: ProjectPermissionPolicyCheck }) {
  return (
    <tr className="border-b last:border-0">
      <td className="py-2 pr-4 text-sm">
        {DANGEROUS_ACTION_LABELS[check.action]}
      </td>
      <td className="py-2 pr-4 text-xs text-muted-foreground font-mono">
        {check.requiredPermission}
      </td>
      <td className="py-2 pr-4">
        <StatusBadge status={check.status} />
      </td>
      <td className="py-2 text-xs text-muted-foreground hidden sm:table-cell">
        {check.message}
      </td>
    </tr>
  );
}

// ── Group table ───────────────────────────────────────────────────────────────

const GROUP_ORDER: ActionGroup[] = [
  "Source & Import",
  "Env & Secrets",
  "Database",
  "Deployment",
  "Routing",
  "GitHub",
  "Cutover",
  "Backups",
  "Team & Settings",
];

function ChecksTable({ checks }: { checks: ProjectPermissionPolicyCheck[] }) {
  const byGroup = new Map<ActionGroup, ProjectPermissionPolicyCheck[]>();
  for (const check of checks) {
    const group = ACTION_GROUPS[check.action];
    const arr   = byGroup.get(group) ?? [];
    arr.push(check);
    byGroup.set(group, arr);
  }

  return (
    <div className="space-y-4">
      {GROUP_ORDER.filter((g) => byGroup.has(g)).map((group) => {
        const groupChecks = byGroup.get(group)!;
        const hasBlocked  = groupChecks.some((c) => c.status === "blocked");
        const hasWarning  = groupChecks.some((c) => c.status === "warning");

        return (
          <div key={group}>
            <div className="flex items-center gap-2 mb-1.5">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {group}
              </p>
              {hasBlocked && (
                <Badge variant="outline" className="text-xs py-0 h-4 border-red-400 text-red-600 dark:text-red-400">
                  blocked
                </Badge>
              )}
              {!hasBlocked && hasWarning && (
                <Badge variant="outline" className="text-xs py-0 h-4 border-yellow-400 text-yellow-600 dark:text-yellow-400">
                  warning
                </Badge>
              )}
            </div>
            <div className="rounded-md border overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="py-1.5 px-3 text-xs font-medium text-left text-muted-foreground">Action</th>
                    <th className="py-1.5 px-3 text-xs font-medium text-left text-muted-foreground">Required</th>
                    <th className="py-1.5 px-3 text-xs font-medium text-left text-muted-foreground">Status</th>
                    <th className="py-1.5 px-3 text-xs font-medium text-left text-muted-foreground hidden sm:table-cell">Message</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {groupChecks.map((check) => (
                    <tr key={check.action} className="hover:bg-muted/20">
                      <td className="py-2 px-3 text-sm">{DANGEROUS_ACTION_LABELS[check.action]}</td>
                      <td className="py-2 px-3 text-xs text-muted-foreground font-mono">{check.requiredPermission}</td>
                      <td className="py-2 px-3"><StatusBadge status={check.status} /></td>
                      <td className="py-2 px-3 text-xs text-muted-foreground hidden sm:table-cell">{check.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Summary header ────────────────────────────────────────────────────────────

function ReportHeader({ report }: { report: ProjectPermissionPolicyReport }) {
  const allowedCount = report.checks.filter((c) => c.status === "allowed").length;
  const blockedCount = report.checks.filter((c) => c.status === "blocked").length;

  return (
    <div className="rounded-lg border bg-card p-4 space-y-2">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          {report.isAdmin ? (
            <ShieldCheck className="h-4 w-4 text-green-600 dark:text-green-400" />
          ) : (
            <ShieldAlert className="h-4 w-4 text-orange-500" />
          )}
          <span className="text-sm font-medium">
            Your role: <span className="font-semibold capitalize">{report.currentUserRole ?? "Unknown"}</span>
          </span>
        </div>
        {report.isAdmin && (
          <Badge variant="outline" className="text-xs border-green-400 text-green-700 dark:text-green-400">
            Admin access
          </Badge>
        )}
        <span className="text-xs text-muted-foreground">
          {allowedCount} allowed · {blockedCount} blocked
        </span>
      </div>

      {report.blockers.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-red-600 dark:text-red-400">Blocked actions:</p>
          <ul className="text-xs text-muted-foreground space-y-0.5 pl-3">
            {report.blockers.slice(0, 5).map((b, i) => (
              <li key={i} className="flex items-start gap-1">
                <XCircle className="h-3 w-3 text-red-500 mt-0.5 flex-shrink-0" />
                {b}
              </li>
            ))}
            {report.blockers.length > 5 && (
              <li className="text-muted-foreground">…and {report.blockers.length - 5} more</li>
            )}
          </ul>
        </div>
      )}

      {report.nextSteps.length > 0 && (
        <div className="space-y-0.5">
          {report.nextSteps.map((step, i) => (
            <p key={i} className="text-xs text-muted-foreground flex items-start gap-1.5">
              <ShieldQuestion className="h-3.5 w-3.5 flex-shrink-0 mt-0.5 text-muted-foreground" />
              {step}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export function ProjectPermissionPolicyPanel({ projectId }: { projectId: string }) {
  const [report,       setReport]       = useState<ProjectPermissionPolicyReport | null>(null);
  const [error,        setError]        = useState<string | null>(null);
  const [expanded,     setExpanded]     = useState(false);
  const [isPending,    startTransition] = useTransition();
  const inFlight = useRef(false);

  const handleGenerate = useCallback(() => {
    if (inFlight.current) return;
    inFlight.current = true;
    setError(null);

    startTransition(async () => {
      try {
        const res = await generateProjectPermissionPolicyReportAction(projectId);
        if (res.ok) {
          setReport(res.data);
          setExpanded(true);
        } else {
          setError(res.error);
        }
      } finally {
        inFlight.current = false;
      }
    });
  }, [projectId]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-5 w-5 text-muted-foreground" />
          <h3 className="text-base font-semibold">Permission Hardening</h3>
        </div>
        <ActionLoadingButton
          loading={isPending}
          loadingLabel="Checking…"
          onClick={handleGenerate}
          size="sm"
          variant="outline"
        >
          <ShieldCheck className="h-4 w-4" />
          Check My Access
        </ActionLoadingButton>
      </div>

      <p className="text-sm text-muted-foreground">
        Review which dangerous actions your current role permits. Use this before staging or production cutover.
      </p>

      {error && (
        <div className="rounded border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {report && (
        <div className="space-y-3">
          <ReportHeader report={report} />

          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            {expanded ? "Hide" : "Show"} full action matrix ({report.checks.length} actions)
          </button>

          {expanded && <ChecksTable checks={report.checks} />}
        </div>
      )}
    </div>
  );
}
