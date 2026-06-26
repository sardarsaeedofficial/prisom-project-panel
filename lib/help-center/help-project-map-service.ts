import fs   from "fs";
import path from "path";
import { generateProjectFileInventory }   from "./project-file-inventory";
import { isExcludedHelpPath, redactHelpContent } from "./help-redaction";
import type { HelpFileInventoryItem }     from "./help-center-types";
import type {
  HelpProjectDeepMap,
  HelpProjectMapNode,
  HelpProjectMapEdge,
  HelpProjectMapNodeKind,
} from "./help-project-map-types";

// ── Known stable export map ───────────────────────────────────────────────────
// These mappings are structural conventions of the codebase and don't require
// dynamic analysis to discover.

const KNOWN_EXPORT_MAP: HelpProjectDeepMap["exportMap"] = [
  { filename: "PROJECT_KNOWLEDGE_BASE.md",       sourcePath: "lib/help-center/help-center-export.ts",          purpose: "Knowledge base — 15 sections, overview, architecture, routes, actions, components, deployment, safety", relatedPanels: ["HelpCenterPanel"] },
  { filename: "PROJECT_FILE_INVENTORY.md",        sourcePath: "lib/help-center/help-center-export.ts",          purpose: "Per-file listing grouped by category with language, size, and summary",                              relatedPanels: ["HelpCenterPanel"] },
  { filename: "PROJECT_METHODS_AND_RESOURCES.md", sourcePath: "lib/help-center/help-center-export.ts",          purpose: "Server actions, exported functions, routes, deployment commands, package imports",                   relatedPanels: ["HelpCenterPanel"] },
  { filename: "PROJECT_DEEP_MAP.md",              sourcePath: "lib/help-center/help-center-export.ts",          purpose: "Route map, action map, export dependency map, panel relationships",                                  relatedPanels: ["HelpCenterPanel"] },
  { filename: "OPERATOR_SOP_LIBRARY.md",          sourcePath: "lib/help-center/help-center-export.ts",          purpose: "14 operator SOPs for deployment, launch, monitoring, Sardar, handover",                              relatedPanels: ["HelpCenterPanel"] },
  { filename: "TROUBLESHOOTING_PLAYBOOK.md",      sourcePath: "lib/help-center/help-center-export.ts",          purpose: "14 troubleshooting playbooks for common panel and Sardar issues",                                    relatedPanels: ["HelpCenterPanel"] },
  { filename: "FINAL_READINESS_AUDIT.md",         sourcePath: "app/actions/final-readiness-audit.ts",           purpose: "Final readiness audit gate — all checklist items and blockers",                                      relatedPanels: ["FinalReadinessAuditPanel"] },
  { filename: "FINAL_LIVE_VERIFICATION_RUN.md",   sourcePath: "app/actions/final-live-verification.ts",         purpose: "Post-deploy live verification run results",                                                          relatedPanels: ["FinalLiveVerificationPanel"] },
  { filename: "GO_NO_GO_EVIDENCE_PACK.md",        sourcePath: "app/actions/go-no-go.ts",                        purpose: "Go/No-Go evidence collection pack for launch decisions",                                             relatedPanels: ["GoNoGoEvidencePanel"] },
  { filename: "LAUNCH_EXECUTION_CHECKLIST.md",    sourcePath: "app/actions/launch-execution-checklist.ts",      purpose: "Launch execution checklist with step-by-step verification items",                                    relatedPanels: ["LaunchExecutionChecklistPanel"] },
  { filename: "DEPLOY_VERIFICATION_REPORT.md",    sourcePath: "app/actions/deploy-verification.ts",             purpose: "Deploy verification report — commit hash, services, smoke checks",                                   relatedPanels: ["DeployVerificationPanel"] },
  { filename: "OPERATOR_TRAINING_PACK.md",        sourcePath: "app/actions/operator-training.ts",               purpose: "Operator training documentation and handoff pack",                                                   relatedPanels: ["OperatorTrainingPanel"] },
  { filename: "LAUNCH_SIGNOFF_REPORT.md",         sourcePath: "app/actions/launch-signoff.ts",                  purpose: "Launch signoff certificate — final human approval gate",                                             relatedPanels: ["LaunchSignoffPanel"] },
  { filename: "STOP_BUILD_GATE_REPORT.md",        sourcePath: "app/actions/stop-build-gate.ts",                 purpose: "Stop-Build Gate report — known blockers that must be resolved before launch",                        relatedPanels: ["StopBuildGatePanel"] },
  { filename: "LAUNCH_DAY_SUPPORT_REPORT.md",     sourcePath: "app/actions/launch-day-support.ts",              purpose: "Launch Day Support — real-time incident capture and triage",                                         relatedPanels: ["LaunchDaySupportPanel"] },
  { filename: "CUTOVER_REHEARSAL_REPORT.md",      sourcePath: "app/actions/cutover-rehearsal.ts",               purpose: "Cutover rehearsal simulation — full production cutover dry run results",                              relatedPanels: ["CutoverRehearsalPanel"] },
  { filename: "LAUNCH_FREEZE_REPORT.md",          sourcePath: "app/actions/launch-freeze.ts",                   purpose: "Launch freeze — code lock enforcement before launch window",                                         relatedPanels: ["LaunchFreezePanel"] },
  { filename: "OPERATOR_RUNBOOK.md",              sourcePath: "lib/runbook/runbook-export.ts",                   purpose: "Complete operator runbook for daily ops, incident response, rollback",                               relatedPanels: ["RunbookPanel"] },
  { filename: "HANDOFF_PACK.md",                  sourcePath: "lib/migration/handoff-export.ts",                 purpose: "Full project handoff pack covering all sprint sections",                                             relatedPanels: ["HandoffExportPanel"] },
  { filename: "POST_LAUNCH_BUG_REPORT.md",        sourcePath: "app/actions/post-launch-bug-capture.ts",         purpose: "Post-launch bug capture and triage report",                                                          relatedPanels: ["PostLaunchBugCapturePanel"] },
];

// ── Known route map ───────────────────────────────────────────────────────────

const KNOWN_ROUTES: HelpProjectDeepMap["routeMap"] = [
  {
    route: "/projects/[projectId]/help",
    pagePath: "app/(dashboard)/projects/[projectId]/help/page.tsx",
    panels: ["HelpCenterPanel", "HelpSearchPanel"],
    actions: ["generateProjectKnowledgeBaseAction", "searchProjectHelpAction", "answerProjectHelpQuestionAction", "exportProjectKnowledgeBaseAction", "exportProjectFileInventoryAction", "exportProjectMethodsAndResourcesAction", "generateProjectDeepMapAction", "generateOperatorSopLibraryAction", "generateTroubleshootingPlaybookAction", "exportProjectDeepMapAction", "exportOperatorSopLibraryAction", "exportTroubleshootingPlaybookAction"],
    exports: ["PROJECT_KNOWLEDGE_BASE.md", "PROJECT_FILE_INVENTORY.md", "PROJECT_METHODS_AND_RESOURCES.md", "PROJECT_DEEP_MAP.md", "OPERATOR_SOP_LIBRARY.md", "TROUBLESHOOTING_PLAYBOOK.md"],
  },
  {
    route: "/projects/[projectId]/releases",
    pagePath: "app/(dashboard)/projects/[projectId]/releases/page.tsx",
    panels: ["FinalLiveVerificationPanel", "GoNoGoEvidencePanel", "FinalReadinessAuditPanel", "DeployVerificationPanel", "LaunchExecutionChecklistPanel", "StopBuildGatePanel", "HelpCenterPanel"],
    actions: ["generateFinalLiveVerificationAction", "generateGoNoGoEvidenceAction", "generateFinalReadinessAuditAction"],
    exports: ["FINAL_LIVE_VERIFICATION_RUN.md", "GO_NO_GO_EVIDENCE_PACK.md", "FINAL_READINESS_AUDIT.md"],
  },
  {
    route: "/projects/[projectId]/runbook",
    pagePath: "app/(dashboard)/projects/[projectId]/runbook/page.tsx",
    panels: ["OperatorTrainingPanel", "LaunchSignoffPanel", "CutoverRehearsalPanel", "LaunchFreezePanel", "GoNoGoEvidencePanel", "HelpCenterPanel"],
    actions: ["generateOperatorTrainingAction", "generateLaunchSignoffAction", "generateCutoverRehearsalAction"],
    exports: ["OPERATOR_TRAINING_PACK.md", "LAUNCH_SIGNOFF_REPORT.md", "CUTOVER_REHEARSAL_REPORT.md"],
  },
  {
    route: "/projects/[projectId]/migration",
    pagePath: "app/(dashboard)/projects/[projectId]/migration/page.tsx",
    panels: ["ReplitMigrationAssistant", "SardarMigrationRunbookPanel", "NewMigrationWizard", "HelpCenterPanel"],
    actions: [],
    exports: ["HANDOFF_PACK.md"],
  },
  {
    route: "/projects/[projectId]/monitoring",
    pagePath: "app/(dashboard)/projects/[projectId]/monitoring/page.tsx",
    panels: ["ProjectMonitoringPanel", "PostCutoverMonitoringPanel", "LaunchDaySupportPanel", "PostLaunchBugCapturePanel", "HelpCenterPanel"],
    actions: ["generateProjectMonitoringAction", "generateLaunchDaySupportAction"],
    exports: ["LAUNCH_DAY_SUPPORT_REPORT.md", "POST_LAUNCH_BUG_REPORT.md"],
  },
  {
    route: "/projects/[projectId]/publishing",
    pagePath: "app/(dashboard)/projects/[projectId]/publishing/page.tsx",
    panels: ["FinalLiveVerificationPanel", "DeployVerificationPanel", "LaunchExecutionChecklistPanel", "HelpCenterPanel"],
    actions: [],
    exports: [],
  },
  {
    route: "/projects/[projectId]/settings",
    pagePath: "app/(dashboard)/projects/[projectId]/settings/page.tsx",
    panels: ["ProjectSettingsPanel", "HelpCenterPanel"],
    actions: [],
    exports: [],
  },
  {
    route: "/projects/[projectId]/backups",
    pagePath: "app/(dashboard)/projects/[projectId]/backups/page.tsx",
    panels: ["BackupPanel"],
    actions: ["generateBackupAction", "restoreBackupAction"],
    exports: [],
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function kindFromCategory(cat: HelpFileInventoryItem["category"]): HelpProjectMapNodeKind {
  const map: Record<HelpFileInventoryItem["category"], HelpProjectMapNodeKind> = {
    page:          "page",
    component:     "component",
    server_action: "server_action",
    library:       "library",
    export:        "export",
    schema:        "schema",
    config:        "config",
    script:        "service",
    style:         "unknown",
    test:          "unknown",
    unknown:       "unknown",
  };
  return map[cat] ?? "unknown";
}

function slugify(p: string): string {
  return p.replace(/[^a-z0-9]/gi, "_").toLowerCase();
}

// Selectively re-read an action file (already in safe dirs, already redacted by inventory)
// to extract permissions and audit event names.
function extractActionMeta(filePath: string): {
  permissions: string[];
  auditEvents: string[];
  exportsGenerated: string[];
} {
  const permissions     = new Set<string>();
  const auditEvents     = new Set<string>();
  const exportsGenerated = new Set<string>();

  try {
    if (isExcludedHelpPath(filePath)) return { permissions: [], auditEvents: [], exportsGenerated: [] };
    const raw = fs.readFileSync(path.join(process.cwd(), filePath), "utf-8");
    const content = redactHelpContent(raw);

    // requireProjectPermission(projectId, "project.xxx")
    const permRe = /requireProjectPermission\([^,]+,\s*["']([^"']+)["']/g;
    let m: RegExpExecArray | null;
    while ((m = permRe.exec(content)) !== null) permissions.add(m[1]);

    // action: "xxx"
    const auditRe = /action:\s*["']([a-z_][a-z_0-9.]+)["']/g;
    while ((m = auditRe.exec(content)) !== null) auditEvents.add(m[1]);

    // filename: "SOMETHING.md"
    const fnRe = /filename:\s*["'`]([A-Z0-9_\-]+\.md)["'`]/g;
    while ((m = fnRe.exec(content)) !== null) exportsGenerated.add(m[1]);
  } catch {
    // file not found or unreadable — skip
  }

  return {
    permissions:      [...permissions],
    auditEvents:      [...auditEvents],
    exportsGenerated: [...exportsGenerated],
  };
}

// ── Main generator ────────────────────────────────────────────────────────────

export async function generateHelpProjectDeepMap(input: {
  projectId: string;
}): Promise<HelpProjectDeepMap> {
  const { projectId } = input;
  const { inventory, warnings } = await generateProjectFileInventory({ projectId, maxFiles: 400 });

  // ── Build nodes ──
  const nodes: HelpProjectMapNode[] = inventory.map((item) => ({
    id:           `node_${slugify(item.path)}`,
    kind:         kindFromCategory(item.category),
    label:        path.basename(item.path),
    path:         item.path,
    summary:      item.summary,
    relatedPaths: item.importantImports.slice(0, 5),
    keywords:     item.importantExports.slice(0, 8),
    safetyNotes:  item.safetyNotes,
  }));

  // ── Build edges ──
  const edges: HelpProjectMapEdge[] = [];
  for (const item of inventory) {
    const fromId = `node_${slugify(item.path)}`;
    // importantImports are external packages (not internal paths) — skip internal edges
    // Build edges from known panel → action relationships via naming convention
    if (item.category === "component") {
      // panel-name → action file name heuristic (e.g., help-center-panel → help-center)
      const panelBase = path.basename(item.path, ".tsx").replace(/-panel$/, "");
      const likelyAction = `app/actions/${panelBase}.ts`;
      const actionNode = nodes.find((n) => n.path === likelyAction);
      if (actionNode) {
        edges.push({ from: fromId, to: actionNode.id, relationship: "calls_action", evidence: `${item.path} → ${likelyAction}` });
      }
    }
    if (item.category === "page") {
      // page → components imported (text-based from importantExports on page)
      for (const exp of item.importantExports) {
        if (/Panel$|Layout$|Card$|Page$/.test(exp)) {
          edges.push({ from: fromId, to: `node_${slugify(exp)}`, relationship: "renders", evidence: exp });
        }
      }
    }
  }

  // ── Build routeMap ──
  // Start with known routes, then add any extra discovered from inventory
  const inventoryRoutes = inventory
    .filter((i) => i.routes && i.routes.length > 0)
    .flatMap((i) => i.routes!.map((r) => ({ route: r, path: i.path })));

  const knownRoutePaths = new Set(KNOWN_ROUTES.map((r) => r.pagePath));
  const discoveredRoutes: HelpProjectDeepMap["routeMap"] = inventoryRoutes
    .filter((r) => !knownRoutePaths.has(r.path))
    .map((r) => ({
      route:    r.route,
      pagePath: r.path,
      panels:   [],
      actions:  [],
      exports:  [],
    }));

  const routeMap = [...KNOWN_ROUTES, ...discoveredRoutes];

  // ── Build actionMap ──
  const actionFiles = inventory.filter((i) => i.category === "server_action" && i.actions && i.actions.length > 0);
  const actionMap: HelpProjectDeepMap["actionMap"] = actionFiles.map((item) => {
    const meta = extractActionMeta(item.path);
    return {
      actionFile:       item.path,
      actions:          item.actions ?? [],
      permissions:      meta.permissions.length > 0 ? meta.permissions : ["project.view"],
      auditEvents:      meta.auditEvents,
      exportsGenerated: meta.exportsGenerated,
    };
  });

  return {
    projectId,
    generatedAt: new Date().toISOString(),
    nodes,
    edges,
    routeMap,
    actionMap,
    exportMap: KNOWN_EXPORT_MAP,
    warnings,
  };
}
