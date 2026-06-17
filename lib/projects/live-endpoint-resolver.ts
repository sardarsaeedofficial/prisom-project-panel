/**
 * lib/projects/live-endpoint-resolver.ts
 *
 * Server-side resolver that returns the best available public endpoints for a
 * deployed project, using DB domain records + ProjectDeploymentConfig fields.
 *
 * Priority for primaryUrl:
 *   1. Active primary domain with SSL
 *   2. Active primary domain (HTTP)
 *   3. Any active domain
 *   4. config.primaryDomain (manually saved)
 *   5. config.publicPreviewUrl (IP preview, if active)
 *   6. null (internal only)
 *
 * Never returns the panel's own domain or a reserved IP as a project URL.
 */

import { db } from "@/lib/db";

// ── Result type ────────────────────────────────────────────────────────────

export interface ResolvedEndpoint {
  hostname:  string;
  url:       string;
  status:    string;
  sslStatus: string;
  isPrimary: boolean;
}

export interface ProjectEndpoints {
  /** The best available public URL for this project (may be null if not deployed). */
  primaryUrl:   string | null;
  /** Human-readable label for the primary URL (e.g. "Primary domain (HTTPS)"). */
  primaryLabel: string;
  /** All domain records for this project. */
  domains:      ResolvedEndpoint[];
  /** Internal loopback URL (always present if config exists). */
  internalUrl:  string;
  /** IP preview URL if configured and active. */
  ipPreviewUrl: string | null;
  /** Full health-check URL (primaryUrl + healthPath). */
  healthUrl:    string | null;
  /** Full login route URL (primaryUrl + loginPath). */
  loginUrl:     string | null;
  /** Port the PM2 process listens on. */
  port:         number;
}

// ── Resolver ───────────────────────────────────────────────────────────────

/**
 * Resolves all live endpoints for a project.
 * Returns null if no deployment config exists.
 */
export async function resolveProjectLiveEndpoints(
  projectId: string
): Promise<ProjectEndpoints | null> {
  const [config, domainRows] = await Promise.all([
    db.projectDeploymentConfig.findUnique({
      where:  { projectId },
      select: {
        port:               true,
        healthPath:         true,
        loginPath:          true,
        primaryDomain:      true,
        publicPreviewUrl:   true,
        publicPreviewStatus: true,
        publicPreviewMode:  true,
      },
    }),
    db.domain.findMany({
      where:   { projectId },
      select:  { hostname: true, isPrimary: true, status: true, sslStatus: true },
      orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    }),
  ]);

  if (!config) return null;

  const internalUrl = `http://127.0.0.1:${config.port}`;

  // Map domain rows to ResolvedEndpoint (status values come from Prisma as uppercase enum strings)
  const domains: ResolvedEndpoint[] = domainRows.map((d) => {
    const scheme = d.sslStatus === "ACTIVE" ? "https" : "http";
    return {
      hostname:  d.hostname,
      url:       `${scheme}://${d.hostname}`,
      status:    d.status  as string,
      sslStatus: d.sslStatus as string,
      isPrimary: d.isPrimary,
    };
  });

  // ── Priority resolution ────────────────────────────────────────────────────

  let primaryUrl:   string | null = null;
  let primaryLabel: string        = "Internal only";

  // 1. SSL-active primary domain
  const sslPrimary = domains.find(
    (d) => d.isPrimary && d.status === "ACTIVE" && d.sslStatus === "ACTIVE"
  );
  if (sslPrimary) {
    primaryUrl   = sslPrimary.url;
    primaryLabel = "Primary domain (HTTPS)";
  }

  // 2. Any active primary domain (HTTP)
  if (!primaryUrl) {
    const httpPrimary = domains.find((d) => d.isPrimary && d.status === "ACTIVE");
    if (httpPrimary) {
      primaryUrl   = httpPrimary.url;
      primaryLabel = "Primary domain";
    }
  }

  // 3. Any active domain (non-primary)
  if (!primaryUrl) {
    const anyActive = domains.find((d) => d.status === "ACTIVE");
    if (anyActive) {
      primaryUrl   = anyActive.url;
      primaryLabel = "Custom domain";
    }
  }

  // 4. Manually saved primary domain in config
  if (!primaryUrl && config.primaryDomain) {
    primaryUrl   = config.primaryDomain.startsWith("http")
      ? config.primaryDomain
      : `http://${config.primaryDomain}`;
    primaryLabel = "Saved domain";
  }

  // 5. IP preview
  if (!primaryUrl && config.publicPreviewUrl && config.publicPreviewStatus === "active") {
    primaryUrl   = config.publicPreviewUrl;
    primaryLabel = "IP preview";
  }

  const ipPreviewUrl =
    config.publicPreviewUrl && config.publicPreviewStatus === "active"
      ? config.publicPreviewUrl
      : null;

  const healthPath = config.healthPath ?? "/api/healthz";
  const loginPath  = config.loginPath  ?? "/login";

  const healthUrl = primaryUrl
    ? `${primaryUrl.replace(/\/$/, "")}${healthPath}`
    : null;
  const loginUrl = primaryUrl
    ? `${primaryUrl.replace(/\/$/, "")}${loginPath}`
    : null;

  return {
    primaryUrl,
    primaryLabel,
    domains,
    internalUrl,
    ipPreviewUrl,
    healthUrl,
    loginUrl,
    port: config.port,
  };
}
