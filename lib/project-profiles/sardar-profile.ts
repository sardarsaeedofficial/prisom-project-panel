/**
 * lib/project-profiles/sardar-profile.ts
 *
 * Sprint 71: Canonical preset for the Sardar Security ecommerce project.
 * Used as the first reusable migration profile — all Sardar detection
 * falls back to this preset with project-specific fields merged in.
 *
 * No secret values are included — only key names and metadata.
 */

import type { ProjectMigrationProfile } from "./project-profile-types";

export function getSardarProfile(overrides?: {
  projectId?: string;
  slug?: string;
  domain?: string;
}): ProjectMigrationProfile {
  return {
    kind: "sardar_ecommerce",
    label: "Sardar Security — Ecommerce",
    description:
      "Full-stack ecommerce platform with a Node.js API server and a React/Vite static frontend, served via nginx on a VPS with Stripe payments and Cloudinary media.",
    projectId: overrides?.projectId,
    slug: overrides?.slug ?? "sardar-security-project",
    domain:
      overrides?.domain ??
      "sardar-security-project.doorstepmanchester.uk",
    isSardar: true,
    isEcommerce: true,

    expectedServices: [
      {
        name: "API Server",
        kind: "api",
        root: "artifacts/api-server",
        buildCommand:
          "pnpm --filter @workspace/api-server run build",
        startCommand:
          "node --enable-source-maps artifacts/api-server/dist/index.mjs",
        healthPath: "/api/healthz",
        route: "/api/*",
      },
      {
        name: "Static Frontend",
        kind: "static",
        root: "artifacts/sardar-security",
        buildCommand:
          "pnpm --filter @workspace/sardar-security run build",
        outputPath: "artifacts/sardar-security/dist/public",
        route: "/*",
      },
    ],

    expectedEnv: [
      {
        name: "DATABASE_URL",
        category: "database",
        required: true,
        secret: true,
        description: "PostgreSQL connection string",
      },
      {
        name: "SESSION_SECRET",
        category: "auth",
        required: true,
        secret: true,
        description: "Express session secret (min 32 chars)",
      },
      {
        name: "APP_URL",
        category: "app",
        required: true,
        secret: false,
        description: "Public-facing app URL (e.g. https://sardar-security-project.doorstepmanchester.uk)",
      },
      {
        name: "STRIPE_SECRET_KEY",
        category: "stripe",
        required: true,
        secret: true,
        description: "Stripe secret key for server-side API calls",
      },
      {
        name: "STRIPE_PUBLISHABLE_KEY",
        category: "stripe",
        required: true,
        secret: false,
        description: "Stripe publishable key for frontend",
      },
      {
        name: "STRIPE_WEBHOOK_SECRET",
        category: "stripe",
        required: true,
        secret: true,
        description: "Stripe webhook signing secret",
      },
      {
        name: "CLOUDINARY_CLOUD_NAME",
        category: "cloudinary",
        required: false,
        secret: false,
        description: "Cloudinary cloud name for media uploads",
      },
      {
        name: "CLOUDINARY_API_KEY",
        category: "cloudinary",
        required: false,
        secret: true,
        description: "Cloudinary API key",
      },
      {
        name: "CLOUDINARY_API_SECRET",
        category: "cloudinary",
        required: false,
        secret: true,
        description: "Cloudinary API secret",
      },
      {
        name: "SMTP_HOST / RESEND_API_KEY / SENDGRID_API_KEY",
        category: "email",
        required: false,
        secret: true,
        description: "Transactional email provider — one of these three",
      },
    ],

    expectedRoutes: [
      {
        path: "/api/*",
        target: "http://localhost:4100",
        type: "api",
      },
      {
        path: "/*",
        target: "artifacts/sardar-security/dist/public",
        type: "spa_fallback",
      },
    ],

    safetyNotes: [
      "Do not restart the PM2 process (project-sardar-security-project) from the panel UI.",
      "Do not reload nginx from the panel UI — apply routes manually via the server CLI.",
      "Do not run DB migrations from the panel — run them manually after cutover.",
      "Stripe webhook secret must match the configured Stripe endpoint exactly.",
      "Staging domain: staging-sardar-security-project.doorstepmanchester.uk",
      "Production health endpoint: /api/healthz — must return 200 before cutover.",
    ],

    recommendedNextSteps: [
      "Run Source Intake to verify artifacts are present.",
      "Run Deployment Dry Run to confirm build succeeds.",
      "Complete Ecommerce Test Plan and smoke checks.",
      "Complete Staging Trial Migration with DB snapshot.",
      "Verify /api/healthz returns 200 on staging.",
      "Run Live QA Smoke Checks from the Releases page.",
      "Execute Production Cutover only after RC is approved.",
    ],
  };
}
