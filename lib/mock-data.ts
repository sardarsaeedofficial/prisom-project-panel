// Mock data for development — replace with real Prisma queries

export type ProjectStatus = "active" | "archived" | "building" | "error" | "draft";
export type ProjectLanguage = string;

export type Project = {
  id: string;
  name: string;
  description: string;
  status: ProjectStatus;
  language: ProjectLanguage;
  url?: string;
  githubRepo?: string;
  lastDeployed?: string;
  createdAt: string;
  updatedAt: string;
  isPublished: boolean;
  slug?: string;
  stars?: number;
  framework?: string;
};

export type Integration = {
  id: string;
  name: string;
  description: string;
  category: "version-control" | "deployment" | "database" | "monitoring" | "ai" | "other";
  connected: boolean;
  icon: string;
  connectedAt?: string;
};

export type SecurityKey = {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsed?: string;
  expiresAt?: string;
  scopes: string[];
};

export type PortfolioProject = {
  id: string;
  name: string;
  description: string;
  slug: string;
  tags: string[];
  imageUrl?: string;
  liveUrl?: string;
  githubUrl?: string;
  featured: boolean;
  publishedAt: string;
};

export const MOCK_PROJECTS: Project[] = [
  {
    id: "proj_001",
    name: "ai-chat-assistant",
    description: "A real-time AI chat application with streaming responses and multi-turn conversations.",
    status: "active",
    language: "TypeScript",
    url: "https://ai-chat.prisom.dev",
    githubRepo: "alexrivera/ai-chat-assistant",
    lastDeployed: "2024-12-10T14:22:00Z",
    createdAt: "2024-10-01T09:00:00Z",
    updatedAt: "2024-12-10T14:22:00Z",
    isPublished: true,
    slug: "ai-chat-assistant",
    stars: 42,
    framework: "Next.js",
  },
  {
    id: "proj_002",
    name: "data-pipeline",
    description: "ETL pipeline for processing large datasets with real-time monitoring and alerting.",
    status: "active",
    language: "Python",
    githubRepo: "alexrivera/data-pipeline",
    lastDeployed: "2024-12-08T11:05:00Z",
    createdAt: "2024-09-15T10:30:00Z",
    updatedAt: "2024-12-08T11:05:00Z",
    isPublished: false,
    framework: "FastAPI",
  },
  {
    id: "proj_003",
    name: "portfolio-site",
    description: "Personal portfolio with blog, projects showcase, and contact form.",
    status: "active",
    language: "TypeScript",
    url: "https://alexrivera.dev",
    githubRepo: "alexrivera/portfolio-site",
    lastDeployed: "2024-12-05T16:40:00Z",
    createdAt: "2024-08-20T08:00:00Z",
    updatedAt: "2024-12-05T16:40:00Z",
    isPublished: true,
    slug: "portfolio-site",
    stars: 18,
    framework: "Astro",
  },
  {
    id: "proj_004",
    name: "rust-cli-tool",
    description: "High-performance CLI tool for file processing and data transformation.",
    status: "building",
    language: "Rust",
    githubRepo: "alexrivera/rust-cli-tool",
    createdAt: "2024-12-01T12:00:00Z",
    updatedAt: "2024-12-09T18:30:00Z",
    isPublished: false,
  },
  {
    id: "proj_005",
    name: "legacy-dashboard",
    description: "Internal analytics dashboard (deprecated, replaced by v2).",
    status: "archived",
    language: "JavaScript",
    createdAt: "2024-03-10T09:00:00Z",
    updatedAt: "2024-09-01T00:00:00Z",
    isPublished: false,
  },
  {
    id: "proj_006",
    name: "api-gateway",
    description: "Microservice API gateway with rate limiting, auth, and request routing.",
    status: "error",
    language: "Go",
    githubRepo: "alexrivera/api-gateway",
    lastDeployed: "2024-12-07T09:15:00Z",
    createdAt: "2024-11-10T11:00:00Z",
    updatedAt: "2024-12-09T22:00:00Z",
    isPublished: false,
    framework: "Gin",
  },
];

export const MOCK_INTEGRATIONS: Integration[] = [
  {
    id: "int_github",
    name: "GitHub",
    description: "Connect your GitHub account to import repositories and enable CI/CD workflows.",
    category: "version-control",
    connected: true,
    icon: "github",
    connectedAt: "2024-10-15T08:00:00Z",
  },
  {
    id: "int_vercel",
    name: "Vercel",
    description: "Deploy your projects to Vercel with zero-configuration deployments.",
    category: "deployment",
    connected: false,
    icon: "triangle",
  },
  {
    id: "int_railway",
    name: "Railway",
    description: "Deploy and scale your applications on Railway infrastructure.",
    category: "deployment",
    connected: false,
    icon: "train",
  },
  {
    id: "int_supabase",
    name: "Supabase",
    description: "Open source Firebase alternative with Postgres, Auth, and Storage.",
    category: "database",
    connected: false,
    icon: "database",
  },
  {
    id: "int_planetscale",
    name: "PlanetScale",
    description: "MySQL-compatible serverless database platform built on Vitess.",
    category: "database",
    connected: false,
    icon: "database",
  },
  {
    id: "int_datadog",
    name: "Datadog",
    description: "Monitoring and analytics platform for cloud-scale applications.",
    category: "monitoring",
    connected: false,
    icon: "activity",
  },
];

export const MOCK_API_KEYS: SecurityKey[] = [
  {
    id: "key_001",
    name: "Production API Key",
    prefix: "ppm_prod",
    createdAt: "2024-10-20T10:00:00Z",
    lastUsed: "2024-12-10T12:30:00Z",
    scopes: ["read:projects", "write:projects", "deploy"],
  },
  {
    id: "key_002",
    name: "CI/CD Pipeline",
    prefix: "ppm_ci",
    createdAt: "2024-11-05T14:00:00Z",
    lastUsed: "2024-12-09T08:00:00Z",
    scopes: ["read:projects", "deploy"],
  },
  {
    id: "key_003",
    name: "Read-only Analytics",
    prefix: "ppm_ro",
    createdAt: "2024-12-01T09:00:00Z",
    expiresAt: "2025-06-01T00:00:00Z",
    scopes: ["read:projects"],
  },
];

export const MOCK_PORTFOLIO_PROJECTS: PortfolioProject[] = [
  {
    id: "port_001",
    name: "AI Chat Assistant",
    description:
      "Full-stack AI chat application with streaming, multi-turn conversations, and tool use.",
    slug: "ai-chat-assistant",
    tags: ["Next.js", "TypeScript", "AI", "Real-time"],
    liveUrl: "https://ai-chat.prisom.dev",
    githubUrl: "https://github.com/alexrivera/ai-chat-assistant",
    featured: true,
    publishedAt: "2024-12-10T00:00:00Z",
  },
  {
    id: "port_002",
    name: "Portfolio Site",
    description: "Personal portfolio with dark mode, blog, and interactive project showcase.",
    slug: "portfolio-site",
    tags: ["Astro", "TypeScript", "Blog"],
    liveUrl: "https://alexrivera.dev",
    githubUrl: "https://github.com/alexrivera/portfolio-site",
    featured: false,
    publishedAt: "2024-12-05T00:00:00Z",
  },
];

export const MOCK_STATS = {
  totalProjects: MOCK_PROJECTS.length,
  activeProjects: MOCK_PROJECTS.filter((p) => p.status === "active").length,
  publishedProjects: MOCK_PROJECTS.filter((p) => p.isPublished).length,
  totalDeployments: 47,
  uptime: "99.8%",
};
