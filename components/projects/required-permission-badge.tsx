"use client";

/**
 * components/projects/required-permission-badge.tsx
 *
 * Sprint 59: Small badge shown near dangerous action buttons to indicate the
 * required permission level.
 *
 * Variants:
 *  - inline: compact badge, sits next to a button
 *  - tooltip: badge with a short tooltip on hover
 *
 * Usage:
 *   <RequiredPermissionBadge permission="deploy.trigger" />
 *   <RequiredPermissionBadge permission="project.edit" label="Owner/Admin only" />
 */

import { ShieldAlert, ShieldCheck, ShieldQuestion } from "lucide-react";

type Props = {
  permission: string;
  label?:     string;
  className?: string;
};

const TIER_MAP: Record<string, { color: string; icon: "alert" | "check" | "question" }> = {
  "project.manageTeam": { color: "text-red-600 dark:text-red-400",    icon: "alert" },
  "deploy.trigger":     { color: "text-orange-600 dark:text-orange-400", icon: "alert" },
  "deploy.rollback":    { color: "text-orange-600 dark:text-orange-400", icon: "alert" },
  "backup.restore":     { color: "text-orange-600 dark:text-orange-400", icon: "alert" },
  "env.manage":         { color: "text-yellow-600 dark:text-yellow-400", icon: "check" },
  "secrets.manage":     { color: "text-yellow-600 dark:text-yellow-400", icon: "check" },
  "database.manage":    { color: "text-yellow-600 dark:text-yellow-400", icon: "check" },
  "project.edit":       { color: "text-blue-600 dark:text-blue-400",   icon: "check" },
  "backup.create":      { color: "text-blue-600 dark:text-blue-400",   icon: "check" },
};

function Icon({ kind, className }: { kind: "alert" | "check" | "question"; className: string }) {
  if (kind === "alert")    return <ShieldAlert    className={className} />;
  if (kind === "check")    return <ShieldCheck    className={className} />;
  return                          <ShieldQuestion className={className} />;
}

export function RequiredPermissionBadge({ permission, label, className = "" }: Props) {
  const tier    = TIER_MAP[permission];
  const color   = tier?.color ?? "text-muted-foreground";
  const iconKind = tier?.icon ?? "question";
  const display = label ?? permission;

  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-medium ${color} ${className}`}
      title={`Requires: ${permission}`}
    >
      <Icon kind={iconKind} className="h-3 w-3 flex-shrink-0" />
      {display}
    </span>
  );
}

/** Block-level variant with a brief description below a section header. */
export function RequiredPermissionNote({
  permission,
  description,
}: {
  permission: string;
  description?: string;
}) {
  return (
    <p className="text-xs text-muted-foreground flex items-center gap-1.5">
      <ShieldAlert className="h-3.5 w-3.5 flex-shrink-0 text-orange-500" />
      <span>
        <span className="font-medium">Requires {permission}</span>
        {description ? ` — ${description}` : ""}
      </span>
    </p>
  );
}
