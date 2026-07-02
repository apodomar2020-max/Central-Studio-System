import { db } from "@workspace/db";

// Extract the transaction argument type from db.transaction callback signature
type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Shared executor type that represents either a root db client or a transaction client
export type DbClient = typeof db | DbTransaction;
