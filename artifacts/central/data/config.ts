/**
 * App-wide runtime configuration flags.
 *
 * IS_DEMO_MODE
 * -----------
 * When true, screens are allowed to fall back to static mock/demo data.
 * This must NEVER be true in production.
 *
 * To enable demo mode during local development only:
 *   EXPO_PUBLIC_DEMO_MODE=true npx expo start
 *
 * Production builds (EAS Build / CI) must NOT set EXPO_PUBLIC_DEMO_MODE,
 * so this resolves to false automatically.
 */
export const IS_DEMO_MODE: boolean =
  process.env.EXPO_PUBLIC_DEMO_MODE === "true";
