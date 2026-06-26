"use client";

import { useState, useTransition, useRef } from "react";
import Link                                 from "next/link";
import {
  generateProjectKnowledgeBaseAction,
  generateProjectDeepMapAction,
  generateOperatorSopLibraryAction,
  generateTroubleshootingPlaybookAction,
  exportProjectKnowledgeBaseAction,
  exportProjectFileInventoryAction,
  exportProjectMethodsAndResourcesAction,
  exportProjectDeepMapAction,
  exportOperatorSopLibraryAction,
  exportTroubleshootingPlaybookAction,
}                                           from "@/app/actions/help-center";
import { CopyDownloadButton }               from "@/components/common/copy-download-button";
import { ActionLoadingButton }             from "@/components/common/action-loading-button";
import { Badge }                            from "@/components/ui/badge";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
}                                           from "@/components/ui/card";
import {
  BookOpen, FileText, FolderOpen, AlertTriangle, CheckCircle2,
  ChevronDown, ChevronUp, ShieldCheck, Map, ClipboardList,
  Wrench, Download,
}                                           from "lucide-react";
import type { ProjectHelpCenterReport, HelpKnowledgeSection } from "@/lib/help-center/help-center-types";
import type { HelpProjectDeepMap }          from "@/lib/help-center/help-project-map-types";
import type { HelpSopLibrary, HelpSop }     from "@/lib/help-center/help-sop-types";
import type {
  HelpTroubleshootingLibrary,
  HelpTroubleshootingPlaybook,
}                                           from "@/lib/help-center/help-troubleshooting-types";

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

const SEVERITY_VARIANT = {
  critical: "destructive" as const,
  high:     "error"       as const,
  medium:   "warning"     as const,
  low:      "secondary"   as const,
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
        {open ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground shrink-0" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
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

function SopCard({ sop }: { sop: HelpSop }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border rounded-md overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-start justify-between px-3 py-2 text-left hover:bg-muted/50 transition-colors"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-0.5">
            <Badge variant="outline" className="text-[10px] shrink-0">
              {sop.category.replace(/_/g, " ")}
            </Badge>
            <span className="text-sm font-medium truncate">{sop.title}</span>
          </div>
          <p className="text-xs text-muted-foreground line-clamp-1">{sop.summary}</p>
        </div>
        {open ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />}
      </button>
      {open && (
        <div className="px-3 pb-3 pt-1 border-t bg-muted/20 space-y-2">
          <div>
            <p className="text-[10px] font-medium text-muted-foreground mb-1">Steps</p>
            <ul className="space-y-0.5">
              {sop.steps.map((s, i) => (
                <li key={i} className="text-xs">{s}</li>
              ))}
            </ul>
          </div>
          {sop.commands.length > 0 && (
            <div>
              <p className="text-[10px] font-medium text-muted-foreground mb-1">Commands</p>
              <pre className="text-[10px] bg-muted rounded px-2 py-1 overflow-x-auto font-mono">
                {sop.commands.join("\n")}
              </pre>
            </div>
          )}
          {sop.safetyNotes.length > 0 && (
            <div>
              <p className="text-[10px] font-medium text-yellow-600 mb-1">Safety</p>
              {sop.safetyNotes.map((n, i) => (
                <p key={i} className="text-xs text-yellow-700 dark:text-yellow-400">⚠ {n}</p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PlaybookCard({ pb }: { pb: HelpTroubleshootingPlaybook }) {
  const [open, setOpen] = useState(false);
  const svVariant = SEVERITY_VARIANT[pb.severity] ?? "secondary";
  return (
    <div className="border rounded-md overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-start justify-between px-3 py-2 text-left hover:bg-muted/50 transition-colors"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-0.5">
            <Badge variant={svVariant} className="text-[10px] shrink-0">
              {pb.severity.toUpperCase()}
            </Badge>
            <span className="text-sm font-medium truncate">{pb.title}</span>
          </div>
          <p className="text-xs text-muted-foreground line-clamp-1">{pb.symptoms[0]}</p>
        </div>
        {open ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />}
      </button>
      {open && (
        <div className="px-3 pb-3 pt-1 border-t bg-muted/20 space-y-2">
          <div>
            <p className="text-[10px] font-medium text-muted-foreground mb-1">Symptoms</p>
            <ul className="space-y-0.5">{pb.symptoms.map((s, i) => <li key={i} className="text-xs">• {s}</li>)}</ul>
          </div>
          <div>
            <p className="text-[10px] font-medium text-muted-foreground mb-1">Checks</p>
            <ul className="space-y-0.5">{pb.checks.map((c, i) => <li key={i} className="text-xs">{c}</li>)}</ul>
          </div>
          {pb.commands.length > 0 && (
            <pre className="text-[10px] bg-muted rounded px-2 py-1 overflow-x-auto font-mono">
              {pb.commands.join("\n")}
            </pre>
          )}
          {pb.safeFixes.length > 0 && (
            <div>
              <p className="text-[10px] font-medium text-green-600 mb-1">Safe fixes</p>
              {pb.safeFixes.map((f, i) => <p key={i} className="text-xs text-green-700 dark:text-green-400">✅ {f}</p>)}
            </div>
          )}
          {pb.unsafeFixes.length > 0 && (
            <div>
              <p className="text-[10px] font-medium text-destructive mb-1">Restricted (escalate first)</p>
              {pb.unsafeFixes.map((f, i) => <p key={i} className="text-xs text-destructive">{f}</p>)}
            </div>
          )}
          {pb.escalation.length > 0 && (
            <div>
              <p className="text-[10px] font-medium text-yellow-600 mb-1">Escalation</p>
              {pb.escalation.map((e, i) => <p key={i} className="text-xs text-yellow-700 dark:text-yellow-400">🔺 {e}</p>)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

type Tab = "sections" | "map" | "sops" | "troubleshooting" | "exports" | "warnings";

export function HelpCenterPanel({ projectId, compact }: HelpCenterPanelProps) {
  const [report,    setReport]    = useState<ProjectHelpCenterReport | null>(null);
  const [deepMap,   setDeepMap]   = useState<HelpProjectDeepMap | null>(null);
  const [sopLib,    setSopLib]    = useState<HelpSopLibrary | null>(null);
  const [troubleLib, setTroubleLib] = useState<HelpTroubleshootingLibrary | null>(null);
  const [error,     setError]     = useState("");
  const [kbMd,      setKbMd]      = useState("");
  const [invMd,     setInvMd]     = useState("");
  const [methodsMd, setMethodsMd] = useState("");
  const [mapMd,     setMapMd]     = useState("");
  const [sopMd,     setSopMd]     = useState("");
  const [troubleMd, setTroubleMd] = useState("");
  const [activeTab, setActiveTab] = useState<Tab>("sections");

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
            Knowledge base, SOPs, troubleshooting playbooks, deep project map. No secrets.
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

  // ── Generate all ──────────────────────────────────────────────────────────

  function handleGenerate() {
    if (flight.current) return;
    flight.current = true;
    setError("");
    setReport(null);
    setDeepMap(null);
    setSopLib(null);
    setTroubleLib(null);
    setKbMd(""); setInvMd(""); setMethodsMd(""); setMapMd(""); setSopMd(""); setTroubleMd("");

    startTransition(async () => {
      try {
        const [kbRes, mapRes, sopRes, troubleRes] = await Promise.all([
          generateProjectKnowledgeBaseAction({ projectId }),
          generateProjectDeepMapAction({ projectId }),
          generateOperatorSopLibraryAction({ projectId }),
          generateTroubleshootingPlaybookAction({ projectId }),
        ]);

        if (kbRes.ok)     setReport(kbRes.data);        else setError(kbRes.error);
        if (mapRes.ok)    setDeepMap(mapRes.data);
        if (sopRes.ok)    setSopLib(sopRes.data);
        if (troubleRes.ok) setTroubleLib(troubleRes.data);

        if (!kbRes.ok) return;

        // Pre-fetch all 6 exports
        expFlight.current = true;
        startExp(async () => {
          try {
            const [kb, inv, methods, map, sop, trouble] = await Promise.all([
              exportProjectKnowledgeBaseAction({ projectId }),
              exportProjectFileInventoryAction({ projectId }),
              exportProjectMethodsAndResourcesAction({ projectId }),
              exportProjectDeepMapAction({ projectId }),
              exportOperatorSopLibraryAction({ projectId }),
              exportTroubleshootingPlaybookAction({ projectId }),
            ]);
            if (kb.ok)      setKbMd(kb.data.markdown ?? "");
            if (inv.ok)     setInvMd(inv.data.markdown ?? "");
            if (methods.ok) setMethodsMd(methods.data.markdown ?? "");
            if (map.ok)     setMapMd(map.data.markdown ?? "");
            if (sop.ok)     setSopMd(sop.data.markdown ?? "");
            if (trouble.ok) setTroubleMd(trouble.data.markdown ?? "");
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

  const TABS: Array<{ key: Tab; label: string; icon: React.ReactNode }> = [
    { key: "sections",       label: report ? `Sections (${report.sections.length})` : "Sections",          icon: <BookOpen className="h-3 w-3" /> },
    { key: "map",            label: deepMap ? `Deep Map (${deepMap.routeMap.length} routes)` : "Deep Map",  icon: <Map className="h-3 w-3" /> },
    { key: "sops",           label: sopLib ? `SOPs (${sopLib.sops.length})` : "SOPs",                       icon: <ClipboardList className="h-3 w-3" /> },
    { key: "troubleshooting",label: troubleLib ? `Troubleshooting (${troubleLib.playbooks.length})` : "Troubleshooting", icon: <Wrench className="h-3 w-3" /> },
    { key: "exports",        label: "Exports",                                                               icon: <Download className="h-3 w-3" /> },
    { key: "warnings",       label: report ? `Warnings (${report.warnings.length})` : "Warnings",           icon: <AlertTriangle className="h-3 w-3" /> },
  ];

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
              Generates knowledge base, deep project map, operator SOPs, and troubleshooting playbooks.
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
          <span>Read-only documentation only. No secrets included. No .env, node_modules, .git, or backup paths scanned.</span>
        </div>

        {/* Generate button */}
        <ActionLoadingButton
          type="button"
          loading={isPending}
          loadingLabel="Generating all documentation…"
          onClick={handleGenerate}
          variant="outline"
        >
          <BookOpen className="h-4 w-4" />
          {report ? "Regenerate All Documentation" : "Generate All Documentation"}
        </ActionLoadingButton>

        {error && <p className="text-xs text-destructive">{error}</p>}

        {/* Report summary */}
        {report && (
          <>
            {/* Stats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: "Files scanned", value: report.fileCount },
                { label: "KB Sections",   value: report.sections.length },
                { label: "SOPs",          value: sopLib?.sops.length ?? "—" },
                { label: "Playbooks",     value: troubleLib?.playbooks.length ?? "—" },
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
            <div className="flex flex-wrap gap-1 border-b pb-0">
              {TABS.map(({ key, label, icon }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setActiveTab(key)}
                  className={[
                    "flex items-center gap-1 px-3 py-1.5 text-xs font-medium border-b-2 -mb-px transition-colors",
                    activeTab === key
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground hover:text-foreground",
                  ].join(" ")}
                >
                  {icon}{label}
                </button>
              ))}
            </div>

            {/* ── Knowledge Sections ── */}
            {activeTab === "sections" && (
              <div className="space-y-1.5">
                {report.sections.map((section) => (
                  <SectionRow key={section.id + section.title} section={section} />
                ))}
              </div>
            )}

            {/* ── Deep Map ── */}
            {activeTab === "map" && (
              <div className="space-y-4">
                {!deepMap ? (
                  <p className="text-xs text-muted-foreground">Deep map not yet generated — click Regenerate.</p>
                ) : (
                  <>
                    <div>
                      <p className="text-xs font-medium mb-2">Route Map ({deepMap.routeMap.length} routes)</p>
                      <div className="space-y-1.5 max-h-80 overflow-y-auto">
                        {deepMap.routeMap.map((r) => (
                          <div key={r.route} className="border rounded-md px-3 py-2 text-xs space-y-1">
                            <p className="font-mono font-medium">{r.route}</p>
                            {r.panels.length > 0 && <p className="text-muted-foreground">Panels: {r.panels.slice(0, 4).join(", ")}</p>}
                            {r.exports.length > 0 && <p className="text-muted-foreground">Exports: {r.exports.slice(0, 4).join(", ")}</p>}
                          </div>
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className="text-xs font-medium mb-2">Export Map ({deepMap.exportMap.length} known exports)</p>
                      <div className="space-y-1 max-h-60 overflow-y-auto">
                        {deepMap.exportMap.map((e) => (
                          <div key={e.filename} className="flex items-start gap-2 text-xs border-b last:border-0 py-1">
                            <FileText className="h-3 w-3 text-muted-foreground mt-0.5 shrink-0" />
                            <div className="min-w-0">
                              <span className="font-mono font-medium">{e.filename}</span>
                              <span className="text-muted-foreground ml-2">{e.purpose.slice(0, 70)}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* ── SOPs ── */}
            {activeTab === "sops" && (
              <div className="space-y-1.5">
                {!sopLib ? (
                  <p className="text-xs text-muted-foreground">SOPs not yet generated — click Regenerate.</p>
                ) : (
                  sopLib.sops.map((sop) => (
                    <SopCard key={sop.id} sop={sop} />
                  ))
                )}
              </div>
            )}

            {/* ── Troubleshooting ── */}
            {activeTab === "troubleshooting" && (
              <div className="space-y-1.5">
                {!troubleLib ? (
                  <p className="text-xs text-muted-foreground">Troubleshooting playbooks not yet generated — click Regenerate.</p>
                ) : (
                  troubleLib.playbooks.map((pb) => (
                    <PlaybookCard key={pb.id} pb={pb} />
                  ))
                )}
              </div>
            )}

            {/* ── Exports ── */}
            {activeTab === "exports" && (
              <div className="space-y-4">
                <p className="text-xs text-muted-foreground">
                  {expPending ? "Preparing exports…" : "Download all 6 documentation exports. No secrets included."}
                </p>

                {/* Knowledge base group */}
                <div className="space-y-2">
                  <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Knowledge Base</p>
                  {[
                    { label: "PROJECT_KNOWLEDGE_BASE.md",       content: kbMd,      filename: "PROJECT_KNOWLEDGE_BASE.md",       icon: <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" /> },
                    { label: "PROJECT_FILE_INVENTORY.md",        content: invMd,     filename: "PROJECT_FILE_INVENTORY.md",        icon: <FolderOpen className="h-3.5 w-3.5 text-muted-foreground shrink-0" /> },
                    { label: "PROJECT_METHODS_AND_RESOURCES.md", content: methodsMd, filename: "PROJECT_METHODS_AND_RESOURCES.md", icon: <BookOpen className="h-3.5 w-3.5 text-muted-foreground shrink-0" /> },
                  ].map(({ label, content, filename, icon }) => (
                    <div key={filename} className="flex items-center gap-2">
                      {icon}
                      <span className="text-xs font-mono flex-1 truncate">{label}</span>
                      <CopyDownloadButton
                        content={content}
                        filename={filename}
                        label="Download"
                        mimeType="text/markdown"
                        disabled={!content || expPending}
                      />
                    </div>
                  ))}
                </div>

                {/* Deep map + SOPs + Troubleshooting group */}
                <div className="space-y-2">
                  <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Operator Documentation</p>
                  {[
                    { label: "PROJECT_DEEP_MAP.md",        content: mapMd,     filename: "PROJECT_DEEP_MAP.md",        icon: <Map className="h-3.5 w-3.5 text-muted-foreground shrink-0" /> },
                    { label: "OPERATOR_SOP_LIBRARY.md",    content: sopMd,     filename: "OPERATOR_SOP_LIBRARY.md",    icon: <ClipboardList className="h-3.5 w-3.5 text-muted-foreground shrink-0" /> },
                    { label: "TROUBLESHOOTING_PLAYBOOK.md",content: troubleMd, filename: "TROUBLESHOOTING_PLAYBOOK.md",icon: <Wrench className="h-3.5 w-3.5 text-muted-foreground shrink-0" /> },
                  ].map(({ label, content, filename, icon }) => (
                    <div key={filename} className="flex items-center gap-2">
                      {icon}
                      <span className="text-xs font-mono flex-1 truncate">{label}</span>
                      <CopyDownloadButton
                        content={content}
                        filename={filename}
                        label="Download"
                        mimeType="text/markdown"
                        disabled={!content || expPending}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── Warnings ── */}
            {activeTab === "warnings" && (
              <div className="space-y-4">
                {report.warnings.length > 0 ? (
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-muted-foreground">Scan Warnings</p>
                    <ul className="space-y-1">
                      {report.warnings.map((w, i) => (
                        <li key={i} className="flex items-start gap-1.5 text-xs text-yellow-700 dark:text-yellow-400">
                          <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />{w}
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
