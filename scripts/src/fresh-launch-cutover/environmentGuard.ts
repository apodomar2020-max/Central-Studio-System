import { isIP } from "node:net";

export const SOURCE_PREFIX = "central_cutover_source_";
export const TARGET_PREFIX = "central_cutover_target_";

export class CutoverSafetyError extends Error {
  constructor(public readonly code: string) {
    super(`[fresh-launch-cutover:${code}] safety validation failed`);
  }
}

function databaseName(url: URL): string {
  return decodeURIComponent(url.pathname.replace(/^\/+/, ""));
}

function assertNoEnvironmentMarkers(env: NodeJS.ProcessEnv): void {
  const forbidden = [
    "RAILWAY_ENVIRONMENT",
    "RAILWAY_ENVIRONMENT_ID",
    "RAILWAY_PROJECT_ID",
    "RAILWAY_SERVICE_ID",
  ];
  if (forbidden.some((key) => Boolean(env[key]))) throw new CutoverSafetyError("REMOTE_ENVIRONMENT_MARKER");
  const environment = `${env.NODE_ENV ?? ""} ${env.APP_ENV ?? ""}`.toLowerCase();
  if (/(production|staging|preview)/.test(environment)) throw new CutoverSafetyError("NON_REHEARSAL_ENVIRONMENT");
}

export function redactDatabaseUrl(raw: string): string {
  try {
    const url = new URL(raw);
    const db = databaseName(url);
    return `${url.protocol}//[redacted]@${url.hostname || "[socket]"}/${db || "[missing]"}`;
  } catch {
    return "[invalid database URL]";
  }
}

function assertLocal(url: URL, role: "source" | "target"): void {
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new CutoverSafetyError(`${role.toUpperCase()}_PROTOCOL`);
  }
  const host = url.hostname.toLowerCase();
  const loopback = host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
  const socketHost = decodeURIComponent(url.searchParams.get("host") ?? "");
  const socket = !host && /^(?:\/tmp|\/private\/tmp)(?:\/|$)/.test(socketHost);
  if (!loopback && !socket) {
    const suffix = isIP(host) ? "REMOTE_IP" : "REMOTE_HOST";
    throw new CutoverSafetyError(`${role.toUpperCase()}_${suffix}`);
  }
  if (!databaseName(url)) throw new CutoverSafetyError(`${role.toUpperCase()}_DATABASE_MISSING`);
}

export function validateCutoverEnvironment(input: {
  rehearsalFlag: string | undefined;
  sourceUrl: string | undefined;
  targetUrl: string | undefined;
  env?: NodeJS.ProcessEnv;
}): { source: URL; target: URL } {
  if (input.rehearsalFlag !== "I_UNDERSTAND_THIS_IS_LOCAL_AND_DISPOSABLE") {
    throw new CutoverSafetyError("REHEARSAL_FLAG_REQUIRED");
  }
  assertNoEnvironmentMarkers(input.env ?? process.env);
  if (!input.sourceUrl || !input.targetUrl) throw new CutoverSafetyError("DATABASE_URL_REQUIRED");
  let source: URL;
  let target: URL;
  try {
    source = new URL(input.sourceUrl);
    target = new URL(input.targetUrl);
  } catch {
    throw new CutoverSafetyError("DATABASE_URL_MALFORMED");
  }
  assertLocal(source, "source");
  assertLocal(target, "target");
  const sourceName = databaseName(source);
  const targetName = databaseName(target);
  if (!sourceName.startsWith(SOURCE_PREFIX)) throw new CutoverSafetyError("SOURCE_PREFIX");
  if (!targetName.startsWith(TARGET_PREFIX)) throw new CutoverSafetyError("TARGET_PREFIX");
  if (source.origin === target.origin && sourceName === targetName) throw new CutoverSafetyError("SOURCE_TARGET_SAME");
  if (/(prod|production|stage|staging|preview)/i.test(`${sourceName} ${targetName}`)) {
    throw new CutoverSafetyError("DATABASE_NAME_ENVIRONMENT_MARKER");
  }
  return { source, target };
}
