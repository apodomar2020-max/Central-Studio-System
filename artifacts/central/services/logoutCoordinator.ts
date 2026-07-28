export type LogoutDependencies = {
  begin: () => void;
  unregister: () => Promise<void>;
  clearSession: () => Promise<void>;
  finish: () => void;
};

export function createLogoutCoordinator(dependencies: LogoutDependencies): () => Promise<void> {
  let inFlight: Promise<void> | null = null;

  return () => {
    if (inFlight) return inFlight;
    dependencies.begin();
    const operation = (async () => {
      try {
        await dependencies.unregister().catch(() => {});
        await dependencies.clearSession();
      } finally {
        dependencies.finish();
        inFlight = null;
      }
    })();
    inFlight = operation;
    return operation;
  };
}
