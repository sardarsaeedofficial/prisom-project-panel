"use client";

/**
 * components/projects/team-permission-review-checklist.tsx
 *
 * Sprint 59: Pre-deployment team permission review checklist.
 *
 * Client-only — checks are manually ticked. No mutations.
 * Add to /projects/[projectId]/team page.
 */

import { useState } from "react";
import { CheckSquare, Square, ShieldCheck, ExternalLink } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";

type CheckItem = {
  id:       string;
  label:    string;
  detail?:  string;
  critical: boolean;
};

const CHECKLIST: CheckItem[] = [
  {
    id:       "owner-confirmed",
    label:    "Owner or Admin confirmed for this project",
    detail:   "At least one trusted user holds the Owner or Admin role.",
    critical: true,
  },
  {
    id:       "deploy-limited",
    label:    "Deploy permission limited to trusted users",
    detail:   "Only Operators, Developers, Admins, or Owners should trigger deploys.",
    critical: true,
  },
  {
    id:       "env-secret-limited",
    label:    "Env/secret editing limited to trusted users",
    detail:   "Only Developers, Admins, or Owners can write env variables and secrets.",
    critical: true,
  },
  {
    id:       "route-apply-limited",
    label:    "Route apply limited to trusted users",
    detail:   "Applying production routes requires deploy.trigger or project.edit.",
    critical: true,
  },
  {
    id:       "cutover-limited",
    label:    "Cutover completion limited to trusted users",
    detail:   "Mark Cutover Complete requires deploy.trigger or project.edit.",
    critical: true,
  },
  {
    id:       "backup-restore-limited",
    label:    "Backup restore limited to trusted users",
    detail:   "Restoring from a backup can overwrite production data.",
    critical: true,
  },
  {
    id:       "former-users-removed",
    label:    "Former team members removed",
    detail:   "Users who no longer need access have been removed from the team.",
    critical: false,
  },
  {
    id:       "invites-reviewed",
    label:    "Pending invite links reviewed",
    detail:   "Outstanding invites should be cancelled if they are no longer needed.",
    critical: false,
  },
  {
    id:       "audit-log-reviewed",
    label:    "Audit log reviewed for unexpected actions",
    detail:   "Check the Activity or Audit page for unexpected permission denials or suspicious activity.",
    critical: false,
  },
];

export function TeamPermissionReviewChecklist({
  projectId,
}: {
  projectId: string;
}) {
  const [checked, setChecked] = useState<Set<string>>(new Set());

  const toggle = (id: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const total    = CHECKLIST.length;
  const done     = checked.size;
  const critical = CHECKLIST.filter((c) => c.critical);
  const critDone = critical.filter((c) => checked.has(c.id)).length;
  const allCritDone = critDone === critical.length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Permission Review Checklist</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{done}/{total} checked</span>
          {allCritDone ? (
            <Badge variant="outline" className="text-xs border-green-400 text-green-700 dark:text-green-400">
              Critical items done
            </Badge>
          ) : (
            <Badge variant="outline" className="text-xs border-yellow-400 text-yellow-700 dark:text-yellow-400">
              {critDone}/{critical.length} critical
            </Badge>
          )}
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Review before staging execution or production cutover. Check off each item to confirm it has been reviewed.
      </p>

      <div className="space-y-1">
        {CHECKLIST.map((item) => {
          const isDone = checked.has(item.id);
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => toggle(item.id)}
              className="w-full flex items-start gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-muted/60 transition-colors group"
            >
              {isDone ? (
                <CheckSquare className="h-4 w-4 text-green-600 dark:text-green-400 mt-0.5 flex-shrink-0" />
              ) : (
                <Square className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className={`text-sm ${isDone ? "line-through text-muted-foreground" : ""}`}>
                    {item.label}
                  </span>
                  {item.critical && !isDone && (
                    <Badge variant="outline" className="text-xs py-0 h-4 border-orange-400 text-orange-600 dark:text-orange-400">
                      critical
                    </Badge>
                  )}
                </div>
                {item.detail && (
                  <p className="text-xs text-muted-foreground mt-0.5">{item.detail}</p>
                )}
              </div>
            </button>
          );
        })}
      </div>

      <div className="pt-1 flex items-center gap-3 flex-wrap">
        <Link
          href={`/projects/${projectId}/audit`}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ExternalLink className="h-3 w-3" />
          View Audit Log
        </Link>
        <Link
          href={`/projects/${projectId}/activity`}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ExternalLink className="h-3 w-3" />
          View Activity
        </Link>
      </div>
    </div>
  );
}
