/**
 * GitHub App API client.
 * Server-side only — never import this in client components.
 * All functions throw on network errors; callers should catch and handle gracefully.
 */
import { Octokit } from "@octokit/rest";
import { createAppAuth } from "@octokit/auth-app";
import { getGitHubAppConfig } from "@/lib/github/config";

/** Handles \n escaping that happens when storing PEM keys in .env files. */
function normalizePrivateKey(key: string): string {
  return key.replace(/\\n/g, "\n");
}

/** Returns an Octokit instance authenticated as a GitHub App installation. */
function createInstallationOctokit(installationId: number): Octokit {
  const config = getGitHubAppConfig(); // throws if env vars missing
  return new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: Number(config.appId),
      privateKey: normalizePrivateKey(config.privateKey),
      installationId,
    },
  });
}

// ── Repository list ───────────────────────────────────────────────────────────

export type GitHubAPIRepo = {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  private: boolean;
  html_url: string;
  default_branch: string;
  language: string | null;
  stargazers_count: number;
  clone_url: string;
  url: string;
};

/** Lists all repositories accessible to a given installation (up to 100). */
export async function listInstallationRepositories(
  installationId: number
): Promise<GitHubAPIRepo[]> {
  const octokit = createInstallationOctokit(installationId);
  const { data } = await octokit.apps.listReposAccessibleToInstallation({
    per_page: 100,
  });
  return data.repositories as unknown as GitHubAPIRepo[];
}

// ── Commits ───────────────────────────────────────────────────────────────────

export type GitHubAPICommit = {
  sha: string;
  html_url: string;
  commit: {
    message: string;
    author: { name: string; email: string; date: string } | null;
    committer: { name: string; email: string; date: string } | null;
  };
};

/** Fetches the most recent commits on a branch (default: 30). */
export async function getRepositoryCommits(input: {
  owner: string;
  repo: string;
  installationId: number;
  branch: string;
  perPage?: number;
}): Promise<GitHubAPICommit[]> {
  const octokit = createInstallationOctokit(input.installationId);
  const { data } = await octokit.repos.listCommits({
    owner: input.owner,
    repo: input.repo,
    sha: input.branch,
    per_page: input.perPage ?? 30,
  });
  return data as unknown as GitHubAPICommit[];
}

// ── File tree ─────────────────────────────────────────────────────────────────

export type GitHubTreeItem = {
  path?: string;
  type?: "blob" | "tree" | "commit";
  sha?: string;
  size?: number;
};

export type GitHubTreeResponse = {
  sha: string;
  tree: GitHubTreeItem[];
  truncated: boolean;
};

/**
 * Fetches the complete recursive file tree for a ref (branch name or commit SHA).
 * Trees are truncated at 100,000 items.
 */
export async function getRepositoryTree(input: {
  owner: string;
  repo: string;
  installationId: number;
  treeSha: string;
}): Promise<GitHubTreeResponse> {
  const octokit = createInstallationOctokit(input.installationId);
  const { data } = await octokit.git.getTree({
    owner: input.owner,
    repo: input.repo,
    tree_sha: input.treeSha,
    recursive: "1",
  });
  return data as unknown as GitHubTreeResponse;
}

// ── Single file content ───────────────────────────────────────────────────────

/**
 * Fetches the decoded text content of a single file.
 * Returns null if not found, not a file, or content is not base64.
 */
export async function getFileContent(input: {
  owner: string;
  repo: string;
  installationId: number;
  path: string;
  ref?: string;
}): Promise<string | null> {
  const octokit = createInstallationOctokit(input.installationId);
  try {
    const { data } = await octokit.repos.getContent({
      owner: input.owner,
      repo: input.repo,
      path: input.path,
      ref: input.ref,
    });
    if (Array.isArray(data)) return null;
    if (!("content" in data) || !data.content) return null;
    if (data.encoding !== "base64") return null;
    return Buffer.from(data.content, "base64").toString("utf8");
  } catch {
    return null;
  }
}

// ── Framework detection ───────────────────────────────────────────────────────

export type FrameworkDetection = {
  framework: string | null;
  language: string | null;
  packageManager: "npm" | "yarn" | "pnpm" | "composer" | null;
  buildCommand: string | null;
  startCommand: string | null;
  installCommand: string | null;
};

/**
 * Infers framework, language, and package manager from a flat list of file paths.
 * Uses config file / lock file heuristics — no network calls.
 */
export function detectFrameworkFromPaths(paths: string[]): FrameworkDetection {
  const pathSet = new Set(paths);

  const hasPackageJson = pathSet.has("package.json");
  const hasNextConfig = paths.some((p) =>
    /^next\.config\.(js|ts|mjs|cjs)$/.test(p)
  );
  const hasViteConfig = paths.some((p) =>
    /^vite\.config\.(js|ts|mjs)$/.test(p)
  );
  const hasPnpmLock = pathSet.has("pnpm-lock.yaml");
  const hasYarnLock = pathSet.has("yarn.lock");
  const hasPackageLock = pathSet.has("package-lock.json");
  const hasComposerJson = pathSet.has("composer.json");
  const hasArtisan = pathSet.has("artisan");
  const hasRequirements = pathSet.has("requirements.txt");
  const hasPyproject = pathSet.has("pyproject.toml");
  const hasCargoToml = pathSet.has("Cargo.toml");
  const hasGoMod = pathSet.has("go.mod");
  const hasGemfile = pathSet.has("Gemfile");

  let packageManager: FrameworkDetection["packageManager"] = null;
  if (hasPnpmLock) packageManager = "pnpm";
  else if (hasYarnLock) packageManager = "yarn";
  else if (hasPackageLock) packageManager = "npm";

  const pm = packageManager ?? "npm";
  const run = (s: string) =>
    pm === "pnpm" ? `pnpm ${s}` : pm === "yarn" ? `yarn ${s}` : `npm run ${s}`;
  const exec = (s: string) =>
    pm === "pnpm" ? `pnpm ${s}` : pm === "yarn" ? `yarn ${s}` : `npm ${s}`;
  const install =
    pm === "pnpm" ? "pnpm install" : pm === "yarn" ? "yarn" : "npm install";

  if (hasPackageJson) {
    if (hasNextConfig) {
      return {
        framework: "Next.js", language: "TypeScript", packageManager,
        installCommand: install, buildCommand: run("build"), startCommand: exec("start"),
      };
    }
    if (hasViteConfig) {
      return {
        framework: "Vite", language: "TypeScript", packageManager,
        installCommand: install, buildCommand: run("build"), startCommand: run("preview"),
      };
    }
    return {
      framework: "Node.js", language: "TypeScript", packageManager,
      installCommand: install, buildCommand: null, startCommand: exec("start"),
    };
  }

  if (hasComposerJson && hasArtisan) {
    return {
      framework: "Laravel", language: "PHP", packageManager: "composer",
      installCommand: "composer install",
      buildCommand: "php artisan optimize",
      startCommand: "php artisan serve",
    };
  }

  if (hasRequirements || hasPyproject) {
    return {
      framework: "Python", language: "Python", packageManager: null,
      installCommand: "pip install -r requirements.txt",
      buildCommand: null,
      startCommand: "python main.py",
    };
  }

  if (hasCargoToml) {
    return {
      framework: "Rust", language: "Rust", packageManager: null,
      installCommand: null,
      buildCommand: "cargo build --release",
      startCommand: "cargo run",
    };
  }

  if (hasGoMod) {
    return {
      framework: "Go", language: "Go", packageManager: null,
      installCommand: null,
      buildCommand: "go build ./...",
      startCommand: "go run .",
    };
  }

  if (hasGemfile) {
    return {
      framework: "Ruby", language: "Ruby", packageManager: null,
      installCommand: "bundle install",
      buildCommand: null,
      startCommand: "bundle exec rails server",
    };
  }

  return {
    framework: null, language: null, packageManager: null,
    installCommand: null, buildCommand: null, startCommand: null,
  };
}
