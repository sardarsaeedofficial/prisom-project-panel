/**
 * app/(dashboard)/projects/[projectId]/logs/download/route.ts
 *
 * Sprint 28: Download route for the Logs Center.
 *
 * GET /projects/:projectId/logs/download?source=<sourceId>
 *
 * Returns the log content as a redacted plain-text attachment.
 * Authentication and authorisation are handled inside getRawLogsForDownload.
 * The source ID is an opaque token; raw file paths are never accepted.
 */

import { NextRequest, NextResponse } from "next/server";
import { getRawLogsForDownload }     from "@/app/actions/project-logs";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const sourceId = request.nextUrl.searchParams.get("source") ?? "";

  if (!sourceId) {
    return new NextResponse("Missing source parameter.", { status: 400 });
  }

  const result = await getRawLogsForDownload(projectId, sourceId);

  if (!result.ok) {
    return new NextResponse(result.error, { status: result.error === "Access denied." ? 403 : 400 });
  }

  return new NextResponse(result.text, {
    status: 200,
    headers: {
      "Content-Type":        "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="${result.filename}"`,
      "Cache-Control":       "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
