import { generateProjectFileInventory } from "./project-file-inventory";
import type {
  ProjectHelpCenterReport,
  HelpKnowledgeSection,
  HelpFileInventoryItem,
} from "./help-center-types";

// ── Framework / resource detection ────────────────────────────────────────────

const FRAMEWORK_MARKERS: Record<string, string> = {
  "next":          "Next.js",
  "@prisma/client":"Prisma",
  "react":         "React",
  "tailwindcss":   "Tailwind CSS",
  "lucide-react":  "Lucide Icons",
  "@radix-ui":     "Radix UI",
  "zod":           "Zod",
  "next-auth":     "NextAuth.js",
  "sharp":         "Sharp (image processing)",
  "stripe":        "Stripe",
  "resend":        "Resend (email)",
  "cloudinary":    "Cloudinary",
};

const RESOURCE_MARKERS: Record<string, string> = {
  "pm2":              "PM2 (process manager)",
  "nginx":            "nginx (reverse proxy)",
  "postgresql":       "PostgreSQL",
  "postgres":         "PostgreSQL",
  "prisma":           "Prisma ORM",
  "stripe":           "Stripe (payments)",
  "cloudinary":       "Cloudinary (media)",
  "resend":           "Resend (email)",
  "github":           "GitHub (version control)",
  "ssh":              "SSH (server access)",
  "pnpm":             "pnpm (package manager)",
  "tailwind":         "Tailwind CSS",
};

function detectFrameworks(allImports: string[]): string[] {
  const found = new Set<string>();
  for (const imp of allImports) {
    for (const [key, label] of Object.entries(FRAMEWORK_MARKERS)) {
      if (imp.includes(key)) found.add(label);
    }
  }
  return [...found];
}

function detectResources(inventory: HelpFileInventoryItem[]): string[] {
  const found = new Set<string>();
  const allText = inventory.map((i) => i.summary + " " + i.importantImports.join(" ")).join(" ").toLowerCase();
  for (const [key, label] of Object.entries(RESOURCE_MARKERS)) {
    if (allText.includes(key)) found.add(label);
  }
  return [...found];
}

// ── Section builders ──────────────────────────────────────────────────────────

function buildOverviewSection(
  inventory: HelpFileInventoryItem[],
  frameworks: string[],
  resources: string[],
): HelpKnowledgeSection {
  const pageCount      = inventory.filter((i) => i.category === "page").length;
  const actionCount    = inventory.filter((i) => i.category === "server_action").length;
  const componentCount = inventory.filter((i) => i.category === "component").length;
  const libCount       = inventory.filter((i) => i.category === "library").length;
  const schemaCount    = inventory.filter((i) => i.category === "schema").length;

  return {
    id:       "overview",
    title:    "Project Overview",
    category: "overview",
    content:  `# Prisom Project Panel — Overview

Prisom Project Panel is a full-stack Next.js web application for managing multi-project deployments, migrations, releases, and operator workflows. It is the operator control room for all projects managed on the Prisom infrastructure.

## Key Counts (from live scan)
- ${pageCount} pages / routes
- ${actionCount} server action files
- ${componentCount} UI components
- ${libCount} library modules
- ${schemaCount} schema files

## Frameworks Detected
${frameworks.length > 0 ? frameworks.map((f) => `- ${f}`).join("\n") : "- Next.js, React, Prisma, Tailwind CSS"}

## Resources Used
${resources.length > 0 ? resources.map((r) => `- ${r}`).join("\n") : "- PM2, nginx, PostgreSQL, pnpm"}

## Production Context
| Key | Value |
| --- | --- |
| Domain | projects.doorstepmanchester.uk |
| PM2 process | prisom-projects |
| Port | 3002 |
| Repo path | /home/prisom/prisom-project-panel |

## Purpose
Prisom Project Panel lets operators:
- Manage multiple deployment projects with domains, services, and env vars
- Execute multi-step migration workflows (including Sardar Security migration)
- Generate and export documentation (readiness audits, checklists, handoffs)
- Monitor production health and perform go/no-go launch decisions
- Track audit logs, deployments, and team permissions

## What This System Does NOT Do (Safety)
- Does NOT restart PM2 or nginx from the UI
- Does NOT mutate DNS automatically
- Does NOT expose secret values in any output
- Does NOT touch Doorsteps/LocalShop (prisom-manager / prisom-backend)
- Does NOT run DB migrations without explicit operator confirmation`,
    sourcePaths: ["app/", "components/", "lib/", "package.json"],
    keywords:    ["overview", "project", "panel", "next.js", "deployment", "migration", "production", "purpose", "what is"],
  };
}

function buildArchitectureSection(inventory: HelpFileInventoryItem[]): HelpKnowledgeSection {
  const pages      = inventory.filter((i) => i.category === "page").slice(0, 20);
  const actions    = inventory.filter((i) => i.category === "server_action").slice(0, 20);
  const components = inventory.filter((i) => i.category === "component").slice(0, 10);

  return {
    id:       "architecture",
    title:    "Architecture",
    category: "architecture",
    content:  `# Architecture

Prisom Project Panel uses the Next.js 16 App Router with server components and server actions.

## Stack
- **Frontend**: Next.js 16, React, TypeScript, Tailwind CSS, Radix UI/shadcn components
- **Backend**: Next.js server actions ("use server"), Prisma ORM, PostgreSQL
- **Auth**: Custom session-based auth with \`requireProjectPermission\`
- **Audit**: Every write action writes to \`ProjectAuditEvent\` via \`writeProjectAuditEvent\`
- **Process**: PM2 runs \`prisom-projects\` on port 3002
- **Proxy**: nginx routes \`projects.doorstepmanchester.uk\` to port 3002

## Directory Structure
\`\`\`
app/                        # Next.js App Router pages and API routes
  (dashboard)/              # Auth-gated dashboard layout
    projects/[projectId]/   # Per-project workspace pages
      help/                 # Help Center (Sprint 81)
      releases/             # Go-live, releases, final verification
      runbook/              # Operator runbook
      migration/            # Migration wizard
      monitoring/           # Monitoring dashboard
      settings/             # Project settings
      publishing/           # Deploy + publishing
      ...
  actions/                  # "use server" server actions
components/
  projects/                 # Per-project panel components
  ui/                       # shadcn/Radix UI primitives
  layout/                   # Shell, nav, headers
  common/                   # Shared helpers (CopyDownloadButton, ActionLoadingButton)
lib/
  help-center/              # Help Center (Sprint 81)
  final-live-verification/  # Sprint 79
  go-no-go/                 # Sprint 79
  launch-execution/         # Sprint 78
  deploy-verification/      # Sprint 78
  final-readiness/          # Sprint 77
  migration/                # Migration + handoff export
  audit/                    # Audit event helpers
  auth/                     # Project permission helpers
  db.ts                     # Prisma client singleton
prisma/
  schema.prisma             # Database schema
\`\`\`

## Key Pages (detected)
${pages.map((p) => `- \`${p.path}\`${p.routes?.[0] ? " → " + p.routes[0] : ""}`).join("\n")}

## Key Server Actions
${actions.map((a) => `- \`${a.path}\``).join("\n")}

## Key Components
${components.map((c) => `- \`${c.path}\``).join("\n")}`,
    sourcePaths: ["app/", "components/", "lib/", "prisma/"],
    keywords:    ["architecture", "structure", "stack", "next.js", "prisma", "server action", "app router", "directory", "folder"],
  };
}

function buildLanguagesSection(
  languages: Record<string, number>,
  frameworks: string[],
): HelpKnowledgeSection {
  const sorted = Object.entries(languages)
    .sort(([, a], [, b]) => b - a)
    .map(([lang, count]) => `- ${lang}: ${count} files`);

  return {
    id:       "languages",
    title:    "Languages and Frameworks",
    category: "languages",
    content:  `# Languages and Frameworks

## File Languages (from scan)
${sorted.join("\n")}

## Frameworks and Libraries
${frameworks.length > 0 ? frameworks.map((f) => `- ${f}`).join("\n") : `- Next.js 16 (App Router)
- React 18
- TypeScript 5
- Tailwind CSS 3
- Prisma 5
- shadcn/ui (Radix UI primitives)
- Lucide Icons
- Zod (schema validation)
- pnpm (package manager)`}

## Key Runtime Tools
- Node.js (server runtime)
- PostgreSQL (database)
- PM2 (process manager for production)
- nginx (reverse proxy)
- pnpm (package manager)`,
    sourcePaths: ["package.json", "tsconfig.json", "tailwind.config.ts"],
    keywords:    ["language", "framework", "typescript", "react", "next.js", "prisma", "tailwind", "zod", "pnpm", "node"],
  };
}

function buildFolderStructureSection(inventory: HelpFileInventoryItem[]): HelpKnowledgeSection {
  const dirs = new Set<string>();
  for (const item of inventory) {
    const parts = item.path.split("/");
    if (parts.length > 1) dirs.add(parts.slice(0, 2).join("/"));
    if (parts.length > 2) dirs.add(parts.slice(0, 3).join("/"));
  }
  const dirList = [...dirs].slice(0, 40).sort();

  return {
    id:       "file_inventory",
    title:    "Folder Structure",
    category: "file_inventory",
    content:  `# Folder Structure

## Detected Directories
${dirList.map((d) => `- ${d}/`).join("\n")}

## Key File Categories
| Category | Count |
| --- | --- |
| Pages / Routes | ${inventory.filter((i) => i.category === "page").length} |
| Server Actions | ${inventory.filter((i) => i.category === "server_action").length} |
| Components | ${inventory.filter((i) => i.category === "component").length} |
| Library modules | ${inventory.filter((i) => i.category === "library").length} |
| Config files | ${inventory.filter((i) => i.category === "config").length} |
| Schema files | ${inventory.filter((i) => i.category === "schema").length} |
| Scripts | ${inventory.filter((i) => i.category === "script").length} |

## File Inventory Summary
Total scanned: ${inventory.length} files across ${dirList.length} directories.

See exported PROJECT_FILE_INVENTORY.md for the full per-file listing.`,
    sourcePaths: ["app/", "components/", "lib/", "prisma/", "scripts/"],
    keywords:    ["folder", "structure", "directory", "files", "inventory", "where", "location"],
  };
}

function buildRoutesSection(inventory: HelpFileInventoryItem[]): HelpKnowledgeSection {
  const pages = inventory.filter((i) => i.category === "page" && (i.routes?.length ?? 0) > 0);
  const apiRoutes = inventory.filter((i) => i.category === "server_action" && i.path.includes("app/api/"));

  return {
    id:       "routes",
    title:    "Pages and Routes",
    category: "routes",
    content:  `# Pages and Routes

## Dashboard Pages (under /projects/[projectId])
| Route | File |
| --- | --- |
| /projects/[projectId] | Overview |
| /projects/[projectId]/help | Help Center (Sprint 81) |
| /projects/[projectId]/releases | Releases + Go-live |
| /projects/[projectId]/runbook | Operator Runbook |
| /projects/[projectId]/migration | Migration wizard |
| /projects/[projectId]/monitoring | Monitoring |
| /projects/[projectId]/settings | Settings |
| /projects/[projectId]/publishing | Publishing + Deploy |
| /projects/[projectId]/env | Environment variables |
| /projects/[projectId]/domains | Domain management |
| /projects/[projectId]/backups | Backup management |
| /projects/[projectId]/team | Team and permissions |
| /projects/[projectId]/audit | Audit log |
| /projects/[projectId]/logs | Application logs |
| /projects/[projectId]/files | File browser |
| /projects/[projectId]/terminal | Web terminal |
| /projects/[projectId]/ai | AI assistant |
| /projects/[projectId]/database | Database browser |
| /projects/[projectId]/activity | Activity feed |
| /projects/[projectId]/storage | Storage management |
| /projects/[projectId]/operations | Operations panel |
| /projects/[projectId]/github | GitHub integration |
| /projects/[projectId]/packages | Package manager |
| /projects/[projectId]/import | Import projects |
| /dashboard | Main dashboard |
| /admin | Admin panel |
| /login | Login |
| /forgot-password | Password reset |

## Detected Page Files
${pages.map((p) => `- \`${p.path}\` → ${p.routes?.[0] ?? ""}`).join("\n")}

## API Routes
${apiRoutes.map((r) => `- \`${r.path}\``).join("\n")}

## Navigation
The WorkspaceNav component (\`components/projects/workspace-nav.tsx\`) provides:
- Primary tabs: Overview, Preview, Files, Publishing, Monitoring
- More dropdown: Development, Data & Config, Team & Governance, Reliability, Advanced (Help, Runbook, Settings)`,
    sourcePaths: ["app/(dashboard)/projects/[projectId]/"],
    keywords:    ["route", "page", "url", "path", "navigation", "nav", "sidebar", "dashboard", "where", "how to get to"],
  };
}

function buildServerActionsSection(inventory: HelpFileInventoryItem[]): HelpKnowledgeSection {
  const actionFiles = inventory.filter((i) => i.category === "server_action");
  const allActions  = actionFiles.flatMap((f) => f.actions ?? []);

  return {
    id:       "server_actions",
    title:    "Server Actions",
    category: "server_actions",
    content:  `# Server Actions

All server actions are in \`app/actions/\` and are marked \`"use server"\`.

## Auth Pattern
Every action calls \`requireProjectPermission(projectId, "project.view")\` before any work. This enforces authentication and project membership.

## Audit Pattern
Write actions fire \`writeProjectAuditEvent\` with:
- \`actorUserId\`, \`actorRole\`
- \`action\` (e.g. \`"help_center.generated"\`)
- \`category\` (e.g. \`"publishing"\`)
- \`result\` (\`"success"\` or \`"failure"\`)

## Action Result Shape
\`\`\`ts
type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string; code?: string }
\`\`\`

## Action Files
${actionFiles.map((f) => `- \`${f.path}\``).join("\n")}

## Detected Action Functions
${allActions.slice(0, 40).map((a) => `- \`${a}\``).join("\n")}

## Key Action Groups
- \`app/actions/help-center.ts\` — Help Center knowledge generation, search, ask, exports
- \`app/actions/final-live-verification.ts\` — Final live verification run
- \`app/actions/go-no-go.ts\` — Go/No-Go evidence pack
- \`app/actions/launch-execution.ts\` — Launch execution checklist
- \`app/actions/deploy-verification.ts\` — Deploy verification report
- \`app/actions/final-readiness.ts\` — Final readiness audit
- \`app/actions/launch-signoff.ts\` — Launch sign-off
- \`app/actions/operator-training.ts\` — Operator training pack
- \`app/actions/cutover-rehearsal.ts\` — Cutover rehearsal
- \`app/actions/launch-freeze.ts\` — Launch freeze gate
- \`app/actions/launch-day-support.ts\` — Launch-day support
- \`app/actions/post-launch-bug-capture.ts\` — Post-launch bug capture`,
    sourcePaths: ["app/actions/"],
    keywords:    ["server action", "action", "function", "api", "backend", "auth", "audit", "use server"],
  };
}

function buildComponentsSection(inventory: HelpFileInventoryItem[]): HelpKnowledgeSection {
  const panels = inventory
    .filter((i) => i.category === "component" && i.path.includes("projects/"))
    .slice(0, 40);
  const ui = inventory
    .filter((i) => i.category === "component" && i.path.includes("ui/"))
    .slice(0, 10);

  return {
    id:       "components",
    title:    "Components and Panels",
    category: "components",
    content:  `# Components and Panels

## Project Panels (components/projects/)
These are the main interactive panels used on project pages. All are "use client" components.

${panels.map((c) => `- \`${c.path}\``).join("\n")}

## Common Patterns
- **Flight guard**: \`useRef(false)\` + try/finally to prevent double-submission
- **Loading buttons**: \`ActionLoadingButton\` from \`components/common/action-loading-button\`
- **Export buttons**: \`CopyDownloadButton\` from \`components/common/copy-download-button\`
- **compact prop**: most panels accept \`compact?: boolean\` for sidebar/compact display

## Key Shared Components
- \`components/common/action-loading-button.tsx\` — Button with loading spinner
- \`components/common/copy-download-button.tsx\` — Download / copy to clipboard
- \`components/projects/workspace-nav.tsx\` — Per-project navigation tabs

## UI Primitives (components/ui/)
${ui.map((c) => `- \`${c.path}\``).join("\n")}
shadcn/ui components: Card, Badge, Button, Input, Tabs, Dialog, DropdownMenu, etc.`,
    sourcePaths: ["components/projects/", "components/ui/", "components/common/"],
    keywords:    ["component", "panel", "ui", "button", "card", "badge", "tabs", "flight guard", "compact", "client"],
  };
}

function buildExportsSection(inventory: HelpFileInventoryItem[]): HelpKnowledgeSection {
  return {
    id:       "exports",
    title:    "Exports and Reports",
    category: "exports",
    content:  `# Exports and Reports

All exports are generated as Markdown files and downloaded via the browser. No export writes to the server filesystem.

## Available Export Files

| Export File | Source Panel | Sprint |
| --- | --- | --- |
| HANDOFF_EXPORT.md | Migration page | 41+ |
| QA_VERIFICATION_REPORT.md | QA Verification | 73 |
| RC_HARDENING_REPORT.md | Release Candidate | 73 |
| FINAL_READINESS_AUDIT.md | Final Readiness Audit | 77 |
| STOP_BUILD_GATE.md | Stop-Build Gate | 77 |
| DEPLOY_VERIFICATION_REPORT.md | Deploy Verification | 78 |
| LAUNCH_EXECUTION_CHECKLIST.md | Launch Execution Checklist | 78 |
| FINAL_LIVE_VERIFICATION_RUN.md | Final Live Verification | 79 |
| GO_NO_GO_EVIDENCE_PACK.md | Go/No-Go Evidence | 79 |
| PROJECT_KNOWLEDGE_BASE.md | Help Center | 81 |
| PROJECT_FILE_INVENTORY.md | Help Center | 81 |
| PROJECT_METHODS_AND_RESOURCES.md | Help Center | 81 |
| OPERATOR_TRAINING_PACK.md | Operator Training | 74 |
| FINAL_CUTOVER_REHEARSAL.md | Cutover Rehearsal | 75 |
| LAUNCH_FREEZE_DECISION.md | Launch Freeze | 75 |
| FINAL_LAUNCH_SIGNOFF.md | Launch Signoff | 74 |
| LAUNCH_DAY_SUPPORT_REPORT.md | Launch-Day Support | 76 |
| POST_LAUNCH_BUG_CAPTURE_REPORT.md | Post-Launch Bug Capture | 76 |
| POST_CUTOVER_MONITORING_REPORT.md | Post-Cutover Monitoring | 66 |
| CLIENT_MIGRATION_PLAN.md | Migration | 72 |
| CLIENT_ONBOARDING_LETTER.md | Migration | 72 |

## Export Pattern
\`\`\`ts
// Export action returns:
{ ok: true, data: { markdown: string, filename: string } }
// Panel accesses via:
exp.data.markdown ?? ""
\`\`\`

## Safety
- No secret values appear in any export
- All exports are read-only documentation
- Exports are generated server-side and downloaded client-side via Blob URL`,
    sourcePaths: ["app/actions/", "lib/"],
    keywords:    ["export", "download", "report", "markdown", "file", "HANDOFF", "READINESS", "VERIFICATION", "CHECKLIST"],
  };
}

function buildDeploymentCommandsSection(): HelpKnowledgeSection {
  return {
    id:       "deployment",
    title:    "Deployment Commands",
    category: "deployment",
    content:  `# Deployment Commands

> **Read-only reference.** These commands must be run manually by an operator via SSH. The UI does not execute these.

## Standard Deploy (no schema change)
\`\`\`bash
cd /home/prisom/prisom-project-panel
git fetch origin
git pull --ff-only
git log --oneline -8
git rev-parse --short HEAD

pnpm install
pnpm run typecheck
pnpm run build

pm2 restart prisom-projects --update-env
pm2 save
\`\`\`

## With Schema Change (Prisma migration required)
\`\`\`bash
pnpm run db:migrate        # Run pending Prisma migrations
# Then follow standard deploy above
\`\`\`

## Smoke Checks (run after deploy)
\`\`\`bash
curl -I https://projects.doorstepmanchester.uk/login
curl -I https://projects.doorstepmanchester.uk/dashboard
curl -I https://projects.doorstepmanchester.uk/admin
curl -I https://sardar-security-project.doorstepmanchester.uk/
curl -I https://sardar-security-project.doorstepmanchester.uk/api/healthz
\`\`\`

## Expected Smoke Check Results
| Endpoint | Expected |
| --- | --- |
| /login | HTTP 200 |
| /dashboard | HTTP 307 → /login (if not authed) |
| /admin | HTTP 307 → /login (if not authed) |
| Sardar frontend | HTTP 200 |
| Sardar health | HTTP 200 |

## Verify Deployed Commit
\`\`\`bash
git -C /home/prisom/prisom-project-panel rev-parse --short HEAD
pm2 list | grep prisom-projects
\`\`\`

## PM2 Commands (manual only)
\`\`\`bash
pm2 list                              # List all processes
pm2 logs prisom-projects --lines 50  # View recent logs
pm2 restart prisom-projects           # Restart panel (manual only)
\`\`\`

## Do NOT Restart
- prisom-manager (Doorsteps backend)
- prisom-backend (Doorsteps backend)`,
    sourcePaths: ["package.json"],
    keywords:    ["deploy", "deployment", "command", "ssh", "pm2", "restart", "build", "install", "smoke check", "git pull", "pnpm build"],
  };
}

function buildEnvVarsSection(inventory: HelpFileInventoryItem[]): HelpKnowledgeSection {
  const hasStripe   = inventory.some((i) => i.importantImports.includes("stripe"));
  const hasCloudinary = inventory.some((i) => i.importantImports.some((imp) => imp.includes("cloudinary")));

  return {
    id:       "resources",
    title:    "Environment Variables (Names Only)",
    category: "resources",
    content:  `# Environment Variables (Names Only)

> Secret values are never shown. Only variable names are listed.

## Required
| Variable | Purpose |
| --- | --- |
| DATABASE_URL | PostgreSQL connection string |
| NEXTAUTH_SECRET or AUTH_SECRET | Session signing secret |
| NEXTAUTH_URL | Public URL of the panel |

## Optional / Conditional
| Variable | Purpose |
| --- | --- |
| GITHUB_CLIENT_ID | GitHub OAuth integration |
| GITHUB_CLIENT_SECRET | GitHub OAuth integration |
${hasStripe ? "| STRIPE_SECRET_KEY | Stripe payments (Sardar only) |\n| STRIPE_WEBHOOK_SECRET | Stripe webhook validation (Sardar only) |" : ""}
${hasCloudinary ? "| CLOUDINARY_CLOUD_NAME | Cloudinary media (if used) |\n| CLOUDINARY_API_KEY | Cloudinary (if used) |\n| CLOUDINARY_API_SECRET | Cloudinary (if used) |" : ""}
| RESEND_API_KEY | Email sending (if configured) |

## Safety Rule
The panel never shows secret values in any UI, export, audit log, or knowledge base output.
Only variable names (not values) are read from the database.

## Where Env Vars Are Managed
- Stored in database: \`ProjectEnvVar\` table (field: \`name\` and encrypted \`value\`)
- UI display: Settings page → Environment Variables section (names only)
- Production .env file: /home/prisom/prisom-project-panel/.env (server-side only, never exposed)`,
    sourcePaths: ["lib/", "app/actions/", "prisma/"],
    keywords:    ["env", "environment variable", "secret", "DATABASE_URL", "AUTH_SECRET", "STRIPE", "key", "token", "config"],
  };
}

function buildSardarSection(): HelpKnowledgeSection {
  return {
    id:       "sardar",
    title:    "Sardar Migration Workflow",
    category: "sardar",
    content:  `# Sardar Migration Workflow

## What is the Sardar Project?
Sardar Security Project is the primary client project being migrated to the Prisom infrastructure. It is a Next.js ecommerce/security application.

## Production Details
| Key | Value |
| --- | --- |
| Domain | sardar-security-project.doorstepmanchester.uk |
| PM2 process | project-sardar-security-project |
| Port | 4100 |
| Health endpoint | /api/healthz |

## How isSardarProject Works
\`\`\`ts
import { isSardarProject } from "@/lib/migration/sardar-migration-types";
// Always called as:
isSardarProject(project.name) || isSardarProject(project.slug ?? "")
\`\`\`

This helper identifies Sardar projects so Sardar-specific checks and UI sections appear.

## Sprint Workflow (Sprints 41–81)
1. **Source intake** — analyze Sardar source code
2. **Migration analysis** — generate migration report
3. **Staging import** — import Sardar files to staging env
4. **Trial migration** — run trial migration
5. **Ecommerce test** — verify checkout works on staging
6. **Staging deployment** — deploy to staging
7. **QA verification** — run QA checklist
8. **Release candidate** — harden release candidate
9. **Launch signoff** — operator signs off
10. **Cutover rehearsal** — full dry-run of cutover
11. **Launch freeze** — freeze all non-critical changes
12. **Final readiness audit** — final audit before cutover
13. **Stop-build gate** — confirm decision to stop building, go live
14. **Deploy verification** — verify deployed commit
15. **Launch execution checklist** — step-by-step cutover
16. **Final live verification** — post-deploy verification run
17. **Go/No-Go evidence** — collect all launch evidence
18. **Help Center** — living documentation for operators

## Safety Rules (Sardar-Specific)
- Do NOT restart project-sardar-security-project from the panel UI
- Do NOT change DNS for sardar-security-project.doorstepmanchester.uk
- Do NOT run Stripe charges or refunds from the panel
- The Sardar project must stay live during panel deployments
- Smoke check Sardar health after every panel deploy: \`curl -I https://sardar-security-project.doorstepmanchester.uk/api/healthz\``,
    sourcePaths: ["lib/migration/sardar-migration-types.ts", "lib/migration/"],
    keywords:    ["sardar", "sardar security", "migration", "isSardarProject", "ecommerce", "client project", "cutover"],
  };
}

function buildSafetyRulesSection(): HelpKnowledgeSection {
  return {
    id:       "safety",
    title:    "Safety Rules",
    category: "safety",
    content:  `# Safety Rules

> These rules must be followed by all operators at all times.

## Critical — Do NOT Perform Automatically
| Rule | Reason |
| --- | --- |
| Do NOT restart PM2 from UI | PM2 changes are production-impacting |
| Do NOT change DNS from UI | DNS changes affect live traffic |
| Do NOT reload nginx from UI | nginx changes affect all sites on server |
| Do NOT run DB migrations unless explicitly required | Migrations are irreversible |
| Do NOT restore backups without operator confirmation | Data loss risk |
| Do NOT expose secret values | Security breach risk |
| Do NOT touch prisom-manager or prisom-backend | Doorsteps/LocalShop production services |

## Files / Paths Never Scanned
| Path | Reason |
| --- | --- |
| .env, .env.* | Contains production secrets |
| node_modules/ | Binary packages, not relevant |
| .git/ | Version control internals |
| .next/ | Build artifacts |
| dist/, build/ | Output directories |
| storage/backups | Production backup data |
| *.pem, *.key, *.crt | SSL/TLS certificates |
| *.log (storage) | May contain sensitive request data |

## Confirmation Phrase Pattern
Some destructive actions require a typed confirmation phrase before proceeding. The phrase is checked client-side and server-side before executing. The format is: \`"I confirm: [action description]"\`

## Audit Trail
Every write action is recorded in the \`ProjectAuditEvent\` table with:
- Actor user ID and role
- Action name and category
- Result (success/failure)
- Summary and metadata
- IP address and user agent (from request context)`,
    sourcePaths: ["app/actions/", "lib/auth/", "lib/audit/"],
    keywords:    ["safety", "do not", "never", "forbidden", "dangerous", "secret", "pm2", "dns", "nginx", "migration", "confirmation", "audit"],
  };
}

function buildTroubleshootingSection(inventory: HelpFileInventoryItem[]): HelpKnowledgeSection {
  const pages   = inventory.filter((i) => i.category === "page").slice(0, 10);
  const actions = inventory.filter((i) => i.category === "server_action").slice(0, 5);

  return {
    id:       "troubleshooting",
    title:    "Troubleshooting",
    category: "troubleshooting",
    content:  `# Troubleshooting

## Panel Not Loading
1. Check PM2: \`pm2 list | grep prisom-projects\`
2. Check logs: \`pm2 logs prisom-projects --lines 100\`
3. Check port: \`curl -I http://localhost:3002/login\`
4. Check nginx: \`sudo nginx -t && sudo nginx -s reload\` (manual)

## Build Failing
1. Run \`pnpm run typecheck\` to check TypeScript errors
2. Run \`pnpm run build\` to check build errors
3. Common cause: Prisma field names (use \`hostname\` not \`domain\`, \`isEnabled\` not \`enabled\`)
4. Common cause: wrong action result shape (must be \`{ ok: true, data } | { ok: false, error }\`)

## Panel Action Errors
1. Check browser console for "ok: false, error:" in action result
2. Check PM2 logs for server-side error details
3. Verify user has project.view permission (requireProjectPermission)
4. Verify projectId is valid (not null/undefined)

## Export Not Downloading
1. Check browser popup blocker (Blob URL downloads can be blocked)
2. Use "Copy" fallback if download fails
3. Check CopyDownloadButton component for content/filename props

## Sardar Health Endpoint Failing
1. Check: \`curl -I https://sardar-security-project.doorstepmanchester.uk/api/healthz\`
2. Check: \`pm2 list | grep project-sardar-security-project\`
3. If offline: restart manually via SSH only — do NOT use panel UI
4. Do NOT restart any other PM2 processes

## Key Files for Debugging
${pages.map((p) => `- \`${p.path}\``).join("\n")}
${actions.map((a) => `- \`${a.path}\``).join("\n")}`,
    sourcePaths: ["app/", "lib/", "components/"],
    keywords:    ["troubleshoot", "error", "failing", "broken", "fix", "debug", "not working", "problem", "issue", "logs"],
  };
}

function buildResourcesSection(resources: string[]): HelpKnowledgeSection {
  return {
    id:       "resources",
    title:    "Resources Used",
    category: "resources",
    content:  `# Resources Used

## Infrastructure
| Resource | Usage | Notes |
| --- | --- | --- |
| PM2 | Process management | prisom-projects on port 3002 |
| nginx | Reverse proxy | Routes *.doorstepmanchester.uk → ports |
| PostgreSQL | Primary database | Via Prisma ORM |
| pnpm | Package manager | Workspace monorepo |

## Frameworks
| Resource | Usage |
| --- | --- |
| Next.js 16 | App Router, server components, server actions |
| React 18 | UI components |
| TypeScript 5 | Static typing |
| Prisma 5 | Database ORM and schema |
| Tailwind CSS 3 | Utility-first styling |
| shadcn/ui | UI component library (Radix UI based) |
| Zod | Schema validation |
| Lucide Icons | Icon set |

## External Services (names only — no values)
${resources.filter((r) => r.includes("Stripe") || r.includes("Cloudinary") || r.includes("Resend")).map((r) => `- ${r}`).join("\n") || "- Stripe (Sardar only)\n- Resend (email)\n- Cloudinary (media, if configured)"}

## Server Environment
- OS: Linux (Ubuntu)
- Node.js: via nvm or system
- Git: standard git workflow
- SSH: all production operations via SSH`,
    sourcePaths: ["package.json", "lib/"],
    keywords:    ["resource", "pm2", "nginx", "postgresql", "pnpm", "prisma", "stripe", "cloudinary", "resend", "infrastructure"],
  };
}

function buildOperatorWorkflowsSection(): HelpKnowledgeSection {
  return {
    id:       "resources",
    title:    "Operator Workflows",
    category: "resources",
    content:  `# Operator Workflows

## Standard Launch Workflow
1. **QA Verification** → /releases → QA Verification panel → generate + export QA_VERIFICATION_REPORT.md
2. **Release Candidate** → /releases → Release Candidate panel → generate + export RC_HARDENING_REPORT.md
3. **Launch Signoff** → /releases → Launch Signoff panel → generate + sign FINAL_LAUNCH_SIGNOFF.md
4. **Operator Training** → /runbook → Operator Training panel → export OPERATOR_TRAINING_PACK.md
5. **Cutover Rehearsal** → /runbook → Cutover Rehearsal panel → export FINAL_CUTOVER_REHEARSAL.md
6. **Launch Freeze** → /releases → Launch Freeze panel → generate LAUNCH_FREEZE_DECISION.md
7. **Stop-Build Gate** → /releases → Stop-Build Gate → confirm STOP_BUILD_GATE.md
8. **Final Readiness Audit** → /releases → Final Readiness Audit → FINAL_READINESS_AUDIT.md
9. **Deploy** → SSH deploy (manual) → pull + build + pm2 restart
10. **Deploy Verification** → /releases → Deploy Verification → DEPLOY_VERIFICATION_REPORT.md
11. **Launch Execution** → /releases → Launch Execution Checklist → LAUNCH_EXECUTION_CHECKLIST.md
12. **Final Live Verification** → /releases → Final Live Verification → FINAL_LIVE_VERIFICATION_RUN.md
13. **Go/No-Go Decision** → /releases → Go/No-Go Evidence Pack → GO_NO_GO_EVIDENCE_PACK.md
14. **Post-Cutover Monitoring** → /monitoring → Post-Cutover Monitoring panel

## Day-to-Day Operations
- **View logs**: /projects/[id]/logs
- **Check monitoring**: /projects/[id]/monitoring
- **Manage domains**: /projects/[id]/domains
- **Manage env vars**: /projects/[id]/env
- **View audit log**: /projects/[id]/audit
- **Manage team**: /projects/[id]/team

## Handoff to Client
- Export HANDOFF_EXPORT.md from Migration page
- Includes all Sprint sections including Help Center summary
- Deliver to client via secure channel

## Help Center Usage
- Generate Knowledge Base: /projects/[id]/help → Generate
- Search: /projects/[id]/help → Search tab
- Ask a question: /projects/[id]/help → Ask tab
- Exports: PROJECT_KNOWLEDGE_BASE.md, PROJECT_FILE_INVENTORY.md, PROJECT_METHODS_AND_RESOURCES.md`,
    sourcePaths: ["app/(dashboard)/projects/[projectId]/"],
    keywords:    ["workflow", "operator", "how to", "steps", "process", "launch", "signoff", "handoff", "monitoring", "day to day"],
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

export async function generateProjectKnowledgeBase(input: {
  projectId: string;
}): Promise<ProjectHelpCenterReport> {
  const { projectId } = input;

  const { inventory, excludedPaths, warnings } = await generateProjectFileInventory({ projectId });

  const allImports = inventory.flatMap((i) => i.importantImports);
  const frameworks = detectFrameworks(allImports);
  const resources  = detectResources(inventory);

  const languages: Record<string, number> = {};
  for (const item of inventory) {
    if (item.language !== "unknown") {
      languages[item.language] = (languages[item.language] ?? 0) + 1;
    }
  }

  const sections: HelpKnowledgeSection[] = [
    buildOverviewSection(inventory, frameworks, resources),
    buildArchitectureSection(inventory),
    buildLanguagesSection(languages, frameworks),
    buildFolderStructureSection(inventory),
    buildRoutesSection(inventory),
    buildServerActionsSection(inventory),
    buildComponentsSection(inventory),
    buildExportsSection(inventory),
    buildDeploymentCommandsSection(),
    buildEnvVarsSection(inventory),
    buildSardarSection(),
    buildSafetyRulesSection(),
    buildTroubleshootingSection(inventory),
    buildResourcesSection(resources),
    buildOperatorWorkflowsSection(),
  ];

  return {
    projectId,
    generatedAt: new Date().toISOString(),
    fileCount:   inventory.length,
    languages,
    frameworks,
    resources,
    sections,
    inventory,
    warnings,
    excludedPaths,
  };
}
