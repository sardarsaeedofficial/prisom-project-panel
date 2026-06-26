"use client";

import { useState, useTransition, useRef } from "react";
import Link                                 from "next/link";
import {
  generateProjectKnowledgeBaseAction,
  exportProjectKnowledgeBaseAction,
  exportProjectFileInventoryAction,
  exportProjectMethodsAndResourcesAction,
}                                           from "@/app/actions/help-center";
import { CopyDownloadButton }               from "@/components/common/copy-download-button";
import { ActionLoadingButton }             from "@/components/common/action-loading-button";
import { Badge }                            from "@/components/ui/badge";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
}                                           from "@/components/ui/card";
import {
  BookOpen, FileText, FolderOpen, AlertTriangle, CheckCircle2,
  ChevronDown, ChevronUp, ShieldCheck,
}                                           from "lucide-react";
import type {
  ProjectHelpCenterReport,
  HelpKnowledgeSection,
} from "@/lib/help-center/help-center-types";

// ── Props ─────────────────────────────────────────────────────────────────────

interface HelpCenterPanelProps {
  projectId: string;
  compact?:  boolean;
}

// ── Category label ────────────────────────────────────────────────────────────

const CATEGORY_LABEL: Record<HelpKnowledgeSection["category"], string> = {
  overview:        "Overview",
  architecture:    "Architecture",
  file_inventory:  "File Inventory",
  routes:          "Routes",
  server_actions:  "Server Actions",
  components:      "Components",
  exports:         "Exports",
  commands:        "Commands",
  resources:       "Resources",
  languages:       "Languages",
  safety:          "Safety",
  deployment:      "Deployment",
  sardar:          "Sardar",
  troubleshooting: "Troubleshooting",
};

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionRow({ section }: { section: HelpKnowledgeSection }) {
  const [open, setOpen] = useState(false);
  const label = CATEGORY_LABEL[section.category] ?? section.category;

  return (
    <div className="border rounded-md overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-muted/50 transition-colors"
      >
        <div className="flex items-center gap-2 min-w-0">
          <Badge variant="secondary" className="text-[10px] shrink-0">{label}</Badge>
          <span className="text-sm font-medium truncate">{section.title}</span>
        </div>
        {open
          ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        }
      </button>
      {open && (
        <div className="px-3 pb-3 pt-1 border-t bg-muted/20">
          <pre className="text-xs whitespace-pre-wrap font-sans leading-relaxed">
            {section.content.slice(0, 1200)}{section.content.length > 1200 ? "\n…" : ""}
          </pre>
          {section.sourcePaths.length > 0 && (
            <p className="text-[10px] text-muted-foreground mt-2">
              Sources: {section.sourcePaths.join(" · ")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function HelpCenterPanel({ projectId, compact }: HelpCenterPanelProps) {
  const [report,     setReport]     = useState<ProjectHelpCenterReport | null>(null);
  const [error,      setError]      = useState("");
  const [kbMd,       setKbMd]       = useState("");
  const [invMd,      setInvMd]      = useState("");
  const [methodsMd,  setMethodsMd]  = useState("");
  const [activeTab,  setActiveTab]  = useState<"sections" | "exports" | "warnings">("sections");

  const [isPending, startTransition] = useTransition();
  const [expPending, startExp]       = useTransition();
  const flight    = useRef(false);
  const expFlight = useRef(false);

  // ── Compact card ──────────────────────────────────────────────────────────

  if (compact) {
    return (
      <Card>
        <CardHeader className="pb-2 pt-4 px-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <BookOpen className="h-4 w-4 text-muted-foreground shrink-0" />
              <CardTitle className="text-sm font-medium">Project Help Center</CardTitle>
            </div>
            <Badge variant="secondary" className="text-[10px] shrink-0">Read-only</Badge>
          </div>
          <CardDescription className="text-xs mt-0.5">
            Search files, methods, routes, exports, and resources. No secrets included.
          </CardDescription>
        </CardHeader>
        <CardContent className="pb-4 px-4">
          <Link
            href={`/projects/${projectId}/help`}
            className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
          >
            <BookOpen className="h-3 w-3" />
            Open Help Center
          </Link>
        </CardContent>
      </Card>
    );
  }

  // ── Generate ──────────────────────────────────────────────────────────────

  function handleGenerate() {
    if (flight.current) return;
    flight.current = true;
    setError("");
    setReport(null);
    setKbMd("");
    setInvMd("");
    setMethodsMd("");

    startTransition(async () => {
      try {
        const res = await generateProjectKnowledgeBaseAction({ projectId });
        if (!res.ok) { setError(res.error); return; }
        setReport(res.data);

        // Pre-fetch all three exports
        expFlight.current = true;
        startExp(async () => {
          try {
            const [kb, inv, methods] = await Promise.all([
              exportProjectKnowledgeBaseAction({ projectId }),
              exportProjectFileInventoryAction({ projectId }),
              exportProjectMethodsAndResourcesAction({ projectId }),
            ]);
            if (kb.ok)      setKbMd(kb.data.markdown ?? "");
            if (inv.ok)     setInvMd(inv.data.markdown ?? "");
            if (methods.ok) setMethodsMd(methods.data.markdown ?? "");
          } finally {
            expFlight.current = false;
          }
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Unexpected error.");
      } finally {
        flight.current = false;
      }
    });
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-muted-foreground shrink-0" />
              <CardTitle className="text-base">Project Help Center</CardTitle>
            </div>
            <CardDescription className="mt-1 text-xs">
              Generates a living README and searchable knowledge base from the panel codebase.
              Read-only — no secrets exposed, no production mutation.
            </CardDescription>
          </div>
          {report && (
            <div className="flex flex-col items-end gap-1 shrink-0">
              <Badge variant="success" className="text-[10px]">Generated</Badge>
              <span className="text-[10px] text-muted-foreground">{report.fileCount} files</span>
            </div>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Safety note */}
        <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/40 rounded-md px-3 py-2">
          <ShieldCheck className="h-3.5 w-3.5 text-green-600 mt-0.5 shrink-0" />
          <span>Read-only documentation only. No secret values included. No .env, node_modules, .git, or backup paths scanned.</span>
        </div>

        {/* Generate button */}
        <ActionLoadingButton
          type="button"
          loading={isPending}
          loadingLabel="Generating knowledge base…"
          onClick={handleGenerate}
          variant="outline"
        >
          <BookOpen className="h-4 w-4" />
          {report ? "Regenerate Knowledge Base" : "Generate Knowledge Base"}
        </ActionLoadingButton>

        {error && (
          <p className="text-xs text-destructive">{error}</p>
        )}

        {/* Report summary */}
        {report && (
          <>
            {/* Stats row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: "Files scanned", value: report.fileCount },
                { label: "Sections",      value: report.sections.length },
                { label: "Languages",     value: Object.keys(report.languages).length },
                { label: "Frameworks",    value: report.frameworks.length },
              ].map(({ label, value }) => (
                <div key={label} className="bg-muted/30 rounded-md px-3 py-2 text-center">
                  <p className="text-lg font-semibold">{value}</p>
                  <p className="text-[10px] text-muted-foreground">{label}</p>
                </div>
              ))}
            </div>

            {/* Frameworks */}
            {report.frameworks.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {report.frameworks.map((f) => (
                  <Badge key={f} variant="outline" className="text-[10px]">{f}</Badge>
                ))}
              </div>
            )}

            {/* Tabs */}
            <div className="flex gap-1 border-b pb-0">
              {(["sections", "exports", "warnings"] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveTab(tab)}
                  className={[
                    "px-3 py-1.5 text-xs font-medium border-b-2 -mb-px transition-colors",
                    activeTab === tab
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground hover:text-foreground",
                  ].join(" ")}
                >
                  {tab === "sections"  ? `Knowledge Sections (${report.sections.length})` : ""}
                  {tab === "exports"   ? "Exports" : ""}
                  {tab === "warnings"  ? `Warnings (${report.warnings.length})` : ""}
                </button>
              ))}
            </div>

            {/* Knowledge Sections */}
            {activeTab === "sections" && (
              <div className="space-y-1.5">
                {report.sections.map((section) => (
                  <SectionRow key={section.id + section.title} section={section} />
                ))}
              </div>
            )}

            {/* Exports */}
            {activeTab === "exports" && (
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  {expPending
                    ? "Preparing exports…"
                    : "Download documentation exports. No secrets included."}
                </p>

                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="text-xs font-medium">PROJECT_KNOWLEDGE_BASE.md</span>
                  </div>
                  <CopyDownloadButton
                    content={kbMd}
                    filename="PROJECT_KNOWLEDGE_BASE.md"
                    label="Download Knowledge Base"
                    mimeType="text/markdown"
                    disabled={!kbMd || expPending}
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <FolderOpen className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="text-xs font-medium">PROJECT_FILE_INVENTORY.md</span>
                  </div>
                  <CopyDownloadButton
                    content={invMd}
                    filename="PROJECT_FILE_INVENTORY.md"
                    label="Download File Inventory"
                    mimeType="text/markdown"
                    disabled={!invMd || expPending}
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <BookOpen className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="text-xs font-medium">PROJECT_METHODS_AND_RESOURCES.md</span>
                  </div>
                  <CopyDownloadButton
                    content={methodsMd}
                    filename="PROJECT_METHODS_AND_RESOURCES.md"
                    label="Download Methods & Resources"
                    mimeType="text/markdown"
                    disabled={!methodsMd || expPending}
                  />
                </div>
              </div>
            )}

            {/* Warnings & Excluded */}
            {activeTab === "warnings" && (
              <div className="space-y-4">
                {report.warnings.length > 0 ? (
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-muted-foreground">Scan Warnings</p>
                    <ul className="space-y-1">
                      {report.warnings.map((w, i) => (
                        <li key={i} className="flex items-start gap-1.5 text-xs text-yellow-700 dark:text-yellow-400">
                          <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                          {w}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <p className="flex items-center gap-1.5 text-xs text-green-600">
                    <CheckCircle2 className="h-3.5 w-3.5" />No scan warnings.
                  </p>
                )}

                {report.excludedPaths.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-muted-foreground">
                      Excluded Paths ({report.excludedPaths.length})
                    </p>
                    <ul className="space-y-0.5 max-h-48 overflow-y-auto">
                      {report.excludedPaths.slice(0, 40).map((p, i) => (
                        <li key={i} className="text-[10px] text-muted-foreground font-mono">{p}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
