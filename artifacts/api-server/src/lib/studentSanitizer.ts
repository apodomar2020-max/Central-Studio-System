/**
 * Sensitive-field sanitizer for student rows (Security Phase F).
 *
 * Strips authentication/security fields from a `studentsTable` row before it
 * is serialized into ANY API response. Use this whenever a route would
 * otherwise spread or return a raw student row; never rely on the frontend
 * to filter these out.
 *
 * Fields stripped:
 *   - passwordHash          bcrypt hash — must never leave the server
 *   - qrToken               check-in credential — bulk exposure lets anyone
 *                           impersonate students at the door
 *   - googleId / appleId / facebookId
 *                           social-provider subject identifiers
 *
 * Intentional qrToken exceptions (documented, owner/feature-scoped — do NOT
 * route these through this sanitizer):
 *   - publicStudent() (lib/studentProfileResponse.ts): the student's own
 *     profile response; the mobile app renders the owner's QR pass from it.
 *   - GET /students/:id/overview: single-student admin view, permission-gated,
 *     whose explicit allowlist feeds the admin QR display.
 */
import type { studentsTable } from "@workspace/db";

type StudentRow = typeof studentsTable.$inferSelect;

/** Row shape with every sensitive credential/identity field removed. */
export type SanitizedStudentRow<T extends Partial<StudentRow>> = Omit<
  T,
  "passwordHash" | "qrToken" | "googleId" | "appleId" | "facebookId"
>;

export function sanitizeStudentRow<T extends Partial<StudentRow>>(
  row: T,
): SanitizedStudentRow<T> {
  const {
    passwordHash: _passwordHash,
    qrToken: _qrToken,
    googleId: _googleId,
    appleId: _appleId,
    facebookId: _facebookId,
    ...safe
  } = row;
  return safe;
}
