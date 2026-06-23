/**
 * lib/github/github-sync-types.ts
 *
 * Sprint 40: Shared types for GitHub auto-sync settings and results.
 * Pure types — no server dependencies, safe to import anywhere.
 */

// ── Sync status ───────────────────────────────────────────────────────────────

export type GitHubSyncStatus =
  | "idle"     // no sync has run yet / settings just created
  | "syncing"  // currently fetching/pulling
  | "synced"   // local HEAD matches remote
  | "behind"   // remote has commits not yet pulled (pull not triggered)
  | "dirty"    // worktree has uncommitted changes — auto-pull blocked
  | "blocked"  // auto-pull disabled or not applicable
  | "failed";  // last sync attempt errored

// ── Settings DTO (what is returned to the client) ────────────────────────────

export type GitHubSyncSettings = {
  id:               string;
  projectId:        string;
  autoPullEnabled:  boolean;
  autoDeployEnabled: boolean;
  lastLocalSha:     string | null;
  lastRemoteSha:    string | null;
  lastSyncStatus:   GitHubSyncStatus | null;
  lastSyncMessage:  string | null;
  lastSyncedAt:     string | null;  // ISO
  lastWebhookAt:    string | null;  // ISO
  createdAt:        string;
  updatedAt:        string;
};

// ── Sync result (internal, not serialised to the client directly) ─────────────

export type GitHubSyncResult =
  | { ok: true;  status: GitHubSyncStatus; message: string; pulledCommits?: number }
  | { ok: false; status: GitHubSyncStatus; message: string };

// ── Action results ────────────────────────────────────────────────────────────

export type SyncSettingsResult =
  | { ok: true;  settings: GitHubSyncSettings }
  | { ok: false; error: string };

export type UpdateSyncSettingsInput = {
  autoPullEnabled?:  boolean;
  autoDeployEnabled?: boolean;
};
