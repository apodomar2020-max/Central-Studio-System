export type LogoutDependencies = {
  begin: () => void;
  // Security-02B (CS-SEC-H-03): best-effort call to POST /api/auth/logout,
  // which revokes every outstanding session for the account server-side
  // (see middlewares/auth.ts's tokenVersion check). Optional — omitting it
  // preserves the exact prior local-only-logout behavior, so existing
  // callers/tests are unaffected by this field's addition.
  //
  // Runs FIRST, while the current studentToken is still present (clearSession
  // removes it) — a request the server can authenticate is the whole point.
  // Its own failure must never block the rest of logout: a network-dead
  // device that "logs out" of a UI it can't reach the server from must still
  // leave that UI in a logged-out state, or the user is trapped.
  revokeSession?: () => Promise<void>;
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
        if (dependencies.revokeSession) {
          await dependencies.revokeSession().catch(() => {});
        }
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
