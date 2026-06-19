"use client";

/**
 * components/projects/project-team-panel.tsx
 *
 * Sprint 17: Project team management panel.
 *
 * Security:
 *  - Raw email addresses are never shown; server returns masked versions.
 *  - All write operations call server actions that enforce permissions server-side.
 *  - Client-side permission checks (hide/disable buttons) are UI-only — they
 *    never replace the server-side enforcement.
 */

import { useState, useEffect, useTransition, useCallback } from "react";
import { Users, UserPlus, Mail, Trash2, Loader2, CheckCircle, Copy, RefreshCw } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  getProjectTeamAction,
  inviteProjectMemberAction,
  updateProjectMemberRoleAction,
  removeProjectMemberAction,
  cancelProjectInviteAction,
  type TeamMember,
  type TeamInvite,
  type TeamData,
} from "@/app/actions/project-team";
import {
  PROJECT_ROLES,
  PROJECT_ROLE_LABELS,
  PROJECT_ROLE_DESCRIPTIONS,
  assignableRoles,
  type ProjectRole,
} from "@/lib/auth/project-permissions";

// ── Types ─────────────────────────────────────────────────────────────────────

type Props = { projectId: string };

// ── Role badge colours ────────────────────────────────────────────────────────

function RoleBadge({ role }: { role: ProjectRole }) {
  const colours: Record<ProjectRole, string> = {
    owner:     "bg-purple-100 text-purple-800 border-purple-200",
    admin:     "bg-blue-100 text-blue-800 border-blue-200",
    developer: "bg-green-100 text-green-800 border-green-200",
    operator:  "bg-orange-100 text-orange-800 border-orange-200",
    viewer:    "bg-gray-100 text-gray-700 border-gray-200",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${colours[role]}`}
    >
      {PROJECT_ROLE_LABELS[role]}
    </span>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function ProjectTeamPanel({ projectId }: Props) {
  const [teamData, setTeamData]       = useState<TeamData | null>(null);
  const [loadError, setLoadError]     = useState<string>("");
  const [isPending, startTransition]  = useTransition();

  // ── Invite form state ────────────────────────────────────────────────────
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole]   = useState<ProjectRole>("viewer");
  const [inviteNote, setInviteNote]   = useState("");
  const [inviteStatus, setInviteStatus] = useState<
    "idle" | "loading" | "success" | "error"
  >("idle");
  const [inviteError, setInviteError]   = useState("");
  const [inviteUrl, setInviteUrl]       = useState("");
  const [copiedUrl, setCopiedUrl]       = useState(false);

  // ── Action feedback ──────────────────────────────────────────────────────
  const [actionError, setActionError] = useState("");

  // ── Load team data ───────────────────────────────────────────────────────
  const loadTeam = useCallback(() => {
    startTransition(async () => {
      setLoadError("");
      const result = await getProjectTeamAction(projectId);
      if (result.ok) {
        setTeamData(result.data);
      } else {
        setLoadError(result.error);
      }
    });
  }, [projectId]);

  useEffect(() => { loadTeam(); }, [loadTeam]);

  // ── Invite ────────────────────────────────────────────────────────────────
  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setInviteStatus("loading");
    setInviteError("");
    setInviteUrl("");

    const result = await inviteProjectMemberAction({
      projectId,
      email: inviteEmail,
      role:  inviteRole,
      note:  inviteNote || undefined,
    });

    if (result.ok) {
      setInviteStatus("success");
      setInviteUrl(result.data.inviteUrl);
      setInviteEmail("");
      setInviteNote("");
      loadTeam();
    } else {
      setInviteStatus("error");
      setInviteError(result.error);
    }
  }

  function copyInviteUrl() {
    const full = `${window.location.origin}${inviteUrl}`;
    navigator.clipboard.writeText(full).then(() => {
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 2000);
    });
  }

  // ── Change role ───────────────────────────────────────────────────────────
  async function handleRoleChange(memberId: string, role: ProjectRole) {
    setActionError("");
    const result = await updateProjectMemberRoleAction({ projectId, memberId, role });
    if (result.ok) {
      loadTeam();
    } else {
      setActionError(result.error);
    }
  }

  // ── Remove member ─────────────────────────────────────────────────────────
  async function handleRemove(memberId: string, name: string) {
    if (!confirm(`Remove ${name} from the project?`)) return;
    setActionError("");
    const result = await removeProjectMemberAction({ projectId, memberId });
    if (result.ok) {
      loadTeam();
    } else {
      setActionError(result.error);
    }
  }

  // ── Cancel invite ─────────────────────────────────────────────────────────
  async function handleCancelInvite(inviteId: string) {
    if (!confirm("Cancel this invite?")) return;
    setActionError("");
    const result = await cancelProjectInviteAction({ projectId, inviteId });
    if (result.ok) {
      loadTeam();
    } else {
      setActionError(result.error);
    }
  }

  // ── Derived state ─────────────────────────────────────────────────────────
  const myRole        = teamData?.myRole ?? "viewer";
  const canManage     = myRole === "owner" || myRole === "admin";
  const allowedRoles  = assignableRoles(myRole);

  // ── Render ────────────────────────────────────────────────────────────────
  if (!teamData && !loadError) {
    return (
      <Card className="max-w-2xl">
        <CardContent className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading team…
        </CardContent>
      </Card>
    );
  }

  if (loadError) {
    return (
      <Card className="max-w-2xl">
        <CardContent className="py-6 text-sm text-destructive">{loadError}</CardContent>
      </Card>
    );
  }

  return (
    <div className="max-w-2xl space-y-6">
      {/* ── Members list ────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Users className="h-4 w-4" />
                Team Members
              </CardTitle>
              <CardDescription className="mt-1">
                {teamData!.members.length} member{teamData!.members.length !== 1 ? "s" : ""}
              </CardDescription>
            </div>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={loadTeam} disabled={isPending}>
              <RefreshCw className={`h-3.5 w-3.5 ${isPending ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </CardHeader>

        {actionError && (
          <div className="mx-6 mb-3 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
            {actionError}
          </div>
        )}

        <CardContent className="p-0">
          <div className="divide-y">
            {teamData!.members.map((member: TeamMember) => (
              <div key={member.id} className="flex items-center gap-3 px-6 py-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium truncate">{member.name}</span>
                    {member.isSelf && (
                      <Badge variant="outline" className="text-xs">You</Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground font-mono">{member.email}</p>
                </div>

                {/* Role selector (only if can manage and not self) */}
                {canManage && !member.isSelf && allowedRoles.length > 0 ? (
                  <select
                    value={member.role}
                    onChange={(e) => handleRoleChange(member.id, e.target.value as ProjectRole)}
                    className="h-7 rounded border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    {PROJECT_ROLES.filter((r) => allowedRoles.includes(r)).map((r) => (
                      <option key={r} value={r}>
                        {PROJECT_ROLE_LABELS[r]}
                      </option>
                    ))}
                  </select>
                ) : (
                  <RoleBadge role={member.role} />
                )}

                {/* Remove button */}
                {canManage && !member.isSelf && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                    onClick={() => handleRemove(member.id, member.name)}
                    title="Remove member"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* ── Pending invites ──────────────────────────────────────────────── */}
      {teamData!.invites.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Mail className="h-4 w-4" />
              Pending Invites
            </CardTitle>
            <CardDescription>Awaiting acceptance</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y">
              {teamData!.invites.map((inv: TeamInvite) => (
                <div key={inv.id} className="flex items-center gap-3 px-6 py-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-mono">{inv.email}</p>
                    <p className="text-xs text-muted-foreground">
                      Invited by {inv.inviterName} · Expires{" "}
                      {new Date(inv.expiresAt).toLocaleDateString()}
                    </p>
                  </div>
                  <RoleBadge role={inv.role as ProjectRole} />
                  {canManage && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      onClick={() => handleCancelInvite(inv.id)}
                      title="Cancel invite"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Invite form ──────────────────────────────────────────────────── */}
      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <UserPlus className="h-4 w-4" />
              Invite Member
            </CardTitle>
            <CardDescription>
              Send an invite link to add someone to this project.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {inviteStatus === "success" && inviteUrl ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2 rounded-md bg-green-50 border border-green-200 px-3 py-2">
                  <CheckCircle className="h-4 w-4 text-green-600 shrink-0" />
                  <p className="text-sm text-green-800 flex-1">
                    Invite created. Share this link with the recipient:
                  </p>
                </div>
                <div className="flex gap-2">
                  <code className="flex-1 rounded bg-muted px-3 py-2 text-xs font-mono break-all">
                    {typeof window !== "undefined"
                      ? `${window.location.origin}${inviteUrl}`
                      : inviteUrl}
                  </code>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={copyInviteUrl}
                    className="shrink-0"
                  >
                    {copiedUrl ? (
                      <CheckCircle className="h-3.5 w-3.5 text-green-600" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => { setInviteStatus("idle"); setInviteUrl(""); }}
                >
                  Invite another person
                </Button>
              </div>
            ) : (
              <form onSubmit={handleInvite} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="invite-email">Email address</Label>
                  <Input
                    id="invite-email"
                    type="email"
                    placeholder="colleague@example.com"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    required
                    disabled={inviteStatus === "loading"}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="invite-role">Role</Label>
                  <select
                    id="invite-role"
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value as ProjectRole)}
                    disabled={inviteStatus === "loading"}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                  >
                    {PROJECT_ROLES.filter((r) => allowedRoles.includes(r)).map((r) => (
                      <option key={r} value={r}>
                        {PROJECT_ROLE_LABELS[r]} — {PROJECT_ROLE_DESCRIPTIONS[r]}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="invite-note">
                    Note{" "}
                    <span className="text-muted-foreground font-normal">(optional)</span>
                  </Label>
                  <Input
                    id="invite-note"
                    placeholder="Hey, joining us for the dashboard rewrite…"
                    value={inviteNote}
                    onChange={(e) => setInviteNote(e.target.value)}
                    maxLength={500}
                    disabled={inviteStatus === "loading"}
                  />
                </div>

                {inviteStatus === "error" && inviteError && (
                  <p className="text-sm text-destructive">{inviteError}</p>
                )}

                <Button
                  type="submit"
                  disabled={inviteStatus === "loading" || !inviteEmail}
                >
                  {inviteStatus === "loading" && (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  )}
                  {inviteStatus === "loading" ? "Creating invite…" : "Create invite link"}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Role reference ───────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Role Reference</CardTitle>
          <CardDescription>What each role can do in this project</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y">
            {PROJECT_ROLES.map((role) => (
              <div key={role} className="flex items-start gap-3 px-6 py-3">
                <div className="pt-0.5 shrink-0">
                  <RoleBadge role={role} />
                </div>
                <p className="text-sm text-muted-foreground">
                  {PROJECT_ROLE_DESCRIPTIONS[role]}
                </p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
