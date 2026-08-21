#!/bin/sh
# Canonical entry point for the practical Mobile (artifacts/central) Node-test
# suite. Must be run from the repo root (process.cwd() stays at repo root so
# every test's root-relative readFileSync/resolve(process.cwd(), "artifacts/
# central/...") source-inspection path keeps working unchanged).
#
# Two flags are required beyond a plain `tsx --test`:
#
#   --experimental-test-module-mocks
#     Node's node:test `mock.module(...)` API (used by
#     PushRegistrationGate.productionPath.test.ts) is gated behind this flag
#     on the currently installed Node version. Without it, `mock.module` is
#     not a function and the test fails before importing the production
#     module it's meant to exercise.
#
#   --tsconfig artifacts/central/tsconfig.json
#     Mobile production modules import via the `@/*` path alias, which is
#     only declared in artifacts/central/tsconfig.json (`"@/*": ["./*"]`).
#     tsx normally discovers the nearest tsconfig.json relative to
#     process.cwd(); invoked from the repo root that resolves to the root
#     tsconfig (no `@/*` mapping at all), so any test that imports a
#     production module with an `@/` import (e.g. apiAdapters.ts) fails to
#     resolve it. Pointing tsx at the Mobile tsconfig explicitly fixes this
#     without changing process.cwd() and without touching Expo/Metro/Babel
#     config, which resolve `@/*` independently at build/bundle time.
set -e

TSX="./lib/db/node_modules/.bin/tsx"

find artifacts/central -type f \( -iname "*.test.ts" -o -iname "*.test.tsx" \) -not -path "*/node_modules/*" -print0 \
  | sort -z \
  | xargs -0 "$TSX" --tsconfig artifacts/central/tsconfig.json --experimental-test-module-mocks --test
