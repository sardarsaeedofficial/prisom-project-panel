"use client";

/**
 * components/projects/project-packages-panel.tsx
 *
 * Sprint 9: Safe per-project package manager UI.
 *
 * Features:
 *  - Displays detected package manager (pnpm/npm/yarn) and lockfile status.
 *  - Shows dependencies / devDependencies / optional / peer in tabs with search.
 *  - Install / Install Dev / Remove / Update with a confirm step before execution.
 *  - Shows command output and package.json + lockfile diffs after each operation.
 *  - Verification buttons for available typecheck/build scripts.
 *
 * Safety: every operation goes through runProjectPackageOperationAction which
 * requires confirmed:true and validates the specifier server-side.
 */

import { useState, useEffect, useCallback } from "react";
import {
  Package2,
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Search,
  Terminal,
  FileCode2,
  Lock,
} from "lucide-react";
import { Button }   from "@/components/ui/button";
import { Badge }    from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input }    from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  getProjectPackageInfoAction,
  runProjectPackageOperationAction,
  getProjectPackageDiffAction,
  type PkgActionResult,
} from "@/app/actions/project-packages";
import { validatePackageSpecifier } from "@/lib/projects/package-validator";
import type {
  ProjectPackageInfo,
  PackageOperation,
  PackageOperationResult,
  PackageDiffResult,
} from "@/lib/projects/package-manager";
import { runProjectCommandAction } from "@/app/actions/project-terminal";
import type { RunCommandOutput } from "@/app/actions/project-terminal";

// ── Types ─────────────────────────────────────────────────────────────────────

interface PendingOperation {
  operation:      PackageOperation;
  specifier:      string;
  displayCommand: string;
}

interface VerifyResult {
  script:  string;
  result:  RunCommandOutput;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const OPERATION_LABELS: Record<PackageOperation, string> = {
  "install":     "Install",
  "install-dev": "Install Dev",
  "remove":      "Remove",
  "update":      "Update",
};

const OPERATION_DESCRIPTIONS: Record<PackageOperation, string> = {
  "install":     "Add to dependencies",
  "install-dev": "Add to devDependencies",
  "remove":      "Remove from all dep groups",
  "update":      "Update to latest matching range",
};

function pmColor(pm: string): string {
  switch (pm) {
    case "pnpm":  return "bg-amber-100 text-amber-800 border-amber-200";
    case "npm":   return "bg-red-100 text-red-800 border-red-200";
    case "yarn":  return "bg-blue-100 text-blue-800 border-blue-200";
    default:      return "bg-muted text-muted-foreground";
  }
}

function buildDisplayCommand(
  pm:                  string,
  operation:           PackageOperation,
  specifier:           string,
  isPnpmWorkspaceRoot: boolean,
): string {
  // When the project root is a pnpm workspace root, --workspace-root is
  // required to avoid ERR_PNPM_ADDING_TO_ROOT.
  const wr = isPnpmWorkspaceRoot && pm === "pnpm" ? " --workspace-root" : "";
  switch (pm) {
    case "pnpm":
      switch (operation) {
        case "install":     return `pnpm add${wr} ${specifier} --ignore-scripts`;
        case "install-dev": return `pnpm add${wr} -D ${specifier} --ignore-scripts`;
        case "remove":      return `pnpm remove${wr} ${specifier} --ignore-scripts`;
        case "update":      return `pnpm update${wr} ${specifier} --ignore-scripts`;
      }
      break;
    case "npm":
      switch (operation) {
        case "install":     return `npm install ${specifier} --ignore-scripts`;
        case "install-dev": return `npm install -D ${specifier} --ignore-scripts`;
        case "remove":      return `npm uninstall ${specifier} --ignore-scripts`;
        case "update":      return `npm update ${specifier} --ignore-scripts`;
      }
      break;
    case "yarn":
      switch (operation) {
        case "install":     return `yarn add ${specifier} --ignore-scripts`;
        case "install-dev": return `yarn add -D ${specifier} --ignore-scripts`;
        case "remove":      return `yarn remove ${specifier}`;
        case "update":      return `yarn upgrade ${specifier} --ignore-scripts`;
      }
      break;
  }
  return `${pm} ${operation} ${specifier}`;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function DiffBlock({ title, diff }: { title: string; diff: string | null }) {
  const [open, setOpen] = useState(false);
  if (!diff) return null;

  const lines = diff.split("\n");

  return (
    <div className="rounded-md border overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium bg-muted/50 hover:bg-muted transition-colors"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="flex items-center gap-1.5">
          <FileCode2 className="h-3 w-3" />
          {title}
        </span>
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
      </button>
      {open && (
        <div className="max-h-80 overflow-y-auto">
          <pre className="p-3 text-[11px] leading-relaxed font-mono">
            {lines.map((line, i) => {
              const isAdd = line.startsWith("+") && !line.startsWith("+++");
              const isDel = line.startsWith("-") && !line.startsWith("---");
              return (
                <div
                  key={i}
                  className={
                    isAdd ? "text-green-700 bg-green-50"
                    : isDel ? "text-red-700 bg-red-50"
                    : "text-muted-foreground"
                  }
                >
                  {line || " "}
                </div>
              );
            })}
          </pre>
        </div>
      )}
    </div>
  );
}

function DepList({
  title,
  deps,
  search,
}: {
  title:  string;
  deps:   Record<string, string>;
  search: string;
}) {
  const entries = Object.entries(deps).filter(
    ([name, ver]) =>
      !search ||
      name.toLowerCase().includes(search.toLowerCase()) ||
      ver.toLowerCase().includes(search.toLowerCase()),
  );

  if (entries.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-2 px-1">
        {search ? "No packages match your search." : `No ${title.toLowerCase()}.`}
      </p>
    );
  }

  return (
    <div className="divide-y">
      {entries.map(([name, ver]) => (
        <div key={name} className="flex items-center justify-between py-1.5 px-1 text-sm">
          <span className="font-mono text-[13px] text-foreground">{name}</span>
          <span className="text-muted-foreground text-xs font-mono">{ver}</span>
        </div>
      ))}
    </div>
  );
}

function OutputBlock({ stdout, stderr }: { stdout: string; stderr: string }) {
  const [open, setOpen] = useState(true);
  const combined = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n\n");
  if (!combined) return null;

  return (
    <div className="rounded-md border overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium bg-muted/50 hover:bg-muted transition-colors"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="flex items-center gap-1.5">
          <Terminal className="h-3 w-3" />
          Command output
        </span>
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
      </button>
      {open && (
        <pre className="max-h-64 overflow-y-auto p-3 text-[11px] leading-relaxed font-mono text-foreground bg-background whitespace-pre-wrap break-words">
          {combined}
        </pre>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  projectId: string;
}

export function ProjectPackagesPanel({ projectId }: Props) {
  // ── Package info ──────────────────────────────────────────────────────────
  const [info,        setInfo]        = useState<ProjectPackageInfo | null>(null);
  const [infoLoading, setInfoLoading] = useState(true);
  const [infoError,   setInfoError]   = useState<string | null>(null);

  // ── Operations form ───────────────────────────────────────────────────────
  const [operation,      setOperation]      = useState<PackageOperation>("install");
  const [specifierInput, setSpecifierInput] = useState("");
  const [specifierError, setSpecifierError] = useState<string | null>(null);
  const [pendingOp,      setPendingOp]      = useState<PendingOperation | null>(null);
  const [running,        setRunning]        = useState(false);

  // ── Results ───────────────────────────────────────────────────────────────
  const [opResult, setOpResult] = useState<PackageOperationResult | null>(null);
  const [opDiff,   setOpDiff]   = useState<PackageDiffResult | null>(null);
  const [opError,  setOpError]  = useState<string | null>(null);

  // ── Verification ──────────────────────────────────────────────────────────
  const [verifyRunning, setVerifyRunning] = useState<string | null>(null);
  const [verifyResult,  setVerifyResult]  = useState<VerifyResult | null>(null);

  // ── Search ────────────────────────────────────────────────────────────────
  const [depSearch, setDepSearch] = useState("");

  // ── Refresh diff ──────────────────────────────────────────────────────────
  const [diffRefreshing, setDiffRefreshing] = useState(false);

  // ── Load package info ─────────────────────────────────────────────────────
  const loadInfo = useCallback(async () => {
    setInfoLoading(true);
    setInfoError(null);
    const r = await getProjectPackageInfoAction(projectId);
    if (r.ok) {
      setInfo(r.data);
    } else {
      setInfoError(r.error);
    }
    setInfoLoading(false);
  }, [projectId]);

  useEffect(() => { void loadInfo(); }, [loadInfo]);

  // ── Validate specifier as user types ─────────────────────────────────────
  const handleSpecifierChange = (value: string) => {
    setSpecifierInput(value);
    if (!value.trim()) {
      setSpecifierError(null);
      return;
    }
    const v = validatePackageSpecifier(value);
    setSpecifierError(v.ok ? null : v.error);
  };

  // ── Prepare operation (show confirm step) ─────────────────────────────────
  const handlePrepare = () => {
    const v = validatePackageSpecifier(specifierInput);
    if (!v.ok) {
      setSpecifierError(v.error);
      return;
    }
    const displayCmd = buildDisplayCommand(
      info?.packageManager ?? "pnpm",
      operation,
      v.specifier.display,
      info?.isPnpmWorkspaceRoot ?? false,
    );
    setPendingOp({ operation, specifier: v.specifier.display, displayCommand: displayCmd });
    setOpResult(null);
    setOpDiff(null);
    setOpError(null);
  };

  // ── Execute confirmed operation ───────────────────────────────────────────
  const handleConfirm = async () => {
    if (!pendingOp) return;
    setRunning(true);
    setOpError(null);
    setPendingOp(null);

    const r = await runProjectPackageOperationAction({
      projectId,
      operation:        pendingOp.operation,
      packageSpecifier: pendingOp.specifier,
      confirmed:        true,
    });

    setRunning(false);

    if (r.ok) {
      setOpResult(r.data.result);
      setOpDiff(r.data.diff);
      // Refresh package info after operation
      void loadInfo();
      // Clear input on success
      if (r.data.result.success) {
        setSpecifierInput("");
        setSpecifierError(null);
      }
    } else {
      setOpError(r.error);
    }
  };

  // ── Refresh diff only ─────────────────────────────────────────────────────
  const handleRefreshDiff = async () => {
    setDiffRefreshing(true);
    const r = await getProjectPackageDiffAction(projectId);
    if (r.ok) setOpDiff(r.data);
    setDiffRefreshing(false);
  };

  // ── Verification scripts ──────────────────────────────────────────────────
  const handleVerify = async (script: string) => {
    if (!info) return;
    const pm  = info.packageManager;
    const cmd = `${pm} run ${script}`;

    setVerifyRunning(script);
    setVerifyResult(null);

    const r = await runProjectCommandAction({ projectId, command: cmd, confirmed: true });
    if (r.ok && r.data) {
      setVerifyResult({ script, result: r.data });
    } else if (!r.ok) {
      setVerifyResult({
        script,
        result: {
          commandId: "", command: cmd, cwd: "", exitCode: 1,
          stdout: "", stderr: r.error, durationMs: 0, risk: "safe",
        },
      });
    }
    setVerifyRunning(null);
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

  const verifyScripts = ["typecheck", "type-check", "build", "lint"].filter(
    (s) => info?.scripts[s] !== undefined,
  );

  const depCount    = info ? Object.keys(info.dependencies).length : 0;
  const devCount    = info ? Object.keys(info.devDependencies).length : 0;
  const optCount    = info ? Object.keys(info.optionalDependencies).length : 0;
  const peerCount   = info ? Object.keys(info.peerDependencies).length : 0;

  return (
    <div className="space-y-4">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Package2 className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-base">
                {infoLoading
                  ? "Loading…"
                  : info
                  ? (info.name ?? "Unnamed project")
                  : "Package Info"}
              </CardTitle>
              {info && (
                <span className="text-sm text-muted-foreground">{info.version ?? ""}</span>
              )}
            </div>
            <Button variant="ghost" size="sm" onClick={loadInfo} disabled={infoLoading}>
              <RefreshCw className={`h-3.5 w-3.5 ${infoLoading ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          {infoError ? (
            <p className="text-sm text-destructive">{infoError}</p>
          ) : info ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge
                variant="outline"
                className={`font-mono text-xs ${pmColor(info.packageManager)}`}
              >
                {info.packageManager}
              </Badge>
              {info.hasLockfile && info.lockfileName ? (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Lock className="h-3 w-3" />
                  {info.lockfileName}
                </span>
              ) : (
                <span className="flex items-center gap-1 text-xs text-amber-600">
                  <AlertTriangle className="h-3 w-3" />
                  No lockfile
                </span>
              )}
              {info.description && (
                <span className="text-xs text-muted-foreground truncate max-w-xs">
                  {info.description}
                </span>
              )}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* ── Dependencies ───────────────────────────────────────────────── */}
      {info && (depCount + devCount + optCount + peerCount > 0) && (
        <Card>
          <CardContent className="pt-4">
            <div className="mb-3">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Search packages…"
                  value={depSearch}
                  onChange={(e) => setDepSearch(e.target.value)}
                  className="pl-8 h-8 text-sm"
                />
              </div>
            </div>
            <Tabs defaultValue="dependencies">
              <TabsList className="h-8 text-xs">
                <TabsTrigger value="dependencies" className="text-xs px-3 h-7">
                  Dependencies
                  {depCount > 0 && (
                    <Badge variant="secondary" className="ml-1.5 text-[10px] h-4 px-1">
                      {depCount}
                    </Badge>
                  )}
                </TabsTrigger>
                <TabsTrigger value="devDependencies" className="text-xs px-3 h-7">
                  Dev
                  {devCount > 0 && (
                    <Badge variant="secondary" className="ml-1.5 text-[10px] h-4 px-1">
                      {devCount}
                    </Badge>
                  )}
                </TabsTrigger>
                {optCount > 0 && (
                  <TabsTrigger value="optionalDependencies" className="text-xs px-3 h-7">
                    Optional
                    <Badge variant="secondary" className="ml-1.5 text-[10px] h-4 px-1">
                      {optCount}
                    </Badge>
                  </TabsTrigger>
                )}
                {peerCount > 0 && (
                  <TabsTrigger value="peerDependencies" className="text-xs px-3 h-7">
                    Peer
                    <Badge variant="secondary" className="ml-1.5 text-[10px] h-4 px-1">
                      {peerCount}
                    </Badge>
                  </TabsTrigger>
                )}
              </TabsList>
              <TabsContent value="dependencies" className="mt-2 max-h-64 overflow-y-auto">
                <DepList title="Dependencies" deps={info.dependencies} search={depSearch} />
              </TabsContent>
              <TabsContent value="devDependencies" className="mt-2 max-h-64 overflow-y-auto">
                <DepList title="Dev dependencies" deps={info.devDependencies} search={depSearch} />
              </TabsContent>
              {optCount > 0 && (
                <TabsContent value="optionalDependencies" className="mt-2 max-h-64 overflow-y-auto">
                  <DepList title="Optional dependencies" deps={info.optionalDependencies} search={depSearch} />
                </TabsContent>
              )}
              {peerCount > 0 && (
                <TabsContent value="peerDependencies" className="mt-2 max-h-64 overflow-y-auto">
                  <DepList title="Peer dependencies" deps={info.peerDependencies} search={depSearch} />
                </TabsContent>
              )}
            </Tabs>
          </CardContent>
        </Card>
      )}

      {/* ── Operation form ──────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Package Operation</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Operation type selector */}
          <div className="flex flex-wrap gap-2">
            {(["install", "install-dev", "remove", "update"] as PackageOperation[]).map((op) => (
              <button
                key={op}
                onClick={() => { setOperation(op); setPendingOp(null); }}
                className={[
                  "px-3 py-1.5 rounded-md text-sm font-medium border transition-colors",
                  operation === op
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background text-foreground border-border hover:bg-muted",
                ].join(" ")}
              >
                {OPERATION_LABELS[op]}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground -mt-1">
            {OPERATION_DESCRIPTIONS[operation]}
          </p>

          {/* Specifier input */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-foreground">
              Package specifier
            </label>
            <div className="flex gap-2">
              <Input
                placeholder="e.g. zod  or  @radix-ui/react-dialog  or  date-fns@3"
                value={specifierInput}
                onChange={(e) => handleSpecifierChange(e.target.value)}
                className={`flex-1 h-9 text-sm font-mono ${specifierError ? "border-destructive" : ""}`}
                disabled={running}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !specifierError && specifierInput.trim()) {
                    handlePrepare();
                  }
                }}
              />
              <Button
                onClick={handlePrepare}
                disabled={!specifierInput.trim() || !!specifierError || running || infoLoading}
                size="sm"
                className="h-9"
              >
                Prepare
              </Button>
            </div>
            {specifierError && (
              <p className="text-xs text-destructive flex items-center gap-1">
                <XCircle className="h-3 w-3" />
                {specifierError}
              </p>
            )}
          </div>

          {/* ── Confirm step ──────────────────────────────────────────── */}
          {pendingOp && (
            <div className="rounded-lg border-2 border-amber-200 bg-amber-50 p-4 space-y-3">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                <div className="space-y-1">
                  <p className="text-sm font-medium text-amber-900">Confirm operation</p>
                  <p className="text-xs text-amber-700">
                    This will run the following command inside this project only:
                  </p>
                </div>
              </div>
              <code className="block text-xs font-mono bg-white border border-amber-200 rounded px-3 py-2 text-amber-900 break-all">
                {pendingOp.displayCommand}
              </code>
              <p className="text-xs text-amber-700">
                Uses <strong>--ignore-scripts</strong> to prevent lifecycle scripts.
                Review Git changes and commit manually when satisfied.
              </p>
              <div className="flex gap-2">
                <Button
                  onClick={handleConfirm}
                  disabled={running}
                  size="sm"
                  className="bg-amber-600 hover:bg-amber-700 text-white"
                >
                  {running ? (
                    <>
                      <RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                      Running…
                    </>
                  ) : (
                    "Confirm & Run"
                  )}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPendingOp(null)}
                  disabled={running}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {/* Global running state (no pending yet shown) */}
          {running && !pendingOp && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <RefreshCw className="h-4 w-4 animate-spin" />
              Running package operation…
            </div>
          )}

          {opError && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive flex items-start gap-2">
              <XCircle className="h-4 w-4 shrink-0 mt-0.5" />
              {opError}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Operation result ────────────────────────────────────────────── */}
      {opResult && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {opResult.success ? (
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                ) : (
                  <XCircle className="h-4 w-4 text-destructive" />
                )}
                <CardTitle className="text-base">
                  {opResult.success ? "Operation succeeded" : "Operation failed"}
                </CardTitle>
                <span className="text-xs text-muted-foreground">
                  exit {opResult.exitCode} · {(opResult.durationMs / 1000).toFixed(1)}s
                </span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleRefreshDiff}
                disabled={diffRefreshing}
                title="Refresh Git diff"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${diffRefreshing ? "animate-spin" : ""}`} />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <code className="block text-xs font-mono bg-muted px-3 py-2 rounded text-foreground">
              {opResult.command}
            </code>

            <OutputBlock stdout={opResult.stdout} stderr={opResult.stderr} />

            {/* Changed files summary */}
            {opDiff && opDiff.changedFiles.length > 0 && (
              <div>
                <p className="text-xs font-medium mb-1.5 text-muted-foreground">
                  Changed package files:
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {opDiff.changedFiles.map((f) => (
                    <Badge key={f.path} variant="outline" className="text-xs font-mono">
                      {f.path}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Diffs */}
            {opDiff?.packageJsonDiff && (
              <DiffBlock title="package.json diff" diff={opDiff.packageJsonDiff} />
            )}
            {opDiff?.lockfileDiff && (
              <DiffBlock title={`lockfile diff (${opDiff.changedFiles.find(f => ["pnpm-lock.yaml","package-lock.json","yarn.lock"].includes(f.path))?.path ?? "lockfile"})`} diff={opDiff.lockfileDiff} />
            )}

            {opDiff && !opDiff.isGitRepo && (
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" />
                Project is not in a Git repo — diffs unavailable. Consider initialising Git
                on the GitHub tab.
              </p>
            )}

            {opResult.success && (
              <p className="text-xs text-muted-foreground pt-1 border-t">
                Review the changes above and commit them via the{" "}
                <strong>GitHub</strong> tab when satisfied.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Verification ────────────────────────────────────────────────── */}
      {info && verifyScripts.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Verification</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Run project scripts to verify your changes compile correctly.
            </p>
            <div className="flex flex-wrap gap-2">
              {verifyScripts.map((script) => (
                <Button
                  key={script}
                  variant="outline"
                  size="sm"
                  onClick={() => handleVerify(script)}
                  disabled={verifyRunning !== null}
                  className="h-8 text-xs"
                >
                  {verifyRunning === script ? (
                    <>
                      <RefreshCw className="h-3 w-3 mr-1.5 animate-spin" />
                      Running…
                    </>
                  ) : (
                    <>
                      <Terminal className="h-3 w-3 mr-1.5" />
                      {info.packageManager} run {script}
                    </>
                  )}
                </Button>
              ))}
            </div>

            {verifyResult && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm">
                  {verifyResult.result.exitCode === 0 ? (
                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                  ) : (
                    <XCircle className="h-4 w-4 text-destructive" />
                  )}
                  <span className="font-medium">
                    {verifyResult.script}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    exit {verifyResult.result.exitCode} ·{" "}
                    {(verifyResult.result.durationMs / 1000).toFixed(1)}s
                  </span>
                </div>
                <OutputBlock
                  stdout={verifyResult.result.stdout}
                  stderr={verifyResult.result.stderr}
                />
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
