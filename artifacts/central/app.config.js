// Dynamic Expo config.
//
// We keep the full static configuration in app.json and only layer on the
// react-native-fbsdk-next config plugin here, so the Facebook **Client Token**
// can be injected from the environment at build time instead of being committed.
//
//   EXPO_PUBLIC_FACEBOOK_APP_ID  — public App ID (already set in eas.json env)
//   FACEBOOK_CLIENT_TOKEN        — secret; provide via an EAS secret / EAS env,
//                                  or a local (gitignored) .env for dev builds.
//
// The App Secret is NEVER referenced here — token validation stays on the backend.
const appJson = require("./app.json");

module.exports = ({ config }) => {
  // `config` is app.json's `expo` block (Expo passes it in); fall back to a
  // direct read for safety.
  const base = config && Object.keys(config).length > 0 ? config : appJson.expo;

  const FACEBOOK_APP_ID = process.env.EXPO_PUBLIC_FACEBOOK_APP_ID ?? "891752636548494";
  const FACEBOOK_CLIENT_TOKEN = process.env.FACEBOOK_CLIENT_TOKEN ?? "";

  return {
    ...base,
    plugins: [
      ...(base.plugins ?? []),
      "expo-video",
      [
        "react-native-fbsdk-next",
        {
          appID: FACEBOOK_APP_ID,
          clientToken: FACEBOOK_CLIENT_TOKEN,
          displayName: "Central Studio",
          scheme: `fb${FACEBOOK_APP_ID}`,
          // Keep tracking/analytics off by default; the app only needs login.
          isAutoInitEnabled: true,
          autoLogAppEventsEnabled: false,
          advertiserIDCollectionEnabled: false,
        },
      ],
    ],
  };
};
