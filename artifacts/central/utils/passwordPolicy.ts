export const PASSWORD_MIN_LENGTH = 8;

/**
 * Mirrors the server's canonical password policy (PasswordSchema in
 * artifacts/api-server/src/lib/authHelpers.ts): at least 8 characters, at
 * least one letter, at least one number. No symbol or whitespace rule.
 * Deliberately no stricter than the server — the server remains authoritative.
 *
 * Shared by Reset Password and Change Password so both validate against the
 * same rule (Registration's existing inline check already matches this rule
 * independently and is left as-is — out of scope for this repair).
 *
 * Returns null when the password is valid, or a user-facing message
 * describing the first unmet rule.
 */
export function passwordPolicyError(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters`;
  }
  if (!/[A-Za-z]/.test(password)) {
    return "Password must include at least one letter";
  }
  if (!/[0-9]/.test(password)) {
    return "Password must include at least one number";
  }
  return null;
}
