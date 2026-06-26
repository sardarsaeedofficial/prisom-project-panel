const SECRET_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /DATABASE_URL\s*[=:]\s*\S+/gi,          label: "DATABASE_URL" },
  { re: /NEXTAUTH_SECRET\s*[=:]\s*\S+/gi,        label: "NEXTAUTH_SECRET" },
  { re: /AUTH_SECRET\s*[=:]\s*\S+/gi,            label: "AUTH_SECRET" },
  { re: /SESSION_SECRET\s*[=:]\s*\S+/gi,         label: "SESSION_SECRET" },
  { re: /STRIPE_SECRET_KEY\s*[=:]\s*\S+/gi,      label: "STRIPE_SECRET_KEY" },
  { re: /STRIPE_WEBHOOK_SECRET\s*[=:]\s*\S+/gi,  label: "STRIPE_WEBHOOK_SECRET" },
  { re: /CLOUDINARY_SECRET\s*[=:]\s*\S+/gi,      label: "CLOUDINARY_SECRET" },
  { re: /JWT_SECRET\s*[=:]\s*\S+/gi,             label: "JWT_SECRET" },
  { re: /RESEND_API_KEY\s*[=:]\s*\S+/gi,         label: "RESEND_API_KEY" },
  { re: /password\s*=\s*["']?[^\s"']+["']?/gi,   label: "password" },
  { re: /\btoken\s*=\s*["']?[^\s"']+["']?/gi,    label: "token" },
  { re: /private_key\s*[=:]\s*\S+/gi,            label: "private_key" },
];

const EXCLUDED_DIRS = new Set(["node_modules", ".git", ".next", "dist", "build", "coverage"]);

export function redactHelpContent(content: string): string {
  let result = content;
  for (const { re } of SECRET_PATTERNS) {
    result = result.replace(re, (m) => {
      const eqIdx = m.search(/[=:]/);
      if (eqIdx >= 0) return m.slice(0, eqIdx + 1) + "[REDACTED]";
      return "[REDACTED]";
    });
  }
  return result;
}

export function isExcludedHelpPath(filePath: string): boolean {
  const p = filePath.replace(/\\/g, "/");
  const segments = p.split("/");
  const basename = segments[segments.length - 1] ?? "";

  // Hidden files / .env files
  if (basename.startsWith(".env")) return true;
  if (basename.startsWith(".") && basename !== ".") return true;

  // Secret file extensions
  if (
    basename.endsWith(".pem") ||
    basename.endsWith(".key") ||
    basename.endsWith(".crt") ||
    basename.endsWith(".log")
  )
    return true;

  // Excluded directory segments
  if (segments.some((s) => EXCLUDED_DIRS.has(s))) return true;

  // Storage backups
  if (p.includes("storage/backups")) return true;

  return false;
}
