/**
 * lib/projects/deploy-constants.ts
 *
 * Constants shared between the deployment runner (server-only) and the
 * deployment UI components (client). Must NOT import any Node.js built-ins.
 */

/**
 * Absolute path to pnpm on the production VPS.
 * This exact binary path is the only absolute-path binary allowed in
 * deployment commands (see validateAndParseCommand in project-deploy-runner.ts).
 */
export const FULL_PATH_PNPM = "/home/prisom/.npm-global/bin/pnpm";
