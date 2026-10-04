import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";

// Driver/provider errors may embed SQL parameters, tokens or medical notes in
// their message/cause. Key redaction cannot sanitize arbitrary error strings.
export function safeErrorForLog(error: unknown) {
  const value = error instanceof Error ? error : null;
  return { type: value?.name && /^[A-Za-z0-9_]+$/.test(value.name) ? value.name : "Error",
    message: "Error details removed for privacy",
    stack: value?.stack?.split("\n").filter(line => /^\s+at /.test(line)).join("\n") };
}

export const LOG_REDACTION_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  "req.headers['x-api-key']",
  "req.headers['x-admin-token']",
  "req.headers['x-installation-secret']",
  "req.body",
  "res.headers['set-cookie']",
  "authorization",
  "Authorization",
  "password",
  "currentPassword",
  "newPassword",
  "token",
  "accessToken",
  "refreshToken",
  "idToken",
  "botToken",
  "otp",
  "providerToken",
  "challengeId",
  "linkChallengeId",
  "authorizationCode", "identityToken", "deletionProof", "statusToken", "APPLE_PRIVATE_KEY", "medicalNotes",
  "*.authorizationCode", "*.identityToken", "*.deletionProof", "*.statusToken", "*.medicalNotes",
  "*.password",
  "*.currentPassword",
  "*.newPassword",
  "*.token",
  "*.accessToken",
  "*.refreshToken",
  "*.idToken",
  "*.botToken",
  "*.otp",
  "*.authorization",
  "*.Authorization",
  "*.providerToken",
  "*.challengeId",
  "*.linkChallengeId",
] as const;

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: [...LOG_REDACTION_PATHS],
  serializers: { err: safeErrorForLog, error: safeErrorForLog },
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }),
});
