/**
 * components/ui/loading-state.tsx
 *
 * Sprint 20: Reusable loading state component.
 * Use for full-panel loading spinners and skeleton placeholders.
 */

import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";

interface LoadingStateProps {
  label?: string;
  className?: string;
}

export function LoadingState({ label = "Loading…", className }: LoadingStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center py-16 text-center",
        className,
      )}
    >
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      {label && (
        <p className="mt-2 text-xs text-muted-foreground">{label}</p>
      )}
    </div>
  );
}

/** Inline spinner — small horizontal spinner for button / card contexts. */
export function InlineSpinner({ className }: { className?: string }) {
  return <Loader2 className={cn("h-4 w-4 animate-spin text-muted-foreground", className)} />;
}

/** Row skeleton — animating placeholder bars for table/list rows. */
export function SkeletonRows({ count = 5 }: { count?: number }) {
  return (
    <div className="space-y-2 p-4">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="h-8 rounded-md bg-muted/60 animate-pulse"
          style={{ opacity: 1 - i * 0.15 }}
        />
      ))}
    </div>
  );
}
