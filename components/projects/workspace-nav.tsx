"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Code2,
  Github,
  Eye,
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
} from "lucide-react";
import { cn } from "@/lib/utils";

type WorkspaceNavProps = {
  projectId: string;
};

export function WorkspaceNav({ projectId }: WorkspaceNavProps) {
  const pathname = usePathname();
  const base = `/projects/${projectId}`;

  const tabs = [
    { label: "Files",     href: `${base}/files`,    icon: Code2    },
    { label: "Terminal",  href: `${base}/terminal`, icon: Terminal },
    { label: "GitHub",    href: `${base}/github`,   icon: Github   },
    { label: "Packages",  href: `${base}/packages`, icon: Package2 },
    { label: "AI Assistant", href: `${base}/ai`,    icon: Bot      },
    { label: "Preview", href: `${base}/preview`, icon: Eye },
    { label: "Publishing", href: `${base}/publishing`, icon: Rocket },
    { label: "Domains", href: `${base}/domains`, icon: Globe },
    { label: "Env Vars", href: `${base}/env`, icon: KeyRound },
    { label: "Import", href: `${base}/import`, icon: PackageOpen },
    { label: "Database", href: `${base}/database`, icon: Database },
    { label: "Logs", href: `${base}/logs`, icon: ScrollText },
    { label: "Settings", href: `${base}/settings`, icon: Settings },
  ];

  return (
    <div className="border-b bg-background">
      <nav className="flex gap-0 overflow-x-auto px-6">
        {tabs.map((tab) => {
          const isActive = pathname === tab.href;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                "flex items-center gap-1.5 px-3 py-3 text-sm border-b-2 transition-colors whitespace-nowrap",
                isActive
                  ? "border-primary text-primary font-medium"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
              )}
            >
              <tab.icon className="h-3.5 w-3.5" />
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
