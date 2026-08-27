import pg from "pg";

const { Pool } = pg;

export function createPostgresPool(connectionString: string) {
  return new Pool({ connectionString });
}
