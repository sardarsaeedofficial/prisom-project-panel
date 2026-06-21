/**
 * lib/projects/service-presets.ts
 *
 * Sprint 23: Static preset configurations for common project service layouts.
 *
 * These are pure data — no server dependencies, no async, safe to import
 * from both server components and client components.
 *
 * Kept separate from app/actions/project-services.ts because "use server"
 * files require all exported functions to be async Server Actions.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

/** One service definition inside a preset (same shape as CreateServiceInput without projectId). */
export type ServiceDefinition = {
  name:            string;
  slug:            string;
  serviceType:     string;
  workingDir?:     string;
  packageManager?: string;
  installCommand?: string;
  buildCommand?:   string;
  startCommand?:   string;
  internalPort?:   number;
  healthPath?:     string;
  staticOutputDir?: string;
  spaFallback?:    boolean;
  isPrimary?:      boolean;
};

export type ServicePreset = {
  id:          string;
  label:       string;
  description: string;
  services:    ServiceDefinition[];
};

// ── Preset list ───────────────────────────────────────────────────────────────

export function getServicePresets(): ServicePreset[] {
  return [
    {
      id:          "replit-react-express",
      label:       "React/Vite + Express API (pnpm workspace)",
      description: "Two services: a Node API backend + a Vite/React static frontend built with pnpm workspaces.",
      services: [
        {
          name:           "API Server",
          slug:           "api",
          serviceType:    "node",
          workingDir:     ".",
          packageManager: "pnpm",
          installCommand: "pnpm install --frozen-lockfile",
          buildCommand:   "pnpm --filter @workspace/api-server run build",
          startCommand:   "node --enable-source-maps artifacts/api-server/dist/index.mjs",
          healthPath:     "/api/healthz",
          isPrimary:      false,
        },
        {
          name:            "Web Frontend",
          slug:            "web",
          serviceType:     "static",
          workingDir:      ".",
          packageManager:  "pnpm",
          buildCommand:    "pnpm --filter @workspace/web run build",
          staticOutputDir: "artifacts/web/dist/public",
          spaFallback:     true,
          isPrimary:       true,
        },
      ],
    },
    {
      id:          "nextjs",
      label:       "Next.js App (single service)",
      description: "Single Node.js service running Next.js.",
      services: [
        {
          name:           "Next.js",
          slug:           "web",
          serviceType:    "node",
          workingDir:     ".",
          packageManager: "npm",
          installCommand: "npm install --ignore-scripts",
          buildCommand:   "npm run build",
          startCommand:   "npm start",
          healthPath:     "/",
          isPrimary:      true,
        },
      ],
    },
    {
      id:          "express-api",
      label:       "Express API only",
      description: "Single Node.js API service.",
      services: [
        {
          name:           "API",
          slug:           "api",
          serviceType:    "node",
          workingDir:     ".",
          packageManager: "npm",
          installCommand: "npm install --ignore-scripts",
          buildCommand:   "",
          startCommand:   "node server.js",
          healthPath:     "/api/healthz",
          isPrimary:      true,
        },
      ],
    },
    {
      id:          "static-only",
      label:       "Static site (Vite / React / Vue)",
      description: "Single static service — build once, serve with nginx.",
      services: [
        {
          name:            "Web",
          slug:            "web",
          serviceType:     "static",
          workingDir:      ".",
          packageManager:  "npm",
          installCommand:  "npm install --ignore-scripts",
          buildCommand:    "npm run build",
          staticOutputDir: "dist",
          spaFallback:     true,
          isPrimary:       true,
        },
      ],
    },
  ];
}
