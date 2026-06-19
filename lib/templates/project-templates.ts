/**
 * lib/templates/project-templates.ts
 *
 * Sprint 19: Curated local starter template definitions.
 *
 * Safety rules:
 *  - All templates are hardcoded here — no arbitrary remote fetching.
 *  - File paths are relative and pre-validated by the author.
 *  - Template variables are interpolated server-side with HTML escaping.
 *  - No .env files with real secrets — only .env.example allowed.
 *  - No executable scripts run automatically.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type ProjectTemplateId =
  | "blank-static"
  | "landing-page"
  | "express-api"
  | "nextjs-app"
  | "fullstack-next-api";

export type ProjectTemplateFile = {
  /** Relative path from project root, e.g. "src/index.ts" */
  path: string;
  content: string;
  /** If true, chmod +x is applied on POSIX systems (not enforced yet). */
  executable?: boolean;
};

export type ProjectTemplateVariable = {
  key: string;
  label: string;
  defaultValue?: string;
  required?: boolean;
  placeholder?: string;
};

export type ProjectTemplateSummary = {
  id: ProjectTemplateId;
  name: string;
  description: string;
  category: "static" | "frontend" | "backend" | "fullstack";
  language: "HTML" | "TypeScript" | "JavaScript";
  framework: string;
  packageManager?: "pnpm" | "npm" | "yarn";
  variables?: ProjectTemplateVariable[];
};

export type ProjectTemplate = ProjectTemplateSummary & {
  recommendedPort?: number;
  healthPath?: string;
  buildCommand?: string;
  startCommand?: string;
  installCommand?: string;
  outputDirectory?: string;
  files: ProjectTemplateFile[];
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Trim leading indentation added for readability in template strings. */
function dedent(s: string): string {
  const lines = s.split("\n");
  // Drop leading blank line from the opening backtick
  const nonEmpty = lines.filter((l) => l.trim().length > 0);
  if (nonEmpty.length === 0) return s.trimStart();
  const indent = nonEmpty[0].match(/^(\s*)/)?.[1].length ?? 0;
  return lines
    .map((l) => l.slice(indent))
    .join("\n")
    .replace(/^\n/, "")
    .replace(/\n$/, "");
}

// ── Template 1: Blank Static Site ─────────────────────────────────────────────

const BLANK_STATIC: ProjectTemplate = {
  id: "blank-static",
  name: "Blank Static Site",
  description: "A bare-bones HTML/CSS starting point. No build step required.",
  category: "static",
  language: "HTML",
  framework: "None",
  healthPath: "/",
  outputDirectory: ".",
  files: [
    {
      path: "index.html",
      content: dedent(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>{{projectName}}</title>
          <link rel="stylesheet" href="styles.css" />
        </head>
        <body>
          <main>
            <h1>{{projectName}}</h1>
            <p>Edit <code>index.html</code> to get started.</p>
          </main>
        </body>
        </html>
      `),
    },
    {
      path: "styles.css",
      content: dedent(`
        *, *::before, *::after {
          box-sizing: border-box;
          margin: 0;
          padding: 0;
        }

        body {
          font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          background: #f8fafc;
          color: #1e293b;
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        main {
          text-align: center;
          padding: 2rem;
        }

        h1 {
          font-size: 2rem;
          font-weight: 700;
          margin-bottom: 0.75rem;
        }

        p {
          color: #64748b;
          font-size: 1rem;
        }

        code {
          background: #e2e8f0;
          padding: 0.15em 0.4em;
          border-radius: 4px;
          font-family: "Fira Code", "Cascadia Code", "Consolas", monospace;
          font-size: 0.9em;
        }
      `),
    },
    {
      path: "README.md",
      content: dedent(`
        # {{projectName}}

        A static site scaffolded with Prisom.

        ## Getting started

        Open \`index.html\` in your browser, or serve the folder:

        \`\`\`bash
        npx serve .
        \`\`\`

        ## Project structure

        \`\`\`
        index.html   — entry point
        styles.css   — styles
        README.md    — this file
        \`\`\`
      `),
    },
  ],
};

// ── Template 2: Landing Page ───────────────────────────────────────────────────

const LANDING_PAGE: ProjectTemplate = {
  id: "landing-page",
  name: "Landing Page",
  description: "A polished one-page marketing site with configurable title and tagline.",
  category: "static",
  language: "HTML",
  framework: "None",
  healthPath: "/",
  outputDirectory: ".",
  variables: [
    {
      key: "projectTitle",
      label: "Page title",
      defaultValue: "My Product",
      required: true,
      placeholder: "My Awesome Product",
    },
    {
      key: "tagline",
      label: "Tagline",
      defaultValue: "Something great is coming.",
      required: false,
      placeholder: "The fastest way to do X.",
    },
  ],
  files: [
    {
      path: "index.html",
      content: dedent(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>{{projectTitle}}</title>
          <link rel="preconnect" href="https://fonts.googleapis.com" />
          <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
          <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
          <link rel="stylesheet" href="styles.css" />
        </head>
        <body>
          <!-- Nav -->
          <header class="nav">
            <div class="nav-inner">
              <span class="nav-logo">{{projectTitle}}</span>
              <nav class="nav-links">
                <a href="#features">Features</a>
                <a href="#contact">Contact</a>
              </nav>
            </div>
          </header>

          <!-- Hero -->
          <section class="hero">
            <div class="container">
              <div class="badge">New</div>
              <h1>{{projectTitle}}</h1>
              <p class="tagline">{{tagline}}</p>
              <div class="hero-actions">
                <a href="#features" class="btn btn-primary">Get started</a>
                <a href="#contact" class="btn btn-outline">Learn more</a>
              </div>
            </div>
          </section>

          <!-- Features -->
          <section class="features" id="features">
            <div class="container">
              <h2>Why {{projectTitle}}?</h2>
              <div class="feature-grid">
                <div class="feature-card">
                  <div class="feature-icon">⚡</div>
                  <h3>Fast</h3>
                  <p>Optimised for speed from the ground up.</p>
                </div>
                <div class="feature-card">
                  <div class="feature-icon">🔒</div>
                  <h3>Secure</h3>
                  <p>Built with security best practices.</p>
                </div>
                <div class="feature-card">
                  <div class="feature-icon">🛠️</div>
                  <h3>Flexible</h3>
                  <p>Adapt it to your exact needs.</p>
                </div>
              </div>
            </div>
          </section>

          <!-- Contact -->
          <section class="contact" id="contact">
            <div class="container">
              <h2>Get in touch</h2>
              <p>Have questions? We'd love to hear from you.</p>
              <a href="mailto:hello@example.com" class="btn btn-primary">Email us</a>
            </div>
          </section>

          <!-- Footer -->
          <footer class="footer">
            <div class="container">
              <p>&copy; 2025 {{projectTitle}}. All rights reserved.</p>
            </div>
          </footer>
        </body>
        </html>
      `),
    },
    {
      path: "styles.css",
      content: dedent(`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        :root {
          --primary: #6366f1;
          --primary-hover: #4f46e5;
          --text: #0f172a;
          --muted: #64748b;
          --border: #e2e8f0;
          --bg: #ffffff;
          --bg-alt: #f8fafc;
          --radius: 12px;
        }

        html { scroll-behavior: smooth; }

        body {
          font-family: "Inter", system-ui, -apple-system, sans-serif;
          color: var(--text);
          background: var(--bg);
          line-height: 1.6;
        }

        .container {
          max-width: 1100px;
          margin: 0 auto;
          padding: 0 1.5rem;
        }

        /* ── Nav ── */
        .nav {
          position: sticky;
          top: 0;
          z-index: 100;
          background: rgba(255,255,255,0.9);
          backdrop-filter: blur(12px);
          border-bottom: 1px solid var(--border);
        }
        .nav-inner {
          max-width: 1100px;
          margin: 0 auto;
          padding: 0 1.5rem;
          height: 60px;
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .nav-logo { font-weight: 700; font-size: 1.1rem; }
        .nav-links { display: flex; gap: 1.5rem; }
        .nav-links a {
          font-size: 0.9rem;
          color: var(--muted);
          text-decoration: none;
          transition: color .15s;
        }
        .nav-links a:hover { color: var(--text); }

        /* ── Hero ── */
        .hero {
          padding: 6rem 0 5rem;
          text-align: center;
          background: linear-gradient(135deg, #eef2ff 0%, #f8fafc 60%, #fdf4ff 100%);
        }
        .badge {
          display: inline-block;
          background: #e0e7ff;
          color: var(--primary);
          font-size: 0.75rem;
          font-weight: 600;
          padding: 0.25rem 0.75rem;
          border-radius: 100px;
          margin-bottom: 1.25rem;
          letter-spacing: .05em;
          text-transform: uppercase;
        }
        .hero h1 {
          font-size: clamp(2rem, 5vw, 3.5rem);
          font-weight: 800;
          letter-spacing: -0.03em;
          line-height: 1.1;
          margin-bottom: 1.25rem;
          background: linear-gradient(135deg, #1e293b 0%, #6366f1 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }
        .tagline {
          font-size: 1.2rem;
          color: var(--muted);
          max-width: 560px;
          margin: 0 auto 2.5rem;
        }
        .hero-actions { display: flex; gap: 1rem; justify-content: center; flex-wrap: wrap; }

        /* ── Buttons ── */
        .btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 0.65rem 1.6rem;
          border-radius: 8px;
          font-size: 0.95rem;
          font-weight: 600;
          text-decoration: none;
          transition: all .15s;
          cursor: pointer;
        }
        .btn-primary {
          background: var(--primary);
          color: #fff;
          border: 2px solid var(--primary);
        }
        .btn-primary:hover { background: var(--primary-hover); border-color: var(--primary-hover); }
        .btn-outline {
          background: transparent;
          color: var(--text);
          border: 2px solid var(--border);
        }
        .btn-outline:hover { border-color: #94a3b8; }

        /* ── Features ── */
        .features { padding: 5rem 0; background: var(--bg); }
        .features h2 {
          font-size: 2rem;
          font-weight: 700;
          text-align: center;
          margin-bottom: 3rem;
          letter-spacing: -0.02em;
        }
        .feature-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
          gap: 1.5rem;
        }
        .feature-card {
          background: var(--bg-alt);
          border: 1px solid var(--border);
          border-radius: var(--radius);
          padding: 1.75rem;
          transition: box-shadow .2s;
        }
        .feature-card:hover { box-shadow: 0 4px 20px rgba(0,0,0,.07); }
        .feature-icon { font-size: 1.75rem; margin-bottom: 0.75rem; }
        .feature-card h3 { font-size: 1.05rem; font-weight: 700; margin-bottom: 0.5rem; }
        .feature-card p { font-size: 0.9rem; color: var(--muted); }

        /* ── Contact ── */
        .contact {
          padding: 5rem 0;
          background: var(--bg-alt);
          text-align: center;
        }
        .contact h2 { font-size: 1.75rem; font-weight: 700; margin-bottom: 0.75rem; }
        .contact p { color: var(--muted); margin-bottom: 2rem; }

        /* ── Footer ── */
        .footer {
          padding: 2rem 0;
          border-top: 1px solid var(--border);
          text-align: center;
        }
        .footer p { font-size: 0.85rem; color: var(--muted); }
      `),
    },
    {
      path: "README.md",
      content: dedent(`
        # {{projectTitle}}

        {{tagline}}

        Scaffolded with Prisom.

        ## Overview

        This is a static landing page with no build step required.

        ## Customise

        - Edit \`index.html\` to change copy and structure.
        - Edit \`styles.css\` to adjust colours, fonts, and layout.

        ## Deploy

        Upload the folder to any static host (Nginx, Netlify, Cloudflare Pages, etc.).
      `),
    },
  ],
};

// ── Template 3: Express API ────────────────────────────────────────────────────

const EXPRESS_API: ProjectTemplate = {
  id: "express-api",
  name: "Express API",
  description: "A Node.js REST API using Express with a health check endpoint and CORS support.",
  category: "backend",
  language: "JavaScript",
  framework: "Express",
  packageManager: "pnpm",
  healthPath: "/api/healthz",
  installCommand: "pnpm install --ignore-scripts",
  startCommand: "node server.js",
  files: [
    {
      path: "package.json",
      content: dedent(`
        {
          "name": "{{projectSlug}}",
          "version": "1.0.0",
          "description": "{{projectName}} — Express API",
          "main": "server.js",
          "scripts": {
            "start": "node server.js",
            "dev": "node server.js"
          },
          "dependencies": {
            "cors": "^2.8.5",
            "express": "^4.21.2"
          },
          "engines": {
            "node": ">=18"
          }
        }
      `),
    },
    {
      path: "server.js",
      content: dedent(`
        "use strict";

        const express = require("express");
        const cors = require("cors");

        const app = express();
        const PORT = process.env.PORT || 3000;

        // ── Middleware ──────────────────────────────────────────────────────────────
        app.use(cors());
        app.use(express.json());
        app.use(express.urlencoded({ extended: true }));

        // ── Health check ────────────────────────────────────────────────────────────
        app.get("/api/healthz", (_req, res) => {
          res.json({ status: "ok", service: "{{projectSlug}}", timestamp: new Date().toISOString() });
        });

        // ── Root ────────────────────────────────────────────────────────────────────
        app.get("/", (_req, res) => {
          res.json({ message: "Welcome to {{projectName}} API", version: "1.0.0" });
        });

        // ── 404 handler ─────────────────────────────────────────────────────────────
        app.use((_req, res) => {
          res.status(404).json({ error: "Not found" });
        });

        // ── Error handler ───────────────────────────────────────────────────────────
        // eslint-disable-next-line no-unused-vars
        app.use((err, _req, res, _next) => {
          console.error(err);
          res.status(500).json({ error: "Internal server error" });
        });

        // ── Start ───────────────────────────────────────────────────────────────────
        app.listen(PORT, () => {
          console.log(\`[{{projectName}}] Server listening on port \${PORT}\`);
        });
      `),
    },
    {
      path: ".env.example",
      content: dedent(`
        # Copy this file to .env and fill in your values.
        PORT=3000
        NODE_ENV=development
      `),
    },
    {
      path: "README.md",
      content: dedent(`
        # {{projectName}}

        A Node.js REST API built with Express.

        Scaffolded with Prisom.

        ## Getting started

        \`\`\`bash
        pnpm install --ignore-scripts
        node server.js
        \`\`\`

        ## Endpoints

        | Method | Path          | Description       |
        |--------|---------------|-------------------|
        | GET    | /             | API root          |
        | GET    | /api/healthz  | Health check      |

        ## Environment

        Copy \`.env.example\` to \`.env\` and adjust values:

        \`\`\`
        PORT=3000
        NODE_ENV=development
        \`\`\`
      `),
    },
  ],
};

// ── Template 4: Next.js App ────────────────────────────────────────────────────

const NEXTJS_APP: ProjectTemplate = {
  id: "nextjs-app",
  name: "Next.js App",
  description: "A minimal Next.js 14 application with App Router and TypeScript.",
  category: "frontend",
  language: "TypeScript",
  framework: "Next.js",
  packageManager: "pnpm",
  healthPath: "/",
  installCommand: "pnpm install --ignore-scripts",
  buildCommand: "pnpm run build",
  startCommand: "pnpm start",
  files: [
    {
      path: "package.json",
      content: dedent(`
        {
          "name": "{{projectSlug}}",
          "version": "0.1.0",
          "private": true,
          "scripts": {
            "dev": "next dev",
            "build": "next build",
            "start": "next start",
            "lint": "next lint"
          },
          "dependencies": {
            "next": "^14.2.21",
            "react": "^18.3.1",
            "react-dom": "^18.3.1"
          },
          "devDependencies": {
            "@types/node": "^20.17.10",
            "@types/react": "^18.3.17",
            "@types/react-dom": "^18.3.5",
            "typescript": "^5.7.2"
          }
        }
      `),
    },
    {
      path: "next.config.ts",
      content: dedent(`
        import type { NextConfig } from "next";

        const nextConfig: NextConfig = {
          /* config options here */
        };

        export default nextConfig;
      `),
    },
    {
      path: "tsconfig.json",
      content: dedent(`
        {
          "compilerOptions": {
            "lib": ["dom", "dom.iterable", "esnext"],
            "allowJs": true,
            "skipLibCheck": true,
            "strict": true,
            "noEmit": true,
            "esModuleInterop": true,
            "module": "esnext",
            "moduleResolution": "bundler",
            "resolveJsonModule": true,
            "isolatedModules": true,
            "jsx": "preserve",
            "incremental": true,
            "plugins": [
              {
                "name": "next"
              }
            ],
            "paths": {
              "@/*": ["./*"]
            }
          },
          "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
          "exclude": ["node_modules"]
        }
      `),
    },
    {
      path: "app/layout.tsx",
      content: dedent(`
        import type { Metadata } from "next";

        export const metadata: Metadata = {
          title: "{{projectName}}",
          description: "Built with Next.js and Prisom",
        };

        export default function RootLayout({
          children,
        }: Readonly<{
          children: React.ReactNode;
        }>) {
          return (
            <html lang="en">
              <body style={{ margin: 0, fontFamily: "system-ui, sans-serif" }}>
                {children}
              </body>
            </html>
          );
        }
      `),
    },
    {
      path: "app/page.tsx",
      content: dedent(`
        export default function Home() {
          return (
            <main
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                minHeight: "100vh",
                gap: "1rem",
                padding: "2rem",
                textAlign: "center",
              }}
            >
              <h1 style={{ fontSize: "2.5rem", fontWeight: 800, margin: 0 }}>
                {{projectName}}
              </h1>
              <p style={{ color: "#64748b", fontSize: "1.1rem", margin: 0 }}>
                Get started by editing{" "}
                <code
                  style={{
                    background: "#f1f5f9",
                    padding: "0.2em 0.5em",
                    borderRadius: "6px",
                    fontFamily: "monospace",
                  }}
                >
                  app/page.tsx
                </code>
              </p>
            </main>
          );
        }
      `),
    },
    {
      path: ".env.example",
      content: dedent(`
        # Copy this file to .env.local and fill in your values.
        # NEXT_PUBLIC_EXAMPLE=hello
      `),
    },
    {
      path: "README.md",
      content: dedent(`
        # {{projectName}}

        A [Next.js](https://nextjs.org) app scaffolded with Prisom.

        ## Getting started

        \`\`\`bash
        pnpm install --ignore-scripts
        pnpm run dev
        \`\`\`

        Open [http://localhost:3000](http://localhost:3000) in your browser.

        ## Build

        \`\`\`bash
        pnpm run build
        pnpm start
        \`\`\`

        ## Learn more

        - [Next.js docs](https://nextjs.org/docs)
        - [Next.js App Router](https://nextjs.org/docs/app)
      `),
    },
  ],
};

// ── Template 5: Fullstack Next.js + API ───────────────────────────────────────

const FULLSTACK_NEXT_API: ProjectTemplate = {
  id: "fullstack-next-api",
  name: "Next.js + API",
  description: "Next.js App Router with a typed API route and /api/healthz health endpoint.",
  category: "fullstack",
  language: "TypeScript",
  framework: "Next.js",
  packageManager: "pnpm",
  healthPath: "/api/healthz",
  installCommand: "pnpm install --ignore-scripts",
  buildCommand: "pnpm run build",
  startCommand: "pnpm start",
  files: [
    {
      path: "package.json",
      content: dedent(`
        {
          "name": "{{projectSlug}}",
          "version": "0.1.0",
          "private": true,
          "scripts": {
            "dev": "next dev",
            "build": "next build",
            "start": "next start",
            "lint": "next lint"
          },
          "dependencies": {
            "next": "^14.2.21",
            "react": "^18.3.1",
            "react-dom": "^18.3.1"
          },
          "devDependencies": {
            "@types/node": "^20.17.10",
            "@types/react": "^18.3.17",
            "@types/react-dom": "^18.3.5",
            "typescript": "^5.7.2"
          }
        }
      `),
    },
    {
      path: "next.config.ts",
      content: dedent(`
        import type { NextConfig } from "next";

        const nextConfig: NextConfig = {
          /* config options here */
        };

        export default nextConfig;
      `),
    },
    {
      path: "tsconfig.json",
      content: dedent(`
        {
          "compilerOptions": {
            "lib": ["dom", "dom.iterable", "esnext"],
            "allowJs": true,
            "skipLibCheck": true,
            "strict": true,
            "noEmit": true,
            "esModuleInterop": true,
            "module": "esnext",
            "moduleResolution": "bundler",
            "resolveJsonModule": true,
            "isolatedModules": true,
            "jsx": "preserve",
            "incremental": true,
            "plugins": [{ "name": "next" }],
            "paths": { "@/*": ["./*"] }
          },
          "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
          "exclude": ["node_modules"]
        }
      `),
    },
    {
      path: "app/layout.tsx",
      content: dedent(`
        import type { Metadata } from "next";

        export const metadata: Metadata = {
          title: "{{projectName}}",
          description: "Built with Next.js and Prisom",
        };

        export default function RootLayout({
          children,
        }: Readonly<{
          children: React.ReactNode;
        }>) {
          return (
            <html lang="en">
              <body style={{ margin: 0, fontFamily: "system-ui, sans-serif" }}>
                {children}
              </body>
            </html>
          );
        }
      `),
    },
    {
      path: "app/page.tsx",
      content: dedent(`
        export default function Home() {
          return (
            <main
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                minHeight: "100vh",
                gap: "1rem",
                padding: "2rem",
                textAlign: "center",
              }}
            >
              <h1 style={{ fontSize: "2.5rem", fontWeight: 800, margin: 0 }}>
                {{projectName}}
              </h1>
              <p style={{ color: "#64748b", fontSize: "1.1rem", margin: 0 }}>
                Get started by editing{" "}
                <code
                  style={{
                    background: "#f1f5f9",
                    padding: "0.2em 0.5em",
                    borderRadius: "6px",
                    fontFamily: "monospace",
                  }}
                >
                  app/page.tsx
                </code>
              </p>
            </main>
          );
        }
      `),
    },
    {
      path: "app/api/healthz/route.ts",
      content: dedent(`
        import { NextResponse } from "next/server";

        export const runtime = "nodejs";

        export function GET() {
          return NextResponse.json(
            { status: "ok", service: "{{projectSlug}}", timestamp: new Date().toISOString() },
            { status: 200 }
          );
        }
      `),
    },
    {
      path: ".env.example",
      content: dedent(`
        # Copy this file to .env.local and fill in your values.
        # NEXT_PUBLIC_EXAMPLE=hello
      `),
    },
    {
      path: "README.md",
      content: dedent(`
        # {{projectName}}

        A fullstack [Next.js](https://nextjs.org) app with API routes, scaffolded with Prisom.

        ## Getting started

        \`\`\`bash
        pnpm install --ignore-scripts
        pnpm run dev
        \`\`\`

        ## API endpoints

        | Method | Path          | Description  |
        |--------|---------------|--------------|
        | GET    | /api/healthz  | Health check |

        ## Build

        \`\`\`bash
        pnpm run build
        pnpm start
        \`\`\`
      `),
    },
  ],
};

// ── Registry ──────────────────────────────────────────────────────────────────

const ALL_TEMPLATES: ProjectTemplate[] = [
  BLANK_STATIC,
  LANDING_PAGE,
  EXPRESS_API,
  NEXTJS_APP,
  FULLSTACK_NEXT_API,
];

export function listProjectTemplates(): ProjectTemplateSummary[] {
  return ALL_TEMPLATES.map(({ files: _files, ...rest }) => rest);
}

export function getProjectTemplate(id: string): ProjectTemplate | null {
  return ALL_TEMPLATES.find((t) => t.id === id) ?? null;
}
