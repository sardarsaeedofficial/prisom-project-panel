/**
 * lib/migration/replit-db-detector.ts
 *
 * Sprint 24: Database detection and migration plan generation.
 */

import type { DatabaseDetection, DatabaseMigrationPlan } from "./replit-detection-types";

// ── Database detection ────────────────────────────────────────────────────────

export function detectDatabase(
  allContent: string,
  fileList:   string[],
  deps:       Record<string, string>,
): DatabaseDetection | undefined {
  const hasDrizzleConfig  = fileList.some((f) => /drizzle\.config\.(ts|js|mjs|cjs)$/.test(f));
  const hasPrismaSchema   = fileList.some((f) => f.endsWith("prisma/schema.prisma") || f.endsWith("schema.prisma"));
  const hasMongoose       = !!deps["mongoose"] || !!deps["@typegoose/typegoose"];
  const hasPg             = !!deps["pg"] || !!deps["postgres"] || !!deps["@neondatabase/serverless"] || !!deps["neon"];
  const hasMysql          = !!deps["mysql2"] || !!deps["mysql"];
  const hasSqlite         = !!deps["better-sqlite3"] || !!deps["@libsql/client"];
  const hasReplitDb       = allContent.includes("REPLIT_DB_URL") || !!deps["@replit/database"];
  const hasDrizzlePkg     = !!deps["drizzle-orm"];
  const hasPrismaPkg      = !!deps["@prisma/client"];
  const hasMongodbUri     = allContent.includes("MONGODB_URI") || allContent.includes("MONGO_URI");
  const hasDatabaseUrl    = allContent.includes("DATABASE_URL") || allContent.includes("POSTGRES_URL");

  if (hasReplitDb) {
    return { type: "replit-db", orm: "none", connectionEnvKey: "REPLIT_DB_URL" };
  }

  if (hasMysql) {
    return {
      type: "mysql",
      orm:  hasDrizzlePkg ? "drizzle" : hasPrismaPkg ? "prisma" : "none",
      configFile: hasDrizzleConfig ? "drizzle.config.ts" : undefined,
    };
  }

  if (hasSqlite) {
    return {
      type: "sqlite",
      orm:  hasDrizzlePkg ? "drizzle" : hasPrismaPkg ? "prisma" : "none",
      configFile: hasDrizzleConfig ? "drizzle.config.ts" : undefined,
    };
  }

  if (hasMongoose || hasMongodbUri) {
    return { type: "mongo", orm: "mongoose", connectionEnvKey: "MONGODB_URI" };
  }

  if (hasPg || hasDatabaseUrl || hasDrizzleConfig || hasPrismaSchema) {
    return {
      type: "postgres",
      orm:  hasDrizzlePkg || hasDrizzleConfig ? "drizzle" : hasPrismaPkg || hasPrismaSchema ? "prisma" : "none",
      configFile: hasDrizzleConfig
        ? fileList.find((f) => /drizzle\.config\.(ts|js|mjs|cjs)$/.test(f))
        : hasPrismaSchema
          ? "prisma/schema.prisma"
          : undefined,
      migrationsDir: fileList.some((f) => f.includes("/migrations/")) ? "migrations/" : undefined,
      connectionEnvKey: "DATABASE_URL",
    };
  }

  return undefined;
}

// ── Migration plan ────────────────────────────────────────────────────────────

export function buildDbMigrationPlan(db: DatabaseDetection): DatabaseMigrationPlan {
  const { type, orm } = db;

  if (type === "postgres") {
    if (orm === "drizzle") {
      return {
        dbType: "PostgreSQL",
        orm:    "Drizzle",
        steps: [
          "Provision a PostgreSQL database (Neon, Supabase, Railway, or self-hosted).",
          "Add DATABASE_URL to the Secrets Vault (production environment).",
          "Run `npx drizzle-kit push` (or `pnpm drizzle-kit push`) to push the schema.",
          "Optional: restore a pg_dump snapshot if migrating existing data.",
        ],
        notes: "Drizzle does not run auto-migrations at startup. You must push the schema manually before first deploy.",
      };
    }
    if (orm === "prisma") {
      return {
        dbType: "PostgreSQL",
        orm:    "Prisma",
        steps: [
          "Provision a PostgreSQL database.",
          "Add DATABASE_URL to the Secrets Vault (production environment).",
          "Run `npx prisma migrate deploy` if using migration files.",
          "Or `npx prisma db push` if using schema-push workflow.",
        ],
        notes: "If this is a fresh project, prisma db push is usually sufficient. Use migrate deploy if you have migration history.",
      };
    }
    return {
      dbType: "PostgreSQL",
      steps: [
        "Provision a PostgreSQL database.",
        "Add DATABASE_URL to the Secrets Vault.",
        "Run your schema setup scripts or restore from pg_dump.",
      ],
      notes: "No ORM configuration detected. Schema setup is manual.",
    };
  }

  if (type === "mysql") {
    return {
      dbType: "MySQL",
      orm:    orm !== "none" ? orm : undefined,
      steps: [
        "Provision a MySQL/MariaDB database.",
        "Add DATABASE_URL (or MYSQL_URL) to Secrets Vault.",
        "Run your schema migration tool (Drizzle push, Prisma migrate, etc.).",
      ],
      notes: "Ensure your database credentials include host, port, name, and SSL settings.",
    };
  }

  if (type === "sqlite") {
    return {
      dbType: "SQLite",
      orm:    orm !== "none" ? orm : undefined,
      steps: [
        "Copy the SQLite database file to the VPS (via Import or SCP).",
        "Set the file path in environment config (e.g. DB_PATH).",
        "Alternatively, migrate to PostgreSQL for production stability.",
      ],
      notes: "SQLite is not recommended for multi-process deployments. PM2 cluster mode will cause conflicts.",
    };
  }

  if (type === "mongo") {
    return {
      dbType: "MongoDB",
      orm:    "Mongoose",
      steps: [
        "Provision MongoDB Atlas or a self-hosted MongoDB instance.",
        "Add MONGODB_URI to the Secrets Vault.",
        "Export data from Replit using mongodump and import to the new cluster.",
      ],
      notes: "MongoDB Atlas free tier is suitable for small projects.",
    };
  }

  if (type === "replit-db") {
    return {
      dbType: "Replit KV (Database)",
      steps: [
        "Replit DB is a key-value store specific to Replit — it cannot be migrated directly.",
        "Write a Replit export script using the Replit DB SDK to dump all keys/values.",
        "Store the dump as JSON and import into Redis, PostgreSQL (JSON column), or another KV store.",
        "Update all REPLIT_DB_URL references to the new connection string.",
      ],
      notes: "This is a manual migration. No automated path exists for Replit KV → VPS.",
    };
  }

  return {
    dbType: "Unknown",
    steps: ["No database configuration detected. No action required if this is a stateless app."],
    notes: "",
  };
}
