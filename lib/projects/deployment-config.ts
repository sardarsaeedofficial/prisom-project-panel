/**
 * Static VPS deployment configuration for managed projects.
 *
 * These values describe HOW to reach/deploy each project on the server.
 * They are not stored in the database (schema doesn't have VPS SSH fields yet);
 * this file is the authoritative source for deploy-time parameters.
 *
 * Keyed by project slug (matches `Project.slug` in Prisma).
 */

export interface ProjectDeploymentConfig {
  /** VPS hostname or IP */
  serverHost: string;
  /** SSH user on the VPS */
  serverUser: string;
  /** Absolute path to the repo on the VPS */
  repoPath: string;
  /** Git branch to deploy */
  branch: string;
  /** PM2 process names to restart after deploy */
  pm2Apps: string[];
  /** Primary live URL for the project */
  domain: string;
  /** NestJS backend port (if applicable) */
  backendPort?: number;
  /** Next.js frontend port (if applicable) */
  frontendPort?: number;
}

export const DEPLOYMENT_CONFIGS: Record<string, ProjectDeploymentConfig> = {
  /**
   * Doorsteps / LocalShop delivery platform
   * Monorepo: sardarsaeedofficial/localshop
   * VPS: Hetzner — 178.105.105.59
   */
  "doorsteps-localshop": {
    serverHost: "178.105.105.59",
    serverUser: "prisom",
    repoPath: "/home/prisom/prisom-panel",
    branch: "master",
    pm2Apps: ["prisom-backend", "prisom-manager"],
    domain: "https://doorstepmanchester.uk",
    backendPort: 3001,
    frontendPort: 3000,
  },
};

/**
 * Convenience helper — returns the deploy config for a project slug, or null.
 */
export function getDeploymentConfig(
  slug: string
): ProjectDeploymentConfig | null {
  return DEPLOYMENT_CONFIGS[slug] ?? null;
}
