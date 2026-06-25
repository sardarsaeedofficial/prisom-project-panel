"use client";

/**
 * components/projects/ecommerce-test-panel.tsx
 *
 * Sprint 62: Sardar Ecommerce Test Harness panel.
 *
 * Sections:
 *  - Generate test plan (GENERATE ECOMMERCE TEST PLAN)
 *  - Provider readiness summary
 *  - Safe smoke checks (RUN SAFE ECOMMERCE CHECKS)
 *  - Per-category check list
 *  - Manual evidence checklist (18 items, client-side)
 *  - Export ECOMMERCE_TEST_REPORT.md
 *  - Mark proof complete (MARK ECOMMERCE PROOF COMPLETE)
 *
 * Safety: no real charges, no production orders, no secrets.
 */

import { useState, useCallback, useTransition, useRef } from "react";
import Link from "next/link";
import {
  CheckCircle2, XCircle, AlertTriangle, Clock,
  ChevronDown, ChevronUp, Download, ShoppingCart,
  Globe, Wrench, CheckSquare, Square, ShieldCheck,
} from "lucide-react";
import { Badge }               from "@/components/ui/badge";
import { Button }              from "@/components/ui/button";
import { Input }               from "@/components/ui/input";
import { ActionLoadingButton } from "@/components/common/action-loading-button";
import { CopyDownloadButton }  from "@/components/common/copy-download-button";
import {
  generateEcommerceTestReportAction,
  runSafeEcommerceSmokeChecksAction,
  exportEcommerceTestReportAction,
  markEcommerceProofCompleteAction,
} from "@/app/actions/ecommerce-test";
import type {
  EcommerceTestReport,
  EcommerceTestCheck,
  EcommerceTestCategory,
  EcommerceSmokeReport,
} from "@/lib/ecommerce/ecommerce-test-types";

// ── Status helpers ────────────────────────────────────────────────────────────

function checkStatusIcon(status: EcommerceTestCheck["status"]) {
  switch (status) {
    case "pass":    return <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />;
    case "warning": return <AlertTriangle className="h-3.5 w-3.5 text-yellow-500 shrink-0" />;
    case "fail":    return <XCircle className="h-3.5 w-3.5 text-red-500 shrink-0" />;
    case "manual":  return <Wrench className="h-3.5 w-3.5 text-blue-500 shrink-0" />;
    case "pending": return <Clock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />;
  }
}

function overallStatusBadge(status: EcommerceTestReport["status"]) {
  const map: Record<string, string> = {
    passed:      "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
    complete:    "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
    ready:       "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
    warning:     "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
    blocked:     "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
    failed:      "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
    not_started: "bg-muted text-muted-foreground",
    running:     "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
    unknown:     "bg-muted text-muted-foreground",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${map[status] ?? map.not_started}`}>
      {status.replace("_", " ").toUpperCase()}
    </span>
  );
}

function smokeStatusIcon(status: "pass" | "passed" | "warning" | "fail" | "failed") {
  return status === "pass" || status === "passed"
    ? <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
    : status === "warning"
    ? <AlertTriangle className="h-4 w-4 text-yellow-500 shrink-0" />
    : <XCircle className="h-4 w-4 text-red-500 shrink-0" />;
}

// ── Check item ────────────────────────────────────────────────────────────────

function CheckItem({ c }: { c: EcommerceTestCheck }) {
  const [open, setOpen] = useState(false);
  const hasDetail = c.warning || c.command || (c.evidence?.length) || c.linkHref;

  return (
    <div className="py-2 border-b last:border-0">
      <button
        type="button"
        onClick={() => hasDetail && setOpen((v) => !v)}
        className={`w-full flex items-start gap-2 text-left ${hasDetail ? "cursor-pointer" : "cursor-default"}`}
      >
        <div className="mt-0.5">{checkStatusIcon(c.status)}</div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium leading-snug">{c.label}</p>
          <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{c.message}</p>
        </div>
        {c.required && (
          <span className="text-[10px] text-muted-foreground shrink-0 mt-0.5 border rounded px-1 py-0.5">req</span>
        )}
        {hasDetail && (
          <div className="shrink-0 mt-1">
            {open ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
          </div>
        )}
      </button>

      {open && hasDetail && (
        <div className="ml-5 mt-2 space-y-1.5">
          {c.warning && (
            <p className="text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 rounded px-2 py-1.5 border border-amber-200 dark:border-amber-800">
              ⚠️ {c.warning}
            </p>
          )}
          {c.command && (
            <code className="block text-xs bg-muted rounded px-2 py-1 font-mono break-all whitespace-pre-wrap">{c.command}</code>
          )}
          {c.evidence?.map((e, i) => (
            <p key={i} className="text-xs text-muted-foreground font-mono break-all">• {e}</p>
          ))}
          {c.linkHref && (
            <Link href={c.linkHref} className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
              View →
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

// ── Category group ────────────────────────────────────────────────────────────

const CATEGORY_LABELS: Record<EcommerceTestCategory, string> = {
  storefront: "Storefront",
  products:   "Products",
  cart:       "Cart",
  checkout:   "Checkout",
  stripe:     "Stripe",
  webhooks:   "Webhooks",
  orders:     "Orders",
  email:      "Email",
  cloudinary: "Cloudinary",
  admin:      "Admin",
  database:   "Database",
  security:   "Security",
  manual:     "Manual",
};

function CategoryGroup({
  category, checks,
}: {
  category: EcommerceTestCategory;
  checks:   EcommerceTestCheck[];
}) {
  const [open, setOpen]  = useState(false);
  const passCount        = checks.filter((c) => c.status === "pass").length;
  const failCount        = checks.filter((c) => c.status === "fail" && c.required).length;
  const warnCount        = checks.filter((c) => c.status === "warning" && c.required).length;
  const badgeClass       = failCount > 0
    ? "border-red-400 text-red-600 dark:text-red-400"
    : warnCount > 0
    ? "border-yellow-400 text-yellow-600 dark:text-yellow-400"
    : "border-border text-muted-foreground";

  return (
    <div className="rounded-lg border bg-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-muted/40 transition-colors rounded-lg"
      >
        <div className="flex items-center gap-2 min-w-0">
          <Badge variant="outline" className={`text-xs py-0 h-5 shrink-0 ${badgeClass}`}>
            {CATEGORY_LABELS[category]}
          </Badge>
          <span className="text-xs text-muted-foreground">
            {passCount}/{checks.length} pass
          </span>
        </div>
        {open
          ? <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" />
          : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />}
      </button>
      {open && (
        <div className="px-4 pb-3 border-t">
          {checks.map((c) => <CheckItem key={c.id} c={c} />)}
        </div>
      )}
    </div>
  );
}

// ── Provider readiness summary ────────────────────────────────────────────────

function ProviderRow({
  label, status, message,
}: {
  label: string; status: EcommerceTestCheck["status"]; message: string;
}) {
  return (
    <div className="flex items-center gap-2 py-1.5 border-b last:border-0">
      {checkStatusIcon(status)}
      <span className="text-sm font-medium w-24 shrink-0">{label}</span>
      <span className="text-xs text-muted-foreground truncate">{message}</span>
    </div>
  );
}

// ── Manual evidence checklist ─────────────────────────────────────────────────

const MANUAL_EVIDENCE = [
  "Storefront loads on staging",
  "Product list visible on staging",
  "Product detail page visible",
  "Product image loads (Cloudinary)",
  "Add-to-cart works",
  "Cart quantity update works",
  "Cart item remove works",
  "Checkout form loads",
  "Checkout validation errors display",
  "Stripe test card path reviewed (4242 4242 4242 4242)",
  "Stripe webhook endpoint documented",
  "Test order created in staging/test mode ONLY",
  "Order confirmation page reviewed",
  "Admin orders page reviewed",
  "Test email reviewed (no real customer address)",
  "Cloudinary test upload reviewed safely",
  "Refund/cancel path reviewed manually",
  "Database backup exists before order-flow test",
] as const;

function ManualEvidenceChecklist() {
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const toggle = (i: number) =>
    setChecked((prev) => { const n = new Set(prev); if (n.has(i)) n.delete(i); else n.add(i); return n; });

  const done  = checked.size;
  const total = MANUAL_EVIDENCE.length;

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">Manual Evidence Checklist</span>
        <span className={`text-xs font-mono px-2 py-0.5 rounded-full border ${
          done === total ? "border-green-400 text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20" : "border-border text-muted-foreground"
        }`}>
          {done} / {total}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        Check each item after manually verifying in the staging environment.
        None of these can be automated safely.
      </p>
      <div className="space-y-0.5">
        {MANUAL_EVIDENCE.map((label, i) => {
          const done = checked.has(i);
          return (
            <button
              key={i}
              type="button"
              onClick={() => toggle(i)}
              className="w-full flex items-start gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-muted/60 transition-colors"
            >
              {done
                ? <CheckSquare className="h-4 w-4 text-green-600 dark:text-green-400 mt-0.5 shrink-0" />
                : <Square className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />}
              <span className={`text-sm ${done ? "line-through text-muted-foreground" : ""}`}>
                {label}
              </span>
            </button>
          );
        })}
      </div>
      {checked.size === total && (
        <div className="flex items-center gap-2 rounded border border-green-200 bg-green-50 dark:bg-green-900/20 px-3 py-2">
          <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
          <span className="text-sm text-green-800 dark:text-green-200">
            All {total} items confirmed ✓
          </span>
        </div>
      )}
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

const ECOMMERCE_CATEGORIES: EcommerceTestCategory[] = [
  "storefront", "products", "cart", "checkout",
  "stripe", "webhooks", "orders", "email", "cloudinary",
  "admin", "database", "security",
];

export function EcommerceTestPanel({ projectId }: { projectId: string }) {
  const [report,      setReport]      = useState<EcommerceTestReport | null>(null);
  const [smokeReport, setSmokeReport] = useState<EcommerceSmokeReport | null>(null);
  const [exportData,  setExportData]  = useState<{ markdown: string; filename: string } | null>(null);
  const [proofDone,   setProofDone]   = useState<string | null>(null);
  const [error,       setError]       = useState<string | null>(null);
  const [lastAction,  setLastAction]  = useState<string | null>(null);

  const [domain,       setDomain]       = useState("");
  const [planConfirm,  setPlanConfirm]  = useState("");
  const [smokeConfirm, setSmokeConfirm] = useState("");
  const [markConfirm,  setMarkConfirm]  = useState("");

  const [planPending,   startPlan]   = useTransition();
  const [smokePending,  startSmoke]  = useTransition();
  const [exportPending, startExport] = useTransition();
  const [markPending,   startMark]   = useTransition();

  const planFlight   = useRef(false);
  const smokeFlight  = useRef(false);
  const exportFlight = useRef(false);
  const markFlight   = useRef(false);

  const handleGeneratePlan = useCallback(() => {
    if (planFlight.current) return;
    if (planConfirm.trim() !== "GENERATE ECOMMERCE TEST PLAN") return;
    planFlight.current = true;
    setError(null);
    startPlan(async () => {
      try {
        const res = await generateEcommerceTestReportAction({
          projectId,
          targetDomain: domain.trim() || undefined,
          confirmation: "GENERATE ECOMMERCE TEST PLAN",
        });
        if (res.ok) {
          setReport(res.data);
          setLastAction("Ecommerce test plan generated");
        } else {
          setError(res.error);
        }
      } finally { planFlight.current = false; }
    });
  }, [projectId, domain, planConfirm]);

  const handleRunSmoke = useCallback(() => {
    if (smokeFlight.current) return;
    if (smokeConfirm.trim() !== "RUN SAFE ECOMMERCE CHECKS") return;
    smokeFlight.current = true;
    setError(null);
    startSmoke(async () => {
      try {
        const res = await runSafeEcommerceSmokeChecksAction({
          projectId,
          targetDomain: domain.trim() || undefined,
          confirmation: "RUN SAFE ECOMMERCE CHECKS",
        });
        if (res.ok) {
          setSmokeReport(res.data);
          setLastAction(`Smoke checks ${res.data.status} ✓`);
        } else {
          setError(res.error);
        }
      } finally { smokeFlight.current = false; }
    });
  }, [projectId, domain, smokeConfirm]);

  const handleExport = useCallback(() => {
    if (exportFlight.current) return;
    exportFlight.current = true;
    setError(null);
    startExport(async () => {
      try {
        const res = await exportEcommerceTestReportAction({
          projectId,
          targetDomain: domain.trim() || undefined,
        });
        if (res.ok) {
          setExportData(res.data);
          setLastAction("ECOMMERCE_TEST_REPORT.md exported");
        } else {
          setError(res.error);
        }
      } finally { exportFlight.current = false; }
    });
  }, [projectId, domain]);

  const handleMarkComplete = useCallback(() => {
    if (markFlight.current) return;
    if (markConfirm.trim() !== "MARK ECOMMERCE PROOF COMPLETE") return;
    markFlight.current = true;
    setError(null);
    startMark(async () => {
      try {
        const res = await markEcommerceProofCompleteAction({
          projectId,
          confirmation: "MARK ECOMMERCE PROOF COMPLETE",
        });
        if (res.ok) {
          setProofDone(res.data.completedAt);
          setLastAction("Ecommerce proof marked complete ✓");
        } else {
          setError(res.error);
        }
      } finally { markFlight.current = false; }
    });
  }, [projectId, markConfirm]);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">

      {/* Header */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <ShoppingCart className="h-5 w-5 text-muted-foreground" />
          <h3 className="text-base font-semibold">Sardar Ecommerce Test Harness</h3>
          {report && overallStatusBadge(report.status)}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <ActionLoadingButton
            loading={exportPending}
            loadingLabel="Exporting…"
            onClick={handleExport}
            size="sm"
            variant="outline"
          >
            <Download className="h-4 w-4" />
            Export Report
          </ActionLoadingButton>
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        Prove checkout, order, and provider readiness on staging before production cutover.
        No real charges, no production orders, no secrets exposed.
      </p>

      {/* Stripe test-mode notice */}
      <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-900/20 px-3 py-2.5 flex items-start gap-2">
        <ShieldCheck className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
        <div className="text-xs text-amber-800 dark:text-amber-200 space-y-0.5">
          <p className="font-medium">Test mode only — no real charges</p>
          <p>Use Stripe test card <code className="font-mono bg-amber-100 dark:bg-amber-900/40 px-1 rounded">4242 4242 4242 4242</code> for all checkout tests. Never enter real card numbers on staging.</p>
        </div>
      </div>

      {/* Feedback */}
      {lastAction && (
        <div className="flex items-center gap-2 rounded border border-green-200 bg-green-50 dark:bg-green-900/20 px-3 py-2">
          <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
          <span className="text-sm text-green-800 dark:text-green-200">{lastAction}</span>
        </div>
      )}
      {error && (
        <div className="rounded border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Target domain + generate plan */}
      <div className="rounded-lg border bg-card p-4 space-y-3">
        <p className="text-sm font-medium">Generate Ecommerce Test Plan</p>
        <p className="text-xs text-muted-foreground">
          Checks Stripe, Cloudinary, and email env names; staged deployments; and security posture.
          Confirm with <code className="font-mono bg-muted px-1 rounded text-xs">GENERATE ECOMMERCE TEST PLAN</code>.
        </p>
        <div className="space-y-2">
          <Input
            placeholder="Staging domain (default: staging-sardar-security-project.doorstepmanchester.uk)"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            className="text-sm font-mono"
          />
          <Input
            placeholder='Type "GENERATE ECOMMERCE TEST PLAN" to confirm'
            value={planConfirm}
            onChange={(e) => setPlanConfirm(e.target.value)}
            className="text-sm font-mono"
          />
          <ActionLoadingButton
            loading={planPending}
            loadingLabel="Generating…"
            onClick={handleGeneratePlan}
            size="sm"
            variant="outline"
            disabled={planPending || planConfirm.trim() !== "GENERATE ECOMMERCE TEST PLAN"}
          >
            <ShoppingCart className="h-4 w-4" />
            Generate Ecommerce Test Plan
          </ActionLoadingButton>
        </div>
      </div>

      {/* Report summary */}
      {report && (
        <div className="rounded-lg border bg-card px-4 py-3 space-y-2">
          <div className="flex items-center gap-3 flex-wrap">
            {overallStatusBadge(report.status)}
            <code className="text-xs font-mono text-muted-foreground">{report.targetDomain}</code>
          </div>
          <div className="flex gap-3 text-xs text-muted-foreground flex-wrap">
            <span className="text-green-600 dark:text-green-400">{report.summary.passed} pass</span>
            {report.summary.warnings > 0 && <span className="text-yellow-600 dark:text-yellow-400">{report.summary.warnings} warn</span>}
            {report.summary.failed > 0  && <span className="text-red-600 dark:text-red-400">{report.summary.failed} fail</span>}
            <span>{report.summary.manual} manual</span>
            <span>{report.summary.pending} pending</span>
          </div>
          {report.blockers.length > 0 && (
            <div className="space-y-0.5 pt-1">
              {report.blockers.map((b, i) => (
                <p key={i} className="text-xs flex items-start gap-1.5">
                  <XCircle className="h-3 w-3 text-red-500 mt-0.5 shrink-0" />{b}
                </p>
              ))}
            </div>
          )}
          {report.warnings.length > 0 && (
            <div className="space-y-0.5">
              {report.warnings.map((w, i) => (
                <p key={i} className="text-xs flex items-start gap-1.5 text-muted-foreground">
                  <AlertTriangle className="h-3 w-3 text-yellow-500 mt-0.5 shrink-0" />{w}
                </p>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Provider readiness */}
      {report && (
        <div className="rounded-lg border bg-card p-4 space-y-2">
          <p className="text-sm font-medium">Provider Readiness</p>
          {(["stripe", "email", "cloudinary"] as const).map((cat) => {
            const catChecks = report.checks.filter((c) => c.category === cat);
            return catChecks.map((c) => (
              <ProviderRow key={c.id} label={cat.charAt(0).toUpperCase() + cat.slice(1)} status={c.status} message={c.message} />
            ));
          })}
        </div>
      )}

      {/* Check categories */}
      {report && (
        <div className="space-y-2">
          {ECOMMERCE_CATEGORIES.map((cat) => {
            const catChecks = report.checks.filter((c) => c.category === cat);
            if (catChecks.length === 0) return null;
            return <CategoryGroup key={cat} category={cat} checks={catChecks} />;
          })}
        </div>
      )}

      {/* Safe smoke checks */}
      <div className="rounded-lg border bg-card p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Globe className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Run Safe Ecommerce Checks</span>
        </div>
        <p className="text-xs text-muted-foreground">
          HTTP GET checks only — root, health, SPA fallback, products, shop, API products.
          No POST, no checkout, no order creation, no provider calls.
          Confirm with <code className="font-mono bg-muted px-1 rounded text-xs">RUN SAFE ECOMMERCE CHECKS</code>.
        </p>
        <div className="space-y-2">
          <Input
            placeholder='Type "RUN SAFE ECOMMERCE CHECKS" to confirm'
            value={smokeConfirm}
            onChange={(e) => setSmokeConfirm(e.target.value)}
            className="text-sm font-mono"
          />
          <ActionLoadingButton
            loading={smokePending}
            loadingLabel="Checking…"
            onClick={handleRunSmoke}
            size="sm"
            variant="outline"
            disabled={smokePending || smokeConfirm.trim() !== "RUN SAFE ECOMMERCE CHECKS"}
          >
            <Globe className="h-4 w-4" />
            Run Safe Ecommerce Checks
          </ActionLoadingButton>
        </div>

        {smokeReport && (
          <div className="space-y-1.5 pt-1">
            <div className="flex items-center gap-2">
              {smokeStatusIcon(smokeReport.status)}
              <span className="text-sm font-medium capitalize">
                Smoke checks {smokeReport.status} — {new Date(smokeReport.generatedAt).toLocaleTimeString()}
              </span>
            </div>
            {smokeReport.results.map((r) => (
              <div key={r.id} className="flex items-start gap-2 py-1.5 border-b last:border-0">
                {smokeStatusIcon(r.status)}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium">{r.label}</p>
                  <code className="text-xs text-muted-foreground font-mono break-all">{r.url}</code>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {r.httpStatus && <span className="mr-2">HTTP {r.httpStatus}</span>}
                    {r.message}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Manual evidence checklist */}
      <ManualEvidenceChecklist />

      {/* Export */}
      {exportData && (
        <div className="rounded-lg border bg-card p-4 space-y-2">
          <div className="flex items-center gap-2">
            <Download className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">ECOMMERCE_TEST_REPORT.md</span>
            <Badge variant="secondary" className="text-xs">Ready</Badge>
          </div>
          <p className="text-xs text-muted-foreground">No secrets included.</p>
          <CopyDownloadButton
            content={exportData.markdown}
            filename={exportData.filename}
            label="Download ECOMMERCE_TEST_REPORT.md"
          />
        </div>
      )}

      {/* Mark proof complete */}
      {proofDone ? (
        <div className="rounded-lg border border-green-200 bg-green-50 dark:bg-green-900/20 px-4 py-3 flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
          <span className="text-sm text-green-800 dark:text-green-200">
            Ecommerce proof marked complete — {proofDone.slice(0, 16).replace("T", " ")} UTC
          </span>
        </div>
      ) : (
        <div className="rounded-lg border bg-card p-4 space-y-3">
          <p className="text-sm font-medium">Mark Ecommerce Proof Complete</p>
          <p className="text-xs text-muted-foreground">
            Once all smoke checks pass, manual items are confirmed, and no blockers remain, type{" "}
            <code className="font-mono bg-muted px-1 rounded text-xs">MARK ECOMMERCE PROOF COMPLETE</code>.
          </p>
          <div className="flex flex-col sm:flex-row gap-2">
            <Input
              placeholder='Type "MARK ECOMMERCE PROOF COMPLETE" to confirm'
              value={markConfirm}
              onChange={(e) => setMarkConfirm(e.target.value)}
              className="text-sm font-mono"
            />
            <ActionLoadingButton
              loading={markPending}
              loadingLabel="Marking…"
              onClick={handleMarkComplete}
              size="sm"
              variant="outline"
              disabled={markPending || markConfirm.trim() !== "MARK ECOMMERCE PROOF COMPLETE"}
              className="shrink-0"
            >
              <CheckCircle2 className="h-4 w-4" />
              Mark Proof Complete
            </ActionLoadingButton>
          </div>
        </div>
      )}

      {/* Next steps */}
      {report?.nextSteps && report.nextSteps.length > 0 && (
        <div className="rounded-lg border bg-card px-4 py-3 space-y-1.5">
          <p className="text-xs font-medium">Next steps:</p>
          {report.nextSteps.map((s, i) => (
            <p key={i} className="text-xs text-muted-foreground">• {s}</p>
          ))}
        </div>
      )}

      {/* Safety footer */}
      <p className="text-xs text-muted-foreground flex items-start gap-1.5 pt-1">
        <AlertTriangle className="h-3.5 w-3.5 text-yellow-500 mt-0.5 shrink-0" />
        This harness does not charge real cards, create production orders, mutate providers,
        modify live Sardar routing, run DB migrations, or restart PM2.
      </p>
    </div>
  );
}
