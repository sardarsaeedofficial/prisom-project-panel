import fs   from "fs";
import path from "path";
import { isExcludedHelpPath, redactHelpContent } from "./help-redaction";
import type { HelpFileInventoryItem, HelpFileCategory } from "./help-center-types";

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_FILE_BYTES = 300 * 1024;
const SAFE_SCAN_DIRS = ["app", "components", "lib", "prisma", "scripts", "public"];
const SAFE_ROOT_FILES = [
  "README.md", "package.json", "pnpm-workspace.yaml",
  "next.config.ts", "next.config.js",
  "tailwind.config.ts", "tailwind.config.js",
  "tsconfig.json",
];
const TEXT_EXTS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs",
  ".json", ".md", ".css", ".prisma", ".sh", ".yaml", ".yml", ".toml", ".txt",
]);

// ── Classifiers ───────────────────────────────────────────────────────────────

function detectLanguage(filename: string): HelpFileInventoryItem["language"] {
  if (filename.endsWith(".tsx"))                                       return "tsx";
  if (filename.endsWith(".ts"))                                        return "typescript";
  if (filename.endsWith(".js") || filename.endsWith(".jsx") || filename.endsWith(".mjs")) return "javascript";
  if (filename.endsWith(".json"))                                      return "json";
  if (filename.endsWith(".md"))                                        return "markdown";
  if (filename.endsWith(".css"))                                       return "css";
  if (filename.endsWith(".prisma"))                                    return "prisma";
  if (filename.endsWith(".sh") || filename.endsWith(".bash"))          return "shell";
  return "unknown";
}

function categorizeFile(relPath: string): HelpFileCategory {
  const p    = relPath.replace(/\\/g, "/");
  const base = p.split("/").pop() ?? "";

  if (p.includes(".test.") || p.includes(".spec."))                  return "test";
  if (p.includes("/actions/") || /\/actions?\.(ts|js)$/.test(p))     return "server_action";
  if (/\/route\.(ts|js)$/.test(p))                                   return "server_action";
  if (/\/page\.(tsx|ts|js|jsx)$/.test(p) || /\/layout\.(tsx|ts|js|jsx)$/.test(p)) return "page";
  if (p.startsWith("components/") || p.includes("/components/"))     return "component";
  if (p.endsWith(".prisma") || p.includes("schema.prisma"))          return "schema";
  if (p.endsWith(".json") || /config\.(ts|js)$/.test(p))            return "config";
  if (p.startsWith("scripts/"))                                       return "script";
  if (p.endsWith(".css"))                                             return "style";
  if (p.endsWith(".md"))                                              return "export";

  if (p.startsWith("lib/")) {
    // Export files: *-export.ts, *export*.ts in lib
    if (/-export\.(ts|js)$/.test(base) || /export[-_]/i.test(base)) return "export";
    // Type definition files: *-types.ts, *type.ts
    if (/-types?\.(ts|js)$/.test(base))                              return "library";
    // Service files: *-service.ts
    if (/-service\.(ts|js)$/.test(base))                             return "library";
    return "library";
  }

  return "unknown";
}

// ── Extractors ────────────────────────────────────────────────────────────────

function extractExports(content: string): string[] {
  const found = new Set<string>();
  const re = /export\s+(?:async\s+)?(?:function|class|const|let|type|interface|enum)\s+(\w+)/g;
  let m;
  while ((m = re.exec(content)) !== null) found.add(m[1]);
  return [...found].slice(0, 15);
}

function extractImports(content: string): string[] {
  const found = new Set<string>();
  const re = /from\s+['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    if (!m[1].startsWith(".")) found.add(m[1]);
  }
  return [...found].slice(0, 10);
}

function extractRoutes(relPath: string): string[] {
  const p = relPath.replace(/\\/g, "/");
  const page = p.match(/^app\/(.+)\/page\.(tsx|ts|js|jsx)$/);
  if (page) {
    const route = "/" + page[1].replace(/\(.*?\)\//g, "").replace(/\(.*?\)$/g, "");
    return [route];
  }
  const route = p.match(/^app\/(.+)\/route\.(ts|js)$/);
  if (route) {
    return ["/" + route[1]];
  }
  return [];
}

function extractActions(content: string): string[] {
  const found = new Set<string>();
  // Explicit *Action named exports
  const re1 = /export\s+async\s+function\s+(\w+Action)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re1.exec(content)) !== null) found.add(m[1]);
  // "use server" files — all async exported functions are actions
  if (content.includes('"use server"') || content.includes("'use server'")) {
    const re2 = /export\s+async\s+function\s+(\w+)\b/g;
    while ((m = re2.exec(content)) !== null) found.add(m[1]);
  }
  return [...found].slice(0, 12);
}

function extractExportFilenames(content: string): string[] {
  const found = new Set<string>();
  // Matches filename: "FOO_BAR.md" style from CopyDownloadButton / export functions
  const re = /filename:\s*["'`]([A-Z0-9_\-]+\.md)["'`]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) found.add(m[1]);
  return [...found];
}

function buildSummary(relPath: string, exports: string[], content: string): string {
  const p    = relPath.replace(/\\/g, "/");
  const name = path.basename(relPath);

  // For action files: list action names
  if (p.includes("/actions/") || /\/actions?\.(ts|js)$/.test(p)) {
    const actionNames = exports.filter((e) => e.endsWith("Action") || e.endsWith("action"));
    if (actionNames.length > 0) {
      const listed = actionNames.slice(0, 4).join(", ");
      return `Server actions: ${listed}${actionNames.length > 4 ? ` +${actionNames.length - 4}` : ""}`;
    }
  }

  // For export files: include export filenames from content
  if (/-export\.(ts|js)$/.test(name)) {
    const filenames = extractExportFilenames(content);
    if (filenames.length > 0) {
      return `${name}: generates ${filenames.join(", ")}`;
    }
  }

  // For page files: include route
  const routes = extractRoutes(relPath);
  if (routes.length > 0) {
    return `Page at ${routes[0]}`;
  }

  // Generic: list key exports
  if (exports.length > 0) {
    const listed = exports.slice(0, 4).join(", ");
    return `${name}: exports ${listed}${exports.length > 4 ? ` +${exports.length - 4}` : ""}`;
  }

  // Fallback: first meaningful line of content
  const text = content
    .split("\n")
    .slice(0, 8)
    .map((l) => l.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "").trim())
    .filter((l) => l.length > 10 && !l.startsWith("import") && !l.startsWith("//"))
    .join(" ")
    .slice(0, 130);
  return text || name;
}

// ── Main scanner ──────────────────────────────────────────────────────────────

export async function generateProjectFileInventory(input: {
  projectId: string;
  maxFiles?: number;
}): Promise<{ inventory: HelpFileInventoryItem[]; excludedPaths: string[]; warnings: string[] }> {
  const { maxFiles = 400 } = input;
  const cwd = process.cwd();
  const inventory: HelpFileInventoryItem[] = [];
  const excludedSet = new Set<string>();
  const warnings: string[] = [];

  function processFile(fullPath: string): void {
    if (inventory.length >= maxFiles) return;

    const relPath = path.relative(cwd, fullPath).replace(/\\/g, "/");

    if (isExcludedHelpPath(relPath)) {
      excludedSet.add(relPath);
      return;
    }

    const ext = path.extname(fullPath).toLowerCase();
    if (!TEXT_EXTS.has(ext)) return;

    let stat: fs.Stats;
    try { stat = fs.statSync(fullPath); } catch { return; }

    if (stat.size > MAX_FILE_BYTES) {
      warnings.push(`Skipped (${Math.round(stat.size / 1024)}KB > 300KB): ${relPath}`);
      return;
    }

    let content = "";
    try {
      content = fs.readFileSync(fullPath, "utf-8");
    } catch {
      warnings.push(`Cannot read: ${relPath}`);
      return;
    }

    content = redactHelpContent(content);

    const importantExports = extractExports(content);
    const importantImports = extractImports(content);
    const routes           = extractRoutes(relPath);
    const actions          = extractActions(content);

    inventory.push({
      path:             relPath,
      category:         categorizeFile(relPath),
      language:         detectLanguage(path.basename(fullPath)),
      sizeBytes:        stat.size,
      summary:          buildSummary(relPath, importantExports, content),
      importantExports,
      importantImports,
      routes,
      actions,
      safetyNotes:      [],
    });
  }

  function scanDir(dirPath: string, depth = 0): void {
    if (depth > 7 || inventory.length >= maxFiles) return;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch {
      warnings.push(`Cannot read: ${path.relative(cwd, dirPath)}`);
      return;
    }

    for (const entry of entries) {
      if (inventory.length >= maxFiles) break;

      const fullPath = path.join(dirPath, entry.name);
      const relPath  = path.relative(cwd, fullPath).replace(/\\/g, "/");

      if (isExcludedHelpPath(relPath)) {
        excludedSet.add(relPath);
        continue;
      }

      if (entry.isDirectory()) {
        scanDir(fullPath, depth + 1);
      } else if (entry.isFile()) {
        processFile(fullPath);
      }
    }
  }

  // Root-level safe files
  for (const fname of SAFE_ROOT_FILES) {
    try {
      const fp = path.join(cwd, fname);
      if (fs.existsSync(fp)) processFile(fp);
    } catch { /* skip */ }
  }

  // Safe directories
  for (const dir of SAFE_SCAN_DIRS) {
    try {
      const dp = path.join(cwd, dir);
      if (fs.existsSync(dp)) scanDir(dp);
    } catch { /* skip */ }
  }

  return {
    inventory,
    excludedPaths: [...excludedSet].slice(0, 80),
    warnings,
  };
}
