"use server";

import { requireProjectPermission }      from "@/lib/auth/project-membership";
import { writeProjectAuditEvent }        from "@/lib/audit/project-audit";
import { getAuditRequestContext }        from "@/lib/audit/request-context";
import { generateProjectKnowledgeBase }       from "@/lib/help-center/project-knowledge-builder";
import { searchHelpKnowledge }                from "@/lib/help-center/help-search-index";
import { answerHelpQuestion }                 from "@/lib/help-center/help-answer-service";
import { generateHelpProjectDeepMap }         from "@/lib/help-center/help-project-map-service";
import { generateHelpSopLibrary }             from "@/lib/help-center/help-sop-service";
import { generateHelpTroubleshootingLibrary } from "@/lib/help-center/help-troubleshooting-service";
import {
  exportProjectKnowledgeBase,
  exportProjectFileInventory,
  exportProjectMethodsAndResources,
  exportProjectDeepMap,
  exportOperatorSopLibrary,
  exportTroubleshootingPlaybook,
}                                             from "@/lib/help-center/help-center-export";
import type { ProjectHelpCenterReport }       from "@/lib/help-center/help-center-types";
import type { HelpAnswer, HelpSearchResult }  from "@/lib/help-center/help-center-types";
import type { HelpProjectDeepMap }            from "@/lib/help-center/help-project-map-types";
import type { HelpSopLibrary }                from "@/lib/help-center/help-sop-types";
import type { HelpTroubleshootingLibrary }    from "@/lib/help-center/help-troubleshooting-types";

type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: string };

// ── Generate knowledge base ───────────────────────────────────────────────────

export async function generateProjectKnowledgeBaseAction(input: {
  projectId: string;
}): Promise<ActionResult<ProjectHelpCenterReport>> {
  const { projectId } = input;
  const auth = await requireProjectPermission(projectId, "project.view");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  try {
    const report = await generateProjectKnowledgeBase({ projectId });
    const ctx    = await getAuditRequestContext();
    void writeProjectAuditEvent({
      projectId,
      actorUserId: auth.userId,
      actorRole:   auth.role,
      action:      "help_center.generated",
      category:    "publishing",
      result:      "success",
      summary:     `Help Center knowledge base generated — ${report.fileCount} files scanned`,
      metadata:    { fileCount: report.fileCount, sectionCount: report.sections.length },
      ...ctx,
    }).catch(() => null);
    return { ok: true, data: report };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message.slice(0, 300) : "Failed to generate knowledge base.",
    };
  }
}

// ── Search ────────────────────────────────────────────────────────────────────

export async function searchProjectHelpAction(input: {
  projectId: string;
  query:     string;
}): Promise<ActionResult<HelpSearchResult[]>> {
  const { projectId, query } = input;
  const auth = await requireProjectPermission(projectId, "project.view");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  if (!query.trim()) return { ok: true, data: [] };

  try {
    const report  = await generateProjectKnowledgeBase({ projectId });
    const results = searchHelpKnowledge({ report, query, limit: 6 });
    const ctx     = await getAuditRequestContext();
    void writeProjectAuditEvent({
      projectId,
      actorUserId: auth.userId,
      actorRole:   auth.role,
      action:      "help_center.searched",
      category:    "publishing",
      result:      "success",
      summary:     `Help Center searched: "${query.slice(0, 100)}" — ${results.length} result(s)`,
      metadata:    { query: query.slice(0, 100), resultCount: results.length },
      ...ctx,
    }).catch(() => null);
    return { ok: true, data: results };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message.slice(0, 300) : "Search failed.",
    };
  }
}

// ── Ask help question ─────────────────────────────────────────────────────────

export async function answerProjectHelpQuestionAction(input: {
  projectId: string;
  question:  string;
}): Promise<ActionResult<HelpAnswer>> {
  const { projectId, question } = input;
  const auth = await requireProjectPermission(projectId, "project.view");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  if (!question.trim()) {
    return { ok: false, error: "Question cannot be empty." };
  }

  try {
    const answer = await answerHelpQuestion({ projectId, question });
    const ctx    = await getAuditRequestContext();
    void writeProjectAuditEvent({
      projectId,
      actorUserId: auth.userId,
      actorRole:   auth.role,
      action:      "help_center.answered",
      category:    "publishing",
      result:      "success",
      summary:     `Help question answered: "${question.slice(0, 100)}" — confidence: ${answer.confidence}`,
      metadata:    { confidence: answer.confidence, matchedSections: answer.matchedSections.length },
      ...ctx,
    }).catch(() => null);
    return { ok: true, data: answer };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message.slice(0, 300) : "Failed to answer question.",
    };
  }
}

// ── Exports ───────────────────────────────────────────────────────────────────

export async function exportProjectKnowledgeBaseAction(input: {
  projectId: string;
}): Promise<ActionResult<{ markdown: string; filename: string }>> {
  const { projectId } = input;
  const auth = await requireProjectPermission(projectId, "project.view");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  try {
    const result = await exportProjectKnowledgeBase({ projectId });
    const ctx    = await getAuditRequestContext();
    void writeProjectAuditEvent({
      projectId,
      actorUserId: auth.userId,
      actorRole:   auth.role,
      action:      "help_center.exported",
      category:    "publishing",
      result:      "success",
      summary:     "PROJECT_KNOWLEDGE_BASE.md exported",
      metadata:    { filename: result.filename },
      ...ctx,
    }).catch(() => null);
    return { ok: true, data: result };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message.slice(0, 300) : "Export failed.",
    };
  }
}

export async function exportProjectFileInventoryAction(input: {
  projectId: string;
}): Promise<ActionResult<{ markdown: string; filename: string }>> {
  const { projectId } = input;
  const auth = await requireProjectPermission(projectId, "project.view");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  try {
    const result = await exportProjectFileInventory({ projectId });
    const ctx    = await getAuditRequestContext();
    void writeProjectAuditEvent({
      projectId,
      actorUserId: auth.userId,
      actorRole:   auth.role,
      action:      "help_center.exported",
      category:    "publishing",
      result:      "success",
      summary:     "PROJECT_FILE_INVENTORY.md exported",
      metadata:    { filename: result.filename },
      ...ctx,
    }).catch(() => null);
    return { ok: true, data: result };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message.slice(0, 300) : "Export failed.",
    };
  }
}

export async function exportProjectMethodsAndResourcesAction(input: {
  projectId: string;
}): Promise<ActionResult<{ markdown: string; filename: string }>> {
  const { projectId } = input;
  const auth = await requireProjectPermission(projectId, "project.view");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  try {
    const result = await exportProjectMethodsAndResources({ projectId });
    const ctx    = await getAuditRequestContext();
    void writeProjectAuditEvent({
      projectId,
      actorUserId: auth.userId,
      actorRole:   auth.role,
      action:      "help_center.exported",
      category:    "publishing",
      result:      "success",
      summary:     "PROJECT_METHODS_AND_RESOURCES.md exported",
      metadata:    { filename: result.filename },
      ...ctx,
    }).catch(() => null);
    return { ok: true, data: result };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message.slice(0, 300) : "Export failed.",
    };
  }
}

// ── Deep Project Map ──────────────────────────────────────────────────────────

export async function generateProjectDeepMapAction(input: {
  projectId: string;
}): Promise<ActionResult<HelpProjectDeepMap>> {
  const { projectId } = input;
  const auth = await requireProjectPermission(projectId, "project.view");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  try {
    const deepMap = await generateHelpProjectDeepMap({ projectId });
    const ctx     = await getAuditRequestContext();
    void writeProjectAuditEvent({
      projectId,
      actorUserId: auth.userId,
      actorRole:   auth.role,
      action:      "help_center.deep_map_generated",
      category:    "publishing",
      result:      "success",
      summary:     `Deep Project Map generated — ${deepMap.nodes.length} nodes, ${deepMap.routeMap.length} routes`,
      metadata:    { nodeCount: deepMap.nodes.length, routeCount: deepMap.routeMap.length },
      ...ctx,
    }).catch(() => null);
    return { ok: true, data: deepMap };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message.slice(0, 300) : "Failed to generate deep map.",
    };
  }
}

export async function exportProjectDeepMapAction(input: {
  projectId: string;
}): Promise<ActionResult<{ markdown: string; filename: string }>> {
  const { projectId } = input;
  const auth = await requireProjectPermission(projectId, "project.view");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  try {
    const result = await exportProjectDeepMap({ projectId });
    const ctx    = await getAuditRequestContext();
    void writeProjectAuditEvent({
      projectId,
      actorUserId: auth.userId,
      actorRole:   auth.role,
      action:      "help_center.deep_map_exported",
      category:    "publishing",
      result:      "success",
      summary:     "PROJECT_DEEP_MAP.md exported",
      metadata:    { filename: result.filename },
      ...ctx,
    }).catch(() => null);
    return { ok: true, data: result };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message.slice(0, 300) : "Export failed.",
    };
  }
}

// ── Operator SOP Library ──────────────────────────────────────────────────────

export async function generateOperatorSopLibraryAction(input: {
  projectId: string;
}): Promise<ActionResult<HelpSopLibrary>> {
  const { projectId } = input;
  const auth = await requireProjectPermission(projectId, "project.view");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  try {
    const lib = await generateHelpSopLibrary({ projectId });
    const ctx = await getAuditRequestContext();
    void writeProjectAuditEvent({
      projectId,
      actorUserId: auth.userId,
      actorRole:   auth.role,
      action:      "help_center.sop_generated",
      category:    "publishing",
      result:      "success",
      summary:     `Operator SOP Library generated — ${lib.sops.length} SOPs`,
      metadata:    { sopCount: lib.sops.length },
      ...ctx,
    }).catch(() => null);
    return { ok: true, data: lib };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message.slice(0, 300) : "Failed to generate SOP library.",
    };
  }
}

export async function exportOperatorSopLibraryAction(input: {
  projectId: string;
}): Promise<ActionResult<{ markdown: string; filename: string }>> {
  const { projectId } = input;
  const auth = await requireProjectPermission(projectId, "project.view");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  try {
    const result = await exportOperatorSopLibrary({ projectId });
    const ctx    = await getAuditRequestContext();
    void writeProjectAuditEvent({
      projectId,
      actorUserId: auth.userId,
      actorRole:   auth.role,
      action:      "help_center.sop_exported",
      category:    "publishing",
      result:      "success",
      summary:     "OPERATOR_SOP_LIBRARY.md exported",
      metadata:    { filename: result.filename },
      ...ctx,
    }).catch(() => null);
    return { ok: true, data: result };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message.slice(0, 300) : "Export failed.",
    };
  }
}

// ── Troubleshooting Playbook ──────────────────────────────────────────────────

export async function generateTroubleshootingPlaybookAction(input: {
  projectId: string;
}): Promise<ActionResult<HelpTroubleshootingLibrary>> {
  const { projectId } = input;
  const auth = await requireProjectPermission(projectId, "project.view");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  try {
    const lib = await generateHelpTroubleshootingLibrary({ projectId });
    const ctx = await getAuditRequestContext();
    void writeProjectAuditEvent({
      projectId,
      actorUserId: auth.userId,
      actorRole:   auth.role,
      action:      "help_center.troubleshooting_generated",
      category:    "publishing",
      result:      "success",
      summary:     `Troubleshooting Playbook generated — ${lib.playbooks.length} playbooks`,
      metadata:    { playbookCount: lib.playbooks.length },
      ...ctx,
    }).catch(() => null);
    return { ok: true, data: lib };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message.slice(0, 300) : "Failed to generate troubleshooting playbook.",
    };
  }
}

export async function exportTroubleshootingPlaybookAction(input: {
  projectId: string;
}): Promise<ActionResult<{ markdown: string; filename: string }>> {
  const { projectId } = input;
  const auth = await requireProjectPermission(projectId, "project.view");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  try {
    const result = await exportTroubleshootingPlaybook({ projectId });
    const ctx    = await getAuditRequestContext();
    void writeProjectAuditEvent({
      projectId,
      actorUserId: auth.userId,
      actorRole:   auth.role,
      action:      "help_center.troubleshooting_exported",
      category:    "publishing",
      result:      "success",
      summary:     "TROUBLESHOOTING_PLAYBOOK.md exported",
      metadata:    { filename: result.filename },
      ...ctx,
    }).catch(() => null);
    return { ok: true, data: result };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message.slice(0, 300) : "Export failed.",
    };
  }
}
