import jwt from "jsonwebtoken";
import { STUDENT_JWT_SECRET } from "../middlewares/auth";

const RESET_GRANT_EXPIRES_IN = "10m";

export type PasswordResetGrant = {
  sub: number;
  email: string;
  type: "password_reset";
  tokenVersion: number;
};

export function signPasswordResetGrant(studentId: number, email: string, tokenVersion: number): string {
  return jwt.sign(
    { sub: studentId, email: email.toLowerCase().trim(), type: "password_reset", tokenVersion },
    STUDENT_JWT_SECRET,
    { algorithm: "HS256", expiresIn: RESET_GRANT_EXPIRES_IN },
  );
}

export function verifyPasswordResetGrant(token: string): PasswordResetGrant | null {
  try {
    const payload = jwt.verify(token, STUDENT_JWT_SECRET, { algorithms: ["HS256"] }) as Partial<PasswordResetGrant>;
    if (
      payload.type !== "password_reset"
      || !Number.isInteger(payload.sub)
      || typeof payload.email !== "string"
      || !Number.isInteger(payload.tokenVersion)
    ) return null;
    return payload as PasswordResetGrant;
  } catch {
    return null;
  }
}
