import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Database, Key, Trash2, Server, HardDrive } from "lucide-react";
import { DashboardShell, PageHeader } from "@/components/layout/dashboard-shell";
import { WorkspaceNav } from "@/components/projects/workspace-nav";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AddDatabaseForm } from "@/components/workspace/add-database-form";
import {
  getProjectDatabases,
  getProjectEnvironments,
} from "@/lib/data/workspace-modules";
import { deleteDatabaseAction } from "@/app/actions/workspace-modules";
import { db } from "@/lib/db";
import { DatabaseStatus } from "@prisma/client";

export const metadata: Metadata = { title: "Database" };
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ projectId: string }> };

const STATUS_BADGE: Record<
  DatabaseStatus,
  { label: string; variant: "secondary" | "warning" | "success" | "error" }
> = {
  PROVISIONING: { label: "Provisioning", variant: "warning" },
  ACTIVE: { label: "Active", variant: "success" },
  PAUSED: { label: "Paused", variant: "secondary" },
  ERROR: { label: "Error", variant: "error" },
};

const TYPE_DEFAULT_PORT: Record<string, number> = {
  POSTGRES: 5432,
  MYSQL: 3306,
  SQLITE: 0,
  MONGODB: 27017,
  REDIS: 6379,
};

function StorageBar({
  used,
  limit,
}: {
  used: number | null;
  limit: number | null;
}) {
  if (!limit) return null;
  const pct = used ? Math.min((used / limit) * 100, 100) : 0;
  return (
    <div className="mt-2">
      <div className="flex justify-between text-xs text-muted-foreground mb-1">
        <span>{used ? `${used.toFixed(0)} MB used` : "0 MB used"}</span>
        <span>{limit} MB limit</span>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full ${pct > 90 ? "bg-red-500" : pct > 70 ? "bg-yellow-500" : "bg-green-500"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export default async function ProjectDatabasePage({ params }: Props) {
  const { projectId } = await params;

  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true },
  });
  if (!project) notFound();

  const [databases, environments] = await Promise.all([
    getProjectDatabases(projectId),
    getProjectEnvironments(projectId),
  ]);

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <WorkspaceNav projectId={projectId} />
      <DashboardShell>
        <PageHeader
          title="Database"
          description="Track database connections for this project. Passwords are never stored."
        />

        <div className="space-y-6 max-w-3xl">
          {/* Add form */}
          <AddDatabaseForm projectId={projectId} environments={environments} />

          {/* DB list */}
          {databases.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center text-center py-10 gap-3">
                <Database className="h-8 w-8 text-muted-foreground/50" />
                <div>
                  <p className="text-sm font-medium">No databases yet</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Add a database record above to track connection metadata.
                  </p>
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {databases.map((db_) => {
                const badge = STATUS_BADGE[db_.status];
                const defaultPort =
                  TYPE_DEFAULT_PORT[db_.type] ?? null;
                const port = db_.port ?? defaultPort;
                return (
                  <Card key={db_.id}>
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <Database className="h-4 w-4 text-muted-foreground" />
                          <CardTitle className="text-base">{db_.name}</CardTitle>
                          <Badge variant="secondary" className="text-xs font-mono">
                            {db_.type}
                          </Badge>
                          <Badge variant={badge.variant} className="text-xs">
                            {badge.label}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-1">
                          <form
                            action={deleteDatabaseAction.bind(
                              null,
                              db_.id,
                              projectId
                            )}
                          >
                            <button
                              type="submit"
                              className="p-1.5 text-muted-foreground hover:text-destructive transition-colors rounded"
                              title="Remove database"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </form>
                        </div>
                      </div>
                    </CardHeader>

                    <CardContent className="pb-4">
                      {/* Connection details */}
                      {(db_.host || db_.databaseName || db_.username) && (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2 flex-wrap">
                          <Server className="h-3.5 w-3.5 shrink-0" />
                          {db_.username && (
                            <span>
                              <Key className="h-3 w-3 inline mr-0.5" />
                              {db_.username}
                            </span>
                          )}
                          {db_.host && (
                            <span className="font-mono">
                              {db_.host}
                              {port ? `:${port}` : ""}
                            </span>
                          )}
                          {db_.databaseName && (
                            <span className="font-mono">{db_.databaseName}</span>
                          )}
                          {db_.environment && (
                            <Badge variant="secondary" className="text-xs">
                              {db_.environment.name}
                            </Badge>
                          )}
                        </div>
                      )}

                      <StorageBar
                        used={db_.storageUsedMb ?? null}
                        limit={db_.storageLimitMb ?? null}
                      />

                      {/* Migrations */}
                      {db_._count.migrations > 0 && (
                        <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
                          <HardDrive className="h-3 w-3" />
                          {db_._count.migrations} migration
                          {db_._count.migrations !== 1 ? "s" : ""} recorded
                        </p>
                      )}

                      <p className="text-xs text-muted-foreground/60 mt-3 italic">
                        Passwords are never stored. Run{" "}
                        <code className="font-mono bg-muted px-1 rounded">
                          npm run db:studio
                        </code>{" "}
                        locally for Prisma Studio.
                      </p>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </DashboardShell>
    </div>
  );
}
