export function isRailwayEnvironment(env: NodeJS.ProcessEnv): boolean;
export function resolveMigrationDatabaseUrl(env: NodeJS.ProcessEnv): string;
export function createRuntimeEnvironment(
  env: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv;
