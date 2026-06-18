"use client";

/**
 * components/projects/project-terminal.tsx
 *
 * Sprint 7: safe project terminal UI.
 *
 * - Preset command buttons based on project context.
 * - Free-form input with safety classification before run.
 * - Confirmation flow for restart/reload.
 * - Output area with copy, exit code, duration.
 * - Session history with re-run.
 *
 * No unrestricted shell. No auto-execution of AI suggestions.
 */

import {
  useState,
  useCallback,
  useRef,
  useEffect,
  useTransition,
} from "react";
import {
  Terminal,
  Play,
  Copy,
  Check,
  AlertTriangle,
  Info,
  Loader2,
  ChevronDown,
  ChevronRight,
  RotateCcw,
  Ban,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Clock,
} from "lucide-react";
import {
  runProjectCommandAction,
  type TerminalBootstrapData,
  type PackageScriptInfo,
  type RunCommandOutput,
} from "@/app/actions/project-terminal";

// ── Types ─────────────────────────────────────────────────────────────────────

interface TerminalEntry {
  id:          string;
  command:     string;
  status:      "running" | "success" | "failed" | "blocked" | "timeout" | "cancelled";
  stdout?:     string;
  stderr?:     string;
  exitCode?:   number | null;
  durationMs?: number;
  reason?:     string;
  cwd?:        string;
}

interface Props {
  projectId:  string;
  bootstrap:  TerminalBootstrapData;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function uid() { return Math.random().toString(36).slice(2, 10); }

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(async () => {
    await navigator.clipboard.writeText(text).catch(() => null);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [text]);
  return (
    <button onClick={copy} title="Copy output"
      className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function StatusIcon({ status }: { status: TerminalEntry["status"] }) {
  if (status === "running")  return <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />;
  if (status === "success")  return <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />;
  if (status === "failed")   return <XCircle className="h-3.5 w-3.5 text-red-500" />;
  if (status === "blocked")  return <Ban className="h-3.5 w-3.5 text-amber-500" />;
  if (status === "timeout")  return <Clock className="h-3.5 w-3.5 text-orange-500" />;
  if (status === "cancelled") return <AlertCircle className="h-3.5 w-3.5 text-muted-foreground" />;
  return null;
}

function RiskBadge({ risk }: { risk: "safe" | "confirm" | "blocked" }) {
  if (risk === "confirm") return (
    <span className="text-[10px] bg-amber-500/10 text-amber-600 rounded px-1.5 py-0.5 font-medium">
      ⚠ confirm
    </span>
  );
  return null;
}

// ── Confirmation dialog ───────────────────────────────────────────────────────

function ConfirmDialog({
  command,
  pm2Name,
  onConfirm,
  onCancel,
}: {
  command:  string;
  pm2Name:  string | null;
  onConfirm: () => void;
  onCancel:  () => void;
}) {
  const isRestart = command.includes("restart");
  const action    = isRestart ? "restart" : "reload";
  return (
    <div className="border border-amber-200/40 rounded-lg bg-amber-50/10 p-4 space-y-3">
      <div className="flex items-start gap-2">
        <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="text-sm font-medium">Confirm {action}</p>
          <p className="text-xs text-muted-foreground">
            This will {action} only{" "}
            <code className="font-mono bg-muted px-1 rounded">{pm2Name ?? "this project"}</code>,
            not all PM2 processes.
          </p>
          <code className="text-xs font-mono bg-muted/80 border border-border rounded px-2 py-1 block mt-2">
            {command}
          </code>
        </div>
      </div>
      <div className="flex gap-2">
        <button onClick={onConfirm}
          className="flex-1 rounded bg-amber-500 text-white text-xs py-1.5 hover:bg-amber-600 transition-colors font-medium"
        >
          Yes, {action} {pm2Name ?? "project"}
        </button>
        <button onClick={onCancel}
          className="flex-1 rounded border border-border text-xs py-1.5 hover:bg-muted transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Output block ──────────────────────────────────────────────────────────────

function OutputBlock({
  entry,
  onRerun,
}: {
  entry:   TerminalEntry;
  onRerun: (cmd: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const hasOutput = (entry.stdout?.trim() || entry.stderr?.trim());
  const fullOutput = [entry.stdout, entry.stderr].filter(Boolean).join("\n").trim();

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      {/* Command header */}
      <div
        className="flex items-center gap-2 px-3 py-2 bg-muted/30 cursor-pointer select-none"
        onClick={() => setExpanded((e) => !e)}
      >
        <StatusIcon status={entry.status} />
        <code className="text-xs font-mono flex-1 truncate">{entry.command}</code>
        <div className="flex items-center gap-2 shrink-0">
          {entry.exitCode !== undefined && entry.exitCode !== null && (
            <span className={`text-[10px] rounded px-1.5 py-0.5 font-mono ${
              entry.exitCode === 0 ? "bg-green-500/10 text-green-600" : "bg-red-500/10 text-red-600"
            }`}>
              exit {entry.exitCode}
            </span>
          )}
          {entry.durationMs !== undefined && (
            <span className="text-[10px] text-muted-foreground">{entry.durationMs}ms</span>
          )}
          {hasOutput && (
            expanded
              ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
              : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
          )}
        </div>
      </div>

      {/* Output */}
      {expanded && (
        <div className="divide-y divide-border">
          {entry.status === "blocked" && entry.reason && (
            <div className="flex items-start gap-2 px-3 py-2 bg-amber-50/10">
              <Ban className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-700">{entry.reason}</p>
            </div>
          )}
          {entry.stdout?.trim() && (
            <div className="relative">
              <pre className="font-mono text-xs p-3 overflow-x-auto whitespace-pre-wrap leading-relaxed text-foreground/90 max-h-96">
                {entry.stdout.trim()}
              </pre>
            </div>
          )}
          {entry.stderr?.trim() && (
            <div className="relative">
              <p className="text-[10px] text-muted-foreground px-3 pt-2 pb-0">stderr:</p>
              <pre className="font-mono text-xs p-3 overflow-x-auto whitespace-pre-wrap leading-relaxed text-red-400 max-h-40">
                {entry.stderr.trim()}
              </pre>
            </div>
          )}
          {hasOutput && (
            <div className="flex items-center justify-between px-3 py-1.5 bg-muted/10">
              <button
                onClick={() => onRerun(entry.command)}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <RotateCcw className="h-3 w-3" /> Re-run
              </button>
              <CopyButton text={fullOutput} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function ProjectTerminal({ projectId, bootstrap }: Props) {
  const { terminal } = bootstrap;
  const [input,         setInput]        = useState("");
  const [entries,       setEntries]      = useState<TerminalEntry[]>([]);
  const [pending,       setPending]      = useState<string | null>(null); // command needing confirm
  const [isPending,     startTransition] = useTransition();
  const [showScripts,   setShowScripts]  = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [entries]);

  const executeCommand = useCallback((command: string, confirmed = false) => {
    if (!command.trim() || isPending) return;

    const entryId = uid();
    setEntries((prev) => [
      ...prev,
      { id: entryId, command, status: "running" },
    ]);
    setInput("");
    setPending(null);

    startTransition(async () => {
      const res = await runProjectCommandAction({ projectId, command, confirmed });
      if (res.ok && res.data) {
        const d = res.data as RunCommandOutput;
        setEntries((prev) => prev.map((e) => e.id === entryId ? {
          ...e,
          status:     d.exitCode === 0 ? "success" : "failed",
          stdout:     d.stdout,
          stderr:     d.stderr,
          exitCode:   d.exitCode,
          durationMs: d.durationMs,
          cwd:        d.cwd,
        } : e));
      } else if (!res.ok) {
        const code  = (res as { ok: false; code?: string }).code;
        const error = (res as { ok: false; error: string }).error;
        if (code === "NEEDS_CONFIRMATION") {
          // Roll back the entry, show confirmation dialog
          setEntries((prev) => prev.filter((e) => e.id !== entryId));
          setPending(command);
        } else {
          setEntries((prev) => prev.map((e) => e.id === entryId ? {
            ...e,
            status: code === "BLOCKED" ? "blocked" : "failed",
            reason: error,
          } : e));
        }
      }
    });
  }, [projectId, isPending]);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    executeCommand(input);
  }, [input, executeCommand]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      executeCommand(input);
    }
  }, [input, executeCommand]);

  const allowedScripts = terminal.packageScripts.filter((s) => s.allowed);
  const pm = terminal.packageManager === "unknown" ? "npm" : terminal.packageManager;

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col flex-1 overflow-hidden">

      {/* ── Context header ── */}
      <div className="border-b bg-muted/10 px-4 py-2 flex flex-wrap items-center gap-4 shrink-0">
        <div className="flex items-center gap-2">
          <Terminal className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">{bootstrap.project.name}</span>
        </div>
        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
          <span title="Working directory">
            cwd: <code className="font-mono bg-muted/80 px-1 rounded">{terminal.cwdLabel}</code>
          </span>
          {terminal.pm2ProcessName && (
            <span>
              PM2: <code className="font-mono bg-muted/80 px-1 rounded">{terminal.pm2ProcessName}</code>
            </span>
          )}
          {terminal.port && (
            <span>
              Port: <code className="font-mono bg-muted/80 px-1 rounded">{terminal.port}</code>
            </span>
          )}
          <span>
            pkg: <code className="font-mono bg-muted/80 px-1 rounded">{terminal.packageManager}</code>
          </span>
        </div>
      </div>

      {/* ── No editable root ── */}
      {!terminal.hasEditableRoot && (
        <div className="flex flex-col items-center justify-center flex-1 gap-4 p-8 text-center">
          <Terminal className="h-10 w-10 text-muted-foreground/20" />
          <div className="space-y-2 max-w-sm">
            <p className="font-medium text-sm">No editable project source found</p>
            <p className="text-sm text-muted-foreground">
              Import or deploy project source before using the terminal.
            </p>
          </div>
        </div>
      )}

      {terminal.hasEditableRoot && (
        <>
          {/* ── Preset buttons ── */}
          <div className="border-b px-4 py-2.5 space-y-2 shrink-0">
            <div className="flex flex-wrap gap-1.5">
              {terminal.presets.map((preset) => (
                <button
                  key={preset.command}
                  onClick={() =>
                    preset.risk === "confirm"
                      ? setPending(preset.command)
                      : executeCommand(preset.command)
                  }
                  disabled={isPending}
                  className={`inline-flex items-center gap-1 rounded px-2 py-1 text-xs border transition-colors disabled:opacity-40 ${
                    preset.risk === "confirm"
                      ? "border-amber-200/60 bg-amber-50/10 text-amber-700 hover:bg-amber-100/20"
                      : "border-border bg-background hover:bg-muted text-foreground/80 hover:text-foreground"
                  }`}
                  title={preset.command}
                >
                  {preset.risk === "confirm" && <AlertTriangle className="h-2.5 w-2.5" />}
                  {preset.label}
                </button>
              ))}
            </div>

            {/* Package scripts toggle */}
            {allowedScripts.length > 0 && (
              <div>
                <button
                  onClick={() => setShowScripts((s) => !s)}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showScripts ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                  Package scripts ({allowedScripts.length})
                </button>
                {showScripts && (
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {allowedScripts.map((script) => (
                      <button
                        key={script.name}
                        onClick={() => executeCommand(`${pm} run ${script.name}`)}
                        disabled={isPending}
                        className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs border border-border bg-background hover:bg-muted text-foreground/80 hover:text-foreground transition-colors disabled:opacity-40"
                        title={`${pm} run ${script.name} → ${script.command}`}
                      >
                        <Play className="h-2.5 w-2.5" />
                        {script.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Confirmation dialog ── */}
          {pending && (
            <div className="px-4 py-3 border-b shrink-0">
              <ConfirmDialog
                command={pending}
                pm2Name={terminal.pm2ProcessName}
                onConfirm={() => executeCommand(pending, true)}
                onCancel={() => setPending(null)}
              />
            </div>
          )}

          {/* ── Output area ── */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2 min-h-0">
            {entries.length === 0 && !isPending && (
              <div className="flex flex-col items-center justify-center h-full gap-3 text-center text-muted-foreground">
                <Terminal className="h-8 w-8 opacity-20" />
                <p className="text-sm">
                  Select a preset or type a command below.
                </p>
                <div className="text-xs space-y-0.5 bg-muted/40 rounded p-3 text-left max-w-xs">
                  <p className="font-medium text-foreground mb-1">Allowed commands:</p>
                  <p>pwd, ls, cat &lt;file&gt;, find . -name …</p>
                  <p>pnpm/npm/yarn run &lt;script&gt;</p>
                  <p>node --version, node &lt;script.js&gt;</p>
                  <p>pm2 status/logs/restart/reload</p>
                </div>
              </div>
            )}
            {entries.map((entry) => (
              <OutputBlock
                key={entry.id}
                entry={entry}
                onRerun={(cmd) => {
                  setInput(cmd);
                  inputRef.current?.focus();
                }}
              />
            ))}
            <div ref={bottomRef} />
          </div>

          {/* ── Input bar ── */}
          <div className="border-t px-4 py-2.5 shrink-0">
            <form onSubmit={handleSubmit} className="flex gap-2 items-center">
              <span className="text-muted-foreground text-sm font-mono shrink-0">$</span>
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="pwd | ls | cat package.json | pnpm run typecheck | pm2 status …"
                disabled={isPending}
                className="flex-1 rounded border border-border bg-muted/30 font-mono text-sm px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50 placeholder:text-muted-foreground/50"
                spellCheck={false}
                autoComplete="off"
                autoCapitalize="off"
              />
              <button
                type="submit"
                disabled={isPending || !input.trim()}
                className="shrink-0 rounded bg-primary text-primary-foreground px-3 py-1.5 text-sm hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              </button>
            </form>
            <p className="mt-1 text-[10px] text-muted-foreground">
              Enter to run · Commands run inside the project source directory · No unrestricted shell access
            </p>
          </div>
        </>
      )}
    </div>
  );
}
