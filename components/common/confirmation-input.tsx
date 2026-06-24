"use client";

/**
 * components/common/confirmation-input.tsx
 *
 * Sprint 56: Confirmation phrase input with hardened UX.
 *
 * Features:
 *  - shows required phrase clearly above the input
 *  - trims whitespace for comparison (value.trim() === phrase)
 *  - case-sensitive (matches existing behavior)
 *  - onEnter callback only called when phrase matches (no accidental submit)
 *  - exposes isConfirmed for parent to gate actions
 */

import { useState, useCallback } from "react";
import { Input }                  from "@/components/ui/input";

type Props = {
  phrase:       string;
  value:        string;
  onChange:     (v: string) => void;
  placeholder?: string;
  label?:       string;
  className?:   string;
  /** Called only when phrase matches AND user presses Enter */
  onEnter?:     () => void;
  disabled?:    boolean;
};

export function ConfirmationInput({
  phrase,
  value,
  onChange,
  placeholder,
  label,
  className = "",
  onEnter,
  disabled,
}: Props) {
  const isConfirmed = value.trim() === phrase;

  const handleKey = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      // Never submit on Enter unless explicitly handled — prevent accidental submit
      if (e.key === "Enter") {
        e.preventDefault();
        if (isConfirmed && onEnter) onEnter();
      }
    },
    [isConfirmed, onEnter],
  );

  return (
    <div className={`space-y-1.5 ${className}`}>
      {label !== undefined ? (
        <p className="text-xs text-muted-foreground">{label}</p>
      ) : (
        <p className="text-xs text-muted-foreground">
          Type <code className="bg-muted px-1.5 py-0.5 rounded font-mono text-xs">{phrase}</code> to confirm
        </p>
      )}
      <Input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKey}
        placeholder={placeholder ?? `Type "${phrase}" to confirm`}
        className={`font-mono text-sm ${isConfirmed ? "border-green-500" : ""}`}
        disabled={disabled}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
      />
    </div>
  );
}

/** Standalone hook for managing confirmation state */
export function useConfirmation(phrase: string) {
  const [value, setValue] = useState("");
  const isConfirmed = value.trim() === phrase;
  const reset = useCallback(() => setValue(""), []);
  return { value, setValue, isConfirmed, reset };
}
