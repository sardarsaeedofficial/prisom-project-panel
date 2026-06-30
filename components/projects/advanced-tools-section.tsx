"use client";

/**
 * components/projects/advanced-tools-section.tsx
 *
 * Sprint 87: Wraps the older technical import tools in a collapsible
 * "Advanced tools" section. Hidden by default so the primary AI Import
 * Operator experience is uncluttered.
 */

import { useState } from "react";
import { ChevronDown, ChevronUp, Wrench, PackageOpen } from "lucide-react";
import { SmartImportPanel }       from "@/components/projects/smart-import-panel";
import { AutoImportControlRoom }  from "@/components/projects/auto-import-control-room";
import { AiImportOperatorPanel }  from "@/components/projects/ai-import-operator-panel";
import { AiImportAutopilotPanel } from "@/components/projects/ai-import-autopilot-panel";
import { SourceIntakePanel }      from "@/components/projects/source-intake-panel";
import { ReplitImportWizard }     from "@/components/projects/replit-import-wizard";
import { DbMigrationPanel }       from "@/components/projects/db-migration-panel";

interface AdvancedToolsSectionProps {
  projectId:       string;
  projectSlug:     string;
  projectName:     string;
  hasExistingConfig: boolean;
}

export function AdvancedToolsSection({
  projectId,
  projectSlug,
  projectName,
  hasExistingConfig,
}: AdvancedToolsSectionProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-md border border-dashed border-border">
      <button
        type="button"
        onClick={() => setOpen((s) => !s)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors rounded-md"
      >
        <span className="flex items-center gap-2">
          <Wrench className="h-4 w-4" />
          Advanced tools
          <span className="text-xs font-normal opacity-70">
            (AI Import Autopilot, AI Import Operator, Auto Import, Smart Import, Replit Wizard, DB Migration)
          </span>
        </span>
        {open
          ? <ChevronUp className="h-4 w-4 shrink-0" />
          : <ChevronDown className="h-4 w-4 shrink-0" />
        }
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-6 border-t pt-4">
          {/* Sprint 88: AI Import Autopilot (superseded by Sprint 89 Agent Console above) */}
          <AiImportAutopilotPanel projectId={projectId} />

          {/* Sprint 87: AI Import Operator */}
          <AiImportOperatorPanel projectId={projectId} />

          {/* Sprint 86: Auto Import Control Room */}
          <AutoImportControlRoom projectId={projectId} />

          {/* Sprint 85: Smart Import */}
          <SmartImportPanel projectId={projectId} />

          {/* Sprint 57: Source Intake Readiness + GitHub import */}
          <SourceIntakePanel projectId={projectId} showGitHubImport />

          {/* Replit import wizard */}
          <section>
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-1.5">
              <PackageOpen className="h-4 w-4" />
              Replit Import Wizard
            </h2>
            <ReplitImportWizard
              projectId={projectId}
              projectSlug={projectSlug}
              projectName={projectName}
              hasExistingConfig={hasExistingConfig}
            />
          </section>

          {/* DB migration */}
          <section>
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
              Database Migration
            </h2>
            <DbMigrationPanel projectId={projectId} />
          </section>
        </div>
      )}
    </div>
  );
}
