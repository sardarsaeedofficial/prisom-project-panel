"use client";

/**
 * app/(dashboard)/projects/[projectId]/operations/error.tsx
 *
 * Sprint 27 Hotfix: Error boundary for the operations page.
 *
 * Next.js shows a blank white page when a server component throws and there is
 * no error.tsx in the route segment.  This file catches those exceptions and
 * renders a helpful message instead.
 */

import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button }                   from "@/components/ui/button";

type Props = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function OperationsError({ error, reset }: Props) {
  return (
    <div className="flex flex-col flex-1 items-center justify-center p-8 gap-4">
      <AlertTriangle className="h-10 w-10 text-amber-500" />
      <div className="text-center space-y-1">
        <h2 className="text-lg font-semibold">Could not load Operations</h2>
        <p className="text-sm text-muted-foreground max-w-sm">
          {error.message?.includes("does not exist")
            ? "The Operations table is not ready on this server. Run “pnpm prisma db push” to create it."
            : "An unexpected error occurred while loading the operations page."}
        </p>
        {error.digest && (
          <p className="text-xs text-muted-foreground/60 font-mono mt-2">
            Error ID: {error.digest}
          </p>
        )}
      </div>
      <Button onClick={reset} variant="outline" size="sm" className="gap-2">
        <RefreshCw className="h-3.5 w-3.5" />
        Retry
      </Button>
    </div>
  );
}
