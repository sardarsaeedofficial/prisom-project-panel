import { type NextRequest, NextResponse } from "next/server";
import { requireProjectPermission }      from "@/lib/auth/project-membership";
import { writeProjectAuditEvent }        from "@/lib/audit/project-audit";
import { loadPlannerInput }              from "@/lib/routing/planner-loader";
import { buildRouteRollbackPreview }     from "@/lib/routing/route-rollback-preview";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await params;

    const auth = await requireProjectPermission(projectId, "project.view");
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: 403 });
    }

    const input = await loadPlannerInput(projectId);
    if (!input) {
      return NextResponse.json({ ok: false, error: "Project not found." });
    }

    const domain  = input.domain ?? "";
    const preview = await buildRouteRollbackPreview(domain);

    void writeProjectAuditEvent({
      projectId,
      actorUserId: auth.userId,
      actorRole:   auth.role,
      category:    "rollback",
      action:      "routing.rollback_preview_generated",
      summary:     `Rollback preview generated for ${domain || "unknown domain"} — hasBackup: ${preview.hasBackup}`,
      result:      "success",
      metadata:    { domain, hasBackup: preview.hasBackup },
    }).catch(() => null);

    return NextResponse.json({ ok: true, data: preview });
  } catch (e) {
    return NextResponse.json({
      ok:    false,
      error: e instanceof Error ? e.message : "Unknown rollback preview error.",
    });
  }
}
