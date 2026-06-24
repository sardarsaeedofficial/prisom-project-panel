"use client";

/**
 * components/projects/go-live-regression-checklist.tsx
 *
 * Sprint 56: Manual regression checklist for go-live UX validation.
 * Client-side only — no server state, no DB, no secrets.
 */

import { useState } from "react";
import Link         from "next/link";
import {
  CheckCircle2, Circle, RotateCcw, ClipboardList,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge }  from "@/components/ui/badge";

type CheckItem = {
  id:      string;
  label:   string;
  detail:  string;
  linkHref: string;
  linkLabel: string;
};

const CHECKLIST: CheckItem[] = [
  {
    id:         "golive_readiness",
    label:      "Generate Go-Live Readiness",
    detail:     "Runs all go-live checks: deployment, env, database, domain, routing, backup, monitoring.",
    linkHref:   "releases",
    linkLabel:  "Releases",
  },
  {
    id:         "cutover_plan",
    label:      "Generate Cutover Plan",
    detail:     "Generates the full 11-stage production cutover plan.",
    linkHref:   "releases",
    linkLabel:  "Releases",
  },
  {
    id:         "smoke_checks",
    label:      "Run Smoke Checks",
    detail:     "HTTP GET/HEAD checks on domain root, API health, SPA fallback, and Stripe webhook URL.",
    linkHref:   "releases",
    linkLabel:  "Releases",
  },
  {
    id:         "export_cutover",
    label:      "Export Cutover Plan",
    detail:     "Downloads PRODUCTION_CUTOVER_PLAN.md with no secrets.",
    linkHref:   "releases",
    linkLabel:  "Releases",
  },
  {
    id:         "dry_run",
    label:      "Generate Dry Run Plan",
    detail:     "Validates install, build, services, env, database, routing, and domain without live changes.",
    linkHref:   "publishing",
    linkLabel:  "Publishing",
  },
  {
    id:         "routing_diagnostics",
    label:      "Generate Routing Diagnostics",
    detail:     "Checks nginx config, domain, SSL, backup, and service routing.",
    linkHref:   "publishing",
    linkLabel:  "Publishing",
  },
  {
    id:         "routing_preview",
    label:      "Preview Routing Config",
    detail:     "Previews the nginx config that would be applied — no live changes.",
    linkHref:   "publishing",
    linkLabel:  "Publishing",
  },
  {
    id:         "external_services",
    label:      "Generate External Services Readiness",
    detail:     "Checks Stripe, Cloudinary, and email secret presence and mode. No values exposed.",
    linkHref:   "env",
    linkLabel:  "Env",
  },
  {
    id:         "staging_import",
    label:      "Generate Staging Import Plan",
    detail:     "Validates the staging import plan for Sardar Security Supplies.",
    linkHref:   "migration",
    linkLabel:  "Migration",
  },
  {
    id:         "handoff_export",
    label:      "Export Handoff Document",
    detail:     "Downloads the full migration handoff markdown with no secrets.",
    linkHref:   "migration",
    linkLabel:  "Migration",
  },
];

export function GoLiveRegressionChecklist({ projectId }: { projectId: string }) {
  const [done, setDone] = useState<Set<string>>(new Set());

  function toggle(id: string) {
    setDone((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function reset() {
    setDone(new Set());
  }

  const doneCount  = done.size;
  const totalCount = CHECKLIST.length;
  const allDone    = doneCount === totalCount;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-sm flex items-center gap-2">
            <ClipboardList className="h-4 w-4" />
            Go-Live Regression Checklist
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant={allDone ? "success" : doneCount > 0 ? "warning" : "secondary"}>
              {doneCount}/{totalCount} done
            </Badge>
            {doneCount > 0 && (
              <Button type="button" variant="ghost" size="sm" onClick={reset} className="h-7 text-xs">
                <RotateCcw className="h-3.5 w-3.5" />
                Reset
              </Button>
            )}
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Mark each panel action as tested before production cutover. Client-side only — no server state.
        </p>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="divide-y divide-border">
          {CHECKLIST.map((item) => {
            const isDone = done.has(item.id);
            return (
              <div key={item.id} className="flex items-start gap-3 py-2.5">
                <button
                  type="button"
                  onClick={() => toggle(item.id)}
                  className="mt-0.5 shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                  aria-label={isDone ? `Unmark ${item.label}` : `Mark ${item.label} as done`}
                >
                  {isDone
                    ? <CheckCircle2 className="h-4 w-4 text-green-500" />
                    : <Circle className="h-4 w-4" />}
                </button>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium ${isDone ? "line-through text-muted-foreground" : ""}`}>
                    {item.label}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">{item.detail}</p>
                </div>
                <Link
                  href={`/projects/${projectId}/${item.linkHref}`}
                  className="text-xs text-primary hover:underline shrink-0 mt-0.5"
                >
                  {item.linkLabel} →
                </Link>
              </div>
            );
          })}
        </div>
        {allDone && (
          <div className="mt-3 rounded-lg border border-green-200 bg-green-50 dark:bg-green-950/20 px-3 py-2">
            <p className="text-xs text-green-700 dark:text-green-300 flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
              All regression checks marked. Review results in each panel before proceeding with production cutover.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
