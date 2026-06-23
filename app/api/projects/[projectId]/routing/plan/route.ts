import { type NextRequest, NextResponse } from "next/server";
import { requireProjectPermission }      from "@/lib/auth/project-membership";
import { loadPlannerInput }              from "@/lib/routing/planner-loader";
import { generateProjectRouteMap }       from "@/lib/routing/project-route-planner";

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

    const routeMap = generateProjectRouteMap(input);

    return NextResponse.json({ ok: true, routeMap });
  } catch (e) {
    return NextResponse.json({
      ok:    false,
      error: e instanceof Error ? e.message : "Unknown routing error.",
    });
  }
}
