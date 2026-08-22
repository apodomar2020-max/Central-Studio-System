/**
 * Child-process fixture for the "OTP_PEPPER required in production" test
 * (authHelpers.otpAtRestSecurity.integration.test.ts, item 18). Run via tsx
 * in a subprocess with NODE_ENV=production and OTP_PEPPER unset, so the
 * fail-closed throw at module load can be observed without crashing the
 * parent test runner.
 */
try {
  await import("./authHelpers");
  console.log("NOTHROW");
} catch (e) {
  console.log(`THROWN:${(e as Error).message}`);
}

export {};
