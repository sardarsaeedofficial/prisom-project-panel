"use client";

/**
 * components/projects/project-backups-panel.tsx
 *
 * Sprint 21: Project backups, snapshots, and disaster recovery UI.
 *
 * Features:
 *  - List backups with status, type, size, file count
 *  - Create backup modal (label + include-env-keys option)
 *  - Detail modal with manifest info and checksum
 *  - Restore confirmation modal (requires typing "RESTORE")
 *  - Delete confirmation modal
 *  - Download link (permissions enforced server-side on route)
 *
 * Security:
 *  - All mutations call server actions that enforce permissions server-side.
 *  - Client-side permission checks are UI-only and never replace server guards.
 *  - Restore requires the user to type "RESTORE" verbatim.
 *  - No secrets or env values are ever displayed.
 */

import {
  useState,
  useCallback,
  useEffect,
  useTransition,
  useRef,
} from "react";
import {
  Archive,
  Plus,
  RefreshCw,
  Loader2,
  X,
  Download,
  RotateCcw,
  Trash2,
  AlertTriangle,
  ShieldCheck,
  Clock,
  Info,
  Check,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorBanner } from "@/components/ui/error-state";
import { LoadingState } from "@/components/ui/loading-state";
import {
  PermissionGate,
  PermissionTooltip,
  useHasPermission,
} from "@/components/projects/permission-gate";
import {
  createProjectBackupAction,
  listProjectBackupsAction,
  getProjectBackupDetailAction,
  restoreProjectBackupAction,
  deleteProjectBackupAction,
} from "@/app/actions/project-backups";
import type { ProjectBackupDTO } from "@/lib/backups/project-backup-types";
import type { ProjectRole } from "@/lib/auth/project-permissions";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

type Props = {
  projectId: string;
};

// ── Formatting helpers ────────────────────────────────────────────────────────

function formatBytes(bytes: number | null): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: ProjectBackupDTO["status"] }) {
  const styles: Record<ProjectBackupDTO["status"], string> = {
    creating:  "bg-blue-100 text-blue-800 border-blue-200",
    ready:     "bg-green-100 text-green-800 border-green-200",
    failed:    "bg-red-100 text-red-800 border-red-200",
    restoring: "bg-yellow-100 text-yellow-800 border-yellow-200",
    restored:  "bg-purple-100 text-purple-800 border-purple-200",
    deleted:   "bg-gray-100 text-gray-500 border-gray-200",
  };
  const labels: Record<ProjectBackupDTO["status"], string> = {
    creating:  "Creating",
    ready:     "Ready",
    failed:    "Failed",
    restoring: "Restoring",
    restored:  "Restored",
    deleted:   "Deleted",
  };
  return (
    <span className={cn("inline-flex text-xs font-medium px-2 py-0.5 rounded-full border", styles[status])}>
      {labels[status]}
    </span>
  );
}

// ── Backup type label ─────────────────────────────────────────────────────────

function BackupTypeBadge({ type }: { type: ProjectBackupDTO["backupType"] }) {
  const styles: Record<ProjectBackupDTO["backupType"], string> = {
    manual:      "bg-slate-100 text-slate-700 border-slate-200",
    pre_restore: "bg-amber-100 text-amber-800 border-amber-200",
    system:      "bg-cyan-100 text-cyan-800 border-cyan-200",
    scheduled:   "bg-violet-100 text-violet-800 border-violet-200",
  };
  const labels: Record<ProjectBackupDTO["backupType"], string> = {
    manual:      "Manual",
    pre_restore: "Pre-restore",
    system:      "System",
    scheduled:   "Scheduled",
  };
  return (
    <span className={cn("inline-flex text-xs font-medium px-2 py-0.5 rounded-full border", styles[type])}>
      {labels[type]}
    </span>
  );
}

// ── Create modal ──────────────────────────────────────────────────────────────

function CreateBackupModal({
  projectId,
  onClose,
  onCreated,
}: {
  projectId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [label, setLabel] = useState("");
  const [includeEnvKeys, setIncludeEnvKeys] = useState(true);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await createProjectBackupAction({
        projectId,
        label: label.trim() || undefined,
        includeEnvKeys,
      });
      if (!res.ok) {
        setError(res.error);
      } else {
        onCreated();
        onClose();
      }
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-background rounded-xl border shadow-lg w-full max-w-md">
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex items-center gap-2">
            <Archive className="h-4 w-4 text-muted-foreground" />
            <span className="font-semibold text-sm">Create Backup</span>
          </div>
          <button onClick={onClose} className="rounded-md p-1 hover:bg-muted" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="backup-label">Label <span className="text-muted-foreground font-normal">(optional)</span></Label>
            <Input
              id="backup-label"
              placeholder="e.g. Before v2 migration"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              maxLength={120}
              disabled={isPending}
            />
          </div>

          <div className="flex items-start gap-3 p-3 rounded-lg border bg-muted/30">
            <Switch
              id="include-env-keys"
              checked={includeEnvKeys}
              onCheckedChange={setIncludeEnvKeys}
              disabled={isPending}
              className="mt-0.5"
            />
            <div className="space-y-0.5">
              <Label htmlFor="include-env-keys" className="cursor-pointer">
                Include environment variable key names
              </Label>
              <p className="text-xs text-muted-foreground">
                Saves key names (never values) in the backup for reference.
                Values are always excluded — they are never backed up.
              </p>
            </div>
          </div>

          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 space-y-1">
            <div className="flex items-center gap-1.5 font-medium">
              <ShieldCheck className="h-3.5 w-3.5" />
              Safety guarantees
            </div>
            <ul className="list-disc list-inside space-y-0.5 pl-1">
              <li>No <code className="bg-amber-100 px-1 rounded">.env</code> files or secret values are ever included</li>
              <li>node_modules, .next, .git are excluded</li>
              <li>Max 5,000 files · 250 MB source · 10 MB per file</li>
            </ul>
          </div>

          {error && <ErrorBanner error={error} />}

          <div className="flex items-center justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                  Creating…
                </>
              ) : (
                <>
                  <Archive className="h-4 w-4 mr-1.5" />
                  Create Backup
                </>
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Detail modal ──────────────────────────────────────────────────────────────

function BackupDetailModal({
  projectId,
  backupId,
  role,
  onClose,
  onRestore,
  onDelete,
}: {
  projectId: string;
  backupId: string;
  role: ProjectRole | null;
  onClose: () => void;
  onRestore: (backup: ProjectBackupDTO) => void;
  onDelete: (backup: ProjectBackupDTO) => void;
}) {
  const [backup, setBackup] = useState<ProjectBackupDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const canRestore = useHasPermission(role, "backup.restore");
  const canDelete = useHasPermission(role, "backup.delete");
  const canDownload = useHasPermission(role, "backup.download");

  useEffect(() => {
    setLoading(true);
    getProjectBackupDetailAction({ projectId, backupId }).then((res) => {
      if (res.ok) setBackup(res.data);
      else setError(res.error);
      setLoading(false);
    });
  }, [projectId, backupId]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-background rounded-xl border shadow-lg w-full max-w-2xl max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b sticky top-0 bg-background z-10">
          <div className="flex items-center gap-2">
            <Archive className="h-4 w-4 text-muted-foreground" />
            <span className="font-semibold text-sm">Backup Details</span>
          </div>
          <button onClick={onClose} className="rounded-md p-1 hover:bg-muted" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-4 text-sm space-y-4">
          {loading && <LoadingState label="Loading backup details…" />}
          {error && <ErrorBanner error={error} />}

          {backup && (
            <>
              {/* Header row */}
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={backup.status} />
                <BackupTypeBadge type={backup.backupType} />
                {backup.label && (
                  <span className="font-medium">{backup.label}</span>
                )}
              </div>

              {/* Metadata grid */}
              <div className="grid grid-cols-2 gap-3 text-xs">
                <InfoRow label="Backup ref" value={backup.backupRef} mono />
                <InfoRow label="Created" value={formatDate(backup.createdAt)} />
                <InfoRow label="Completed" value={formatDate(backup.completedAt)} />
                <InfoRow label="Created by" value={backup.createdByName ?? "system"} />
                <InfoRow label="File count" value={backup.fileCount?.toLocaleString() ?? "—"} />
                <InfoRow label="Archive size" value={formatBytes(backup.sizeBytes)} />
                <InfoRow label="Restore count" value={String(backup.restoreCount)} />
                <InfoRow label="Last restored" value={formatDate(backup.lastRestoredAt)} />
              </div>

              {/* Contents */}
              <div className="space-y-1.5">
                <p className="font-medium text-xs text-muted-foreground uppercase tracking-wide">Contents</p>
                <div className="flex flex-wrap gap-2">
                  {backup.includesSource && <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border bg-green-50 text-green-700 border-green-200"><Check className="h-3 w-3" />Source files</span>}
                  {backup.includesConfig && <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border bg-green-50 text-green-700 border-green-200"><Check className="h-3 w-3" />Config</span>}
                  {backup.includesEnvKeys && <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border bg-green-50 text-green-700 border-green-200"><Check className="h-3 w-3" />Env key names</span>}
                  {!backup.includesSecrets && <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border bg-red-50 text-red-700 border-red-200"><X className="h-3 w-3" />No secrets</span>}
                </div>
              </div>

              {/* Checksum */}
              {backup.checksumShort && (
                <div className="space-y-1.5">
                  <p className="font-medium text-xs text-muted-foreground uppercase tracking-wide">Archive integrity</p>
                  <p className="font-mono text-xs bg-muted px-2 py-1 rounded">
                    SHA-256 <span className="text-muted-foreground">prefix:</span> {backup.checksumShort}…
                  </p>
                </div>
              )}

              {/* Last error */}
              {backup.lastError && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">
                  <p className="font-medium mb-1">Last error</p>
                  <p className="font-mono break-all">{backup.lastError}</p>
                </div>
              )}

              {/* Restore warning */}
              {backup.status === "ready" && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 space-y-1">
                  <div className="flex items-center gap-1.5 font-medium">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    Before restoring
                  </div>
                  <ul className="list-disc list-inside space-y-0.5 pl-1">
                    <li>A pre-restore snapshot of the current state is created automatically</li>
                    <li>The project will NOT be automatically redeployed</li>
                    <li>You must trigger a new deploy manually from the Publishing tab</li>
                    <li>Env variables are not restored — only source files are replaced</li>
                  </ul>
                </div>
              )}

              {/* Actions */}
              <div className="flex flex-wrap items-center gap-2 pt-2 border-t">
                {/* Download */}
                {canDownload ? (
                  <a
                    href={`/projects/${projectId}/backups/${backup.id}/download`}
                    download
                    className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md border hover:bg-muted transition-colors"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Download .zip
                  </a>
                ) : (
                  <PermissionTooltip permission="backup.download">
                    <button
                      disabled
                      className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md border opacity-50 cursor-not-allowed"
                    >
                      <Download className="h-3.5 w-3.5" />
                      Download .zip
                    </button>
                  </PermissionTooltip>
                )}

                {/* Restore */}
                {backup.status === "ready" && (
                  canRestore ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-amber-300 text-amber-800 hover:bg-amber-50"
                      onClick={() => { onClose(); onRestore(backup); }}
                    >
                      <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                      Restore
                    </Button>
                  ) : (
                    <PermissionTooltip permission="backup.restore">
                      <Button size="sm" variant="outline" disabled>
                        <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                        Restore
                      </Button>
                    </PermissionTooltip>
                  )
                )}

                {/* Delete */}
                {canDelete ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive hover:bg-destructive/10 ml-auto"
                    onClick={() => { onClose(); onDelete(backup); }}
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                    Delete
                  </Button>
                ) : (
                  <PermissionTooltip permission="backup.delete">
                    <Button size="sm" variant="ghost" disabled className="ml-auto">
                      <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                      Delete
                    </Button>
                  </PermissionTooltip>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function InfoRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="space-y-0.5">
      <p className="text-muted-foreground">{label}</p>
      <p className={cn("font-medium break-all", mono && "font-mono")}>{value}</p>
    </div>
  );
}

// ── Restore confirmation modal ─────────────────────────────────────────────────

function RestoreConfirmModal({
  projectId,
  backup,
  onClose,
  onRestored,
}: {
  projectId: string;
  backup: ProjectBackupDTO;
  onClose: () => void;
  onRestored: (preRestoreRef: string | null) => void;
}) {
  const [confirmText, setConfirmText] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  function handleRestore() {
    setError(null);
    startTransition(async () => {
      const res = await restoreProjectBackupAction({
        projectId,
        backupId: backup.id,
        confirmationText: confirmText,
      });
      if (!res.ok) {
        setError(res.error);
      } else {
        onRestored(res.data.preRestoreBackupRef);
        onClose();
      }
    });
  }

  const confirmed = confirmText === "RESTORE";

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget && !isPending) onClose(); }}
    >
      <div className="bg-background rounded-xl border shadow-lg w-full max-w-lg">
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            <span className="font-semibold text-sm">Confirm Restore</span>
          </div>
          <button onClick={onClose} disabled={isPending} className="rounded-md p-1 hover:bg-muted" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-4 space-y-4 text-sm">
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-2 text-amber-900">
            <p className="font-semibold">This will replace all project source files.</p>
            <ul className="list-disc list-inside space-y-0.5 text-xs pl-1">
              <li>A pre-restore snapshot is created automatically before any changes</li>
              <li>The project will NOT be automatically redeployed after restore</li>
              <li>You must trigger a new deployment manually from Publishing</li>
              <li>Env variables and secrets are NOT affected by restore</li>
            </ul>
          </div>

          <div className="p-3 rounded-lg border bg-muted/30 space-y-1">
            <p className="text-xs text-muted-foreground">Restoring from:</p>
            <p className="font-mono text-xs font-medium">{backup.backupRef}</p>
            {backup.label && <p className="text-xs text-muted-foreground">{backup.label}</p>}
            <p className="text-xs text-muted-foreground">{formatDate(backup.createdAt)} · {backup.fileCount?.toLocaleString() ?? "?"} files · {formatBytes(backup.sizeBytes)}</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="restore-confirm">
              Type <span className="font-mono font-bold">RESTORE</span> to confirm
            </Label>
            <Input
              ref={inputRef}
              id="restore-confirm"
              placeholder="RESTORE"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              disabled={isPending}
              className={cn(
                "font-mono",
                confirmText && !confirmed && "border-red-300 focus-visible:ring-red-300",
                confirmed && "border-green-400 focus-visible:ring-green-300",
              )}
            />
          </div>

          {error && <ErrorBanner error={error} />}

          <div className="flex items-center justify-end gap-2 pt-1">
            <Button variant="outline" onClick={onClose} disabled={isPending}>
              Cancel
            </Button>
            <Button
              onClick={handleRestore}
              disabled={!confirmed || isPending}
              className="bg-amber-600 hover:bg-amber-700 text-white"
            >
              {isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                  Restoring…
                </>
              ) : (
                <>
                  <RotateCcw className="h-4 w-4 mr-1.5" />
                  Restore Project
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Delete confirmation modal ─────────────────────────────────────────────────

function DeleteConfirmModal({
  projectId,
  backup,
  onClose,
  onDeleted,
}: {
  projectId: string;
  backup: ProjectBackupDTO;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  function handleDelete() {
    setError(null);
    startTransition(async () => {
      const res = await deleteProjectBackupAction({ projectId, backupId: backup.id });
      if (!res.ok) {
        setError(res.error);
      } else {
        onDeleted();
        onClose();
      }
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget && !isPending) onClose(); }}
    >
      <div className="bg-background rounded-xl border shadow-lg w-full max-w-md">
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex items-center gap-2">
            <Trash2 className="h-4 w-4 text-destructive" />
            <span className="font-semibold text-sm">Delete Backup</span>
          </div>
          <button onClick={onClose} disabled={isPending} className="rounded-md p-1 hover:bg-muted" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-4 space-y-4 text-sm">
          <p className="text-muted-foreground">
            This backup and its archive file will be permanently deleted. This action cannot be undone.
          </p>

          <div className="p-3 rounded-lg border bg-muted/30 text-xs space-y-1">
            <p className="font-mono font-medium">{backup.backupRef}</p>
            {backup.label && <p className="text-muted-foreground">{backup.label}</p>}
            <p className="text-muted-foreground">{formatDate(backup.createdAt)} · {formatBytes(backup.sizeBytes)}</p>
          </div>

          {error && <ErrorBanner error={error} />}

          <div className="flex items-center justify-end gap-2 pt-1">
            <Button variant="outline" onClick={onClose} disabled={isPending}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={isPending}
            >
              {isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                  Deleting…
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4 mr-1.5" />
                  Delete Backup
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Backup list row ───────────────────────────────────────────────────────────

function BackupRow({
  backup,
  onClick,
}: {
  backup: ProjectBackupDTO;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left flex items-center gap-3 p-3 rounded-lg border bg-background hover:bg-muted/50 transition-colors group"
    >
      <Archive className="h-4 w-4 text-muted-foreground flex-shrink-0" />

      <div className="flex-1 min-w-0 space-y-0.5">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={backup.status} />
          <BackupTypeBadge type={backup.backupType} />
          {backup.label && (
            <span className="text-xs font-medium truncate">{backup.label}</span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          <span className="font-mono">{backup.backupRef}</span>
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {timeAgo(backup.createdAt)}
          </span>
          {backup.fileCount !== null && <span>{backup.fileCount.toLocaleString()} files</span>}
          {backup.sizeBytes !== null && <span>{formatBytes(backup.sizeBytes)}</span>}
        </div>
      </div>

      <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
    </button>
  );
}

// ── Success banner ────────────────────────────────────────────────────────────

function SuccessBanner({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss: () => void;
}) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, 6000);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
      <div className="flex items-center gap-2">
        <Check className="h-4 w-4 flex-shrink-0" />
        <span>{message}</span>
      </div>
      <button onClick={onDismiss} className="text-green-600 hover:text-green-900">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// ── Restore note ──────────────────────────────────────────────────────────────

function RestoreSuccessNote({ preRestoreRef }: { preRestoreRef: string }) {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm space-y-1.5">
      <div className="flex items-center gap-1.5 font-medium text-amber-900">
        <Info className="h-4 w-4" />
        Restore complete — next steps required
      </div>
      <ul className="list-disc list-inside text-xs text-amber-800 space-y-0.5 pl-1">
        <li>Source files have been restored. The project has NOT been redeployed.</li>
        <li>Go to the <strong>Publishing</strong> tab and trigger a new deployment.</li>
        <li>A pre-restore snapshot was saved: <code className="bg-amber-100 px-1 rounded font-mono">{preRestoreRef}</code></li>
      </ul>
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export function ProjectBackupsPanel({ projectId }: Props) {
  const [backups, setBackups] = useState<ProjectBackupDTO[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, startRefresh] = useTransition();
  // Role is resolved from the list action response — initialized to null
  const [role, setRole] = useState<ProjectRole | null>(null);

  // Modal state
  const [showCreate, setShowCreate] = useState(false);
  const [detailBackupId, setDetailBackupId] = useState<string | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<ProjectBackupDTO | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ProjectBackupDTO | null>(null);

  // Feedback
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [preRestoreRef, setPreRestoreRef] = useState<string | null>(null);

  const canCreate = useHasPermission(role, "backup.create");

  const load = useCallback(
    (p: number) => {
      setError(null);
      startRefresh(async () => {
        setLoading(true);
        const res = await listProjectBackupsAction({ projectId, page: p, pageSize: 20 });
        if (res.ok) {
          setBackups(res.data.backups);
          setTotal(res.data.total);
          setPage(res.data.page);
          setTotalPages(res.data.totalPages);
          // Set role from the server response (used for client-side permission gates only)
          setRole(res.data.role);
        } else {
          setError(res.error);
        }
        setLoading(false);
      });
    },
    [projectId],
  );

  useEffect(() => {
    load(1);
  }, [load]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2">
            <Archive className="h-4 w-4 text-muted-foreground" />
            Backups & Snapshots
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Point-in-time archives of your project source files and configuration.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => load(page)}
            disabled={isRefreshing || loading}
            aria-label="Refresh"
          >
            <RefreshCw className={cn("h-4 w-4", (isRefreshing || loading) && "animate-spin")} />
          </Button>

          {canCreate ? (
            <Button size="sm" onClick={() => setShowCreate(true)}>
              <Plus className="h-4 w-4 mr-1.5" />
              Create Backup
            </Button>
          ) : (
            <PermissionTooltip permission="backup.create">
              <Button size="sm" disabled>
                <Plus className="h-4 w-4 mr-1.5" />
                Create Backup
              </Button>
            </PermissionTooltip>
          )}
        </div>
      </div>

      {/* Success feedback */}
      {successMsg && (
        <SuccessBanner message={successMsg} onDismiss={() => setSuccessMsg(null)} />
      )}

      {/* Post-restore next-steps note */}
      {preRestoreRef && (
        <RestoreSuccessNote preRestoreRef={preRestoreRef} />
      )}

      {/* Error */}
      {error && <ErrorBanner error={error} />}

      {/* Loading */}
      {loading && !backups.length && <LoadingState label="Loading backups…" />}

      {/* Empty state */}
      {!loading && !error && backups.length === 0 && (
        <EmptyState
          icon={Archive}
          title="No backups yet"
          description="Create your first backup to save a point-in-time snapshot of your project."
          action={canCreate ? {
            label: "Create Backup",
            onClick: () => setShowCreate(true),
          } : undefined}
        />
      )}

      {/* Backup list */}
      {backups.length > 0 && (
        <div className="space-y-2">
          {backups.map((b) => (
            <BackupRow
              key={b.id}
              backup={b}
              onClick={() => setDetailBackupId(b.id)}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-muted-foreground pt-1">
          <span>{total} backup{total !== 1 ? "s" : ""} total</span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => load(page - 1)}
              disabled={page <= 1 || loading}
            >
              Previous
            </Button>
            <span>Page {page} of {totalPages}</span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => load(page + 1)}
              disabled={page >= totalPages || loading}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      {/* Info footer */}
      <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground space-y-1">
        <div className="flex items-center gap-1.5 font-medium text-foreground">
          <ShieldCheck className="h-3.5 w-3.5 text-green-600" />
          Security guarantees
        </div>
        <ul className="list-disc list-inside space-y-0.5 pl-1">
          <li>Backups never contain <code>.env</code> files or secret values</li>
          <li>node_modules, .next, .git directories are always excluded</li>
          <li>A pre-restore snapshot is always taken before any restore operation</li>
          <li>Restoring does not trigger an automatic redeployment</li>
        </ul>
      </div>

      {/* Modals */}
      {showCreate && (
        <CreateBackupModal
          projectId={projectId}
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setSuccessMsg("Backup created successfully.");
            load(1);
          }}
        />
      )}

      {detailBackupId && (
        <BackupDetailModal
          projectId={projectId}
          backupId={detailBackupId}
          role={role}
          onClose={() => setDetailBackupId(null)}
          onRestore={(b) => setRestoreTarget(b)}
          onDelete={(b) => setDeleteTarget(b)}
        />
      )}

      {restoreTarget && (
        <RestoreConfirmModal
          projectId={projectId}
          backup={restoreTarget}
          onClose={() => setRestoreTarget(null)}
          onRestored={(ref) => {
            setPreRestoreRef(ref);
            setSuccessMsg("Project restored successfully. Deploy manually to apply changes.");
            load(1);
          }}
        />
      )}

      {deleteTarget && (
        <DeleteConfirmModal
          projectId={projectId}
          backup={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDeleted={() => {
            setSuccessMsg("Backup deleted.");
            load(1);
          }}
        />
      )}
    </div>
  );
}
