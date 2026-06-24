"use client";

/**
 * components/common/action-loading-button.tsx
 *
 * Sprint 56: Button with built-in loading state.
 * - always type="button" unless overridden
 * - disabled while loading (or when extra disabled prop is true)
 * - shows spinner + label while loading
 */

import { Loader2 }    from "lucide-react";
import { Button }     from "@/components/ui/button";
import type { ButtonProps } from "@/components/ui/button";

type Props = ButtonProps & {
  loading:       boolean;
  loadingLabel?: string;
};

export function ActionLoadingButton({
  loading,
  loadingLabel,
  children,
  disabled,
  type = "button",
  ...props
}: Props) {
  return (
    <Button
      type={type}
      disabled={loading || disabled}
      {...props}
    >
      {loading ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" />
          {loadingLabel ?? "Loading…"}
        </>
      ) : children}
    </Button>
  );
}
