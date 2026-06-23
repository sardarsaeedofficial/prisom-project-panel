/**
 * lib/routing/project-route-types.ts
 *
 * Sprint 44: Pure types for multi-service production routing.
 * No server dependencies — safe to import from client or server.
 */

// ── Route target type ─────────────────────────────────────────────────────────

export type ProjectRouteTargetType = "service" | "static" | "redirect";

// ── Individual route rule ─────────────────────────────────────────────────────

export type ProjectRouteRule = {
  id:               string;
  pathPattern:      string;
  targetType:       ProjectRouteTargetType;
  serviceId?:       string;
  serviceName?:     string;
  targetPort?:      number;
  staticOutputPath?: string;
  spaFallback?:     boolean;
  priority:         number;
  healthPath?:      string;
  notes?:           string;
};

// ── Full route map ────────────────────────────────────────────────────────────

export type ProjectRouteMap = {
  projectId:   string;
  domain:      string;
  generatedAt: string;
  rules:       ProjectRouteRule[];
  warnings:    string[];
  blockers:    string[];
};

// ── Nginx apply result ────────────────────────────────────────────────────────

export type RouteApplyResult = {
  ok:            boolean;
  error?:        string;
  configPath?:   string;
  backupPath?:   string;
  nginxOutput?:  string;
};

// ── Route health check result ─────────────────────────────────────────────────

export type RouteHealthResult = {
  url:        string;
  label:      string;
  ok:         boolean;
  statusCode?: number;
  error?:     string;
  durationMs: number;
};

export type ProjectRouteHealthReport = {
  domain:      string;
  checkedAt:   string;
  checks:      RouteHealthResult[];
  allOk:       boolean;
};

// ── Server action return shape ────────────────────────────────────────────────

export type ProjectRoutingActionResult = {
  ok:             boolean;
  error?:         string;
  routeMap?:      ProjectRouteMap;
  nginxPreview?:  string;
  warnings?:      string[];
  blockers?:      string[];
  backupPath?:    string;
  nginxOutput?:   string;
};
