/**
 * components/ai-agent-workspace/index.ts
 * Barrel export for the Sprint 95 workspace component suite.
 */

export { AiAgentWorkspaceShell }    from "./ai-agent-workspace-shell";
export { AiAgentChatFeed }          from "./ai-agent-chat-feed";
export { AiAgentActionRow }         from "./ai-agent-action-row";
export { AiAgentCommandOutput }     from "./ai-agent-command-output";
export { AiAgentPlanCard }          from "./ai-agent-plan-card";
export { AiAgentPatchApprovalCard } from "./ai-agent-patch-approval-card";
export { AiAgentStatusPanel }       from "./ai-agent-status-panel";
export { AiAgentPreviewPane }       from "./ai-agent-preview-pane";
export { AiAgentComposer }          from "./ai-agent-composer";
export { AiAgentEmptyState }        from "./ai-agent-empty-state";

export type { AgentActionRow, ActionRowStatus } from "./ai-agent-action-row";
