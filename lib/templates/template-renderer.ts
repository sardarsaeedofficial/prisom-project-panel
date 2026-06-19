/**
 * lib/templates/template-renderer.ts
 *
 * Sprint 19: Renders template files by substituting {{variable}} placeholders.
 *
 * Safety:
 *  - Variable values are escaped for HTML in .html files.
 *  - Variable values are escaped for JSON in .json files.
 *  - Variable keys must be simple identifiers (no injection via keys).
 *  - Unknown variables in the template are left as-is (not silently dropped).
 */

import type { ProjectTemplateFile } from "@/lib/templates/project-templates";
import { getProjectTemplate } from "@/lib/templates/project-templates";

// ── HTML escaping ─────────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

/**
 * Escape a string for safe embedding in a JSON string value.
 * The surrounding quotes are handled by the template itself.
 */
function escapeJson(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
}

// ── Variable substitution ─────────────────────────────────────────────────────

/**
 * Substitute all {{key}} placeholders in a string using the given variable map.
 * For HTML files, values are HTML-escaped.
 * For JSON files, values are JSON-escaped (no HTML escaping — JSON consumers
 * handle their own encoding).
 */
function substituteVariables(
  content: string,
  variables: Record<string, string>,
  filePath: string,
): string {
  const isHtml = filePath.endsWith(".html") || filePath.endsWith(".htm");
  const isJson = filePath.endsWith(".json");

  return content.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    const value = variables[key];
    if (value === undefined) return `{{${key}}}`; // leave unknown vars intact

    if (isHtml) return escapeHtml(value);
    if (isJson) return escapeJson(value);
    return value; // Markdown, TypeScript, JS, etc. — raw
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

export type RenderInput = {
  templateId: string;
  /** User-supplied variable values (merged with template defaults). */
  variables?: Record<string, string>;
  projectName: string;
  projectSlug: string;
};

export type RenderResult =
  | { ok: true; files: ProjectTemplateFile[] }
  | { ok: false; error: string };

/**
 * Render a template to its final file set.
 * - Merges built-in variables (projectName, projectSlug) with user-supplied ones.
 * - Substitutes all {{key}} placeholders in file content.
 * - Does NOT write any files — that's the action's job.
 */
export function renderTemplateFiles(input: RenderInput): RenderResult {
  const template = getProjectTemplate(input.templateId);
  if (!template) {
    return { ok: false, error: `Template "${input.templateId}" not found.` };
  }

  // Build the full variable map: built-ins first, then template defaults, then user values
  const builtIns: Record<string, string> = {
    projectName: input.projectName,
    projectSlug: input.projectSlug,
    // healthPath as a convenience variable (rarely used in file content)
    healthPath: template.healthPath ?? "/",
  };

  // Merge template variable defaults
  const defaults: Record<string, string> = {};
  for (const v of template.variables ?? []) {
    if (v.defaultValue !== undefined) defaults[v.key] = v.defaultValue;
  }

  const merged: Record<string, string> = {
    ...builtIns,
    ...defaults,
    ...(input.variables ?? {}),
  };

  const rendered: ProjectTemplateFile[] = template.files.map((f) => ({
    ...f,
    content: substituteVariables(f.content, merged, f.path),
  }));

  return { ok: true, files: rendered };
}

/**
 * Validate that all required template variables are present.
 */
export function validateTemplateVariables(input: {
  templateId: string;
  variables: Record<string, string>;
}): { ok: true } | { ok: false; error: string } {
  const template = getProjectTemplate(input.templateId);
  if (!template) {
    return { ok: false, error: `Template "${input.templateId}" not found.` };
  }

  const missing: string[] = [];
  for (const v of template.variables ?? []) {
    if (v.required) {
      const val = input.variables[v.key]?.trim();
      if (!val) missing.push(v.label);
    }
  }

  if (missing.length > 0) {
    return { ok: false, error: `Required fields missing: ${missing.join(", ")}.` };
  }

  return { ok: true };
}

export { getProjectTemplate, listProjectTemplates } from "@/lib/templates/project-templates";
