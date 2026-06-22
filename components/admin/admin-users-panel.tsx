"use client";

import { useState, useTransition } from "react";
import { UserRole } from "@prisma/client";
import {
  UserPlus,
  RotateCcw,
  ShieldCheck,
  UserCheck,
  UserX,
  RefreshCw,
  Eye,
  EyeOff,
  Link2,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";
import { cn }                            from "@/lib/utils";
import type { UserDTO }                  from "@/lib/auth/user-management";
import {
  listUsersAction,
  createUserAction,
  updateUserRoleAction,
  resetUserPasswordAction,
  verifyUserEmailAction,
  disableUserAction,
  reactivateUserAction,
  generateAdminResetLinkAction,
}                                        from "@/app/actions/admin-users";

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtRelative(iso: string | null): string {
  if (!iso) return "—";
  const ms  = Date.now() - new Date(iso).getTime();
  if (ms < 60_000)    return "just now";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return new Date(iso).toLocaleDateString();
}

function roleBadge(role: UserRole) {
  const map: Record<UserRole, string> = {
    OWNER:  "bg-purple-100 text-purple-800 border-purple-200",
    ADMIN:  "bg-blue-100   text-blue-800   border-blue-200",
    MEMBER: "bg-gray-100   text-gray-700   border-gray-200",
  };
  return (
    <span className={cn(
      "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border",
      map[role],
    )}>
      {role}
    </span>
  );
}

// ── Password input ────────────────────────────────────────────────────────────

function PasswordInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input
        type={show ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? "••••••••••"}
        autoComplete="new-password"
        className="w-full rounded-md border bg-background px-3 py-1.5 text-sm pr-9 focus:outline-none focus:ring-1 focus:ring-primary"
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
        tabIndex={-1}
      >
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

// ── Inline error/success ──────────────────────────────────────────────────────

function Feedback({ error, success }: { error?: string; success?: string }) {
  if (error)   return <p className="text-xs text-red-600 mt-1">{error}</p>;
  if (success) return <p className="text-xs text-green-600 mt-1">{success}</p>;
  return null;
}

// ── Create User modal ─────────────────────────────────────────────────────────

function CreateUserModal({
  onClose,
  onCreated,
  actorRole,
}: {
  onClose:   () => void;
  onCreated: (u: UserDTO) => void;
  actorRole: UserRole;
}) {
  const [email,         setEmail]         = useState("");
  const [name,          setName]          = useState("");
  const [role,          setRole]          = useState<UserRole>(UserRole.MEMBER);
  const [password,      setPassword]      = useState("");
  const [emailVerified, setEmailVerified] = useState(true);
  const [error,         setError]         = useState("");
  const [isPending, startTransition]      = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    startTransition(async () => {
      const res = await createUserAction({ email, name, role, password, emailVerified });
      if (res.ok) {
        onCreated(res.data);
        onClose();
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-card rounded-lg border shadow-xl w-full max-w-md p-6 space-y-4">
        <h2 className="text-base font-semibold">Create User</h2>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Email *</label>
            <input
              type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
              className="mt-0.5 w-full rounded-md border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              placeholder="user@example.com"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Name</label>
            <input
              type="text" value={name} onChange={(e) => setName(e.target.value)}
              className="mt-0.5 w-full rounded-md border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              placeholder="Full name"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Role</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as UserRole)}
              className="mt-0.5 w-full rounded-md border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value={UserRole.MEMBER}>MEMBER</option>
              <option value={UserRole.ADMIN}>ADMIN</option>
              {actorRole === UserRole.OWNER && (
                <option value={UserRole.OWNER}>OWNER</option>
              )}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Password *</label>
            <div className="mt-0.5">
              <PasswordInput value={password} onChange={setPassword} />
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Min 10 chars, upper, lower, number, symbol recommended.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              id="ev" type="checkbox" checked={emailVerified}
              onChange={(e) => setEmailVerified(e.target.checked)}
              className="rounded border"
            />
            <label htmlFor="ev" className="text-xs font-medium">Mark email as verified</label>
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose}
              className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent">
              Cancel
            </button>
            <button type="submit" disabled={isPending}
              className="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm disabled:opacity-50">
              {isPending ? "Creating…" : "Create user"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Reset password modal ──────────────────────────────────────────────────────

function ResetPasswordModal({
  user,
  onClose,
}: {
  user:    UserDTO;
  onClose: () => void;
}) {
  const [password,   setPassword]   = useState("");
  const [error,      setError]      = useState("");
  const [success,    setSuccess]    = useState("");
  const [resetLink,  setResetLink]  = useState("");
  const [isPending, startTransition] = useTransition();

  function handleSetPassword(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setSuccess("");
    startTransition(async () => {
      const res = await resetUserPasswordAction({ userId: user.id, newPassword: password });
      if (res.ok) setSuccess("Password updated successfully.");
      else        setError(res.error);
    });
  }

  function handleGenLink() {
    setError(""); setSuccess(""); setResetLink("");
    startTransition(async () => {
      const res = await generateAdminResetLinkAction(user.id);
      if (res.ok) setResetLink(res.data);
      else        setError(res.error);
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-card rounded-lg border shadow-xl w-full max-w-md p-6 space-y-4">
        <h2 className="text-base font-semibold">Reset Password — {user.email}</h2>

        <form onSubmit={handleSetPassword} className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground">New password</label>
          <PasswordInput value={password} onChange={setPassword} />
          <button type="submit" disabled={isPending || !password}
            className="w-full rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm disabled:opacity-50">
            {isPending ? "Saving…" : "Set password"}
          </button>
          <Feedback error={error} success={success} />
        </form>

        <div className="border-t pt-3">
          <p className="text-xs text-muted-foreground mb-2">
            Or generate a one-time reset link (expires in 30 min):
          </p>
          <button onClick={handleGenLink} disabled={isPending}
            className="inline-flex items-center gap-1.5 text-xs rounded-md border px-3 py-1.5 hover:bg-accent disabled:opacity-50">
            <Link2 className="h-3 w-3" />
            Generate reset link
          </button>
          {resetLink && (
            <div className="mt-2 space-y-1">
              <p className="text-xs text-muted-foreground">Send this link to the user:</p>
              <code className="block text-xs break-all bg-muted px-2 py-1 rounded">{resetLink}</code>
            </div>
          )}
        </div>

        <div className="flex justify-end pt-1">
          <button onClick={onClose} className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Disable modal ─────────────────────────────────────────────────────────────

function DisableModal({
  user,
  onClose,
  onDisabled,
}: {
  user:      UserDTO;
  onClose:   () => void;
  onDisabled: () => void;
}) {
  const [reason, setReason]         = useState("");
  const [error,  setError]          = useState("");
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    startTransition(async () => {
      const res = await disableUserAction({ userId: user.id, reason });
      if (res.ok) { onDisabled(); onClose(); }
      else        setError(res.error);
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-card rounded-lg border shadow-xl w-full max-w-sm p-6 space-y-4">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-yellow-500" />
          <h2 className="text-base font-semibold">Disable user</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Disabling <strong>{user.email}</strong> will prevent them from logging in.
        </p>
        <form onSubmit={handleSubmit} className="space-y-2">
          <input
            type="text" value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder="Reason (optional)"
            className="w-full rounded-md border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
          />
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose}
              className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent">
              Cancel
            </button>
            <button type="submit" disabled={isPending}
              className="rounded-md bg-destructive text-destructive-foreground px-3 py-1.5 text-sm disabled:opacity-50">
              {isPending ? "Disabling…" : "Disable"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── User row ──────────────────────────────────────────────────────────────────

function UserRow({
  user,
  actorRole,
  onRefresh,
}: {
  user:      UserDTO;
  actorRole: UserRole;
  onRefresh: () => void;
}) {
  const [showReset,   setShowReset]   = useState(false);
  const [showDisable, setShowDisable] = useState(false);
  const [roleError,   setRoleError]   = useState("");
  const [isPending, startTransition]  = useTransition();

  const disabled = !!user.disabledAt;

  function handleRoleChange(newRole: UserRole) {
    setRoleError("");
    startTransition(async () => {
      const res = await updateUserRoleAction({ userId: user.id, role: newRole });
      if (!res.ok) setRoleError(res.error);
      else         onRefresh();
    });
  }

  function handleVerify() {
    startTransition(async () => {
      await verifyUserEmailAction(user.id);
      onRefresh();
    });
  }

  function handleReactivate() {
    startTransition(async () => {
      await reactivateUserAction(user.id);
      onRefresh();
    });
  }

  return (
    <>
      <tr className={cn("border-b", disabled && "opacity-60")}>
        <td className="py-3 pl-4 pr-4">
          <div className="font-medium text-sm">{user.email}</div>
          <div className="text-xs text-muted-foreground">{user.name}</div>
        </td>
        <td className="py-3 pr-4">
          <select
            value={user.role}
            onChange={(e) => handleRoleChange(e.target.value as UserRole)}
            disabled={isPending}
            className="rounded border bg-background px-2 py-0.5 text-xs focus:outline-none"
          >
            <option value={UserRole.MEMBER}>MEMBER</option>
            <option value={UserRole.ADMIN}>ADMIN</option>
            {actorRole === UserRole.OWNER && (
              <option value={UserRole.OWNER}>OWNER</option>
            )}
          </select>
          {roleError && <p className="text-xs text-red-600 mt-0.5">{roleError}</p>}
        </td>
        <td className="py-3 pr-4 text-xs">
          {user.emailVerifiedAt ? (
            <span className="flex items-center gap-1 text-green-700">
              <CheckCircle2 className="h-3 w-3" /> Verified
            </span>
          ) : (
            <button onClick={handleVerify} disabled={isPending}
              className="flex items-center gap-1 text-yellow-700 hover:underline">
              <ShieldCheck className="h-3 w-3" />
              Verify
            </button>
          )}
        </td>
        <td className="py-3 pr-4 text-xs text-muted-foreground">
          {disabled ? (
            <span className="text-red-600">Disabled</span>
          ) : (
            <span className="text-green-700">Active</span>
          )}
        </td>
        <td className="py-3 pr-4 text-xs text-muted-foreground">{fmtRelative(user.lastLoginAt)}</td>
        <td className="py-3 pr-4 text-xs text-muted-foreground">{fmtRelative(user.createdAt)}</td>
        <td className="py-3">
          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowReset(true)}
              title="Reset password"
              className="rounded p-1 hover:bg-accent text-muted-foreground"
            >
              <RotateCcw className="h-4 w-4" />
            </button>
            {disabled ? (
              <button onClick={handleReactivate} disabled={isPending}
                title="Reactivate user"
                className="rounded p-1 hover:bg-accent text-muted-foreground">
                <UserCheck className="h-4 w-4" />
              </button>
            ) : (
              <button onClick={() => setShowDisable(true)}
                title="Disable user"
                className="rounded p-1 hover:bg-accent text-muted-foreground">
                <UserX className="h-4 w-4" />
              </button>
            )}
          </div>
        </td>
      </tr>

      {showReset && (
        <ResetPasswordModal user={user} onClose={() => setShowReset(false)} />
      )}
      {showDisable && (
        <DisableModal
          user={user}
          onClose={() => setShowDisable(false)}
          onDisabled={onRefresh}
        />
      )}
    </>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function AdminUsersPanel({
  initialUsers,
  actorRole,
  actorEmail,
}: {
  initialUsers: UserDTO[];
  actorRole:    UserRole;
  actorEmail:   string;
}) {
  const [users,      setUsers]      = useState<UserDTO[]>(initialUsers);
  const [showCreate, setShowCreate] = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function refresh() {
    startTransition(async () => {
      const res = await listUsersAction();
      if (res.ok) { setUsers(res.data); setError(null); }
      else        setError(res.error);
    });
  }

  function onCreated(u: UserDTO) {
    setUsers((prev) => [...prev, u]);
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">User Management</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Signed in as <strong>{actorEmail}</strong> · {actorRole}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={refresh}
            disabled={isPending}
            className="inline-flex items-center gap-2 rounded-md border bg-card px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
          >
            <RefreshCw className={cn("h-4 w-4", isPending && "animate-spin")} />
            Refresh
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-2 rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm"
          >
            <UserPlus className="h-4 w-4" />
            Create user
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}

      <div className="rounded-lg border bg-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-xs text-muted-foreground uppercase tracking-wide">
              <th className="py-3 pr-4 pl-4 text-left">User</th>
              <th className="py-3 pr-4 text-left">Role</th>
              <th className="py-3 pr-4 text-left">Email</th>
              <th className="py-3 pr-4 text-left">Status</th>
              <th className="py-3 pr-4 text-left">Last login</th>
              <th className="py-3 pr-4 text-left">Created</th>
              <th className="py-3 text-left">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {users.length === 0 && (
              <tr>
                <td colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                  No users found.
                </td>
              </tr>
            )}
            {users.map((u) => (
              <UserRow
                key={u.id}
                user={u}
                actorRole={actorRole}
                onRefresh={refresh}
              />
            ))}
          </tbody>
        </table>
      </div>

      {showCreate && (
        <CreateUserModal
          onClose={() => setShowCreate(false)}
          onCreated={onCreated}
          actorRole={actorRole}
        />
      )}
    </div>
  );
}
