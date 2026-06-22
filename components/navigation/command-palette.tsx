"use client";

/**
 * components/navigation/command-palette.tsx
 *
 * Sprint 38: Global command palette.
 *
 * Opens with Ctrl+K / Cmd+K, or via window "open-command-palette" custom event.
 * Permission rules:
 *  - admin commands only shown when isAdmin === true
 *  - project commands only shown when a /projects/[id] route is active
 *  - no secrets or env values included
 */

import { useState, useEffect, useRef } from "react";
import { useRouter, usePathname }       from "next/navigation";
import {
  Search, X,
  LayoutDashboard, FolderOpen, Globe, Plug, ShieldCheck, BookOpen,
  Bell, TerminalSquare, Users, History, Activity,
  Eye, Code2, Rocket, Github, Package2, Bot, ArrowRightLeft,
  Database, KeyRound, ScrollText, PackageOpen, Terminal,
  Archive, HardDrive, ListChecks, Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { CommandItem } from "@/lib/navigation/command-items";

// ── Command list builder ───────────────────────────────────────────────────────

function buildCommands(opts: {
  isAdmin:     boolean;
  projectId?:  string;
}): CommandItem[] {
  const { isAdmin, projectId } = opts;
  const p = (path: string) => `/projects/${projectId}${path}`;

  const global: CommandItem[] = [
    { id: "nav-dashboard",     label: "Dashboard",     group: "Navigation", href: "/dashboard",           icon: LayoutDashboard },
    { id: "nav-projects",      label: "Projects",      group: "Navigation", href: "/projects",            icon: FolderOpen      },
    { id: "nav-published",     label: "Published",     group: "Navigation", href: "/published",           icon: Globe           },
    { id: "nav-integrations",  label: "Integrations",  group: "Navigation", href: "/integrations",        icon: Plug            },
    { id: "nav-security",      label: "Security",      group: "Navigation", href: "/security",            icon: ShieldCheck     },
    { id: "nav-portfolio",     label: "Portfolio",     group: "Navigation", href: "/portfolio",           icon: BookOpen        },
    { id: "nav-notifications", label: "Notifications", group: "Navigation", href: "/notifications",       icon: Bell            },
  ];

  const admin: CommandItem[] = isAdmin ? [
    { id: "admin-console",   label: "Admin Console",   group: "Admin", href: "/admin",           icon: TerminalSquare },
    { id: "admin-users",     label: "Admin: Users",    group: "Admin", href: "/admin/users",     icon: Users          },
    { id: "admin-jobs",      label: "Admin: Jobs",     group: "Admin", href: "/admin/jobs",      icon: Activity       },
    { id: "admin-activity",  label: "Admin: Activity", group: "Admin", href: "/admin/activity",  icon: History        },
  ] : [];

  const project: CommandItem[] = projectId ? [
    { id: "proj-overview",   label: "Overview",      group: "Project", href: p(""),               icon: LayoutDashboard },
    { id: "proj-preview",    label: "Preview",       group: "Project", href: p("/preview"),       icon: Eye             },
    { id: "proj-files",      label: "Files",         group: "Project", href: p("/files"),         icon: Code2           },
    { id: "proj-publishing", label: "Publishing",    group: "Project", href: p("/publishing"),    icon: Rocket          },
    { id: "proj-monitoring", label: "Monitoring",    group: "Project", href: p("/monitoring"),    icon: Activity        },
    { id: "proj-terminal",   label: "Terminal",      group: "Project", href: p("/terminal"),      icon: Terminal        },
    { id: "proj-github",     label: "GitHub",        group: "Project", href: p("/github"),        icon: Github          },
    { id: "proj-packages",   label: "Packages",      group: "Project", href: p("/packages"),      icon: Package2        },
    { id: "proj-ai",         label: "AI Assistant",  group: "Project", href: p("/ai"),            icon: Bot             },
    { id: "proj-migration",  label: "Migration",     group: "Project", href: p("/migration"),     icon: ArrowRightLeft  },
    { id: "proj-database",   label: "Database",      group: "Project", href: p("/database"),      icon: Database        },
    { id: "proj-secrets",    label: "Secrets Vault", group: "Project", href: p("/env"),           icon: KeyRound        },
    { id: "proj-domains",    label: "Domains",       group: "Project", href: p("/domains"),       icon: Globe           },
    { id: "proj-logs",       label: "Logs",          group: "Project", href: p("/logs"),          icon: ScrollText      },
    { id: "proj-import",     label: "Import",        group: "Project", href: p("/import"),        icon: PackageOpen     },
    { id: "proj-team",       label: "Team",          group: "Project", href: p("/team"),          icon: Users           },
    { id: "proj-audit",      label: "Audit",         group: "Project", href: p("/audit"),         icon: ShieldCheck     },
    { id: "proj-activity",   label: "Activity",      group: "Project", href: p("/activity"),      icon: History         },
    { id: "proj-backups",    label: "Backups",        group: "Project", href: p("/backups"),       icon: Archive         },
    { id: "proj-storage",    label: "Storage",       group: "Project", href: p("/storage"),       icon: HardDrive       },
    { id: "proj-operations", label: "Operations",    group: "Project", href: p("/operations"),    icon: ListChecks      },
    { id: "proj-settings",   label: "Settings",      group: "Project", href: p("/settings"),      icon: Settings        },
  ] : [];

  return [...global, ...admin, ...project];
}

// ── Main component ─────────────────────────────────────────────────────────────

interface CommandPaletteProps {
  isAdmin: boolean;
}

export function CommandPalette({ isAdmin }: CommandPaletteProps) {
  const [open, setOpen]               = useState(false);
  const [query, setQuery]             = useState("");
  const [selectedIndex, setSelected]  = useState(0);
  const router                        = useRouter();
  const pathname                      = usePathname();
  const inputRef                      = useRef<HTMLInputElement>(null);

  // Detect current project from URL
  const projectId = pathname.match(/^\/projects\/([^/]+)/)?.[1];

  const allCommands = buildCommands({ isAdmin, projectId });

  // Filter by search query
  const filtered = query.trim()
    ? allCommands.filter((c) =>
        c.label.toLowerCase().includes(query.toLowerCase()) ||
        c.group.toLowerCase().includes(query.toLowerCase()),
      )
    : allCommands;

  // Group for display
  const grouped = filtered.reduce<Record<string, CommandItem[]>>((acc, item) => {
    (acc[item.group] ??= []).push(item);
    return acc;
  }, {});

  // Flat list for index-based keyboard nav
  const flat = Object.values(grouped).flat();

  // Register keyboard shortcut + custom event
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    }
    function onOpenEvent() { setOpen(true); }

    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("open-command-palette", onOpenEvent);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("open-command-palette", onOpenEvent);
    };
  }, []);

  // Auto-focus + reset on open
  useEffect(() => {
    if (open) {
      setQuery("");
      setSelected(0);
      // tick needed for the element to become visible
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Reset selection when query changes
  useEffect(() => setSelected(0), [query]);

  function navigate(href: string) {
    setOpen(false);
    router.push(href);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    switch (e.key) {
      case "Escape":
        setOpen(false);
        break;
      case "ArrowDown":
        e.preventDefault();
        setSelected((i) => Math.min(i + 1, flat.length - 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setSelected((i) => Math.max(i - 1, 0));
        break;
      case "Enter": {
        e.preventDefault();
        const item = flat[selectedIndex];
        if (item) navigate(item.href);
        break;
      }
    }
  }

  if (!open) return null;

  return (
    /* Backdrop — click outside to close */
    <div
      className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[15vh]"
      onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
    >
      <div
        className="fixed inset-0 bg-background/70 backdrop-blur-sm"
        onMouseDown={() => setOpen(false)}
      />

      {/* Palette dialog */}
      <div className="relative z-10 w-full max-w-xl overflow-hidden rounded-xl border border-border bg-background shadow-2xl">
        {/* Search row */}
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search commands…"
            aria-label="Command palette search"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          {query ? (
            <button
              aria-label="Clear search"
              onClick={() => setQuery("")}
              className="rounded text-muted-foreground hover:text-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <X className="h-4 w-4" />
            </button>
          ) : (
            <kbd className="hidden items-center rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground sm:flex">
              Esc
            </kbd>
          )}
        </div>

        {/* Results */}
        <div className="max-h-[60vh] overflow-y-auto overscroll-contain py-2">
          {flat.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No commands found for &ldquo;{query}&rdquo;
            </p>
          ) : (
            Object.entries(grouped).map(([group, items]) => (
              <div key={group} className="px-1">
                <div className="px-3 pb-1 pt-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {group}
                  </p>
                </div>
                {items.map((item) => {
                  const idx        = flat.indexOf(item);
                  const isSelected = idx === selectedIndex;
                  return (
                    <button
                      key={item.id}
                      onClick={() => navigate(item.href)}
                      onMouseEnter={() => setSelected(idx)}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors",
                        isSelected
                          ? "bg-primary/10 text-primary"
                          : "text-foreground hover:bg-muted",
                      )}
                    >
                      <item.icon
                        className={cn(
                          "h-4 w-4 shrink-0",
                          isSelected ? "text-primary" : "text-muted-foreground",
                        )}
                      />
                      {item.label}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        {/* Footer hint */}
        <div className="flex items-center gap-3 border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
          <span><kbd className="rounded border border-border bg-muted px-1 py-0.5 font-mono">↑↓</kbd> navigate</span>
          <span><kbd className="rounded border border-border bg-muted px-1 py-0.5 font-mono">↵</kbd> open</span>
          <span><kbd className="rounded border border-border bg-muted px-1 py-0.5 font-mono">Esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}
