"use client";

/**
 * components/projects/permission-gate.tsx
 *
 * Sprint 20: Client-side permission-aware UI gate.
 *
 * IMPORTANT: This is UI-only sugar. All write operations MUST still enforce
 * permissions server-side via requireProjectPermission(). This component only
 * controls what the UI renders — it does not replace server guards.
 *
 * Usage:
 *   <PermissionGate role={myRole} permission="deploy.trigger">
 *     <DeployButton />
 *   </PermissionGate>
 *
 *   <PermissionGate
 *     role={myRole}
 *     permission="env.manage"
 *     fallback={<DisabledEditButton reason="Admin or Owner access required" />}
 *   >
 *     <EditButton />
 *   </PermissionGate>
 */

import { hasPermission, type ProjectRole, type ProjectPermission } from "@/lib/auth/project-permissions";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Lock } from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface PermissionGateProps {
  role: ProjectRole | null | undefined;
  permission: ProjectPermission;
  /**
   * What to render when the user lacks permission.
   * Defaults to null (renders nothing).
   */
  fallback?: React.ReactNode;
  children: React.ReactNode;
}

// ── Role-to-friendly-label mapping ────────────────────────────────────────────

const ROLE_REQUIRED: Record<ProjectPermission, string> = {
  "project.view":       "Viewer",
  "project.edit":       "Developer, Admin, or Owner",
  "project.delete":     "Admin or Owner",
  "project.manageTeam": "Admin or Owner",
  "files.read":         "Viewer",
  "files.write":        "Developer, Admin, or Owner",
  "terminal.use":       "Developer, Admin, or Owner",
  "env.view":           "Viewer",
  "env.manage":         "Admin or Owner",
  "deploy.trigger":     "Developer, Operator, Admin, or Owner",
  "deploy.rollback":    "Operator, Admin, or Owner",
  "monitoring.view":    "Viewer",
  "monitoring.manage":  "Operator, Admin, or Owner",
  "logs.view":          "Viewer",
  "database.view":      "Viewer",
  "database.manage":    "Admin or Owner",
  "domains.view":       "Viewer",
  "domains.manage":     "Admin or Owner",
  "packages.view":      "Viewer",
  "packages.manage":    "Developer, Admin, or Owner",
  "ai.use":             "Developer, Admin, or Owner",
  "github.view":        "Viewer",
  "audit.view":         "Developer, Operator, Admin, or Owner",
  "audit.export":       "Admin or Owner",
  "backup.view":        "Viewer",
  "backup.create":      "Developer, Operator, Admin, or Owner",
  "backup.download":    "Developer, Operator, Admin, or Owner",
  "backup.restore":     "Admin or Owner",
  "backup.delete":      "Admin or Owner",
  "secrets.view":       "Viewer",
  "secrets.manage":     "Admin or Owner",
  "secrets.rotate":     "Admin or Owner",
  "secrets.import":     "Admin or Owner",
  "secrets.export":     "Viewer",
};

// ── Main component ────────────────────────────────────────────────────────────

export function PermissionGate({
  role,
  permission,
  fallback = null,
  children,
}: PermissionGateProps) {
  if (role && hasPermission(role, permission)) {
    return <>{children}</>;
  }
  return <>{fallback}</>;
}

// ── Disabled button with tooltip ──────────────────────────────────────────────

interface PermissionTooltipProps {
  permission: ProjectPermission;
  children: React.ReactNode;
}

/**
 * Wraps a disabled button/element in a tooltip explaining which role is needed.
 *
 * Usage:
 *   <PermissionTooltip permission="deploy.trigger">
 *     <Button disabled>Deploy</Button>
 *   </PermissionTooltip>
 */
export function PermissionTooltip({ permission, children }: PermissionTooltipProps) {
  const required = ROLE_REQUIRED[permission] ?? "a higher role";
  return (
    <TooltipProvider>
      <Tooltip delayDuration={300}>
        <TooltipTrigger asChild>
          <span className="inline-flex cursor-not-allowed">{children}</span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[200px] text-center text-xs">
          <Lock className="h-3 w-3 inline-block mr-1 opacity-70" />
          Requires {required} access
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// ── Hook ──────────────────────────────────────────────────────────────────────

/** Returns true if `role` has `permission`. Handles null/undefined roles safely. */
export function useHasPermission(
  role: ProjectRole | null | undefined,
  permission: ProjectPermission,
): boolean {
  if (!role) return false;
  return hasPermission(role, permission);
}
