/**
 * lib/secrets/env-parse.ts
 *
 * Sprint 22: Enhanced .env file parser with safety validation.
 *
 * Returns structured entries (not a raw Record) so the caller can:
 *  - Show per-entry validation status
 *  - Block dangerous entries
 *  - Generate fingerprints without storing values
 *  - Show redacted previews
 *
 * Parser handles:
 *  - KEY=value
 *  - KEY="value"  KEY='value'  KEY=`value`
 *  - # comments
 *  - export KEY=value
 *  - Multiline quoted values (double-quote only)
 *  - Escaped characters in double-quoted values
 *
 * Safety blocks:
 *  - Private key PEM blocks
 *  - Null bytes / binary content
 *  - Values > 8 KB
 *  - More than 200 entries per paste
 */

import { fingerprintSecret } from "./secret-fingerprint";
import { redactForImportPreview } from "./secret-redaction";

// ── Types ─────────────────────────────────────────────────────────────────────

export type ParsedEnvEntryStatus =
  | "ok"
  | "blocked_private_key"
  | "blocked_binary"
  | "blocked_too_large"
  | "invalid_key"
  | "empty_value"
  | "comment"
  | "conflict"; // set externally by caller after comparing with existing DB keys

export type ParsedEnvEntry = {
  key: string;
  /** Redacted display value — never the full plaintext */
  redactedPreview: string;
  /** Fingerprint of value — safe to show */
  fingerprint: string;
  status: ParsedEnvEntryStatus;
  /** Human-readable explanation for non-ok status */
  statusMessage: string | null;
  /** isSecret auto-detection */
  isLikelySecret: boolean;
  /** Selected for import — caller sets this */
  selected: boolean;
};

// ── Private key detection ─────────────────────────────────────────────────────

const PRIVATE_KEY_PATTERNS: RegExp[] = [
  /-----BEGIN\s+(RSA\s+)?PRIVATE KEY-----/i,
  /-----BEGIN\s+EC\s+PRIVATE KEY-----/i,
  /-----BEGIN\s+DSA\s+PRIVATE KEY-----/i,
  /-----BEGIN\s+OPENSSH\s+PRIVATE KEY-----/i,
  /-----BEGIN\s+ENCRYPTED\s+PRIVATE KEY-----/i,
  /-----BEGIN\s+PGP\s+PRIVATE KEY BLOCK-----/i,
];

function isPrivateKey(value: string): boolean {
  return PRIVATE_KEY_PATTERNS.some((re) => re.test(value));
}

function hasBinaryContent(value: string): boolean {
  // Check for null bytes or non-printable characters (except newline/tab)
  return /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(value);
}

// ── Key validation ────────────────────────────────────────────────────────────

export const RESERVED_IMPORT_KEYS = new Set([
  "NODE_ENV", "PORT", "HOST", "PWD", "HOME", "PATH",
  "SHELL", "USER", "PM2_HOME",
]);

export function validateImportKey(key: string): string | null {
  const clean = key.trim().toUpperCase();
  if (!clean) return "Empty key name.";
  if (!/^[A-Z][A-Z0-9_]*$/.test(clean)) {
    return `Invalid key name "${key}". Must start with a letter, uppercase letters/digits/underscores only.`;
  }
  if (RESERVED_IMPORT_KEYS.has(clean)) {
    return `"${clean}" is a reserved platform key and cannot be imported.`;
  }
  return null;
}

// ── SECRET_NAME_RE (from env-manager, duplicated to avoid cross-dep) ──────────

const SECRET_NAME_RE =
  /(?:SECRET|PASSWORD|PASS\b|_PASS$|_KEY$|KEY\b|TOKEN|PRIVATE|CREDENTIAL|WEBHOOK|DATABASE_URL|DSN|_URL$|PWD)/i;

// ── Main parser ───────────────────────────────────────────────────────────────

const MAX_ENTRIES = 200;
const MAX_VALUE_BYTES = 8 * 1024; // 8 KB per value

/**
 * Parse a .env file string into structured entries with safety validation.
 * No values are stored in the returned objects — only fingerprints and previews.
 */
export function parseDotEnv(content: string): ParsedEnvEntry[] {
  const entries: ParsedEnvEntry[] = [];
  const lines = content.split(/\r?\n/);
  let i = 0;

  while (i < lines.length && entries.length < MAX_ENTRIES) {
    let line = lines[i].trim();
    i++;

    // Skip blank lines and comments
    if (!line || line.startsWith("#") || line.startsWith("//")) continue;

    // Strip leading "export "
    if (line.startsWith("export ")) {
      line = line.slice(7).trim();
    }

    const eq = line.indexOf("=");
    if (eq < 1) continue;

    const rawKey = line.slice(0, eq).trim();
    let rawValue = line.slice(eq + 1);

    // Handle multiline double-quoted values
    if (rawValue.trimStart().startsWith('"') && !rawValue.trimEnd().endsWith('"')) {
      // Collect continuation lines
      let multiline = rawValue;
      while (i < lines.length) {
        multiline += "\n" + lines[i];
        i++;
        if (lines[i - 1].trimEnd().endsWith('"')) break;
      }
      rawValue = multiline;
    }

    rawValue = rawValue.trim();

    // Strip surrounding quotes
    if (
      (rawValue.startsWith('"') && rawValue.endsWith('"')) ||
      (rawValue.startsWith("'") && rawValue.endsWith("'")) ||
      (rawValue.startsWith("`") && rawValue.endsWith("`"))
    ) {
      rawValue = rawValue.slice(1, -1);
      // Process escape sequences in double-quoted values
      rawValue = rawValue.replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\"/g, '"');
    }

    const cleanKey = rawKey.toUpperCase().replace(/\s+/g, "_");

    // ── Validate key ─────────────────────────────────────────────────────────
    const keyError = validateImportKey(cleanKey);
    if (keyError) {
      entries.push({
        key: cleanKey || rawKey,
        redactedPreview: "(skipped)",
        fingerprint: "",
        status: "invalid_key",
        statusMessage: keyError,
        isLikelySecret: false,
        selected: false,
      });
      continue;
    }

    // ── Validate value ────────────────────────────────────────────────────────

    if (!rawValue) {
      entries.push({
        key: cleanKey,
        redactedPreview: "(empty)",
        fingerprint: "",
        status: "empty_value",
        statusMessage: "Empty value — will be skipped.",
        isLikelySecret: false,
        selected: false,
      });
      continue;
    }

    if (isPrivateKey(rawValue)) {
      entries.push({
        key: cleanKey,
        redactedPreview: "(private key — blocked)",
        fingerprint: "",
        status: "blocked_private_key",
        statusMessage:
          "Private key-style values are blocked. Store them outside Prisom or add a dedicated secure secret type.",
        isLikelySecret: true,
        selected: false,
      });
      continue;
    }

    if (hasBinaryContent(rawValue)) {
      entries.push({
        key: cleanKey,
        redactedPreview: "(binary content — blocked)",
        fingerprint: "",
        status: "blocked_binary",
        statusMessage: "Value contains binary or non-printable characters and cannot be imported.",
        isLikelySecret: false,
        selected: false,
      });
      continue;
    }

    if (Buffer.byteLength(rawValue, "utf8") > MAX_VALUE_BYTES) {
      entries.push({
        key: cleanKey,
        redactedPreview: "(too large — blocked)",
        fingerprint: "",
        status: "blocked_too_large",
        statusMessage: `Value exceeds 8 KB limit (${Buffer.byteLength(rawValue, "utf8")} bytes).`,
        isLikelySecret: true,
        selected: false,
      });
      continue;
    }

    // ── All checks passed — generate fingerprint + preview ────────────────────
    entries.push({
      key: cleanKey,
      redactedPreview: redactForImportPreview(rawValue),
      fingerprint: fingerprintSecret(rawValue),
      status: "ok",
      statusMessage: null,
      isLikelySecret: SECRET_NAME_RE.test(cleanKey),
      selected: true, // default to selected for valid entries
    });
  }

  return entries;
}
