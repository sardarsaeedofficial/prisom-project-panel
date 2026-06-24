import { type NextRequest, NextResponse } from "next/server";
import { requireProjectPermission }      from "@/lib/auth/project-membership";
import { writeProjectAuditEvent }        from "@/lib/audit/project-audit";
import { generateRoutingDiagnostics }    from "@/lib/routing/routing-diagnostics-service";

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

    const report = await generateRoutingDiagnostics(projectId);

    void writeProjectAuditEvent({
      projectId,
      actorUserId: auth.userId,
      actorRole:   auth.role,
      category:    "publishing",
      action:      "routing.diagnostics_generated",
      summary:     `Routing diagnostics generated — status: ${report.status}, blockers: ${report.blockers.length}`,
      result:      report.status === "blocked" ? "failed" : "success",
      metadata:    {
        domain:        report.domain,
        status:        report.status,
        blockerCount:  report.blockers.length,
        warningCount:  report.warnings.length,
      },
    }).catch(() => null);

    return NextResponse.json({ ok: true, data: report });
  } catch (e) {
    return NextResponse.json({
      ok:    false,
      error: e instanceof Error ? e.message : "Unknown diagnostics error.",
    });
  }
}
