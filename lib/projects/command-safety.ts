/**
 * lib/projects/command-safety.ts
 *
 * Sprint 7: safe command classifier for the per-project terminal.
 *
 * Parses a raw command string into executable + args, then classifies it as:
 *  - safe     → run immediately
 *  - confirm  → require explicit user confirmation before running
 *  - blocked  → refuse with a clear reason
 *
 * This module is PURE (no I/O, no DB, no filesystem reads).
 * All context (pm2Name, packageScripts) is passed by the caller.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type CommandRiskLevel = "safe" | "confirm" | "blocked";

export interface NormalizedCommand {
  executable: string;
  args:       string[];
  display:    string;
}

export type CommandSafetyResult =
  | { ok: true;  risk: "safe" | "confirm"; normalized: NormalizedCommand }
  | { ok: false; risk: "blocked";          reason: string };

// ── Shell metacharacter check ─────────────────────────────────────────────────

/**
 * Characters that could introduce shell injection when passed as-is.
 * We check BEFORE tokenising so a trailing pipe etc. is caught early.
 */
const SHELL_META_RX = /[;|`$<>!\\]/;

// ── Blocked executable names ──────────────────────────────────────────────────

const BLOCKED_EXECUTABLES = new Set([
  // privilege escalation
  "sudo", "su", "doas", "pkexec", "newgrp",
  // file destruction
  "rm", "rmdir", "shred", "wipe", "truncate",
  // permission / ownership
  "chmod", "chown", "chgrp", "setfacl",
  // link creation
  "ln",
  // network
  "curl", "wget", "fetch", "http", "httpie",
  "nc", "ncat", "netcat", "socat",
  "ssh", "scp", "sftp", "rsync", "rclone",
  "telnet", "ftp",
  // containers / virt
  "docker", "docker-compose", "podman", "kubectl", "helm",
  // process management (system-wide)
  "kill", "pkill", "killall", "fuser", "renice",
  // service / init
  "systemctl", "service", "initctl", "launchctl", "rc-service",
  "systemd",
  // web server / cert
  "nginx", "apache2", "httpd", "certbot", "openssl",
  // disk / mounts
  "mount", "umount", "mkfs", "fdisk", "parted", "dd",
  "lsblk", "blkid",
  // network config
  "iptables", "ip6tables", "nftables", "ufw", "firewalld",
  "ifconfig", "ip", "route", "tc",
  "arp",
  // crypto / keys
  "gpg", "gpg2", "ssh-keygen",
  // package managers (OS-level)
  "apt", "apt-get", "apt-cache",
  "yum", "dnf", "rpm",
  "brew", "pacman", "zypper",
  // env printing
  "printenv", "env", "export", "set",
  // interpreters with eval capability
  "bash", "sh", "zsh", "fish", "ksh", "dash", "csh", "tcsh",
  "perl", "ruby", "php", "python", "python3",
  "eval",
  // cron / scheduling
  "cron", "crontab", "at",
  // process substitution / pipes
  "tee", "xargs",
  // strace/ltrace (can expose secrets)
  "strace", "ltrace", "gdb",
  // misc dangerous
  "exec", "source",
  "git",  // too broad for now; may relax in a future sprint
]);

// ── Blocked argument tokens ───────────────────────────────────────────────────

/** If ANY arg matches this regex, the command is blocked. */
const BLOCKED_ARG_PATTERNS: Array<[RegExp, string | null]> = [
  [/^-e$/i,                          "flag -e allows arbitrary code execution"],
  [/^--exec$/i,                      "flag --exec executes code"],
  [/^-exec$/i,                       "find -exec executes code"],
  [/^-delete$/i,                     "find -delete deletes files"],
  [/\/etc\//,                        "access to /etc is blocked"],
  [/\/home\/prisom\/?$/,             "access to /home/prisom is blocked"],
  [/\/home\/prisom\/prisom-panel/,   "access to prisom-panel is blocked"],
  [/\/home\/prisom\/prisom-project-panel(?!\/storage\/projects)/,
                                     "access to prisom-project-panel root is blocked"],
  [/\/root\//,                       "access to /root is blocked"],
  [/\/var\//,                        "access to /var is blocked"],
  [/\/proc\//,                       "access to /proc is blocked"],
  [/\/sys\//,                        "access to /sys is blocked"],
  [/\/run\//,                        "access to /run is blocked"],
  [/^\.env(\..*)?$/i,                ".env files cannot be read"],
  [/^\//,                            "absolute paths are not allowed (use relative paths)"],
  [/\.\.\//,                         "path traversal (..) is not allowed"],
  [/^--/,                            null],  // will do per-command flag allow-listing below
];

/** Explicitly allowed global flags (like --version, --help). */
const GLOBAL_ALLOWED_FLAGS = new Set([
  "--version", "-v", "-V",
  "--help", "-h",
  "--no-color", "--color",
]);

/** Flags allowed specifically for `ls`. */
const LS_ALLOWED_FLAGS = /^-[laAhHFRt1]+$/;

/** Flags allowed specifically for `find`. */
const FIND_ALLOWED_FLAGS = new Set(["-name", "-type", "-maxdepth", "-mindepth", "-iname"]);

/** Flags allowed for `pm2 logs`. */
const PM2_LOGS_ALLOWED_FLAGS = new Set(["--lines", "--nostream", "--raw", "--err", "--out"]);

/** Tokens in package.json script bodies that indicate a blocked script. */
const BLOCKED_SCRIPT_BODY_RX = [
  /\brm\s+(-\S*r\S*|-\S*f\S*)/i,   // rm -rf / rm -r / rm -f
  /\brm\s+-/i,                       // any rm -<flag>
  /\bsudo\b/i,
  /\bsu\b/i,
  /\bcurl\b/i,
  /\bwget\b/i,
  /\bssh\b/i,
  /\bscp\b/i,
  /\bchmod\s+[0-9]*7[0-9]*/i,       // chmod 777 etc.
  /\bchown\b/i,
  /\bnode\s+-e\b/i,
  /\beval\b/i,
  /\bsystemctl\b/i,
  /\bservice\b/i,
  /\bdocker\b/i,
  /\bexec\b/i,                       // shell exec
  /printenv|process\.env|process\.argv/i,
];

/** Script names that indicate long-running / interactive processes. */
const LONG_RUNNING_SCRIPT_NAMES = new Set([
  "dev", "develop", "start", "serve", "watch",
  "storybook", "preview",
]);

const LONG_RUNNING_SCRIPT_BODY_RX = [
  /\bnext\s+dev\b/,
  /\bvite\b(?!\s+build)/,
  /\bwebpack\s+serve\b/,
  /\bnodemon\b/,
  /\bts-node-dev\b/,
  /--watch\b/,
  /--follow\b/,
  /-f\b/,
  /\btail\s+-f\b/,
];

// ── Tokeniser ─────────────────────────────────────────────────────────────────

/**
 * Split a command string into tokens.
 * Does NOT handle shell quoting fully — but we already block shell metacharacters
 * before reaching here, so quotes only appear in benign contexts like filenames.
 */
function tokenize(raw: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;

  for (const ch of raw) {
    if (ch === "'" && !inDouble) { inSingle = !inSingle; continue; }
    if (ch === '"' && !inSingle) { inDouble = !inDouble; continue; }
    if ((ch === " " || ch === "\t") && !inSingle && !inDouble) {
      if (current) { tokens.push(current); current = ""; }
      continue;
    }
    current += ch;
  }
  if (current) tokens.push(current);
  return tokens;
}

// ── Main classifier ───────────────────────────────────────────────────────────

export function classifyProjectCommand(input: {
  rawCommand:       string;
  projectPm2Name?:  string;
  packageScripts?:  Record<string, string>;
  packageManager?:  "pnpm" | "npm" | "yarn" | "unknown";
}): CommandSafetyResult {
  const {
    rawCommand,
    projectPm2Name,
    packageScripts = {},
    packageManager = "pnpm",
  } = input;

  // 1. Basic sanity checks
  const trimmed = rawCommand.trim();
  if (!trimmed) {
    return { ok: false, risk: "blocked", reason: "Empty command." };
  }
  if (trimmed.length > 300) {
    return { ok: false, risk: "blocked", reason: "Command too long (max 300 chars)." };
  }

  // 2. Shell metacharacter check
  if (SHELL_META_RX.test(trimmed)) {
    return {
      ok:     false,
      risk:   "blocked",
      reason: "Shell metacharacters (;|`$<>!\\) are not allowed. Each command must run standalone.",
    };
  }

  // 3. Tokenise
  const tokens = tokenize(trimmed);
  if (tokens.length === 0) {
    return { ok: false, risk: "blocked", reason: "Empty command." };
  }

  const [executable, ...args] = tokens;
  const execLower = executable.toLowerCase();

  // 4. Blocked executable?
  if (BLOCKED_EXECUTABLES.has(execLower)) {
    return {
      ok:     false,
      risk:   "blocked",
      reason: `"${executable}" is not an allowed command in the project terminal.`,
    };
  }

  // 5. Blocked arg patterns check
  for (const arg of args) {
    for (const [rx, msg] of BLOCKED_ARG_PATTERNS) {
      if (msg === null) continue; // handle per-command below
      if (rx.test(arg)) {
        return { ok: false, risk: "blocked", reason: msg ?? `Argument "${arg}" is not allowed.` };
      }
    }
  }

  // 6. Dispatch to per-command classifiers
  switch (execLower) {

    // ── pwd ─────────────────────────────────────────────────────────────────
    case "pwd":
      if (args.length > 0) {
        return { ok: false, risk: "blocked", reason: "pwd takes no arguments." };
      }
      return ok("safe", executable, [], trimmed);

    // ── ls ──────────────────────────────────────────────────────────────────
    case "ls": {
      const flags = args.filter((a) => a.startsWith("-"));
      const paths = args.filter((a) => !a.startsWith("-"));

      for (const flag of flags) {
        if (!LS_ALLOWED_FLAGS.test(flag) && !GLOBAL_ALLOWED_FLAGS.has(flag)) {
          return { ok: false, risk: "blocked", reason: `ls flag "${flag}" is not allowed.` };
        }
      }
      // At most one path argument
      if (paths.length > 1) {
        return { ok: false, risk: "blocked", reason: "ls with multiple paths is not allowed." };
      }
      return ok("safe", executable, args, trimmed);
    }

    // ── cat ─────────────────────────────────────────────────────────────────
    case "cat": {
      if (args.length === 0) {
        return { ok: false, risk: "blocked", reason: "cat requires a filename." };
      }
      if (args.length > 1) {
        return { ok: false, risk: "blocked", reason: "cat with multiple files is not allowed." };
      }
      const file = args[0];
      // Already checked absolute paths and .. in BLOCKED_ARG_PATTERNS
      const lower = file.toLowerCase();
      if (lower === ".env" || lower.startsWith(".env.") || lower.endsWith(".env")) {
        return { ok: false, risk: "blocked", reason: ".env files cannot be read." };
      }
      // Reject if starts with -
      if (file.startsWith("-")) {
        return { ok: false, risk: "blocked", reason: `cat flag "${file}" is not allowed.` };
      }
      return ok("safe", executable, args, trimmed);
    }

    // ── find ────────────────────────────────────────────────────────────────
    case "find": {
      // Allow: find [path] [-name/-iname/-type/-maxdepth/-mindepth] [value]
      // Path: must be . or a safe relative path
      let pathArg: string | undefined;
      const remaining: string[] = [];
      for (const arg of args) {
        if (!arg.startsWith("-") && pathArg === undefined) {
          pathArg = arg;
        } else {
          remaining.push(arg);
        }
      }
      if (pathArg && pathArg !== ".") {
        if (pathArg.startsWith("/") || pathArg.includes("..")) {
          return { ok: false, risk: "blocked", reason: "find path must be . or a relative path." };
        }
      }
      for (let i = 0; i < remaining.length; i++) {
        const flag = remaining[i];
        if (flag.startsWith("-")) {
          if (!FIND_ALLOWED_FLAGS.has(flag)) {
            return {
              ok: false, risk: "blocked",
              reason: `find flag "${flag}" is not allowed. Allowed: ${[...FIND_ALLOWED_FLAGS].join(", ")}.`,
            };
          }
          i++; // skip the value after the flag
        }
      }
      return ok("safe", executable, args, trimmed);
    }

    // ── node ────────────────────────────────────────────────────────────────
    case "node": {
      // Allow only: node --version, node -v, node scripts/safe.js
      // Block: node -e, node --eval, and any node with no args
      if (args.length === 0) {
        return { ok: false, risk: "blocked", reason: 'Bare "node" opens a REPL; not allowed.' };
      }
      const first = args[0].toLowerCase();
      if (first === "-e" || first === "--eval" || first === "--print" || first === "-p") {
        return { ok: false, risk: "blocked", reason: "node -e (eval) is not allowed." };
      }
      if (first === "--version" || first === "-v") {
        return ok("safe", executable, args, trimmed);
      }
      // Running a file — must be a safe relative path
      if (first.startsWith("-")) {
        return { ok: false, risk: "blocked", reason: `node flag "${args[0]}" is not allowed.` };
      }
      if (first.startsWith("/") || first.includes("..")) {
        return { ok: false, risk: "blocked", reason: "node script path must be relative." };
      }
      return ok("safe", executable, args, trimmed);
    }

    // ── pm2 ─────────────────────────────────────────────────────────────────
    case "pm2": {
      if (args.length === 0) {
        return { ok: false, risk: "blocked", reason: 'Bare "pm2" is not allowed.' };
      }
      const subcommand = args[0].toLowerCase();

      // Allow version check
      if (subcommand === "--version" || subcommand === "-v") {
        return ok("safe", executable, args, trimmed);
      }

      // Block broad/destructive pm2 commands
      const PM2_BLOCKED_SUBS = new Set([
        "kill", "delete", "del", "flush", "reset",
        "dump", "resurrect", "startup", "unstartup",
        "update", "install", "uninstall",
        "set", "conf", "multiwatch",
      ]);
      if (PM2_BLOCKED_SUBS.has(subcommand)) {
        return {
          ok: false, risk: "blocked",
          reason: `pm2 ${subcommand} is not allowed in the project terminal.`,
        };
      }

      // "pm2 <sub> all" is always blocked
      if (args.includes("all") || args.includes("ALL")) {
        return {
          ok: false, risk: "blocked",
          reason: `pm2 ${subcommand} all is blocked. Commands must target only the project's process.`,
        };
      }

      // Read-only commands: status / list / logs
      if (subcommand === "status" || subcommand === "list" || subcommand === "ls") {
        // Allow pm2 status <pm2Name> or pm2 list
        if (subcommand !== "list" && subcommand !== "ls") {
          // pm2 status <name> — validate name matches project
          const target = args[1];
          if (!target) {
            return {
              ok: false, risk: "blocked",
              reason: `pm2 status requires the process name: pm2 status ${projectPm2Name ?? "<pm2Name>"}.`,
            };
          }
          if (projectPm2Name && target !== projectPm2Name) {
            return {
              ok: false, risk: "blocked",
              reason: `pm2 status may only target "${projectPm2Name}" for this project.`,
            };
          }
        }
        return ok("safe", executable, args, trimmed);
      }

      if (subcommand === "logs") {
        const target = args[1];
        if (!target) {
          return {
            ok: false, risk: "blocked",
            reason: `pm2 logs requires the process name: pm2 logs ${projectPm2Name ?? "<pm2Name>"} --lines 100 --nostream.`,
          };
        }
        if (projectPm2Name && target !== projectPm2Name) {
          return {
            ok: false, risk: "blocked",
            reason: `pm2 logs may only target "${projectPm2Name}" for this project.`,
          };
        }
        // Must include --nostream (we don't support streaming yet)
        if (!args.includes("--nostream")) {
          return {
            ok: false, risk: "blocked",
            reason: 'pm2 logs must include --nostream. Example: pm2 logs ' +
              (projectPm2Name ?? "<pm2Name>") + " --lines 100 --nostream",
          };
        }
        // Validate remaining flags
        for (const arg of args.slice(2)) {
          if (arg.startsWith("-") && !PM2_LOGS_ALLOWED_FLAGS.has(arg.split("=")[0])) {
            return {
              ok: false, risk: "blocked",
              reason: `pm2 logs flag "${arg}" is not allowed.`,
            };
          }
        }
        return ok("safe", executable, args, trimmed);
      }

      // Restart / reload — require confirmation
      if (subcommand === "restart" || subcommand === "reload") {
        const target = args[1];
        if (!target) {
          return {
            ok: false, risk: "blocked",
            reason: `pm2 ${subcommand} requires the process name.`,
          };
        }
        if (projectPm2Name && target !== projectPm2Name) {
          return {
            ok: false, risk: "blocked",
            reason: `pm2 ${subcommand} may only target "${projectPm2Name}" for this project, not "${target}".`,
          };
        }
        // Extra flags beyond the name must be in allowlist
        for (const arg of args.slice(2)) {
          const allowed = ["--update-env", "--env"];
          if (!allowed.includes(arg.split("=")[0])) {
            return {
              ok: false, risk: "blocked",
              reason: `pm2 ${subcommand} flag "${arg}" is not allowed.`,
            };
          }
        }
        return ok("confirm", executable, args,
          `pm2 ${subcommand} ${target} — restarts only this project's PM2 process`);
      }

      return {
        ok: false, risk: "blocked",
        reason: `pm2 ${subcommand} is not supported in the project terminal.`,
      };
    }

    // ── pnpm / npm / yarn ────────────────────────────────────────────────────
    case "pnpm":
    case "npm":
    case "yarn": {
      const pkgMgr = execLower as "pnpm" | "npm" | "yarn";
      if (args.length === 0) {
        return { ok: false, risk: "blocked", reason: `Bare "${pkgMgr}" is not allowed.` };
      }

      const subcommand = args[0].toLowerCase();

      // Version check
      if (subcommand === "--version" || subcommand === "-v") {
        return ok("safe", executable, args, trimmed);
      }

      // run <script>
      if (subcommand === "run") {
        const scriptName = args[1];
        if (!scriptName) {
          return { ok: false, risk: "blocked", reason: `${pkgMgr} run requires a script name.` };
        }
        return classifyPackageScript(pkgMgr, scriptName, args.slice(1), packageScripts);
      }

      // test (shorthand for run test)
      if (subcommand === "test" || subcommand === "t") {
        return classifyPackageScript(pkgMgr, "test", args.slice(1), packageScripts);
      }

      // install — confirm-risk (downloads from npm, but legitimate for setup)
      if (subcommand === "install" || subcommand === "i" || subcommand === "add" || subcommand === "ci") {
        // Block install with arbitrary package names (could download malicious packages)
        if (args.slice(1).some((a) => !a.startsWith("-"))) {
          return {
            ok: false, risk: "blocked",
            reason: `${pkgMgr} ${subcommand} with package names is not allowed. Use "${pkgMgr} install" (no args) to restore from lockfile only.`,
          };
        }
        return ok("confirm", executable, args,
          `${pkgMgr} install — restores dependencies from lockfile`);
      }

      return {
        ok: false, risk: "blocked",
        reason: `"${pkgMgr} ${subcommand}" is not allowed. Use "run <script>" or "test".`,
      };
    }

    default:
      return {
        ok:     false,
        risk:   "blocked",
        reason: `"${executable}" is not an allowed command. Allowed: pwd, ls, cat, find, node, npm, pnpm, yarn, pm2.`,
      };
  }
}

// ── Package script classifier ─────────────────────────────────────────────────

function classifyPackageScript(
  pkgMgr:        string,
  scriptName:    string,
  extraArgs:     string[],
  scriptBodies:  Record<string, string>,
): CommandSafetyResult {
  const nameLower = scriptName.toLowerCase();

  // Check script exists in package.json (if scripts are provided)
  const hasScripts = Object.keys(scriptBodies).length > 0;
  if (hasScripts && !(scriptName in scriptBodies)) {
    return {
      ok:     false,
      risk:   "blocked",
      reason: `Script "${scriptName}" not found in package.json.`,
    };
  }

  // Long-running check
  if (LONG_RUNNING_SCRIPT_NAMES.has(nameLower)) {
    return {
      ok:     false,
      risk:   "blocked",
      reason: `"${scriptName}" is a long-running script. Use the deployment controls to manage the running process instead.`,
    };
  }

  // Body analysis (if we have the script body)
  const body = scriptBodies[scriptName] ?? "";
  if (body) {
    for (const rx of LONG_RUNNING_SCRIPT_BODY_RX) {
      if (rx.test(body)) {
        return {
          ok:     false,
          risk:   "blocked",
          reason: `Script "${scriptName}" appears to be long-running or interactive. Use deployment controls instead.`,
        };
      }
    }
    for (const rx of BLOCKED_SCRIPT_BODY_RX) {
      if (rx.test(body)) {
        return {
          ok:     false,
          risk:   "blocked",
          reason: `Script "${scriptName}" contains a blocked command in its body.`,
        };
      }
    }
  }

  // Extra arg validation
  for (const arg of extraArgs) {
    if (arg.startsWith("-")) {
      // Block arbitrary flags
      const allowedExtraFlags = new Set(["--", "--reporter", "--coverage", "--ci", "--passWithNoTests", "--silent", "--no-color"]);
      if (!allowedExtraFlags.has(arg)) {
        return {
          ok: false, risk: "blocked",
          reason: `Flag "${arg}" is not allowed when running a script.`,
        };
      }
    }
  }

  const display = extraArgs.length > 0
    ? `${pkgMgr} run ${scriptName} ${extraArgs.join(" ")}`
    : `${pkgMgr} run ${scriptName}`;

  return ok("safe", pkgMgr, ["run", scriptName, ...extraArgs], display);
}

// ── Helper ────────────────────────────────────────────────────────────────────

function ok(
  risk:       "safe" | "confirm",
  executable: string,
  args:       string[],
  display:    string,
): CommandSafetyResult {
  return {
    ok:   true,
    risk,
    normalized: { executable, args, display },
  };
}

// ── Preset builder ────────────────────────────────────────────────────────────

export interface PresetCommand {
  label:   string;
  command: string;
  risk:    "safe" | "confirm";
}

/**
 * Build the set of preset commands shown in the terminal UI.
 */
export function buildPresetCommands(opts: {
  pm2Name?:       string;
  packageManager: "pnpm" | "npm" | "yarn" | "unknown";
}): PresetCommand[] {
  const { pm2Name, packageManager } = opts;
  const pm = packageManager === "unknown" ? "npm" : packageManager;
  const presets: PresetCommand[] = [
    { label: "pwd",       command: "pwd",                                    risk: "safe" },
    { label: "ls",        command: "ls",                                     risk: "safe" },
    { label: "ls -la",    command: "ls -la",                                 risk: "safe" },
    { label: "typecheck", command: `${pm} run typecheck`,                    risk: "safe" },
    { label: "build",     command: `${pm} run build`,                        risk: "safe" },
    { label: "test",      command: `${pm} test`,                             risk: "safe" },
  ];
  if (pm2Name) {
    presets.push(
      { label: "PM2 status", command: `pm2 status ${pm2Name}`,                                      risk: "safe" },
      { label: "PM2 logs",   command: `pm2 logs ${pm2Name} --lines 100 --nostream`,                 risk: "safe" },
      { label: "PM2 reload", command: `pm2 reload ${pm2Name}`,                                      risk: "confirm" },
      { label: "PM2 restart",command: `pm2 restart ${pm2Name}`,                                     risk: "confirm" },
    );
  }
  return presets;
}
