export function redirectSystemPath({ path, initial }: { path: string; initial: boolean }): string {
  let matchesOauthRedirect = false;
  let redirectTo = path;

  try {
    const parsed = new URL(path);
    if (parsed.pathname === "/oauthredirect" || parsed.hostname === "oauthredirect") {
      matchesOauthRedirect = true;
      redirectTo = "/";
    }
  } catch {
    if (path.startsWith("/oauthredirect") || path.includes(":/oauthredirect")) {
      matchesOauthRedirect = true;
      redirectTo = "/";
    }
  }

  if (__DEV__) {
    console.log("[AUTH_NAV] native-intent", {
      path,
      matchesOauthRedirect,
      redirectTo,
      initial,
    });
  }

  return redirectTo;
}
