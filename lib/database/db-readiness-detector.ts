/**
 * lib/database/db-readiness-detector.ts
 *
 * Sprint 45: Generates a DatabaseReadinessReport for a project.
 *
 * Detection strategy (in order of priority):
 *  1. ProjectMigrationReport.reportJson — most reliable (file-scanned)
 *  2. ProjectService buildCommand/startCommand — ORM keyword detection
 *  3. Env var presence — provider inference (DATABASE_URL → postgresql, MONGODB_URI → mongodb)
 *
 * Safety rules:
 *  - No secret values in the report
 *  - "blocked" commands never included in output
 *  - Only masked URL previews shown
 */

import { db }             from "@/lib/db";
import { getDbEnvFindings } from "./db-env-safety";
import type {
  DatabaseReadinessReport,
  DatabaseTool,
  DatabaseProvider,
  DatabaseCommand,
  DatabaseManualStep,
  DatabaseToolFinding,
  DatabaseProviderFinding,
} from "./db-readiness-types";

// ── Blocked commands (never generated) ───────────────────────────────────────

const BLOCKED_PATTERNS = [
  /prisma\s+migrate\s+reset/i,
  /drizzle-kit\s+push\s+--force/i,
  /psql\s+-f/i,
  /\bDROP\s+TABLE\b/i,
  /\bTRUNCATE\b/i,
  /\bDELETE\s+FROM\b/i,
];

export function isBlockedCommand(cmd: string): boolean {
  return BLOCKED_PATTERNS.some((re) => re.test(cmd));
}

// ── Detection helpers ─────────────────────────────────────────────────────────

function detectProviderFromUrl(url: string): DatabaseProvider {
  const lower = url.toLowerCase();
  if (lower.includes("neon.tech"))            return "neon";
  if (lower.includes("supabase"))             return "supabase";
  if (lower.startsWith("postgresql://") || lower.startsWith("postgres://")) return "postgresql";
  if (lower.startsWith("mysql://"))           return "mysql";
  if (lower.startsWith("mongodb://") || lower.startsWith("mongodb+srv://")) return "mongodb";
  if (lower.startsWith("redis://") || lower.startsWith("rediss://"))        return "redis";
  if (lower.endsWith(".db") || lower.includes("sqlite")) return "sqlite";
  return "unknown";
}

function detectHostFromUrl(url: string): { host?: string; databaseName?: string } {
  try {
    const parsed = new URL(url);
    const host   = parsed.hostname || undefined;
    const dbName = parsed.pathname.replace(/^\//, "") || undefined;
    return { host, databaseName: dbName };
  } catch {
    return {};
  }
}

function detectProviderFromEnvFindings(
  envFindings: Awaited<ReturnType<typeof getDbEnvFindings>>,
): { provider: DatabaseProvider; detectedVia: string } {
  for (const f of envFindings) {
    if (!f.valueConfigured || !f.maskedPreview) continue;
    const lower = f.maskedPreview.toLowerCase();
    if (lower.includes("neon.tech"))             return { provider: "neon",       detectedVia: `${f.name} host` };
    if (lower.includes("supabase"))              return { provider: "supabase",   detectedVia: `${f.name} host` };
    if (lower.startsWith("postgresql://") || lower.startsWith("postgres://"))
                                                  return { provider: "postgresql", detectedVia: `${f.name} scheme` };
    if (lower.startsWith("mongodb"))             return { provider: "mongodb",    detectedVia: `${f.name} scheme` };
    if (lower.startsWith("redis"))               return { provider: "redis",      detectedVia: `${f.name} scheme` };
  }
  // Provider inference from env var names
  const envNames = envFindings.map((f) => f.name);
  if (envNames.includes("MONGODB_URI"))          return { provider: "mongodb",    detectedVia: "MONGODB_URI present" };
  if (envNames.includes("SUPABASE_URL"))         return { provider: "supabase",   detectedVia: "SUPABASE_URL present" };
  if (envNames.some((n) => n.startsWith("POSTGRES"))) return { provider: "postgresql", detectedVia: "POSTGRES_* env var present" };
  return { provider: "unknown", detectedVia: "no conclusive signal" };
}

function detectToolFromServices(
  services: Array<{ buildCommand: string | null; startCommand: string | null; name: string }>,
): { tool: DatabaseTool; detectedVia: string } | null {
  for (const svc of services) {
    const combined = `${svc.buildCommand ?? ""} ${svc.startCommand ?? ""}`.toLowerCase();
    if (combined.includes("prisma"))        return { tool: "prisma",   detectedVia: `service "${svc.name}" command` };
    if (combined.includes("drizzle"))       return { tool: "drizzle",  detectedVia: `service "${svc.name}" command` };
    if (combined.includes("typeorm"))       return { tool: "typeorm",  detectedVia: `service "${svc.name}" command` };
    if (combined.includes("sequelize"))     return { tool: "sequelize", detectedVia: `service "${svc.name}" command` };
  }
  return null;
}

// ── Command generation ────────────────────────────────────────────────────────

function buildPrismaCommands(pm: string): DatabaseCommand[] {
  return [
    {
      id:              "prisma-generate",
      label:           "Generate Prisma Client",
      command:         `${pm} prisma generate`,
      safety:          "safe",
      description:     "Regenerates the Prisma Client from your schema. No database changes.",
      requiresConfirm: false,
    },
    {
      id:              "prisma-migrate-status",
      label:           "Check Migration Status",
      command:         `${pm} prisma migrate status`,
      safety:          "safe",
      description:     "Lists which migrations have been applied and which are pending. Read-only.",
      requiresConfirm: false,
    },
    {
      id:              "prisma-migrate-deploy",
      label:           "Deploy Pending Migrations",
      command:         `${pm} prisma migrate deploy`,
      safety:          "caution",
      description:     "Applies all pending migrations to the production database. Irreversible — back up first.",
      requiresConfirm: true,
      confirmText:     "RUN DB CHECK",
    },
    {
      id:              "prisma-db-push",
      label:           "Push Schema (no migration file)",
      command:         `${pm} prisma db push`,
      safety:          "caution",
      description:     "Pushes the schema to the DB without creating a migration file. Back up first.",
      requiresConfirm: true,
      confirmText:     "RUN DB CHECK",
    },
  ];
}

function buildDrizzleCommands(pm: string): DatabaseCommand[] {
  return [
    {
      id:              "drizzle-check",
      label:           "Check Schema Status",
      command:         `${pm} drizzle-kit check`,
      safety:          "safe",
      description:     "Checks the schema for consistency without touching the database.",
      requiresConfirm: false,
    },
    {
      id:              "drizzle-push",
      label:           "Push Schema to Database",
      command:         `${pm} drizzle-kit push`,
      safety:          "caution",
      description:     "Pushes schema changes to the database. Irreversible — back up first.",
      requiresConfirm: true,
      confirmText:     "RUN DB CHECK",
    },
    {
      id:              "drizzle-migrate",
      label:           "Apply Migrations",
      command:         `${pm} drizzle-kit migrate`,
      safety:          "caution",
      description:     "Applies pending migration files to the database. Irreversible — back up first.",
      requiresConfirm: true,
      confirmText:     "RUN DB CHECK",
    },
  ];
}

function buildGenericCommands(): DatabaseCommand[] {
  return [
    {
      id:              "db-backup-reminder",
      label:           "Create Backup First",
      command:         "# Use Prisom → Backups to create a snapshot before any schema changes",
      safety:          "safe",
      description:     "No schema tool detected. Always back up before running schema changes manually.",
      requiresConfirm: false,
    },
  ];
}

// ── Manual steps ──────────────────────────────────────────────────────────────

function buildManualSteps(
  tool: DatabaseTool,
  provider: DatabaseProvider,
  hasMissingRequired: boolean,
): DatabaseManualStep[] {
  const steps: DatabaseManualStep[] = [];

  steps.push({
    id:          "backup-before-migrate",
    label:       "Create a database backup before any migration",
    description: "Use Prisom → Backups to snapshot the database. Restore if a migration fails.",
    severity:    "required",
  });

  if (hasMissingRequired) {
    steps.push({
      id:          "configure-db-url",
      label:       "Add DATABASE_URL to Secrets Vault",
      description: "Go to the Secrets tab and add the production DATABASE_URL from your database provider.",
      severity:    "required",
    });
  }

  if (tool === "prisma") {
    steps.push({
      id:          "prisma-review-migrations",
      label:       "Review pending migrations before deploying",
      description: "Run `prisma migrate status` to verify which migrations are pending. Review each migration file.",
      severity:    "recommended",
    });
  }

  if (tool === "drizzle") {
    steps.push({
      id:          "drizzle-review-schema",
      label:       "Review schema diff before pushing",
      description: "Run `drizzle-kit check` and review the diff output carefully before pushing to production.",
      severity:    "recommended",
    });
  }

  if (provider === "neon" || provider === "supabase") {
    steps.push({
      id:          "neon-direct-url",
      label:       "Configure DIRECT_URL for migrations",
      description: `${provider === "neon" ? "Neon" : "Supabase"} uses a connection pooler by default. Add DIRECT_URL (without pooling) for Prisma migrate/push commands.`,
      severity:    "recommended",
    });
  }

  steps.push({
    id:          "test-connection",
    label:       "Run a connection test before first deploy",
    description: "Use the Database tab → Test Connection to verify connectivity from the panel server.",
    severity:    "recommended",
  });

  return steps;
}

// ── Score ─────────────────────────────────────────────────────────────────────

function computeScore(
  toolFound:          boolean,
  providerFound:      boolean,
  requiredEnvsOk:     boolean,
  connectionTested:   boolean,
): number {
  let score = 0;
  if (toolFound)        score += 25;
  if (providerFound)    score += 25;
  if (requiredEnvsOk)   score += 30;
  if (connectionTested) score += 20;
  return score;
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function generateReadinessReport(
  projectId: string,
): Promise<DatabaseReadinessReport | null> {
  // Load project
  const project = await db.project.findUnique({
    where:  { id: projectId },
    select: { id: true, slug: true },
  });
  if (!project) return null;

  // Load env findings (safe — no secrets returned)
  const envFindings = await getDbEnvFindings(projectId);

  // Load services for ORM detection from commands
  const services = await db.projectService.findMany({
    where:  { projectId, isEnabled: true },
    select: { name: true, buildCommand: true, startCommand: true },
  });

  // Load latest migration report if available
  type MigrationDbSection = {
    type:          string;
    orm?:          string;
    configFile?:   string;
    migrationsDir?: string;
  };
  let migrationDb: MigrationDbSection | null = null;
  let packageManager = "pnpm";
  try {
    const latestReport = await db.projectMigrationReport.findFirst({
      where:   { projectId },
      orderBy: { createdAt: "desc" },
      select:  { reportJson: true },
    });
    if (latestReport?.reportJson && typeof latestReport.reportJson === "object") {
      const json = latestReport.reportJson as Record<string, unknown>;
      if (json["database"] && typeof json["database"] === "object" && !Array.isArray(json["database"])) {
        const raw = json["database"] as Record<string, unknown>;
        migrationDb = {
          type:          typeof raw["type"] === "string" ? raw["type"] : "unknown",
          orm:           typeof raw["orm"] === "string" ? raw["orm"] : undefined,
          configFile:    typeof raw["configFile"] === "string" ? raw["configFile"] : undefined,
          migrationsDir: typeof raw["migrationsDir"] === "string" ? raw["migrationsDir"] : undefined,
        };
      }
      if (typeof json["packageManager"] === "string") {
        packageManager = json["packageManager"];
      }
    }
  } catch {
    // Migration report table may not exist — ignore
  }

  // ── Tool detection ────────────────────────────────────────────────────────

  let toolFinding: DatabaseToolFinding | null = null;

  if (migrationDb?.orm && migrationDb.orm !== "none" && migrationDb.orm !== "unknown") {
    toolFinding = {
      tool:          migrationDb.orm as DatabaseTool,
      configFile:    migrationDb.configFile,
      migrationsDir: migrationDb.migrationsDir,
      detectedVia:   "migration report (file scan)",
    };
  } else {
    const fromServices = detectToolFromServices(services);
    if (fromServices) {
      toolFinding = { ...fromServices };
    }
  }

  // ── Provider detection ────────────────────────────────────────────────────

  let providerFinding: DatabaseProviderFinding | null = null;

  if (migrationDb?.type && migrationDb.type !== "none" && migrationDb.type !== "unknown") {
    // Migration report uses "postgres" — normalize to "postgresql"
    const rawType = migrationDb.type === "postgres" ? "postgresql" : migrationDb.type as DatabaseProvider;
    providerFinding = {
      provider:    rawType,
      detectedVia: "migration report (file scan)",
    };
  } else {
    const { provider, detectedVia } = detectProviderFromEnvFindings(envFindings);
    if (provider !== "unknown") {
      providerFinding = { provider, detectedVia };
    }
  }

  // Enrich provider with masked host info from env
  if (providerFinding) {
    const dbUrlFinding = envFindings.find(
      (f) => f.name === "DATABASE_URL" && f.valueConfigured && f.maskedPreview,
    );
    if (dbUrlFinding?.maskedPreview) {
      try {
        const { host, databaseName } = detectHostFromUrl(
          dbUrlFinding.maskedPreview.replace("***", "xxx"),
        );
        providerFinding.host         = host;
        providerFinding.databaseName = databaseName;
      } catch {
        // ignore
      }
    }
  }

  // ── Validate provider isn't the Prisom panel database ────────────────────
  if (providerFinding?.host) {
    const panelHost = (process.env.DATABASE_URL ?? "").toLowerCase();
    if (panelHost.includes(providerFinding.host)) {
      providerFinding.host = undefined;
    }
  }

  // ── Command generation ────────────────────────────────────────────────────

  const pm = packageManager === "yarn" ? "yarn" : packageManager === "npm" ? "npx" : "pnpm";

  let commands: DatabaseCommand[] = [];
  if (toolFinding?.tool === "prisma") {
    commands = buildPrismaCommands(pm);
  } else if (toolFinding?.tool === "drizzle") {
    commands = buildDrizzleCommands(pm);
  } else {
    commands = buildGenericCommands();
  }

  // ── Warnings / blockers ───────────────────────────────────────────────────

  const warnings: string[] = [];
  const blockers: string[] = [];

  const requiredMissing = envFindings.filter(
    (f) => f.required && !f.valueConfigured,
  );
  requiredMissing.forEach((f) => blockers.push(`${f.name} is required but not configured.`));

  if (!toolFinding) {
    warnings.push("No database ORM detected. If this project uses a database, configure it before deploying.");
  }

  if (!providerFinding || providerFinding.provider === "unknown") {
    if (envFindings.some((f) => f.presentInVault)) {
      warnings.push("Database provider could not be determined from env vars.");
    }
  }

  const neonOrSupabase =
    providerFinding?.provider === "neon" || providerFinding?.provider === "supabase";
  if (neonOrSupabase) {
    const hasDirectUrl = envFindings.some((f) => f.name === "DIRECT_URL" && f.valueConfigured);
    if (!hasDirectUrl) {
      warnings.push(
        `${providerFinding?.provider === "neon" ? "Neon" : "Supabase"} uses a connection pooler. Add DIRECT_URL (non-pooling) for reliable schema migrations.`,
      );
    }
  }

  // ── Manual steps ──────────────────────────────────────────────────────────

  const manualSteps = buildManualSteps(
    toolFinding?.tool ?? "unknown",
    providerFinding?.provider ?? "unknown",
    requiredMissing.length > 0,
  );

  // ── Score ─────────────────────────────────────────────────────────────────

  const readinessScore = computeScore(
    toolFinding !== null,
    providerFinding !== null && providerFinding.provider !== "unknown",
    requiredMissing.length === 0,
    false,
  );

  return {
    projectId,
    generatedAt:  new Date().toISOString(),
    tool:         toolFinding,
    provider:     providerFinding,
    envFindings,
    commands,
    manualSteps,
    warnings,
    blockers,
    readinessScore,
    isReady:      blockers.length === 0 && readinessScore >= 50,
  };
}
