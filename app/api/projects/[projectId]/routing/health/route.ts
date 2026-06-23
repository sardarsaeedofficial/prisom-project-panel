import { type NextRequest, NextResponse } from "next/server";
import { requireProjectPermission }      from "@/lib/auth/project-membership";
import { loadPlannerInput }              from "@/lib/routing/planner-loader";
import { generateProjectRouteMap }       from "@/lib/routing/project-route-planner";
import { checkProjectRouteHealth }       from "@/lib/routing/project-route-health";

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

    const domain = input.domain;
    if (!domain) {
      return NextResponse.json({ ok: false, error: "No domain configured for this project." });
    }

    const routeMap     = generateProjectRouteMap(input);
    const healthReport = await checkProjectRouteHealth(domain, routeMap.rules);

    return NextResponse.json({ ok: true, health: healthReport });
  } catch (e) {
    return NextResponse.json({
      ok:    false,
      error: e instanceof Error ? e.message : "Unknown routing error.",
    });
  }
}
