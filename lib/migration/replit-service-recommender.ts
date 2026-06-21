/**
 * lib/migration/replit-service-recommender.ts
 *
 * Sprint 24: Generates suggested ProjectService configurations from
 * the detected project structure.
 *
 * Generated commands pass through the same Sprint 23 command validator
 * before being shown to the user. We only emit commands we know are valid.
 */

import type {
  ReplitMigrationReport,
  SuggestedProjectService,
  DetectedService,
} from "./replit-detection-types";

// ── Service recommender ───────────────────────────────────────────────────────

export function recommendServices(
  report: Pick<
    ReplitMigrationReport,
    "packageManager" | "isMonorepo" | "frontend" | "backend" | "monorepoPaths"
  >,
): SuggestedProjectService[] {
  const services: SuggestedProjectService[] = [];
  const { packageManager, isMonorepo, frontend, backend } = report;

  const pm = packageManager === "pnpm" ? "pnpm" : packageManager === "yarn" ? "yarn" : "npm";

  // ── Install command (shared for both services if monorepo) ────────────────
  const installCmd = isMonorepo && pm === "pnpm"
    ? "pnpm install --frozen-lockfile"
    : pm === "pnpm"
      ? "pnpm install --frozen-lockfile"
      : pm === "yarn"
        ? "yarn install --frozen-lockfile"
        : "npm install --ignore-scripts";

  // ── Backend / API service ─────────────────────────────────────────────────
  if (backend) {
    const apiService = buildApiService(backend, pm, isMonorepo, installCmd);
    services.push(apiService);
  }

  // ── Frontend / static service ─────────────────────────────────────────────
  if (frontend) {
    const webService = buildWebService(frontend, pm, isMonorepo, installCmd, !!backend);
    services.push(webService);
  }

  // ── Single-service fallback (if neither detected specifically) ─────────────
  if (!backend && !frontend) {
    services.push({
      name:           "App",
      slug:           "app",
      serviceType:    "node",
      workingDir:     ".",
      packageManager: pm,
      installCommand: installCmd,
      buildCommand:   pm === "pnpm" ? "pnpm run build" : pm === "yarn" ? "yarn build" : "npm run build",
      startCommand:   pm === "pnpm" ? "pnpm start" : pm === "yarn" ? "yarn start" : "npm start",
      healthPath:     "/",
      isPrimary:      true,
      notes:          "Generic service — no specific framework detected. Adjust commands for your project.",
    });
  }

  return services;
}

// ── API service builder ───────────────────────────────────────────────────────

function buildApiService(
  backend:    DetectedService,
  pm:         string,
  isMonorepo: boolean,
  installCmd: string,
): SuggestedProjectService {
  const workingDir = backend.workingDir ?? ".";
  const pkg        = backend.packageName;
  const framework  = backend.framework ?? "node";

  let buildCommand:  string | undefined;
  let startCommand:  string | undefined;
  let notes:         string | undefined;

  if (isMonorepo && pm === "pnpm" && pkg) {
    // pnpm workspace — build with filter
    const filterPkg = pkg.startsWith("@") ? pkg : `@workspace/${pkg}`;
    buildCommand = `pnpm --filter ${filterPkg} run build`;

    // Try to figure out start command from entryFile
    if (backend.entryFile) {
      const entry = backend.entryFile
        .replace(/^src\//, "dist/")
        .replace(/\.ts$/, ".js")
        .replace(/\.mts$/, ".mjs");
      startCommand = `node --enable-source-maps ${entry}`;
    } else {
      startCommand = `node --enable-source-maps dist/index.js`;
      notes = "Adjust start command to match your compiled output path.";
    }
  } else if (framework === "nextjs") {
    buildCommand  = pm === "pnpm" ? "pnpm run build" : pm === "yarn" ? "yarn build" : "npm run build";
    startCommand  = pm === "pnpm" ? "pnpm start" : pm === "yarn" ? "yarn start" : "npm start";
  } else {
    // Express/Fastify/plain Node
    buildCommand = backend.buildScript
      ? (pm === "pnpm" ? `pnpm run ${backend.buildScript}` : pm === "yarn" ? `yarn ${backend.buildScript}` : `npm run ${backend.buildScript}`)
      : undefined;

    if (backend.entryFile) {
      const entry = backend.entryFile.endsWith(".ts")
        ? backend.entryFile.replace(/src\//, "dist/").replace(".ts", ".js")
        : backend.entryFile;
      startCommand = `node --enable-source-maps ${entry}`;
    } else {
      startCommand = pm === "pnpm" ? "pnpm start" : pm === "yarn" ? "yarn start" : "npm start";
    }
  }

  return {
    name:           "API Server",
    slug:           "api",
    serviceType:    "node",
    workingDir,
    packageManager: pm,
    installCommand: installCmd,
    buildCommand,
    startCommand,
    healthPath:     "/api/healthz",
    isPrimary:      false,
    notes,
  };
}

// ── Web/static service builder ────────────────────────────────────────────────

function buildWebService(
  frontend:   DetectedService,
  pm:         string,
  isMonorepo: boolean,
  installCmd: string,
  hasBackend: boolean,
): SuggestedProjectService {
  const workingDir = frontend.workingDir ?? ".";
  const pkg        = frontend.packageName;
  const framework  = frontend.framework;

  // Next.js runs as a Node service, not static
  if (framework === "nextjs") {
    const buildCmd = pm === "pnpm" ? "pnpm run build" : pm === "yarn" ? "yarn build" : "npm run build";
    const startCmd = pm === "pnpm" ? "pnpm start"      : pm === "yarn" ? "yarn start"  : "npm start";
    return {
      name:           "Next.js App",
      slug:           "web",
      serviceType:    "node",
      workingDir,
      packageManager: pm,
      installCommand: installCmd,
      buildCommand:   buildCmd,
      startCommand:   startCmd,
      healthPath:     "/",
      isPrimary:      true,
      notes:          "Next.js runs as a Node service, not a static site.",
    };
  }

  // Vite/React/Vue static build
  let buildCommand: string;
  if (isMonorepo && pm === "pnpm" && pkg) {
    const filterPkg = pkg.startsWith("@") ? pkg : `@workspace/${pkg}`;
    buildCommand = `pnpm --filter ${filterPkg} run build`;
  } else {
    buildCommand = pm === "pnpm" ? "pnpm run build" : pm === "yarn" ? "yarn build" : "npm run build";
  }

  const outputDir  = frontend.outputDir ?? "dist";

  return {
    name:            hasBackend ? "Web Frontend" : "Web",
    slug:            "web",
    serviceType:     "static",
    workingDir,
    packageManager:  pm,
    // Static services share the monorepo install — no per-service install needed
    installCommand:  isMonorepo ? undefined : installCmd,
    buildCommand,
    staticOutputDir: outputDir,
    spaFallback:     true,
    isPrimary:       true,
    notes:           `Static build output expected at: ${outputDir}`,
  };
}
