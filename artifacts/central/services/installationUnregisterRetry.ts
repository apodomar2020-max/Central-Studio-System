export type PendingInstallation = { deviceId: string };

export type InstallationRetryDependencies = {
  readPending: () => Promise<PendingInstallation | null>;
  readSecret: () => Promise<string | null>;
  unregister: (deviceId: string, secret: string) => Promise<boolean>;
  clearPending: () => Promise<void>;
  wait: (ms: number) => Promise<void>;
};

export async function retryPendingInstallation(
  dependencies: InstallationRetryDependencies,
  maxAttempts = 3,
): Promise<boolean> {
  const pending = await dependencies.readPending();
  if (!pending) return true;
  const secret = await dependencies.readSecret();
  if (!secret) return false;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      if (await dependencies.unregister(pending.deviceId, secret)) {
        await dependencies.clearPending();
        return true;
      }
      return false;
    } catch {
      if (attempt + 1 < maxAttempts) await dependencies.wait(250 * (2 ** attempt));
    }
  }
  return false;
}
