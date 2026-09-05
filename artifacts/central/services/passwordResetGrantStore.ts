type PasswordResetGrant = { email: string; resetToken: string };

let currentGrant: PasswordResetGrant | null = null;

/** Keeps the short-lived reset grant in JS memory only — never in a URL,
 * AsyncStorage, logs, or analytics. It disappears when the app process ends. */
export function storePasswordResetGrant(grant: PasswordResetGrant): void {
  currentGrant = { email: grant.email.trim(), resetToken: grant.resetToken };
}

export function getPasswordResetGrant(): PasswordResetGrant | null {
  return currentGrant;
}

export function clearPasswordResetGrant(): void {
  currentGrant = null;
}
