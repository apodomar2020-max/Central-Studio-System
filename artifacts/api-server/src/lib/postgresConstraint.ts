type PostgresErrorShape = {
  code?: unknown;
  constraint?: unknown;
  constraint_name?: unknown;
  cause?: unknown;
  driverError?: unknown;
};

function postgresErrorCandidates(error: unknown): PostgresErrorShape[] {
  if (!error || typeof error !== "object") return [];

  const outer = error as PostgresErrorShape;
  return [outer, outer.cause, outer.driverError].filter(
    (candidate): candidate is PostgresErrorShape => !!candidate && typeof candidate === "object",
  );
}

/** Matches one specific constraint through a raw pg or wrapped Drizzle error. */
export function isPostgresConstraintViolation(error: unknown, constraintName: string): boolean {
  return postgresErrorCandidates(error).some((candidate) => {
    const constraint = candidate.constraint ?? candidate.constraint_name;
    return candidate.code === "23505" && constraint === constraintName;
  });
}
