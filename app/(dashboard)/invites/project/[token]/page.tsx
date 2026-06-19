import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { DashboardShell, PageHeader } from "@/components/layout/dashboard-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PROJECT_ROLE_LABELS, PROJECT_ROLE_DESCRIPTIONS } from "@/lib/auth/project-permissions";
import type { ProjectRole } from "@/lib/auth/project-permissions";
import { InviteAcceptForm } from "@/components/projects/invite-accept-form";

export const metadata: Metadata = { title: "Project Invite" };

type Props = { params: Promise<{ token: string }> };

export default async function ProjectInvitePage({ params }: Props) {
  const { token } = await params;

  const session = await getSession();
  if (!session) {
    redirect(`/login?from=/invites/project/${token}`);
  }

  const invite = await db.projectInvite.findUnique({
    where: { token },
    include: {
      project: {
        select: {
          id:   true,
          name: true,
          slug: true,
        },
      },
      invitedBy: {
        select: { name: true },
      },
    },
  });

  if (!invite) {
    notFound();
  }

  // Determine invite state for UI rendering
  const isExpired    = invite.expiresAt < new Date();
  const isNotPending = invite.status !== "pending";
  const emailMismatch =
    invite.email.toLowerCase() !== session.email.toLowerCase();

  // Already a member?
  const existingMember = await db.projectMember.findFirst({
    where: {
      projectId: invite.projectId,
      user: { email: invite.email },
    },
  });

  const role = invite.role as ProjectRole;

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <DashboardShell>
        <PageHeader
          title="Project Invitation"
          description={`You have been invited to join ${invite.project.name}`}
        />

        <div className="max-w-lg">
          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <div>
                  <CardTitle className="text-lg">{invite.project.name}</CardTitle>
                  <CardDescription className="mt-1">
                    Invited by <strong>{invite.invitedBy.name}</strong>
                  </CardDescription>
                </div>
              </div>
            </CardHeader>

            <CardContent className="space-y-4">
              {/* Role being offered */}
              <div className="flex items-center justify-between rounded-md border px-4 py-3">
                <div>
                  <p className="text-sm font-medium">Role offered</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {PROJECT_ROLE_DESCRIPTIONS[role]}
                  </p>
                </div>
                <Badge variant="secondary" className="shrink-0 ml-4">
                  {PROJECT_ROLE_LABELS[role]}
                </Badge>
              </div>

              {/* State: already a member */}
              {existingMember ? (
                <div className="rounded-md bg-blue-50 border border-blue-200 px-4 py-3 text-sm text-blue-800">
                  You are already a member of <strong>{invite.project.name}</strong>.{" "}
                  <Link
                    href={`/projects/${invite.project.id}/settings`}
                    className="underline underline-offset-2"
                  >
                    Go to project
                  </Link>
                </div>
              ) : isNotPending || isExpired ? (
                /* State: invite no longer valid */
                <div className="rounded-md bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
                  {isExpired || invite.status === "expired"
                    ? "This invite has expired and can no longer be accepted."
                    : `This invite has been ${invite.status}.`}
                </div>
              ) : emailMismatch ? (
                /* State: wrong account */
                <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-800">
                  <p className="font-medium">Wrong account</p>
                  <p className="mt-1">
                    This invite was sent to a different email address. You are currently
                    logged in as <strong>{session.email}</strong>. Please log in with the
                    account that received this invite.
                  </p>
                </div>
              ) : (
                /* State: ready to accept */
                <InviteAcceptForm
                  token={token}
                  projectName={invite.project.name}
                  projectSlug={invite.project.slug}
                  projectId={invite.project.id}
                  expiresAt={invite.expiresAt.toISOString()}
                />
              )}
            </CardContent>
          </Card>
        </div>
      </DashboardShell>
    </div>
  );
}
