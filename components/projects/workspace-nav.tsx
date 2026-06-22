"use client";

/**
 * components/projects/workspace-nav.tsx
 *
 * Sprint 38: Fixed More dropdown overflow + regrouped secondary tabs.
 *
 * Layout:
 *  - Primary tabs always visible: Overview, Preview, Files, Publishing, Monitoring
 *  - "More ▾" dropdown — vertically scrollable so all items are reachable on
 *    laptop screens (1366×768). Grouped into 5 sections.
 *  - Active route highlighted whether primary or inside More.
 *  - More button border turns primary-coloured when a More-item is active.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Code2,
  Github,
  Eye,
  Activity,
  Rocket,
  Globe,
  Database,
  ScrollText,
  Settings,
  Bot,
  KeyRound,
  PackageOpen,
  Terminal,
  Package2,
  Users,
  ShieldCheck,
  MoreHorizontal,
  LayoutDashboard,
  Archive,
  ArrowRightLeft,
  ListChecks,
  HardDrive,
  History,
  Tag,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ProjectOperationBanner } from "@/components/projects/project-operation-banner";

// ── Tab definitions ───────────────────────────────────────────────────────────

type Tab = {
  label: string;
  href:  string;
  icon:  React.ElementType;
};

type WorkspaceNavProps = {
  projectId: string;
};

// ── Component ─────────────────────────────────────────────────────────────────

export function WorkspaceNav({ projectId }: WorkspaceNavProps) {
  const pathname = usePathname();
  const base     = `/projects/${projectId}`;

  // Primary tabs — always visible
  const PRIMARY: Tab[] = [
    { label: "Overview",    href: base,                  icon: LayoutDashboard },
    { label: "Preview",     href: `${base}/preview`,     icon: Eye             },
    { label: "Files",       href: `${base}/files`,       icon: Code2           },
    { label: "Publishing",  href: `${base}/publishing`,  icon: Rocket          },
    { label: "Monitoring",  href: `${base}/monitoring`,  icon: Activity        },
  ];

  // Secondary tabs — 5 groups inside the scrollable More dropdown
  const SECONDARY_GROUPS: Array<{ label: string; items: Tab[] }> = [
    {
      label: "Development",
      items: [
        { label: "Terminal",     href: `${base}/terminal`,  icon: Terminal       },
        { label: "GitHub",       href: `${base}/github`,    icon: Github         },
        { label: "Packages",     href: `${base}/packages`,  icon: Package2       },
        { label: "AI Assistant", href: `${base}/ai`,        icon: Bot            },
        { label: "Migration",    href: `${base}/migration`, icon: ArrowRightLeft },
      ],
    },
    {
      label: "Data & Config",
      items: [
        { label: "Database",      href: `${base}/database`, icon: Database    },
        { label: "Secrets Vault", href: `${base}/env`,      icon: KeyRound    },
        { label: "Domains",       href: `${base}/domains`,  icon: Globe       },
        { label: "Logs",          href: `${base}/logs`,     icon: ScrollText  },
        { label: "Import",        href: `${base}/import`,   icon: PackageOpen },
      ],
    },
    {
      label: "Team & Governance",
      items: [
        { label: "Team",     href: `${base}/team`,     icon: Users      },
        { label: "Audit",    href: `${base}/audit`,    icon: ShieldCheck },
        { label: "Activity", href: `${base}/activity`, icon: History    },
      ],
    },
    {
      label: "Reliability",
      items: [
        { label: "Backups",    href: `${base}/backups`,    icon: Archive    },
        { label: "Storage",    href: `${base}/storage`,    icon: HardDrive  },
        { label: "Operations", href: `${base}/operations`, icon: ListChecks },
        { label: "Releases",   href: `${base}/releases`,   icon: Tag        },
      ],
    },
    {
      label: "Advanced",
      items: [
        { label: "Settings", href: `${base}/settings`, icon: Settings },
      ],
    },
  ];

  // Flatten for active-check (startsWith covers sub-pages)
  const allSecondary = SECONDARY_GROUPS.flatMap((g) => g.items);
  const activeInMore = allSecondary.find(
    (t) => pathname === t.href || pathname.startsWith(t.href + "/"),
  );

  return (
    <div>
      <div className="border-b bg-background">
      <nav className="flex items-center gap-0 px-4 sm:px-6">
        {/* ── Primary tabs ── */}
        <div className="flex overflow-x-auto min-w-0 flex-1" style={{ scrollbarWidth: "none" }}>
          {PRIMARY.map((tab) => {
            // Overview is active only on exact match; others use startsWith too
            const isActive =
              tab.href === base
                ? pathname === base
                : pathname === tab.href || pathname.startsWith(tab.href + "/");

            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={cn(
                  "flex shrink-0 items-center gap-1.5 px-3 py-3 text-sm border-b-2 transition-colors whitespace-nowrap",
                  isActive
                    ? "border-primary text-primary font-medium"
                    : "border-transparent text-muted-foreground hover:text-foreground hover:border-border",
                )}
              >
                <tab.icon className="h-3.5 w-3.5" />
                {tab.label}
              </Link>
            );
          })}
        </div>

        {/* ── More dropdown ── */}
        <div
          className={cn(
            "shrink-0 pl-1 py-2 border-b-2 transition-colors",
            activeInMore ? "border-primary" : "border-transparent",
          )}
        >
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className={cn(
                  "flex items-center gap-1 rounded-md px-2.5 py-1.5 text-sm transition-colors",
                  activeInMore
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted",
                )}
                aria-label="More workspace tabs"
              >
                {activeInMore ? (
                  <>
                    <activeInMore.icon className="h-3.5 w-3.5" />
                    <span>{activeInMore.label}</span>
                  </>
                ) : (
                  <>
                    <MoreHorizontal className="h-3.5 w-3.5" />
                    <span>More</span>
                  </>
                )}
              </button>
            </DropdownMenuTrigger>

            {/*
             * p-0 removes default padding so the inner scroll div controls layout.
             * The inner div provides max-height + vertical scroll so all items are
             * reachable on 1366×768 laptop screens.
             */}
            <DropdownMenuContent align="end" className="w-52 p-0" sideOffset={6}>
              <div className="max-h-[70vh] overflow-y-auto overscroll-contain py-1">
                {SECONDARY_GROUPS.map((group, gi) => (
                  <div key={group.label}>
                    {gi > 0 && <DropdownMenuSeparator />}
                    <div className="px-2 pb-0.5 pt-1.5">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        {group.label}
                      </p>
                    </div>
                    {group.items.map((tab) => {
                      const isActive =
                        pathname === tab.href ||
                        pathname.startsWith(tab.href + "/");
                      return (
                        <DropdownMenuItem key={tab.href} asChild>
                          <Link
                            href={tab.href}
                            className={cn(
                              "flex cursor-pointer items-center gap-2",
                              isActive && "bg-primary/5 font-medium text-primary",
                            )}
                          >
                            <tab.icon className="h-3.5 w-3.5 shrink-0" />
                            {tab.label}
                            {isActive && (
                              <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary" />
                            )}
                          </Link>
                        </DropdownMenuItem>
                      );
                    })}
                  </div>
                ))}
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </nav>
      </div>
      <ProjectOperationBanner projectId={projectId} />
    </div>
  );
}
