// TODO: Implement GitHub OAuth and API integration
// Required scopes: repo, read:user, read:org

export type GitHubRepo = {
  id: number;
  name: string;
  fullName: string;
  description: string | null;
  private: boolean;
  url: string;
  language: string | null;
  stargazersCount: number;
  updatedAt: string;
  defaultBranch: string;
};

export type GitHubUser = {
  login: string;
  name: string;
  avatarUrl: string;
  publicRepos: number;
};

// TODO: Initialize Octokit with user access token from database
// import { Octokit } from "@octokit/rest";
// export function getOctokit(accessToken: string) {
//   return new Octokit({ auth: accessToken });
// }

// TODO: Replace with real GitHub API calls
export async function listUserRepos(_accessToken: string): Promise<GitHubRepo[]> {
  throw new Error("GitHub integration not yet implemented");
}

export async function getGitHubUser(_accessToken: string): Promise<GitHubUser> {
  throw new Error("GitHub integration not yet implemented");
}

// Placeholder constants for OAuth flow
export const GITHUB_OAUTH_URL = "https://github.com/login/oauth/authorize";
export const GITHUB_SCOPES = ["repo", "read:user", "read:org"].join(",");
