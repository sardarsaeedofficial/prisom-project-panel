"use client";

/**
 * components/projects/replit-import-checklist.tsx
 *
 * Sprint 23: Replit → Prisom import readiness checklist.
 *
 * Guides the user through the steps needed to migrate a Replit project.
 * Manual checkboxes with category grouping. No AI, no auto-deploy.
 *
 * Includes specific warnings for common Replit-specific issues:
 *   - REPLIT_DOMAINS env var
 *   - Replit Google Mail connector
 *   - Stripe webhook URL
 *   - Database schema push
 *   - Cloudinary vs local uploads
 */

import { useState } from "react";
import {
  CheckCircle2,
  Circle,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Info,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

// ── Checklist item types ──────────────────────────────────────────────────────

type ChecklistSeverity = "warning" | "info" | "required";

interface ChecklistItem {
  id:          string;
  label:       string;
  description: string;
  severity?:   ChecklistSeverity;
}

interface ChecklistCategory {
  id:    string;
  title: string;
  items: ChecklistItem[];
}

// ── Checklist definition ───────────────────────────────────────────────────────

const REPLIT_CHECKLIST: ChecklistCategory[] = [
  {
    id:    "code",
    title: "Code & Import",
    items: [
      { id: "code-imported",     label: "Code imported into Prisom",     description: "Source files are available in the project workspace." },
      { id: "pkg-detected",      label: "Package manager detected",       description: "pnpm-lock.yaml, package-lock.json, or yarn.lock is present." },
      { id: "monorepo-detected", label: "Monorepo structure confirmed",   description: "pnpm-workspace.yaml or packages/ directory is present if this is a workspace." },
      { id: "services-configured", label: "Services configured",          description: "API and web services are set up in the Services section below.", severity: "required" },
    ],
  },
  {
    id:    "env",
    title: "Secrets & Environment",
    items: [
      { id: "secrets-imported",   label: "Secrets imported",              description: "Use the Secrets Vault to import your .env from Replit.", severity: "required" },
      { id: "replit-domains-replaced", label: "REPLIT_DOMAINS replaced", description: "Replace any REPLIT_DOMAINS usage with APP_URL pointing to your Prisom domain.", severity: "warning" },
      { id: "app-url-set",        label: "APP_URL configured",            description: "Set APP_URL to your public domain (e.g. https://shop.example.com).", severity: "required" },
      { id: "port-not-manual",    label: "PORT is injected by Prisom",    description: "Do not manually set PORT in the Secrets Vault — Prisom injects it automatically.", severity: "info" },
    ],
  },
  {
    id:    "database",
    title: "Database",
    items: [
      { id: "db-configured",     label: "DATABASE_URL secret set",        description: "Ensure DATABASE_URL points to your PostgreSQL instance.", severity: "required" },
      { id: "schema-pushed",     label: "Database schema pushed/restored", description: "Run prisma db push or restore from a backup to set up tables.", severity: "required" },
      { id: "db-seed",           label: "Seed data imported if needed",   description: "Import or restore any required seed data / prod database snapshot." },
    ],
  },
  {
    id:    "stripe",
    title: "Payments (Stripe)",
    items: [
      { id: "stripe-keys",       label: "Stripe keys set in Secrets Vault", description: "STRIPE_SECRET_KEY, STRIPE_PUBLISHABLE_KEY, STRIPE_WEBHOOK_SECRET.", severity: "required" },
      { id: "stripe-webhook",    label: "Stripe webhook URL updated",        description: "Update the webhook endpoint in Stripe Dashboard to your new domain /api/webhooks/stripe.", severity: "warning" },
    ],
  },
  {
    id:    "email",
    title: "Email",
    items: [
      { id: "email-provider",    label: "Email provider configured",        description: "Replit's Google Mail connector does not work on VPS. Configure SMTP (Resend, SendGrid, or Mailgun).", severity: "warning" },
      { id: "smtp-secrets",      label: "SMTP secrets added",              description: "Add SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM to Secrets Vault.", severity: "required" },
    ],
  },
  {
    id:    "media",
    title: "Media & Files",
    items: [
      { id: "cloudinary-keys",   label: "Cloudinary keys set",            description: "CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET.", severity: "required" },
      { id: "no-local-uploads",  label: "No local file uploads to migrate", description: "Cloudinary stores media remotely — no local uploads/ folder to copy.", severity: "info" },
    ],
  },
  {
    id:    "domain",
    title: "Domain & Routing",
    items: [
      { id: "domain-configured", label: "Domain configured in Prisom",    description: "Add and verify your custom domain in the Domains section.", severity: "required" },
      { id: "api-routing",       label: "/api route works",              description: "nginx proxies /api/* to the Node API service — test after first deploy." },
      { id: "ssl-issued",        label: "SSL certificate issued",         description: "Use the Domains section to issue a Let's Encrypt certificate." },
    ],
  },
  {
    id:    "deploy",
    title: "Deploy & Smoke Test",
    items: [
      { id: "first-deploy",      label: "First multi-service deploy triggered", description: "Use the Services section to deploy all services.", severity: "required" },
      { id: "frontend-loads",    label: "Frontend loads at /",           description: "https://yourdomain.com/ should return the React/Vite app." },
      { id: "health-ok",         label: "API health check passes",       description: "https://yourdomain.com/api/healthz should return 200." },
      { id: "login-works",       label: "Login / auth flow works",       description: "SESSION_SECRET is set and the login page functions correctly." },
    ],
  },
];

// ── Main component ────────────────────────────────────────────────────────────

interface ReplitImportChecklistProps {
  /** If true, show the checklist collapsed by default */
  defaultCollapsed?: boolean;
}

export function ReplitImportChecklist({ defaultCollapsed = false }: ReplitImportChecklistProps) {
  const [open,     setOpen]     = useState(!defaultCollapsed);
  const [checked,  setChecked]  = useState<Set<string>>(new Set());
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  const allItems  = REPLIT_CHECKLIST.flatMap((c) => c.items);
  const total     = allItems.length;
  const done      = allItems.filter((i) => checked.has(i.id)).length;
  const required  = allItems.filter((i) => i.severity === "required");
  const reqDone   = required.filter((i) => checked.has(i.id)).length;
  const pct       = Math.round((done / total) * 100);

  function toggle(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  const severityColors: Record<ChecklistSeverity, string> = {
    required: "text-red-600 bg-red-50 border-red-200 dark:bg-red-950/20 dark:text-red-400",
    warning:  "text-amber-700 bg-amber-50 border-amber-200 dark:bg-amber-950/20 dark:text-amber-400",
    info:     "text-blue-700 bg-blue-50 border-blue-200 dark:bg-blue-950/20 dark:text-blue-400",
  };
  const severityLabel: Record<ChecklistSeverity, string> = {
    required: "Required",
    warning:  "Warning",
    info:     "Info",
  };

  return (
    <div className="rounded-lg border bg-card overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 bg-muted/30">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2 flex-1 text-left"
        >
          {open ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
          <span className="font-medium text-sm">Replit import readiness checklist</span>
          <Badge variant={done === total ? "outline" : "secondary"} className={`text-xs ${done === total ? "border-emerald-300 text-emerald-700 bg-emerald-50 dark:bg-emerald-950/20" : ""}`}>
            {done}/{total} done
          </Badge>
          {reqDone < required.length && (
            <Badge variant="destructive" className="text-xs">
              {required.length - reqDone} required missing
            </Badge>
          )}
        </button>
        <Button
          variant="ghost" size="sm" className="h-7 w-7 p-0 ml-2"
          onClick={() => setDismissed(true)}
          title="Dismiss checklist"
        >
          <X className="h-3.5 w-3.5 text-muted-foreground" />
        </Button>
      </div>

      {open && (
        <>
          {/* Progress bar */}
          <div className="px-4 pt-3 pb-2">
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-emerald-500 transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground mt-1">{pct}% complete · {done} of {total} items</p>
          </div>

          {REPLIT_CHECKLIST.map((category) => (
            <div key={category.id} className="border-t">
              <p className="px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide bg-muted/20">
                {category.title}
              </p>
              <div className="divide-y">
                {category.items.map((item) => {
                  const isDone = checked.has(item.id);
                  return (
                    <label
                      key={item.id}
                      className="flex items-start gap-3 px-4 py-2.5 cursor-pointer hover:bg-muted/30 transition-colors"
                    >
                      <button
                        type="button"
                        onClick={(e) => { e.preventDefault(); toggle(item.id); }}
                        className={`mt-0.5 shrink-0 ${isDone ? "text-emerald-500" : "text-muted-foreground"}`}
                      >
                        {isDone
                          ? <CheckCircle2 className="h-4 w-4" />
                          : <Circle className="h-4 w-4" />
                        }
                      </button>
                      <div className="min-w-0 flex-1" onClick={() => toggle(item.id)}>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-sm ${isDone ? "line-through text-muted-foreground" : "font-medium"}`}>
                            {item.label}
                          </span>
                          {item.severity && (
                            <span className={`text-xs font-medium px-1.5 py-0.5 rounded border ${severityColors[item.severity]}`}>
                              {severityLabel[item.severity]}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">{item.description}</p>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
          ))}

          <div className="border-t px-4 py-3 bg-muted/20 flex items-center gap-2 text-xs text-muted-foreground">
            <Info className="h-3.5 w-3.5 shrink-0" />
            This checklist is stored in your browser only — it resets on page refresh. Use it as a migration guide.
          </div>
        </>
      )}
    </div>
  );
}
