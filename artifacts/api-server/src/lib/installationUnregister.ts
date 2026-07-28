import { createHash, randomBytes } from "node:crypto";

export const UNREGISTER_SECRET_BYTES = 32;

export type InstallationUnregisterStore = {
  deactivate(deviceId: string, secretHash: string): Promise<boolean>;
};

export function hashUnregisterSecret(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

export function resolveRegistrationSecret(provided?: string): {
  secret: string;
  secretHash: string;
  returnSecret: boolean;
} {
  const secret = provided ?? randomBytes(UNREGISTER_SECRET_BYTES).toString("base64url");
  return {
    secret,
    secretHash: hashUnregisterSecret(secret),
    returnSecret: provided == null,
  };
}

/**
 * Possession of the 256-bit secret authorizes only soft-deactivation of rows
 * for the matching installation. The store deliberately returns no match
 * count so callers cannot turn this into an ownership oracle.
 */
export async function unregisterByInstallation(
  store: InstallationUnregisterStore,
  deviceId: string,
  secret: string,
): Promise<boolean> {
  return store.deactivate(deviceId, hashUnregisterSecret(secret));
}
