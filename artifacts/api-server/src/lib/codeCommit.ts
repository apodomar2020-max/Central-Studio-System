import { execFile } from "node:child_process";
import { promisify } from "node:util";

type Environment = Readonly<Record<string, string | undefined>>;

export type ResolveCodeCommitOptions = {
  env?: Environment;
  readLocalGitCommit?: () => Promise<string | null>;
};

const COMMIT_ENV_PRIORITY = [
  "GIT_COMMIT_SHA",
  "RAILWAY_GIT_COMMIT_SHA",
  "GITHUB_SHA",
  "CI_COMMIT_SHA",
  "VERCEL_GIT_COMMIT_SHA",
] as const;

const GIT_SHA_PATTERN = /^[0-9a-f]{7,40}$/i;

function normalizeGitSha(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized && GIT_SHA_PATTERN.test(normalized)
    ? normalized.toLowerCase()
    : null;
}

function isDeployedEnvironment(env: Environment): boolean {
  return env["NODE_ENV"] === "production" || Boolean(
    env["RAILWAY_ENVIRONMENT"] ||
    env["RAILWAY_ENVIRONMENT_NAME"] ||
    env["RAILWAY_PROJECT_ID"] ||
    env["RAILWAY_SERVICE_ID"] ||
    env["VERCEL"] ||
    env["VERCEL_ENV"] ||
    env["CI"],
  );
}

async function readLocalGitCommit(): Promise<string | null> {
  try {
    const execFileAsync = promisify(execFile);
    const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"]);
    return stdout;
  } catch {
    return null;
  }
}

/**
 * Resolves the source revision without exposing arbitrary environment data.
 * Production uses validated platform metadata only; local Git is consulted
 * solely outside deployed environments.
 */
export async function resolveCodeCommit(
  options: ResolveCodeCommitOptions = {},
): Promise<string> {
  const env = options.env ?? process.env;
  for (const key of COMMIT_ENV_PRIORITY) {
    const commit = normalizeGitSha(env[key]);
    if (commit) return commit;
  }

  if (isDeployedEnvironment(env)) return "unavailable";

  const localCommit = normalizeGitSha(
    await (options.readLocalGitCommit ?? readLocalGitCommit)(),
  );
  return localCommit ?? "local";
}
