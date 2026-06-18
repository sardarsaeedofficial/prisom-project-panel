/**
 * lib/projects/package-validator.ts
 *
 * Sprint 9: Package specifier validation — pure JS, no Node built-ins.
 * Safe to import in both server modules and React client components.
 *
 * Safety goals:
 *  - Reject shell metacharacters (;, &, |, `, $, (, ), >, <, newlines)
 *  - Reject URL/protocol installs (http://, git+, file:, etc.)
 *  - Reject path-based installs (./, ../, /)
 *  - Reject malformed scoped names (@bad, @scope/, scope/name/extra)
 *  - Reject internal whitespace
 *  - Cap at 120 characters
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ValidatedPackageSpecifier {
  /** Human-readable string to display (e.g. "zod@latest") */
  display: string;
  /** Exact string to pass to the CLI (same as display in most cases) */
  raw: string;
}

export type ValidationResult =
  | { ok: true;  specifier: ValidatedPackageSpecifier }
  | { ok: false; error: string };

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_SPECIFIER_LENGTH = 120;

/**
 * Prefixes that identify non-registry install sources — all blocked.
 * Checked case-insensitively against the trimmed input.
 */
const BLOCKED_PREFIXES: string[] = [
  "http://",
  "https://",
  "git+",
  "github:",
  "gitlab:",
  "bitbucket:",
  "file:",
  "link:",
  "workspace:",
  "./",
  "../",
  "/",
];

/** Shell-injection characters that must never appear in a specifier. */
const SHELL_META_RE = /[;&|`$()><\n\r\\]/;

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Validate a single npm name segment (scope or package name, without @/).
 * Allows: letters, digits, hyphens, underscores, dots.
 * Must start with a letter, digit, or underscore.
 */
function isValidNpmNamePart(name: string): boolean {
  if (!name || name.length > 214) return false;
  return /^[a-zA-Z0-9_][a-zA-Z0-9\-_.]*$/.test(name);
}

/**
 * Validate a version specifier such as "latest", "^18.0.0", "3", ">=1.0.0".
 * Blocks protocol strings.
 */
function validateVersion(version: string): { ok: true } | { ok: false; error: string } {
  if (!version || version.length > 50) {
    return { ok: false, error: "Version specifier is empty or too long." };
  }

  const BLOCKED_IN_VERSION = [
    "file:",
    "git+",
    "https://",
    "http://",
    "github:",
    "gitlab:",
    "bitbucket:",
  ];
  for (const b of BLOCKED_IN_VERSION) {
    if (version.toLowerCase().includes(b)) {
      return { ok: false, error: `Version specifier contains blocked protocol: "${b}".` };
    }
  }

  // Allow semver chars, dist-tag chars, range operators
  if (!/^[a-zA-Z0-9.\-_^~>=<|* ]+$/.test(version)) {
    return { ok: false, error: `Version specifier contains invalid characters.` };
  }

  return { ok: true };
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Validate a package specifier entered by the user.
 *
 * Valid examples:
 *   "react"                  → name: react
 *   "@radix-ui/react-dialog" → name: @radix-ui/react-dialog
 *   "zod@latest"             → name: zod, version: latest
 *   "date-fns@3"             → name: date-fns, version: 3
 *   "@types/node@latest"     → name: @types/node, version: latest
 *
 * Invalid examples:
 *   "@bad"             → missing slash
 *   "@scope/"          → empty name after scope
 *   "scope/name/extra" → too many path segments
 *   "https://..."      → URL install
 *   "react native"     → whitespace
 *   "zod; rm -rf"      → shell metachar
 */
export function validatePackageSpecifier(input: string): ValidationResult {
  if (!input || typeof input !== "string") {
    return { ok: false, error: "Package name is required." };
  }

  const trimmed = input.trim();
  if (!trimmed) {
    return { ok: false, error: "Package name is required." };
  }

  if (trimmed.length > MAX_SPECIFIER_LENGTH) {
    return {
      ok: false,
      error: `Package specifier is too long (${trimmed.length} chars; max ${MAX_SPECIFIER_LENGTH}).`,
    };
  }

  // Internal whitespace
  if (/\s/.test(trimmed)) {
    return { ok: false, error: "Package specifier must not contain spaces or whitespace." };
  }

  // Shell metacharacters
  if (SHELL_META_RE.test(trimmed)) {
    return { ok: false, error: "Package specifier contains invalid characters." };
  }

  // Protocol / path prefixes
  const lower = trimmed.toLowerCase();
  for (const prefix of BLOCKED_PREFIXES) {
    if (lower.startsWith(prefix)) {
      return { ok: false, error: `Installing from "${prefix}" is not allowed.` };
    }
  }

  // ── Parse ────────────────────────────────────────────────────────────────

  let name: string;
  let version: string | undefined;

  if (trimmed.startsWith("@")) {
    // Scoped: @scope/name  or  @scope/name@version
    const withoutAt = trimmed.slice(1);
    const slashIdx  = withoutAt.indexOf("/");

    if (slashIdx < 0) {
      return { ok: false, error: 'Scoped packages must use the format "@scope/name".' };
    }

    const scope = withoutAt.slice(0, slashIdx);
    const rest  = withoutAt.slice(slashIdx + 1);

    if (!scope) {
      return { ok: false, error: "Package scope is empty." };
    }
    if (!rest) {
      return { ok: false, error: "Package name is empty after the scope." };
    }
    if (!isValidNpmNamePart(scope)) {
      return { ok: false, error: `Invalid package scope: "${scope}".` };
    }

    // rest can be "name" or "name@version"
    const atInRest = rest.indexOf("@");
    if (atInRest === 0) {
      return { ok: false, error: "Invalid package specifier." };
    } else if (atInRest > 0) {
      const pkgPart = rest.slice(0, atInRest);
      version = rest.slice(atInRest + 1);
      if (pkgPart.includes("/")) {
        return { ok: false, error: "Package name has too many path segments." };
      }
      if (!isValidNpmNamePart(pkgPart)) {
        return { ok: false, error: `Invalid package name: "${pkgPart}".` };
      }
      name = `@${scope}/${pkgPart}`;
    } else {
      // No version suffix
      if (rest.includes("/")) {
        return { ok: false, error: "Package name has too many path segments." };
      }
      if (!isValidNpmNamePart(rest)) {
        return { ok: false, error: `Invalid package name: "${rest}".` };
      }
      name = `@${scope}/${rest}`;
    }
  } else {
    // Unscoped: name  or  name@version
    const atIdx = trimmed.indexOf("@");

    if (atIdx === 0) {
      return { ok: false, error: "Invalid package name." };
    } else if (atIdx > 0) {
      name    = trimmed.slice(0, atIdx);
      version = trimmed.slice(atIdx + 1);
    } else {
      name = trimmed;
    }

    if (name.includes("/")) {
      return {
        ok: false,
        error: 'Package name must not contain "/" unless using scoped format @scope/name.',
      };
    }
    if (!isValidNpmNamePart(name)) {
      return { ok: false, error: `Invalid package name: "${name}".` };
    }
  }

  // Validate version if present
  if (version !== undefined) {
    const vr = validateVersion(version);
    if (!vr.ok) return vr;
  }

  const display = version ? `${name}@${version}` : name;
  return { ok: true, specifier: { display, raw: display } };
}
