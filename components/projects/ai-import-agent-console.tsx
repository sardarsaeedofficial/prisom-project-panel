"use client";

/**
 * components/projects/ai-import-agent-console.tsx
 *
 * Sprint 89–94: Original full-featured console (all state logic).
 * Sprint 95: Delegates to AiAgentWorkspaceShell (Replit-style dark split workspace).
 *            All state management + handlers now live in ai-agent-workspace-shell.tsx.
 */

import { AiAgentWorkspaceShell } from "@/components/ai-agent-workspace";

interface AiImportAgentConsoleProps {
  projectId: string;
}

export function AiImportAgentConsole({ projectId }: AiImportAgentConsoleProps) {
  return (
    <div className="h-[calc(100vh-12rem)] min-h-[600px]">
      <AiAgentWorkspaceShell projectId={projectId} />
    </div>
  );
}
