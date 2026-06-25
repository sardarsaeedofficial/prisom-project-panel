"use client";

/**
 * components/projects/contextual-help-card.tsx
 *
 * Sprint 67: Small collapsible contextual help card used across
 * Releases, Monitoring, Backups, Logs, and Team pages.
 *
 * Documentation only — no production mutation.
 */

import { useState }   from "react";
import Link           from "next/link";
import { HelpCircle, ChevronDown, ChevronUp } from "lucide-react";

type HelpLink = {
  label: string;
  href:  string;
};

type Props = {
  purpose:  string;
  doHere:   string;
  dontDo:   string;
  nextPage?: HelpLink;
};

export function ContextualHelpCard({ purpose, doHere, dontDo, nextPage }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border rounded-lg bg-muted/30">
      <button
        type="button"
        className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-muted/40 transition-colors rounded-lg"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className="flex items-center gap-2 text-sm text-muted-foreground">
          <HelpCircle className="h-3.5 w-3.5 shrink-0" />
          Page guide
        </span>
        {open ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        )}
      </button>

      {open && (
        <div className="px-4 pb-3 space-y-2 text-xs border-t pt-2.5">
          <p><span className="font-medium text-foreground">What is this page for?</span>{" "}<span className="text-muted-foreground">{purpose}</span></p>
          <p><span className="font-medium text-foreground">What to do here:</span>{" "}<span className="text-muted-foreground">{doHere}</span></p>
          <p><span className="font-medium text-orange-600 dark:text-orange-400">What NOT to do:</span>{" "}<span className="text-muted-foreground">{dontDo}</span></p>
          {nextPage && (
            <p>
              <span className="font-medium text-foreground">Where to go next:</span>{" "}
              <Link
                href={nextPage.href}
                className="text-primary hover:underline"
              >
                {nextPage.label} →
              </Link>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
