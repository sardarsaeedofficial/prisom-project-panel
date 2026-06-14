import { db } from "@/lib/db";
import {
  ProjectStatus,
  ProjectType,
  Visibility,
  EnvironmentName,
  EnvironmentStatus,
} from "@prisma/client";
import { getCurrentWorkspaceId, getCurrentUser } from "@/lib/current-workspace";
import type { Project as MockProjectShape } from "@/lib/mock-data";

// ── Queries ───────────────────────────────────────────────────────────────────

export async function getProjects() {
  const workspaceId = await getCurrentWorkspaceId();
  return db.project.findMany({
    where: { workspaceId },
    include: {
      githubRepository: true,
      domains: { where: { isPrimary: true }, take: 1 },
      deployments: { orderBy: { createdAt: "desc" }, take: 1 },
      environments: true,
      _count: {
        select: { logs: true, tasks: true, features: true, commits: true },
      },
    },
    orderBy: { updatedAt: "desc" },
  });
}

export type ProjectListItem = Awaited<ReturnType<typeof getProjects>>[number];

export async function getProjectById(projectId: string) {
  return db.project.findUnique({
    where: { id: projectId },
    include: {
      githubRepository: true,
      domains: true,
      deployments: {
        orderBy: { createdAt: "desc" },
        take: 5,
        include: { triggeredBy: true },
      },
      environments: {
        include: {
          secrets: { select: { id: true, key: true, createdAt: true } },
        },
      },
      portfolioItem: true,
      logs: { orderBy: { timestamp: "desc" }, take: 20 },
      features: {
        include: { tasks: true },
        orderBy: { createdAt: "desc" },
        take: 5,
      },
      tasks: {
        where: { status: { not: "DONE" } },
        orderBy: { createdAt: "desc" },
        take: 5,
      },
      _count: {
        select: { logs: true, tasks: true, features: true, commits: true },
      },
    },
  });
}

export type ProjectDetail = NonNullable<Awaited<ReturnType<typeof getProjectById>>>;

export async function getProjectBySlug(slug: string) {
  const workspaceId = await getCurrentWorkspaceId();
  return db.project.findUnique({
    where: { workspaceId_slug: { workspaceId, slug } },
    include: {
      githubRepository: true,
      environments: true,
    },
  });
}

// ── View model adapter (maps Prisma → shape UI components expect) ─────────────

function mapStatus(status: ProjectStatus): MockProjectShape["status"] {
  const map: Record<ProjectStatus, MockProjectShape["status"]> = {
    ACTIVE: "active",
    BUILDING: "building",
    ERROR: "error",
    ARCHIVED: "archived",
    DRAFT: "draft",
  };
  return map[status];
}

export function toProjectViewModel(project: ProjectListItem): MockProjectShape {
  return {
    id: project.id,
    name: project.name,
    description: project.description ?? "",
    status: mapStatus(project.status),
    language: project.language ?? "Other",
    url: project.liveUrl ?? undefined,
    githubRepo: project.githubRepository?.fullName ?? undefined,
    lastDeployed: project.lastDeployedAt?.toISOString() ?? undefined,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
    isPublished: project.visibility === Visibility.PUBLIC,
    slug: project.slug,
    stars: project.githubRepository?.stargazersCount ?? undefined,
    framework: project.framework ?? undefined,
  };
}

// ── Mutations ─────────────────────────────────────────────────────────────────

export type CreateProjectInput = {
  name: string;
  slug: string;
  description?: string;
  type?: ProjectType;
  visibility?: Visibility;
  language?: string;
  framework?: string;
  installCommand?: string;
  buildCommand?: string;
  startCommand?: string;
  outputDirectory?: string;
  githubUrl?: string;
};

export async function createProject(input: CreateProjectInput) {
  const [workspaceId, user] = await Promise.all([
    getCurrentWorkspaceId(),
    getCurrentUser(),
  ]);

  const parsed = input.githubUrl ? parseGitHubUrl(input.githubUrl) : null;

  const project = await db.project.create({
    data: {
      workspaceId,
      ownerId: user.id,
      name: input.name,
      slug: input.slug,
      description: input.description || null,
      type: input.type ?? ProjectType.APP,
      status: ProjectStatus.ACTIVE,
      visibility: input.visibility ?? Visibility.PRIVATE,
      language: input.language || null,
      framework: input.framework || null,
      installCommand: input.installCommand || null,
      buildCommand: input.buildCommand || null,
      startCommand: input.startCommand || null,
      outputDirectory: input.outputDirectory || null,
      ...(parsed
        ? {
            githubRepository: {
              create: {
                githubRepoId: Date.now(), // placeholder — real ID comes from GitHub API sync
                fullName: `${parsed.owner}/${parsed.repo}`,
                name: parsed.repo,
                htmlUrl: `https://github.com/${parsed.owner}/${parsed.repo}`,
                url: `https://api.github.com/repos/${parsed.owner}/${parsed.repo}`,
                cloneUrl: `https://github.com/${parsed.owner}/${parsed.repo}.git`,
                defaultBranch: "main",
                private: false,
              },
            },
          }
        : {}),
    },
  });

  await db.environment.createMany({
    data: [
      {
        projectId: project.id,
        name: EnvironmentName.DEVELOPMENT,
        status: EnvironmentStatus.ACTIVE,
      },
      {
        projectId: project.id,
        name: EnvironmentName.PRODUCTION,
        status: EnvironmentStatus.ACTIVE,
      },
    ],
  });

  return project;
}

export type UpdateProjectInput = {
  name?: string;
  slug?: string;
  description?: string | null;
  type?: ProjectType;
  visibility?: Visibility;
  language?: string | null;
  framework?: string | null;
  installCommand?: string | null;
  buildCommand?: string | null;
  startCommand?: string | null;
  outputDirectory?: string | null;
  liveUrl?: string | null;
  defaultBranch?: string;
};

export async function updateProject(projectId: string, input: UpdateProjectInput) {
  const { defaultBranch, ...projectData } = input;

  const project = await db.project.update({
    where: { id: projectId },
    data: projectData,
  });

  if (defaultBranch) {
    await db.gitHubRepository.updateMany({
      where: { projectId },
      data: { defaultBranch },
    });
  }

  return project;
}

export async function archiveProject(projectId: string) {
  return db.project.update({
    where: { id: projectId },
    data: { status: ProjectStatus.ARCHIVED },
  });
}

export async function deleteProject(projectId: string) {
  return db.project.delete({ where: { id: projectId } });
}

export async function markProjectOpened(projectId: string) {
  return db.project.update({
    where: { id: projectId },
    data: { lastOpenedAt: new Date() },
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseGitHubUrl(url: string): { owner: string; repo: string } | null {
  const match = url.match(
    /github\.com\/([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+?)(?:\.git)?(?:\/.*)?$/
  );
  if (!match) return null;
  return { owner: match[1], repo: match[2] };
}
