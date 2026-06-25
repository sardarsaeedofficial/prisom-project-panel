/**
 * lib/project-templates/builtin-project-templates.ts
 *
 * Sprint 72: Five built-in project migration templates.
 * Ecommerce, generic web app, API service, static site, and custom project.
 * No secret values — only key names, hints, and structural guidance.
 */

import type { ProjectTemplate } from "./project-template-types";

// ── 1. Ecommerce Migration ────────────────────────────────────────────────────

const ecommerceTemplate: ProjectTemplate = {
  id: "ecommerce",
  kind: "ecommerce",
  label: "Ecommerce Migration",
  description:
    "Full-stack ecommerce app with a Node.js API, React/Vite static frontend, Stripe payments, and optional media uploads. Suitable for Sardar-style and other ecommerce platforms.",
  bestFor: [
    "Online stores with Stripe checkout",
    "Projects with a separate API + frontend build",
    "Apps needing DB, auth, media, and email",
    "Migrations from Replit ecommerce projects",
  ],
  expectedServices: [
    {
      name: "API Server",
      kind: "api",
      rootHint: "artifacts/api-server",
      buildCommandHint: "pnpm --filter @workspace/api-server run build",
      startCommandHint: "node --enable-source-maps dist/index.mjs",
      healthPathHint: "/api/healthz",
      routeHint: "/api/*",
    },
    {
      name: "Static Frontend",
      kind: "static",
      rootHint: "artifacts/frontend",
      buildCommandHint: "pnpm --filter @workspace/frontend run build",
      outputPathHint: "dist/public",
      routeHint: "/*",
    },
    {
      name: "Worker / Queue (optional)",
      kind: "worker",
      rootHint: "artifacts/worker",
      buildCommandHint: "pnpm --filter @workspace/worker run build",
      startCommandHint: "node dist/worker.mjs",
    },
  ],
  expectedEnv: [
    {
      name: "DATABASE_URL",
      category: "database",
      required: true,
      secret: true,
      description: "PostgreSQL / MySQL connection string",
    },
    {
      name: "SESSION_SECRET",
      category: "auth",
      required: true,
      secret: true,
      description: "Server-side session secret (min 32 chars)",
    },
    {
      name: "APP_URL",
      category: "app",
      required: true,
      secret: false,
      description: "Public URL of the app (e.g. https://example.com)",
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
      description: "Stripe publishable key (safe for frontend)",
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
      name: "RESEND_API_KEY / SENDGRID_API_KEY / SMTP_HOST",
      category: "email",
      required: false,
      secret: true,
      description: "Transactional email provider",
    },
    {
      name: "STRIPE_WEBHOOK_SECRET",
      category: "webhook",
      required: true,
      secret: true,
      description: "Must match the configured Stripe webhook endpoint exactly",
    },
  ],
  recommendedPages: [
    { label: "Source Intake",   hrefSuffix: "/publishing",  reason: "Import and validate source artifacts" },
    { label: "Migration",       hrefSuffix: "/migration",   reason: "Run dry runs, staging trial, ecommerce test" },
    { label: "Backups",         hrefSuffix: "/backups",     reason: "Create DB backup before cutover" },
    { label: "Publishing",      hrefSuffix: "/publishing",  reason: "Deployment configuration and env vars" },
    { label: "Releases",        hrefSuffix: "/releases",    reason: "RC approval and production cutover" },
    { label: "Monitoring",      hrefSuffix: "/monitoring",  reason: "Post-cutover health monitoring" },
    { label: "Operator Runbook", hrefSuffix: "/runbook",   reason: "Document go-live operations" },
  ],
  onboardingChecklist: [
    { id: "ec-1",  label: "Clone or import source artifacts",           description: "Run Source Intake to validate source structure.", required: true },
    { id: "ec-2",  label: "Review expected services",                   description: "Confirm API server and static frontend roots.", required: true },
    { id: "ec-3",  label: "Add DATABASE_URL env var",                   description: "PostgreSQL connection string for the production database.", required: true },
    { id: "ec-4",  label: "Add SESSION_SECRET env var",                 description: "At least 32 characters, random string.", required: true },
    { id: "ec-5",  label: "Add APP_URL env var",                        description: "Full public URL of the deployed app.", required: true },
    { id: "ec-6",  label: "Add Stripe keys",                            description: "STRIPE_SECRET_KEY, STRIPE_PUBLISHABLE_KEY, STRIPE_WEBHOOK_SECRET.", required: true },
    { id: "ec-7",  label: "Configure Cloudinary (optional)",            description: "Required if app uses image uploads.", required: false },
    { id: "ec-8",  label: "Configure email provider (optional)",        description: "RESEND_API_KEY or SMTP_HOST for transactional email.", required: false },
    { id: "ec-9",  label: "Run Deployment Dry Run",                     description: "Confirm build succeeds without errors.", required: true },
    { id: "ec-10", label: "Run Ecommerce Test Plan",                    description: "Smoke checks on product pages, cart, checkout flow.", required: true },
    { id: "ec-11", label: "Run Staging Trial Migration",                description: "Full DB snapshot + restore on staging.", required: true },
    { id: "ec-12", label: "Verify /api/healthz returns 200",            description: "API health check must pass before production cutover.", required: true },
    { id: "ec-13", label: "Create DB backup before cutover",            description: "Run from Backups page — verify restore works.", required: true },
    { id: "ec-14", label: "Approve Release Candidate",                  description: "Generate RC report and mark as approved.", required: true },
    { id: "ec-15", label: "Run Live QA Smoke Checks",                   description: "All 18-item checklist on Releases page.", required: true },
    { id: "ec-16", label: "Execute Production Cutover",                 description: "Apply routes via the guarded Execution panel.", required: true },
    { id: "ec-17", label: "Verify Stripe webhooks are live",            description: "Check Stripe dashboard webhook delivery logs after cutover.", required: true },
    { id: "ec-18", label: "Complete post-cutover monitoring review",    description: "Monitor for 30 min after cutover; mark incident reviewed if any.", required: true },
  ],
  safetyNotes: [
    "Do not restart PM2 from the panel UI.",
    "Do not reload nginx from the panel UI.",
    "Do not run DB migrations from the panel.",
    "Stripe webhook secret must exactly match the Stripe dashboard endpoint.",
    "Confirm ecommerce smoke checks pass before going live.",
    "Always create a DB backup before production cutover.",
  ],
};

// ── 2. Generic Web App ────────────────────────────────────────────────────────

const webAppTemplate: ProjectTemplate = {
  id: "web_app",
  kind: "web_app",
  label: "Generic Web App",
  description:
    "Full-stack web application with a frontend build and an optional API layer. No ecommerce requirements.",
  bestFor: [
    "Next.js / Remix / SvelteKit apps",
    "React + Express API combos",
    "Internal tools and dashboards",
    "Projects without Stripe or ecommerce",
  ],
  expectedServices: [
    {
      name: "Frontend",
      kind: "static",
      buildCommandHint: "pnpm run build",
      outputPathHint: "dist",
      routeHint: "/*",
    },
    {
      name: "API (optional)",
      kind: "api",
      buildCommandHint: "pnpm run build",
      startCommandHint: "node dist/index.mjs",
      healthPathHint: "/api/health",
      routeHint: "/api/*",
    },
  ],
  expectedEnv: [
    {
      name: "APP_URL",
      category: "app",
      required: true,
      secret: false,
      description: "Public URL of the app",
    },
    {
      name: "SESSION_SECRET / JWT_SECRET",
      category: "auth",
      required: false,
      secret: true,
      description: "Auth secret if the app uses sessions or JWTs",
    },
    {
      name: "DATABASE_URL",
      category: "database",
      required: false,
      secret: true,
      description: "Database connection string (if app has a DB)",
    },
  ],
  recommendedPages: [
    { label: "Source Intake",  hrefSuffix: "/publishing", reason: "Import and validate source" },
    { label: "Migration",      hrefSuffix: "/migration",  reason: "Run deployment dry run" },
    { label: "Publishing",     hrefSuffix: "/publishing", reason: "Configure env vars and services" },
    { label: "Releases",       hrefSuffix: "/releases",   reason: "Production cutover" },
    { label: "Monitoring",     hrefSuffix: "/monitoring", reason: "Post-cutover health" },
  ],
  onboardingChecklist: [
    { id: "wa-1", label: "Import source artifacts",           description: "Run Source Intake.", required: true },
    { id: "wa-2", label: "Set APP_URL env var",               description: "Full public URL.", required: true },
    { id: "wa-3", label: "Add auth secrets if needed",        description: "SESSION_SECRET or JWT_SECRET.", required: false },
    { id: "wa-4", label: "Add DATABASE_URL if app has a DB",  description: "Connection string.", required: false },
    { id: "wa-5", label: "Run Deployment Dry Run",            description: "Confirm build succeeds.", required: true },
    { id: "wa-6", label: "Approve Release Candidate",         description: "Generate RC report.", required: true },
    { id: "wa-7", label: "Execute Production Cutover",        description: "Apply routes via guarded Execution panel.", required: true },
    { id: "wa-8", label: "Verify app is live",                description: "Check domain returns 200.", required: true },
  ],
  safetyNotes: [
    "Do not restart PM2 from the panel UI.",
    "Do not reload nginx from the panel UI.",
    "Always run a deployment dry run before production cutover.",
  ],
};

// ── 3. API Service ────────────────────────────────────────────────────────────

const apiServiceTemplate: ProjectTemplate = {
  id: "api_service",
  kind: "api_service",
  label: "API Service",
  description:
    "Backend-only Node.js service with a health endpoint. No frontend build required.",
  bestFor: [
    "REST or GraphQL API backends",
    "Microservices",
    "Webhook receivers",
    "Background job processors",
  ],
  expectedServices: [
    {
      name: "API",
      kind: "api",
      buildCommandHint: "pnpm run build",
      startCommandHint: "node dist/index.mjs",
      healthPathHint: "/api/healthz",
      routeHint: "/*",
    },
  ],
  expectedEnv: [
    {
      name: "DATABASE_URL",
      category: "database",
      required: false,
      secret: true,
      description: "Database connection string if API is stateful",
    },
    {
      name: "API_SECRET / WEBHOOK_SECRET",
      category: "other",
      required: false,
      secret: true,
      description: "API authentication token or webhook secret",
    },
  ],
  recommendedPages: [
    { label: "Source Intake", hrefSuffix: "/publishing", reason: "Validate source" },
    { label: "Migration",     hrefSuffix: "/migration",  reason: "Dry run build" },
    { label: "Publishing",    hrefSuffix: "/publishing", reason: "Configure env and services" },
    { label: "Releases",      hrefSuffix: "/releases",   reason: "Production cutover" },
    { label: "Monitoring",    hrefSuffix: "/monitoring", reason: "Health check monitoring" },
  ],
  onboardingChecklist: [
    { id: "api-1", label: "Import source artifacts",        description: "Run Source Intake.", required: true },
    { id: "api-2", label: "Confirm build command",          description: "Check package.json scripts.", required: true },
    { id: "api-3", label: "Confirm start command",          description: "Verify entry point path.", required: true },
    { id: "api-4", label: "Set DATABASE_URL if stateful",   description: "Connection string.", required: false },
    { id: "api-5", label: "Set API secrets",                description: "API tokens and signing secrets.", required: false },
    { id: "api-6", label: "Run Deployment Dry Run",         description: "Confirm build succeeds.", required: true },
    { id: "api-7", label: "Verify /api/healthz returns 200", description: "Health endpoint must pass.", required: true },
    { id: "api-8", label: "Execute Production Cutover",     description: "Apply routes via Releases page.", required: true },
  ],
  safetyNotes: [
    "Do not restart PM2 from the panel UI.",
    "Do not reload nginx from the panel UI.",
    "Confirm health endpoint returns 200 before production cutover.",
  ],
};

// ── 4. Static Site ────────────────────────────────────────────────────────────

const staticSiteTemplate: ProjectTemplate = {
  id: "static_site",
  kind: "static_site",
  label: "Static Site",
  description:
    "Pure static build — no Node.js process. Served directly by nginx from a built output directory.",
  bestFor: [
    "Marketing / landing pages",
    "Documentation sites",
    "Blogs built with Astro, Hugo, or similar",
    "React / Vue apps with no backend",
  ],
  expectedServices: [
    {
      name: "Static Build",
      kind: "static",
      buildCommandHint: "pnpm run build",
      outputPathHint: "dist",
      routeHint: "/*",
    },
  ],
  expectedEnv: [
    {
      name: "SITE_URL",
      category: "app",
      required: false,
      secret: false,
      description: "Public URL of the site (used in meta tags, sitemaps)",
    },
  ],
  recommendedPages: [
    { label: "Source Intake", hrefSuffix: "/publishing", reason: "Import source" },
    { label: "Migration",     hrefSuffix: "/migration",  reason: "Run dry run build" },
    { label: "Publishing",    hrefSuffix: "/publishing", reason: "Configure output path" },
    { label: "Releases",      hrefSuffix: "/releases",   reason: "Deploy static output" },
  ],
  onboardingChecklist: [
    { id: "ss-1", label: "Import source artifacts",     description: "Run Source Intake.", required: true },
    { id: "ss-2", label: "Confirm build command",       description: "e.g. pnpm run build.", required: true },
    { id: "ss-3", label: "Confirm output directory",    description: "e.g. dist or public.", required: true },
    { id: "ss-4", label: "Run Deployment Dry Run",      description: "Confirm build output exists.", required: true },
    { id: "ss-5", label: "Execute Production Cutover",  description: "Apply nginx static route.", required: true },
    { id: "ss-6", label: "Verify site loads in browser", description: "Check domain returns 200.", required: true },
  ],
  safetyNotes: [
    "No PM2 process required — nginx serves the static files directly.",
    "Do not reload nginx from the panel UI.",
    "Confirm output directory matches the path configured in nginx.",
  ],
};

// ── 5. Custom Project ─────────────────────────────────────────────────────────

const customTemplate: ProjectTemplate = {
  id: "custom",
  kind: "custom",
  label: "Custom Project",
  description:
    "Flexible template for projects that don't fit a standard category. Start with minimal guidance and configure everything manually.",
  bestFor: [
    "Projects with unusual architectures",
    "Multi-repo monorepos",
    "Projects not yet fully specified",
  ],
  expectedServices: [],
  expectedEnv: [
    {
      name: "APP_URL",
      category: "app",
      required: false,
      secret: false,
      description: "Public URL of the app",
    },
  ],
  recommendedPages: [
    { label: "Source Intake", hrefSuffix: "/publishing", reason: "Start with source validation" },
    { label: "Migration",     hrefSuffix: "/migration",  reason: "Analyze project structure" },
    { label: "Settings",      hrefSuffix: "/settings",   reason: "Configure services and env" },
  ],
  onboardingChecklist: [
    { id: "cu-1", label: "Import source artifacts",      description: "Run Source Intake.", required: true },
    { id: "cu-2", label: "Identify services",            description: "Determine how many processes the app needs.", required: true },
    { id: "cu-3", label: "Configure env vars",           description: "Add all required env keys.", required: true },
    { id: "cu-4", label: "Run Deployment Dry Run",       description: "Confirm build succeeds.", required: true },
    { id: "cu-5", label: "Execute Production Cutover",   description: "Apply routes when ready.", required: true },
  ],
  safetyNotes: [
    "Manually verify all services and routes before cutover.",
    "Do not restart PM2 or reload nginx from the panel UI.",
  ],
};

// ── Registry ─────────────────────────────────────────────────────────────────

export const BUILTIN_TEMPLATES: ProjectTemplate[] = [
  ecommerceTemplate,
  webAppTemplate,
  apiServiceTemplate,
  staticSiteTemplate,
  customTemplate,
];
