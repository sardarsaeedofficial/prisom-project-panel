import { type NextRequest, NextResponse } from "next/server";
import { requireProjectPermission }      from "@/lib/auth/project-membership";
import { loadPlannerInput }              from "@/lib/routing/planner-loader";
import { generateProjectRouteMap }       from "@/lib/routing/project-route-planner";
import { generateNginxFromRouteMap }     from "@/lib/routing/nginx-route-generator";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await params;

    const auth = await requireProjectPermission(projectId, "deploy.trigger");
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: 403 });
    }

    const input = await loadPlannerInput(projectId);
    if (!input) {
      return NextResponse.json({ ok: false, error: "Project not found." });
    }

    const routeMap  = generateProjectRouteMap(input);
    const genResult = generateNginxFromRouteMap(routeMap);

    const warnings = [...routeMap.warnings, ...(genResult.ok ? genResult.warnings : [])];
    const blockers = routeMap.blockers;

    if (!genResult.ok) {
      return NextResponse.json({
        ok:      false,
        error:   genResult.error,
        routeMap,
        validation: { ok: false, warnings, blockers },
        warnings,
        blockers,
      });
    }

    return NextResponse.json({
      ok:           true,
      routeMap,
      nginxPreview: genResult.config,
      validation:   { ok: true, warnings, blockers },
      warnings,
      blockers,
    });
  } catch (e) {
    return NextResponse.json({
      ok:    false,
      error: e instanceof Error ? e.message : "Unknown routing error.",
    });
  }
}
