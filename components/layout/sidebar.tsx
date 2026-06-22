"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  FolderOpen,
  Globe,
  Plug,
  Github,
  ShieldCheck,
  BookOpen,
  ChevronRight,
  Boxes,
  TerminalSquare,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";

const NAV_ITEMS = [
  {
    title: "Dashboard",
    href: "/dashboard",
    icon: LayoutDashboard,
  },
  {
    title: "Projects",
    href: "/projects",
    icon: FolderOpen,
  },
  {
    title: "Published",
    href: "/published",
    icon: Globe,
  },
  {
    title: "Integrations",
    href: "/integrations",
    icon: Plug,
    children: [
      { title: "GitHub", href: "/integrations/github", icon: Github },
    ],
  },
  {
    title: "Security",
    href: "/security",
    icon: ShieldCheck,
  },
  {
    title: "Portfolio",
    href: "/portfolio",
    icon: BookOpen,
  },
];

type NavItemProps = {
  href: string;
  icon: React.ElementType;
  title: string;
  isActive: boolean;
  isChild?: boolean;
};

function NavItem({ href, icon: Icon, title, isActive, isChild }: NavItemProps) {
  return (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
        isChild && "pl-9",
        isActive
          ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
          : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="truncate">{title}</span>
      {isActive && <ChevronRight className="ml-auto h-3 w-3 opacity-60" />}
    </Link>
  );
}

export function Sidebar({ isAdmin = false }: { isAdmin?: boolean }) {
  const pathname = usePathname();

  return (
    <TooltipProvider delayDuration={300}>
      <aside className="flex h-screen w-60 flex-col bg-sidebar border-r border-sidebar-border">
        {/* Logo */}
        <div className="flex h-14 items-center px-4 border-b border-sidebar-border shrink-0">
          <Link href="/dashboard" className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary">
              <Boxes className="h-4 w-4 text-primary-foreground" />
            </div>
            <span className="font-semibold text-sidebar-foreground text-sm tracking-tight">
              Prisom Panel
            </span>
          </Link>
        </div>

        {/* Navigation */}
        <ScrollArea className="flex-1 px-2 py-3">
          <nav className="space-y-0.5">
            {NAV_ITEMS.map((item) => {
              const isActive =
                pathname === item.href ||
                (item.href !== "/dashboard" && pathname.startsWith(item.href));
              return (
                <div key={item.href}>
                  <NavItem
                    href={item.href}
                    icon={item.icon}
                    title={item.title}
                    isActive={isActive && !item.children}
                  />
                  {item.children && isActive &&
                    item.children.map((child) => (
                      <NavItem
                        key={child.href}
                        href={child.href}
                        icon={child.icon}
                        title={child.title}
                        isActive={pathname === child.href}
                        isChild
                      />
                    ))}
                </div>
              );
            })}

            {/* Admin Console — visible only to OWNER / ADMIN */}
            {isAdmin && (
              <NavItem
                href="/admin"
                icon={TerminalSquare}
                title="Admin"
                isActive={pathname === "/admin" || pathname.startsWith("/admin/")}
              />
            )}
          </nav>
        </ScrollArea>

        {/* Footer hint */}
        <div className="shrink-0 px-4 py-3 border-t border-sidebar-border">
          <p className="text-xs text-sidebar-foreground/40 text-center">
            Prisom Project Panel v0.1
          </p>
        </div>
      </aside>
    </TooltipProvider>
  );
}
