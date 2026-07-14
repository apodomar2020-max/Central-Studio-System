# Expo Dependency Notes

## Sentry

`@sentry/react-native` is intentionally excluded from `expo install --check`.
The app uses the Sentry Expo config plugin, Sentry Metro config, and runtime
initialization from `@sentry/react-native` v8. Downgrading only to satisfy Expo's
recommended range should be tested with a native preview build first.

## React Type Packages

`@types/react` and `@types/react-dom` are intentionally aligned with the
workspace catalog. Keeping Central on Expo's older recommended type range caused
pnpm to expose duplicate same-version native module peer contexts to
`expo-doctor`. These type packages are development-only and do not change the
native runtime.
