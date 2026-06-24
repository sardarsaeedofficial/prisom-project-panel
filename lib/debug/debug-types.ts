/**
 * lib/debug/debug-types.ts
 *
 * Sprint 58: Core types for the debug summary system.
 * Pure types — safe to import from client or server.
 */

export type DebugSeverity = "info" | "warning" | "error" | "critical";

export type DebugCategory =
  | "install"
  | "build"
  | "runtime"
  | "routing"
  | "database"
  | "env"
  | "github"
  | "external_service"
  | "permissions"
  | "network"
  | "unknown";

export type DebugFinding = {
  id:           string;
  category:     DebugCategory;
  severity:     DebugSeverity;
  title:        string;
  message:      string;
  evidence?:    string[];
  suggestedFix?: string;
  fixHref?:     string;
};

export type DebugSummary = {
  projectId:          string;
  generatedAt:        string;
  source:             "logs" | "operation" | "build" | "deploy" | "dry_run" | "routing" | "cutover" | "github" | "unknown";
  status:             "healthy" | "warning" | "failed" | "unknown";
  findings:           DebugFinding[];
  likelyCause?:       string;
  nextSteps:          string[];
  sanitizedExcerpt?:  string;
};
