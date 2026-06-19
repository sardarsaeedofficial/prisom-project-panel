/**
 * lib/audit/project-audit-types.ts
 *
 * Sprint 18 Hotfix: Client-safe DTO types for the project audit log.
 *
 * This file has NO "use server", NO Prisma imports, NO server-only deps.
 * Import from here in client components — never from the "use server" action file.
 */

export type ProjectAuditEventDTO = {
  id: string;
  projectId: string;
  actorUserId: string | null;
  actorEmail: string | null;
  actorName: string | null;
  actorRole: string | null;
  action: string;
  category: string;
  result: string;
  targetType: string | null;
  targetId: string | null;
  targetLabel: string | null;
  summary: string;
  metadata: Record<string, unknown> | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string; // ISO
};

export type AuditActor = {
  actorUserId: string | null;
  actorName: string | null;
  actorEmail: string | null;
};

export type GetAuditEventsOutput = {
  events: ProjectAuditEventDTO[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  actors: AuditActor[];
};
