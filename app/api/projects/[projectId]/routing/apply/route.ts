import { type NextRequest, NextResponse } from "next/server";
import { requireProjectPermission }      from "@/lib/auth/project-membership";
import { writeProjectAuditEvent }        from "@/lib/audit/project-audit";
import { loadPlannerInput }              from "@/lib/routing/planner-loader";
import { generateProjectRouteMap }       from "@/lib/routing/project-route-planner";
import { generateNginxFromRouteMap }     from "@/lib/routing/nginx-route-generator";
import { applyNginxRouteConfig }         from "@/lib/routing/nginx-route-apply";
import { db }                            from "@/lib/db";

const CONFIRMATION_PHRASE = "APPLY ROUTES";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await params;

    const auth = await requireProjectPermission(projectId, "deploy.trigger");
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: 403 });
    }

    // Require explicit confirmation phrase in request body
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    if (body.confirmation !== CONFIRMATION_PHRASE) {
      return NextResponse.json({
        ok:    false,
        error: `Confirmation required: send { "confirmation": "${CONFIRMATION_PHRASE}" }`,
      }, { status: 400 });
    }

    const input = await loadPlannerInput(projectId);
    if (!input) {
      return NextResponse.json({ ok: false, error: "Project not found." });
    }

    const routeMap = generateProjectRouteMap(input);

    if (routeMap.blockers.length > 0) {
      void writeProjectAuditEvent({
        projectId, actorUserId: auth.userId, actorRole: auth.role,
        category: "publishing", action: "routing.apply_requested",
        result: "failed",
        summary: `Route apply requested but blocked: ${routeMap.blockers[0]}`,
        metadata: { domain: routeMap.domain, blockerCount: routeMap.blockers.length },
      }).catch(() => null);
      return NextResponse.json({
        ok:       false,
        error:    `Cannot apply: ${routeMap.blockers.length} blocker(s). Resolve them first.`,
        blockers: routeMap.blockers,
      });
    }

    const genResult = generateNginxFromRouteMap(routeMap);
    if (!genResult.ok) {
      return NextResponse.json({ ok: false, error: genResult.error, warnings: genResult.warnings });
    }

    void writeProjectAuditEvent({
      projectId, actorUserId: auth.userId, actorRole: auth.role,
      category: "publishing", action: "routing.apply_requested",
      result: "success",
      summary: `Route apply requested for ${routeMap.domain}`,
      metadata: { domain: routeMap.domain, ruleCount: routeMap.rules.length },
    }).catch(() => null);

    const applyResult = await applyNginxRouteConfig(routeMap.domain, genResult.config);

    void writeProjectAuditEvent({
      projectId, actorUserId: auth.userId, actorRole: auth.role,
      category: "publishing",
      action:   applyResult.ok ? "routing.apply_succeeded" : "routing.apply_failed",
      result:   applyResult.ok ? "success" : "failed",
      summary:  applyResult.ok
        ? `Nginx route config applied for ${routeMap.domain}`
        : `Nginx route apply failed for ${routeMap.domain}: ${applyResult.error?.slice(0, 200)}`,
      metadata: { domain: routeMap.domain },
    }).catch(() => null);

    if (!applyResult.ok) {
      try {
        const { notifyProjectAdmins } = await import("@/lib/notifications/notification-service");
        await notifyProjectAdmins(projectId, {
          title:      "Route config apply failed",
          body:       `nginx routing failed for ${routeMap.domain}. Config rolled back.`,
          severity:   "error",
          category:   "deployment",
          sourceType: "routing",
          href:       `/projects/${projectId}/publishing`,
        });
      } catch { /* non-fatal */ }

      return NextResponse.json({ ok: false, error: applyResult.error ?? "Apply failed.", nginxOutput: applyResult.nginxOutput });
    }

    // Persist configPath in Domain record
    try {
      await db.domain.updateMany({
        where: { projectId, hostname: routeMap.domain },
        data:  { nginxConfigPath: applyResult.configPath ?? null },
      });
    } catch { /* non-fatal */ }

    return NextResponse.json({
      ok:           true,
      data: {
        routeMap,
        nginxPreview: genResult.config,
        warnings:     [...routeMap.warnings, ...genResult.warnings],
        blockers:     [],
        nginxOutput:  applyResult.nginxOutput,
      },
    });
  } catch (e) {
    return NextResponse.json({
      ok:    false,
      error: e instanceof Error ? e.message : "Unknown routing error.",
    });
  }
}
