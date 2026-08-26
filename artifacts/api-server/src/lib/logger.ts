import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";

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
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }),
});
