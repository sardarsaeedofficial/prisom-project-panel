/**
 * components/ui/empty-state.tsx
 *
 * Sprint 20: Reusable empty state component.
 * Use when a data list has no items yet.
 */

import { cn } from "@/lib/utils";
import { type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  /** Primary call-to-action button */
  action?: {
    label: string;
    onClick: () => void;
  };
  /** Alternative: render any JSX as the action area */
  actionSlot?: React.ReactNode;
  className?: string;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  actionSlot,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center py-16 px-6 text-center",
        className,
      )}
    >
      {Icon && (
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
          <Icon className="h-6 w-6 text-muted-foreground" />
        </div>
      )}
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description && (
        <p className="mt-1 text-xs text-muted-foreground max-w-xs leading-relaxed">
          {description}
        </p>
      )}
      {(action || actionSlot) && (
        <div className="mt-4">
          {actionSlot ?? (
            action && (
              <Button size="sm" onClick={action.onClick}>
                {action.label}
              </Button>
            )
          )}
        </div>
      )}
    </div>
  );
}
