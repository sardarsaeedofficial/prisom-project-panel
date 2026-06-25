"use client";

/**
 * components/admin/admin-onboarding-checklist.tsx
 *
 * Sprint 67: Admin Onboarding Checklist.
 *
 * A client-side interactive checklist for new admins to work through.
 * Progress tracked in local state — not persisted (documentation only).
 */

import { useState } from "react";
import Link         from "next/link";
import { CheckCircle2, Circle, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge }  from "@/components/ui/badge";

type OnboardingItem = {
  id:        string;
  label:     string;
  detail:    string;
  href?:     string;
  linkLabel?: string;
  critical?: boolean;
};

const ITEMS: OnboardingItem[] = [
  {
    id:        "login",
    label:     "Login tested",
    detail:    "Confirm you can log in to projects.doorstepmanchester.uk with your admin account.",
    href:      "https://projects.doorstepmanchester.uk/login",
    linkLabel: "Login page →",
    critical:  true,
  },
  {
    id:        "admin-users",
    label:     "Admin users reviewed",
    detail:    "Open /admin/users. Verify only trusted users have OWNER or ADMIN global role.",
    href:      "/admin/users",
    linkLabel: "Admin Users →",
    critical:  true,
  },
  {
    id:        "project-team",
    label:     "Project team reviewed",
    detail:    "Visit the Team page on the Sardar project. Confirm member roles are correct.",
    critical:  true,
  },
  {
    id:        "owner-confirmed",
    label:     "Owner/admin confirmed",
    detail:    "At least one person has OWNER role and knows their responsibilities.",
    critical:  true,
  },
  {
    id:        "deploy-permissions",
    label:     "Deploy permissions reviewed",
    detail:    "Confirm only intended users have deploy.trigger — required for APPLY PRODUCTION CUTOVER.",
    critical:  true,
  },
  {
    id:        "env-secrets",
    label:     "Env/secret access reviewed",
    detail:    "Settings page shows secret names only (no values). Verify who has project.edit permission.",
  },
  {
    id:        "backups",
    label:     "Backup page reviewed",
    detail:    "Confirm a recent backup exists. Understand how to create and restore backups.",
  },
  {
    id:        "monitoring",
    label:     "Monitoring page reviewed",
    detail:    "Open Monitoring page. Run RUN PRODUCTION HEALTH CHECKS and read the report.",
  },
  {
    id:        "logs",
    label:     "Logs/debug page reviewed",
    detail:    "Open Logs page. Confirm PM2 log streaming works. Expand Debug Summary panel.",
  },
  {
    id:        "go-live",
    label:     "Final Go-Live Control Room reviewed",
    detail:    "Open Releases page. Understand the Production Cutover Execution Guard and confirmation phrases.",
  },
  {
    id:        "incident",
    label:     "Incident response process reviewed",
    detail:    "Read the Incident Response section of the Operator Runbook.",
  },
  {
    id:        "handoff",
    label:     "Handoff exports reviewed",
    detail:    "Understand what OPERATOR_RUNBOOK.md, FINAL_GO_LIVE_PACK.md, and POST_CUTOVER_MONITORING_REPORT.md contain.",
  },
];

// ── Component ─────────────────────────────────────────────────────────────────

export function AdminOnboardingChecklist() {
  const [done, setDone] = useState<Set<string>>(new Set());

  function toggle(id: string) {
    setDone((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const criticalItems = ITEMS.filter((i) => i.critical);
  const criticalDone  = criticalItems.filter((i) => done.has(i.id)).length;
  const allDone       = done.size === ITEMS.length;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-2.5">
            <ShieldCheck className="h-5 w-5 text-primary mt-0.5 shrink-0" />
            <div>
              <CardTitle className="text-base">Admin Onboarding Checklist</CardTitle>
              <CardDescription className="mt-1">
                Work through this checklist when onboarding a new admin or operator.
                Progress is not saved — complete it in one session.
              </CardDescription>
            </div>
          </div>
          <div className="shrink-0 flex flex-col items-end gap-1">
            <Badge
              variant={allDone ? "default" : "outline"}
              className={allDone ? "bg-green-600 hover:bg-green-600" : ""}
            >
              {done.size} / {ITEMS.length} complete
            </Badge>
            {criticalDone < criticalItems.length && (
              <span className="text-xs text-orange-500">
                {criticalDone}/{criticalItems.length} critical done
              </span>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-2">
        {ITEMS.map((item) => {
          const checked = done.has(item.id);
          return (
            <div
              key={item.id}
              className={`flex items-start gap-3 p-3 rounded-lg border transition-colors cursor-pointer hover:bg-muted/30 ${
                checked ? "border-green-200 bg-green-50/50 dark:border-green-800 dark:bg-green-950/20" : "border-transparent"
              }`}
              onClick={() => toggle(item.id)}
            >
              <div className="shrink-0 mt-0.5">
                {checked ? (
                  <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
                ) : (
                  <Circle className="h-4 w-4 text-muted-foreground" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <p className={`text-sm font-medium ${checked ? "line-through text-muted-foreground" : ""}`}>
                    {item.label}
                  </p>
                  {item.critical && (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300">
                      Critical
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{item.detail}</p>
                {item.href && (
                  <Link
                    href={item.href}
                    target={item.href.startsWith("http") ? "_blank" : undefined}
                    rel={item.href.startsWith("http") ? "noopener noreferrer" : undefined}
                    className="text-xs text-primary hover:underline mt-1 inline-block"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {item.linkLabel ?? item.href}
                  </Link>
                )}
              </div>
            </div>
          );
        })}

        {done.size > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="mt-1 text-xs"
            onClick={() => setDone(new Set())}
          >
            Reset checklist
          </Button>
        )}

        {allDone && (
          <div className="mt-3 rounded-lg border border-green-300 bg-green-50 dark:border-green-700 dark:bg-green-950/30 px-3 py-2.5 text-sm text-green-700 dark:text-green-300 flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            All items complete — admin onboarding done.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
