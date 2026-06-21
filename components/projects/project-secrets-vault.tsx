"use client";

/**
 * components/projects/project-secrets-vault.tsx
 *
 * Sprint 22: Secrets Vault UI panel.
 *
 * CRITICAL SAFETY RULES:
 *  - Never display raw secret values. Only fingerprints + masked previews.
 *  - Rotate requires user to type "ROTATE" verbatim.
 *  - All mutations call server actions with server-side permission checks.
 *  - Import preview shows fingerprints + redacted values only (parseDotEnv).
 *  - Export downloads key names + metadata only — never values.
 *  - Client-side permission gates are UI-only; server is always authoritative.
 */

import {
  useState,
  useCallback,
  useEffect,
  useTransition,
  useRef,
} from "react";
import {
  KeyRound,
  Plus,
  RefreshCw,
  Loader2,
  X,
  Eye,
  EyeOff,
  RotateCcw,
  Trash2,
  AlertTriangle,
  ShieldCheck,
  ShieldAlert,
  Clock,
  Info,
  Check,
  Download,
  Upload,
  ChevronDown,
  ChevronRight,
  Copy,
  CheckCircle2,
  XCircle,
  Filter,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorBanner } from "@/components/ui/error-state";
import { LoadingState } from "@/components/ui/loading-state";
import {
  PermissionGate,
  PermissionTooltip,
  useHasPermission,
} from "@/components/projects/permission-gate";
import {
  listProjectSecretsAction,
  createProjectSecretAction,
  rotateProjectSecretAction,
  updateProjectSecretMetadataAction,
  deleteProjectSecretAction,
  previewEnvImportAction,
  applyEnvImportAction,
  exportProjectSecretMetadataAction,
  getRequiredSecretsChecklistAction,
  type SecretDTO,
  type PreviewEnvImportEntry,
  type RequiredSecretItem,
  type ExportedSecretMetadata,
} from "@/app/actions/project-secrets";
import { sourceLabel } from "@/lib/secrets/secret-validation";
import type { ProjectRole } from "@/lib/auth/project-permissions";

// ── Environment tabs ──────────────────────────────────────────────────────────

const ENVIRONMENTS = ["production", "staging", "development"] as const;
type Environment = (typeof ENVIRONMENTS)[number];

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function relativeTime(iso: string | null | undefined) {
  if (!iso) return null;
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30)  return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

function downloadJson(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Summary cards ─────────────────────────────────────────────────────────────

interface SummaryCardsProps {
  total:           number;
  enabled:         number;
  required:        number;
  requiredMissing: number;
  lastUpdatedAt:   string | null;
}

function SummaryCards({ total, enabled, required, requiredMissing, lastUpdatedAt }: SummaryCardsProps) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <SummaryCard
        label="Total secrets"
        value={String(total)}
        sub={`${enabled} enabled`}
        icon={<KeyRound className="h-4 w-4" />}
        color="blue"
      />
      <SummaryCard
        label="Required"
        value={String(required)}
        sub={requiredMissing > 0 ? `${requiredMissing} missing` : "All configured"}
        icon={requiredMissing > 0 ? <ShieldAlert className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
        color={requiredMissing > 0 ? "red" : "green"}
      />
      <SummaryCard
        label="Last updated"
        value={relativeTime(lastUpdatedAt) ?? "—"}
        sub={fmt(lastUpdatedAt)}
        icon={<Clock className="h-4 w-4" />}
        color="gray"
      />
      <SummaryCard
        label="Missing required"
        value={String(requiredMissing)}
        sub={requiredMissing === 0 ? "Vault healthy" : "Action needed"}
        icon={requiredMissing > 0 ? <AlertTriangle className="h-4 w-4" /> : <Check className="h-4 w-4" />}
        color={requiredMissing > 0 ? "amber" : "green"}
      />
    </div>
  );
}

function SummaryCard({
  label, value, sub, icon, color,
}: { label: string; value: string; sub: string; icon: React.ReactNode; color: string }) {
  const colors: Record<string, string> = {
    blue:  "bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400",
    red:   "bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-400",
    green: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400",
    amber: "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400",
    gray:  "bg-muted text-muted-foreground",
  };
  return (
    <div className="rounded-lg border bg-card px-4 py-3">
      <div className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium ${colors[color] ?? colors.gray}`}>
        {icon}
        <span className="sr-only">{label}</span>
      </div>
      <p className="mt-2 text-2xl font-semibold tabular-nums leading-none">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{label}</p>
      <p className="text-xs text-muted-foreground/70">{sub}</p>
    </div>
  );
}

// ── Required secrets checklist ────────────────────────────────────────────────

function RequiredChecklist({ items }: { items: RequiredSecretItem[] }) {
  const [open, setOpen] = useState(true);
  if (items.length === 0) return null;

  const missing = items.filter((i) => !i.configured);

  return (
    <div className="rounded-lg border bg-card overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium hover:bg-muted/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          {missing.length > 0
            ? <ShieldAlert className="h-4 w-4 text-amber-500" />
            : <ShieldCheck className="h-4 w-4 text-emerald-500" />
          }
          Required secrets checklist
          {missing.length > 0 && (
            <Badge variant="destructive" className="text-xs">
              {missing.length} missing
            </Badge>
          )}
        </div>
        {open ? <ChevronDown className="h-4 w-4 opacity-60" /> : <ChevronRight className="h-4 w-4 opacity-60" />}
      </button>

      {open && (
        <div className="divide-y border-t">
          {items.map((item) => (
            <div key={item.key} className="flex items-start gap-3 px-4 py-2.5">
              {item.configured
                ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
              }
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm font-medium">{item.key}</span>
                  <Badge variant="outline" className="text-xs">{sourceLabel(item.source)}</Badge>
                </div>
                {item.description && (
                  <p className="text-xs text-muted-foreground mt-0.5">{item.description}</p>
                )}
              </div>
              <span className={`shrink-0 text-xs font-medium ${item.configured ? "text-emerald-600" : "text-red-600"}`}>
                {item.configured ? "Configured" : "Missing"}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Secret row ────────────────────────────────────────────────────────────────

interface SecretRowProps {
  secret:   SecretDTO;
  role:     ProjectRole | null;
  onRotate: (s: SecretDTO) => void;
  onEdit:   (s: SecretDTO) => void;
  onDelete: (s: SecretDTO) => void;
}

function SecretRow({ secret, role, onRotate, onEdit, onDelete }: SecretRowProps) {
  const canManage = useHasPermission(role, "secrets.manage");
  const canRotate = useHasPermission(role, "secrets.rotate");

  const [copied, setCopied] = useState(false);
  function copyFingerprint() {
    if (!secret.fingerprint) return;
    navigator.clipboard.writeText(secret.fingerprint).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div className={`group flex items-center gap-3 px-4 py-3 border-b last:border-b-0 hover:bg-muted/30 transition-colors ${!secret.isEnabled ? "opacity-60" : ""}`}>
      {/* Name + badges */}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-sm font-medium">{secret.name}</span>
          {secret.required && (
            <Badge variant="outline" className="text-xs border-amber-300 text-amber-600 bg-amber-50 dark:bg-amber-950/20">
              Required
            </Badge>
          )}
          {!secret.isEnabled && (
            <Badge variant="secondary" className="text-xs">Disabled</Badge>
          )}
          {secret.source && secret.source !== "manual" && (
            <Badge variant="secondary" className="text-xs">{sourceLabel(secret.source)}</Badge>
          )}
          {secret.isSecret && (
            <Badge variant="outline" className="text-xs">Secret</Badge>
          )}
        </div>
        {secret.description && (
          <p className="mt-0.5 text-xs text-muted-foreground truncate max-w-sm">{secret.description}</p>
        )}
        <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
          {/* Fingerprint */}
          {secret.fingerprint ? (
            <button
              onClick={copyFingerprint}
              className="flex items-center gap-1 font-mono hover:text-foreground transition-colors"
              title="Copy fingerprint"
            >
              {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
              {secret.fingerprint}
            </button>
          ) : (
            <span className="font-mono opacity-50">no fingerprint</span>
          )}
          <span className="opacity-40">·</span>
          {/* Masked value */}
          <span className="font-mono opacity-60">{secret.maskedValue}</span>
          {/* Rotation date */}
          {secret.lastRotatedAt && (
            <>
              <span className="opacity-40">·</span>
              <span title={`Rotated ${fmt(secret.lastRotatedAt)}`}>
                <RotateCcw className="inline h-3 w-3 mr-0.5 opacity-50" />
                {relativeTime(secret.lastRotatedAt)}
              </span>
            </>
          )}
          <span className="opacity-40">·</span>
          <span title={`Updated ${fmt(secret.updatedAt)}`}>
            {relativeTime(secret.updatedAt)}
          </span>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        {canRotate ? (
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => onRotate(secret)}>
            <RotateCcw className="h-3 w-3 mr-1" />
            Rotate
          </Button>
        ) : (
          <PermissionTooltip permission="secrets.rotate">
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" disabled>
              <RotateCcw className="h-3 w-3 mr-1" />
              Rotate
            </Button>
          </PermissionTooltip>
        )}
        {canManage && (
          <>
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => onEdit(secret)}>
              Edit
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
              onClick={() => onDelete(secret)}
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span className="sr-only">Delete</span>
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

// ── Add / Edit secret modal ───────────────────────────────────────────────────

interface AddSecretModalProps {
  projectId:   string;
  environment: string;
  initial?:    SecretDTO | null;   // null = create, set = metadata-edit
  onClose:     () => void;
  onSaved:     () => void;
}

function AddSecretModal({ projectId, environment, initial, onClose, onSaved }: AddSecretModalProps) {
  const isEdit = !!initial;

  const [name,        setName]        = useState(initial?.name ?? "");
  const [value,       setValue]       = useState("");
  const [showValue,   setShowValue]   = useState(false);
  const [desc,        setDesc]        = useState(initial?.description ?? "");
  const [required,    setRequired]    = useState(initial?.required ?? false);
  const [enabled,     setEnabled]     = useState(initial?.isEnabled ?? true);

  const [error, setError]         = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      if (isEdit) {
        // Metadata-only update
        const res = await updateProjectSecretMetadataAction({
          projectId,
          secretId:    initial.id,
          description: desc || null,
          required,
          isEnabled:   enabled,
        });
        if (!res.ok) { setError(res.error); return; }
      } else {
        const res = await createProjectSecretAction({
          projectId,
          name,
          value,
          environment,
          description: desc || undefined,
          required,
          source:      "manual",
        });
        if (!res.ok) { setError(res.error); return; }
      }
      onSaved();
      onClose();
    });
  }

  return (
    <ModalOverlay onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <ModalHeader
          icon={<KeyRound className="h-5 w-5" />}
          title={isEdit ? `Edit "${initial.name}"` : "Add secret"}
          onClose={onClose}
        />

        {!isEdit && (
          <div className="space-y-1.5">
            <Label htmlFor="secret-name">Key name</Label>
            <Input
              id="secret-name"
              placeholder="DATABASE_URL"
              value={name}
              onChange={(e) => setName(e.target.value.toUpperCase().replace(/\s+/g, "_"))}
              className="font-mono"
              required
              autoFocus
            />
            <p className="text-xs text-muted-foreground">Must be UPPER_SNAKE_CASE.</p>
          </div>
        )}

        {!isEdit && (
          <div className="space-y-1.5">
            <Label htmlFor="secret-value">Value</Label>
            <div className="relative">
              <Input
                id="secret-value"
                type={showValue ? "text" : "password"}
                placeholder="Enter secret value…"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                className="font-mono pr-10"
                required
              />
              <button
                type="button"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => setShowValue((v) => !v)}
                tabIndex={-1}
              >
                {showValue ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              Encrypted at rest. Value is never shown or logged after saving.
            </p>
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="secret-desc">Description <span className="text-muted-foreground">(optional)</span></Label>
          <Input
            id="secret-desc"
            placeholder="e.g. Primary database connection"
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            maxLength={200}
          />
        </div>

        <div className="flex items-center gap-3 pt-1">
          <Switch id="secret-required" checked={required} onCheckedChange={setRequired} />
          <Label htmlFor="secret-required" className="cursor-pointer">
            Mark as required
            <span className="ml-1.5 text-xs text-muted-foreground">(appears in checklist)</span>
          </Label>
        </div>

        {isEdit && (
          <div className="flex items-center gap-3">
            <Switch id="secret-enabled" checked={enabled} onCheckedChange={setEnabled} />
            <Label htmlFor="secret-enabled" className="cursor-pointer">
              {enabled ? "Enabled" : "Disabled"}
              <span className="ml-1.5 text-xs text-muted-foreground">(injected into deployments)</span>
            </Label>
          </div>
        )}

        {error && <ErrorBanner error={error} />}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button type="submit" disabled={pending}>
            {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isEdit ? "Save changes" : "Add secret"}
          </Button>
        </div>
      </form>
    </ModalOverlay>
  );
}

// ── Rotate secret modal ───────────────────────────────────────────────────────

interface RotateModalProps {
  projectId: string;
  secret:    SecretDTO;
  onClose:   () => void;
  onRotated: () => void;
}

function RotateModal({ projectId, secret, onClose, onRotated }: RotateModalProps) {
  const [newValue,      setNewValue]      = useState("");
  const [showValue,     setShowValue]     = useState(false);
  const [confirmation,  setConfirmation]  = useState("");
  const [note,          setNote]          = useState("");
  const [result,        setResult]        = useState<{ before: string | null; after: string } | null>(null);
  const [error,         setError]         = useState<string | null>(null);
  const [pending, startTransition]        = useTransition();

  const confirmed = confirmation === "ROTATE";

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await rotateProjectSecretAction({
        projectId,
        secretId:         secret.id,
        newValue,
        confirmationText: confirmation,
        note:             note || undefined,
      });
      if (!res.ok) { setError(res.error); return; }
      setResult({ before: res.data.fingerprintBefore, after: res.data.fingerprintAfter });
    });
  }

  if (result) {
    return (
      <ModalOverlay onClose={onClose}>
        <ModalHeader icon={<RotateCcw className="h-5 w-5 text-emerald-500" />} title="Secret rotated" onClose={onClose} />
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 dark:bg-emerald-950/20 p-3 space-y-1.5 text-sm">
          <p className="font-medium text-emerald-800 dark:text-emerald-300">
            <Check className="inline h-4 w-4 mr-1" />
            {secret.name} has been rotated.
          </p>
          <div className="font-mono text-xs text-muted-foreground space-y-0.5">
            {result.before && <p>Before: {result.before}</p>}
            <p>After:&nbsp; {result.after}</p>
          </div>
        </div>
        <p className="text-sm text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/20 rounded border border-amber-200 dark:border-amber-800 px-3 py-2">
          <AlertTriangle className="inline h-4 w-4 mr-1" />
          Remember to redeploy your project so the new value takes effect.
        </p>
        <div className="flex justify-end pt-2">
          <Button onClick={() => { onRotated(); onClose(); }}>Done</Button>
        </div>
      </ModalOverlay>
    );
  }

  return (
    <ModalOverlay onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <ModalHeader icon={<RotateCcw className="h-5 w-5" />} title={`Rotate "${secret.name}"`} onClose={onClose} />

        <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
          <AlertTriangle className="inline h-4 w-4 mr-1" />
          Rotation replaces the current value. After rotating, you must redeploy to apply the new secret.
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="new-value">New value</Label>
          <div className="relative">
            <Input
              id="new-value"
              type={showValue ? "text" : "password"}
              placeholder="Enter new secret value…"
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              className="font-mono pr-10"
              required
              autoFocus
            />
            <button
              type="button"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              onClick={() => setShowValue((v) => !v)}
              tabIndex={-1}
            >
              {showValue ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="rotate-note">Rotation note <span className="text-muted-foreground">(optional)</span></Label>
          <Input
            id="rotate-note"
            placeholder="e.g. Quarterly rotation, security incident"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={200}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="rotate-confirm">
            Type <span className="font-mono font-semibold">ROTATE</span> to confirm
          </Label>
          <Input
            id="rotate-confirm"
            placeholder="ROTATE"
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            className={`font-mono ${confirmed ? "border-emerald-400" : ""}`}
          />
        </div>

        {error && <ErrorBanner error={error} />}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button
            type="submit"
            variant="destructive"
            disabled={pending || !confirmed || !newValue.trim()}
          >
            {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Rotate secret
          </Button>
        </div>
      </form>
    </ModalOverlay>
  );
}

// ── Delete secret modal ───────────────────────────────────────────────────────

interface DeleteModalProps {
  projectId: string;
  secret:    SecretDTO;
  onClose:   () => void;
  onDeleted: () => void;
}

function DeleteModal({ projectId, secret, onClose, onDeleted }: DeleteModalProps) {
  const [error, setError]         = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleDelete() {
    setError(null);
    startTransition(async () => {
      const res = await deleteProjectSecretAction(projectId, secret.id);
      if (!res.ok) { setError(res.error); return; }
      onDeleted();
      onClose();
    });
  }

  return (
    <ModalOverlay onClose={onClose}>
      <ModalHeader icon={<Trash2 className="h-5 w-5 text-destructive" />} title="Delete secret" onClose={onClose} />
      <p className="text-sm text-muted-foreground">
        Delete <span className="font-mono font-medium text-foreground">{secret.name}</span> from {secret.environment}?
        This cannot be undone. If any running services rely on this key, they will lose access immediately on next deployment.
      </p>
      {error && <ErrorBanner error={error} />}
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" onClick={onClose} disabled={pending}>Cancel</Button>
        <Button variant="destructive" onClick={handleDelete} disabled={pending}>
          {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Delete secret
        </Button>
      </div>
    </ModalOverlay>
  );
}

// ── Import .env modal ─────────────────────────────────────────────────────────

interface ImportModalProps {
  projectId:   string;
  environment: string;
  onClose:     () => void;
  onImported:  (count: number) => void;
}

function ImportModal({ projectId, environment, onClose, onImported }: ImportModalProps) {
  const [step,      setStep]      = useState<"paste" | "preview" | "done">("paste");
  const [content,   setContent]   = useState("");
  const [entries,   setEntries]   = useState<PreviewEnvImportEntry[]>([]);
  const [selected,  setSelected]  = useState<Set<string>>(new Set());
  const [overwrite, setOverwrite] = useState(true);
  const [result,    setResult]    = useState<{ imported: number; skipped: number; overwritten: number } | null>(null);
  const [error,     setError]     = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handlePreview() {
    setError(null);
    startTransition(async () => {
      const res = await previewEnvImportAction({ projectId, content, environment });
      if (!res.ok) { setError(res.error); return; }
      const sel = new Set(res.data.entries.filter((e) => e.selected).map((e) => e.key));
      setEntries(res.data.entries);
      setSelected(sel);
      setStep("preview");
    });
  }

  function handleApply() {
    setError(null);
    startTransition(async () => {
      const res = await applyEnvImportAction({
        projectId,
        content,
        environment,
        selectedKeys:      [...selected],
        overwriteExisting: overwrite,
      });
      if (!res.ok) { setError(res.error); return; }
      setResult(res.data);
      setStep("done");
    });
  }

  function toggleKey(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  const statusColors: Record<string, string> = {
    ok:                  "text-emerald-600",
    conflict:            "text-amber-600",
    blocked_private_key: "text-red-600",
    blocked_binary:      "text-red-600",
    blocked_too_large:   "text-red-600",
    invalid_key:         "text-red-500",
    empty_value:         "text-muted-foreground",
    comment:             "text-muted-foreground",
  };

  return (
    <ModalOverlay onClose={onClose} wide>
      <ModalHeader icon={<Upload className="h-5 w-5" />} title="Import from .env" onClose={onClose} />

      {step === "paste" && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Paste the contents of a <span className="font-mono">.env</span> file below.
            Values are previewed with fingerprints only — never stored during preview.
          </p>
          <Textarea
            placeholder={"DATABASE_URL=postgres://...\nSECRET_KEY=abc123\n# comments are ignored"}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="font-mono text-xs h-48 resize-none"
            autoFocus
          />
          {error && <ErrorBanner error={error} />}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose} disabled={pending}>Cancel</Button>
            <Button onClick={handlePreview} disabled={pending || !content.trim()}>
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Preview import
            </Button>
          </div>
        </div>
      )}

      {step === "preview" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              {entries.length} entries parsed · {selected.size} selected
            </span>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" className="h-7 text-xs"
                onClick={() => setSelected(new Set(entries.filter((e) => e.status === "ok" || e.status === "conflict").map((e) => e.key)))}>
                All
              </Button>
              <Button variant="ghost" size="sm" className="h-7 text-xs"
                onClick={() => setSelected(new Set())}>
                None
              </Button>
            </div>
          </div>

          <div className="rounded-lg border overflow-hidden">
            <div className="max-h-72 overflow-y-auto divide-y">
              {entries.map((entry) => {
                const canSelect = entry.status === "ok" || entry.status === "conflict";
                const isSelected = selected.has(entry.key);
                return (
                  <label
                    key={entry.key}
                    className={`flex items-start gap-3 px-3 py-2 text-sm cursor-pointer hover:bg-muted/30 ${!canSelect ? "opacity-50 cursor-default" : ""}`}
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={isSelected}
                      disabled={!canSelect}
                      onChange={() => canSelect && toggleKey(entry.key)}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-medium">{entry.key}</span>
                        {entry.fingerprint && (
                          <span className="font-mono text-xs text-muted-foreground">{entry.fingerprint}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="font-mono text-xs text-muted-foreground truncate max-w-xs">
                          {entry.redactedPreview}
                        </span>
                        {entry.statusMessage && (
                          <span className={`text-xs ${statusColors[entry.status] ?? "text-muted-foreground"}`}>
                            · {entry.statusMessage}
                          </span>
                        )}
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Switch id="overwrite" checked={overwrite} onCheckedChange={setOverwrite} />
            <Label htmlFor="overwrite" className="cursor-pointer text-sm">
              Overwrite existing secrets
            </Label>
          </div>

          {error && <ErrorBanner error={error} />}

          <div className="flex justify-between gap-2">
            <Button variant="outline" onClick={() => { setStep("paste"); setError(null); }} disabled={pending}>
              Back
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={onClose} disabled={pending}>Cancel</Button>
              <Button onClick={handleApply} disabled={pending || selected.size === 0}>
                {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Import {selected.size} secret{selected.size !== 1 ? "s" : ""}
              </Button>
            </div>
          </div>
        </div>
      )}

      {step === "done" && result && (
        <div className="space-y-4">
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 dark:bg-emerald-950/20 p-4 text-sm space-y-1">
            <p className="font-medium text-emerald-800 dark:text-emerald-300">
              <Check className="inline h-4 w-4 mr-1" />
              Import complete
            </p>
            <ul className="text-xs text-emerald-700 dark:text-emerald-400 space-y-0.5 pl-5 list-disc">
              <li>{result.imported} new secret{result.imported !== 1 ? "s" : ""} added</li>
              {result.overwritten > 0 && <li>{result.overwritten} existing secret{result.overwritten !== 1 ? "s" : ""} updated</li>}
              {result.skipped > 0 && <li>{result.skipped} skipped</li>}
            </ul>
          </div>
          <p className="text-sm text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/20 rounded border border-amber-200 dark:border-amber-800 px-3 py-2">
            <AlertTriangle className="inline h-4 w-4 mr-1" />
            Redeploy your project to apply imported secrets.
          </p>
          <div className="flex justify-end">
            <Button onClick={() => { onImported(result.imported + result.overwritten); onClose(); }}>Done</Button>
          </div>
        </div>
      )}
    </ModalOverlay>
  );
}

// ── Shared modal primitives ───────────────────────────────────────────────────

function ModalOverlay({ children, onClose, wide }: { children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function handleKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={ref}
        className={`bg-background rounded-xl border shadow-xl w-full ${wide ? "max-w-2xl" : "max-w-md"} p-6 space-y-4 max-h-[90vh] overflow-y-auto`}
        role="dialog"
        aria-modal="true"
      >
        {children}
      </div>
    </div>
  );
}

function ModalHeader({ icon, title, onClose }: { icon: React.ReactNode; title: string; onClose: () => void }) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2 font-semibold">
        {icon}
        {title}
      </div>
      <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onClose}>
        <X className="h-4 w-4" />
        <span className="sr-only">Close</span>
      </Button>
    </div>
  );
}

// ── Main vault panel ──────────────────────────────────────────────────────────

interface ProjectSecretsVaultProps {
  projectId: string;
}

export function ProjectSecretsVault({ projectId }: ProjectSecretsVaultProps) {
  const [environment, setEnvironment] = useState<Environment>("production");
  const [role,        setRole]        = useState<ProjectRole | null>(null);
  const [secrets,     setSecrets]     = useState<SecretDTO[]>([]);
  const [summary,     setSummary]     = useState<{ total: number; enabled: number; required: number; requiredMissing: number; lastUpdatedAt: string | null } | null>(null);
  const [checklist,   setChecklist]   = useState<RequiredSecretItem[]>([]);
  const [filter,      setFilter]      = useState("");
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState<string | null>(null);
  const [successMsg,  setSuccessMsg]  = useState<string | null>(null);

  // Modal state
  const [addModal,    setAddModal]    = useState(false);
  const [editTarget,  setEditTarget]  = useState<SecretDTO | null>(null);
  const [rotateTarget, setRotateTarget] = useState<SecretDTO | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SecretDTO | null>(null);
  const [importModal, setImportModal] = useState(false);

  const [exporting, startExportTransition] = useTransition();
  const [refreshing, startRefreshTransition] = useTransition();

  const canManage = useHasPermission(role, "secrets.manage");
  const canRotate = useHasPermission(role, "secrets.rotate");
  const canImport = useHasPermission(role, "secrets.import");
  const canExport = useHasPermission(role, "secrets.export");

  const load = useCallback(async (env: Environment) => {
    setLoading(true);
    setError(null);
    const [listRes, checklistRes] = await Promise.all([
      listProjectSecretsAction(projectId, env),
      getRequiredSecretsChecklistAction(projectId, env),
    ]);
    if (!listRes.ok) { setError(listRes.error); setLoading(false); return; }
    setSecrets(listRes.data.secrets);
    setSummary(listRes.data.summary);
    setRole(listRes.data.role);
    if (checklistRes.ok) setChecklist(checklistRes.data.items);
    setLoading(false);
  }, [projectId]);

  useEffect(() => { load(environment); }, [load, environment]);

  function refresh() {
    startRefreshTransition(async () => { await load(environment); });
  }

  function handleExport() {
    startExportTransition(async () => {
      const res = await exportProjectSecretMetadataAction(projectId, environment);
      if (!res.ok) { setSuccessMsg(null); setError(res.error); return; }
      downloadJson(res.data, `secrets-metadata-${environment}-${new Date().toISOString().slice(0, 10)}.json`);
      showSuccess("Metadata exported (no secret values included).");
    });
  }

  function showSuccess(msg: string) {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(null), 5000);
  }

  const filtered = secrets.filter((s) =>
    filter ? s.name.toLowerCase().includes(filter.toLowerCase()) || (s.description ?? "").toLowerCase().includes(filter.toLowerCase()) : true,
  );

  return (
    <div className="space-y-6">
      {/* Environment tabs */}
      <div className="flex items-center gap-1 rounded-lg border bg-muted/40 p-1 w-fit">
        {ENVIRONMENTS.map((env) => (
          <button
            key={env}
            onClick={() => { setEnvironment(env); setFilter(""); }}
            className={`rounded-md px-3 py-1.5 text-sm font-medium capitalize transition-colors ${
              environment === env
                ? "bg-background shadow-sm text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {env}
          </button>
        ))}
      </div>

      {/* Actions toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1.5 border rounded-md px-3 h-9 bg-background flex-1 min-w-[180px] max-w-xs">
          <Filter className="h-4 w-4 text-muted-foreground shrink-0" />
          <input
            type="text"
            placeholder="Filter secrets…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="bg-transparent text-sm outline-none w-full placeholder:text-muted-foreground"
          />
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={refresh} disabled={refreshing || loading}>
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            <span className="sr-only">Refresh</span>
          </Button>

          {canExport ? (
            <Button variant="outline" size="sm" onClick={handleExport} disabled={exporting}>
              {exporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
              Export metadata
            </Button>
          ) : (
            <PermissionTooltip permission="secrets.export">
              <Button variant="outline" size="sm" disabled>
                <Download className="mr-2 h-4 w-4" />
                Export metadata
              </Button>
            </PermissionTooltip>
          )}

          {canImport ? (
            <Button variant="outline" size="sm" onClick={() => setImportModal(true)}>
              <Upload className="mr-2 h-4 w-4" />
              Import .env
            </Button>
          ) : (
            <PermissionTooltip permission="secrets.import">
              <Button variant="outline" size="sm" disabled>
                <Upload className="mr-2 h-4 w-4" />
                Import .env
              </Button>
            </PermissionTooltip>
          )}

          {canManage ? (
            <Button size="sm" onClick={() => setAddModal(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Add secret
            </Button>
          ) : (
            <PermissionTooltip permission="secrets.manage">
              <Button size="sm" disabled>
                <Plus className="mr-2 h-4 w-4" />
                Add secret
              </Button>
            </PermissionTooltip>
          )}
        </div>
      </div>

      {/* Success banner */}
      {successMsg && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 dark:bg-emerald-950/20 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">
          <Check className="h-4 w-4" />
          {successMsg}
        </div>
      )}

      {/* Error banner */}
      {error && <ErrorBanner error={error} />}

      {/* Loading */}
      {loading && <LoadingState label="Loading secrets…" />}

      {!loading && !error && (
        <div className="space-y-4">
          {/* Summary cards */}
          {summary && (
            <SummaryCards
              total={summary.total}
              enabled={summary.enabled}
              required={summary.required}
              requiredMissing={summary.requiredMissing}
              lastUpdatedAt={summary.lastUpdatedAt}
            />
          )}

          {/* Required checklist */}
          {checklist.length > 0 && <RequiredChecklist items={checklist} />}

          {/* Secrets list */}
          <div className="rounded-lg border bg-card overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 border-b bg-muted/30">
              <span className="text-sm font-medium">
                {filter ? `${filtered.length} of ${secrets.length} secrets` : `${secrets.length} secret${secrets.length !== 1 ? "s" : ""}`}
              </span>
              {filter && (
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setFilter("")}>
                  Clear filter
                </Button>
              )}
            </div>

            {filtered.length === 0 && !filter && (
              <div className="px-4 py-12">
                <EmptyState
                  icon={KeyRound}
                  title="No secrets yet"
                  description={`No secrets configured for ${environment}. Add your first secret or import a .env file.`}
                  actionSlot={canManage ? (
                    <Button size="sm" onClick={() => setAddModal(true)}>
                      <Plus className="mr-2 h-4 w-4" />
                      Add secret
                    </Button>
                  ) : undefined}
                />
              </div>
            )}

            {filtered.length === 0 && filter && (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                No secrets match <span className="font-mono">{filter}</span>
              </div>
            )}

            {filtered.map((s) => (
              <SecretRow
                key={s.id}
                secret={s}
                role={role}
                onRotate={setRotateTarget}
                onEdit={setEditTarget}
                onDelete={setDeleteTarget}
              />
            ))}
          </div>

          {/* Safety note */}
          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
            <Info className="h-3.5 w-3.5 shrink-0" />
            Secret values are encrypted at rest and never displayed, logged, or included in backups.
            Fingerprints (fp_…) identify a value without revealing it.
          </p>
        </div>
      )}

      {/* Modals */}
      {addModal && (
        <AddSecretModal
          projectId={projectId}
          environment={environment}
          onClose={() => setAddModal(false)}
          onSaved={() => { refresh(); showSuccess("Secret added."); }}
        />
      )}

      {editTarget && (
        <AddSecretModal
          projectId={projectId}
          environment={environment}
          initial={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={() => { refresh(); showSuccess("Secret updated."); }}
        />
      )}

      {rotateTarget && (
        <RotateModal
          projectId={projectId}
          secret={rotateTarget}
          onClose={() => setRotateTarget(null)}
          onRotated={() => { refresh(); }}
        />
      )}

      {deleteTarget && (
        <DeleteModal
          projectId={projectId}
          secret={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDeleted={() => { refresh(); showSuccess(`"${deleteTarget.name}" deleted.`); }}
        />
      )}

      {importModal && (
        <ImportModal
          projectId={projectId}
          environment={environment}
          onClose={() => setImportModal(false)}
          onImported={(n) => { refresh(); showSuccess(`${n} secret${n !== 1 ? "s" : ""} imported.`); }}
        />
      )}
    </div>
  );
}
