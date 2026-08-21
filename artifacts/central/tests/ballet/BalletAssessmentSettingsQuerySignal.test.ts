/**
 * Regression for a real production bug: the Ballet Assessment screen's
 * ballet-settings useQuery previously passed `fetchBalletSettings` directly
 * as `queryFn`. TanStack Query v5 calls queryFn(context) with the full
 * QueryFunctionContext object ({ client, queryKey, signal, meta, ... }), not
 * a bare AbortSignal — so the entire context landed in fetchBalletSettings's
 * `signal` parameter and was forwarded straight to native fetch()'s
 * RequestInit, which throws synchronously because that object is not an
 * AbortSignal instance. This silently broke the ballet-settings fetch on
 * every mount, so `assessmentFeeEgp` was always null and the configured
 * assessment fee never displayed.
 *
 * The fix mirrors the already-working pattern used for the exact same
 * function in app/(tabs)/index.tsx: destructure `signal` out of the
 * TanStack context and forward only that to fetchBalletSettings.
 *
 * app/ballet/assessment.tsx is an Expo Router screen (JSX, react-native
 * imports) that cannot be imported into a plain Node test process — this
 * follows the repo's established source-assertion convention (see
 * artifacts/api-server/src/routes/bookingPriceBinding.test.ts).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

const ASSESSMENT_SCREEN = "artifacts/central/app/ballet/assessment.tsx";
const HOME_SCREEN = "artifacts/central/app/(tabs)/index.tsx";

function settingsQueryCallBody(source: string): string {
  const start = source.indexOf('queryKey: ["ballet-settings"]');
  assert.notEqual(start, -1, 'expected a queryKey: ["ballet-settings"] useQuery call');
  const end = source.indexOf("});", start);
  return source.slice(start, end);
}

test("assessment.tsx's ballet-settings queryFn extracts signal from the TanStack context instead of passing fetchBalletSettings directly", () => {
  const body = settingsQueryCallBody(read(ASSESSMENT_SCREEN));

  assert.match(
    body,
    /queryFn:\s*\(\{\s*signal\s*\}\)\s*=>\s*fetchBalletSettings\(signal\)/,
    "queryFn must destructure { signal } from the query context and forward only the AbortSignal to fetchBalletSettings",
  );

  // This is the exact regression this test exists to catch: queryFn must
  // never be the bare function reference again, since TanStack calls
  // queryFn(context) — passing the whole context object where
  // fetchBalletSettings expects an AbortSignal breaks native fetch's
  // RequestInit validation before any network request is made.
  assert.doesNotMatch(
    body,
    /queryFn:\s*fetchBalletSettings\s*[,}]/,
    "queryFn must not be the bare fetchBalletSettings reference — TanStack passes a context object, not a signal",
  );
});

test("the fix mirrors the already-working ballet-settings queryFn pattern used elsewhere for the same function", () => {
  const homeBody = settingsQueryCallBody(read(HOME_SCREEN));
  const assessmentBody = settingsQueryCallBody(read(ASSESSMENT_SCREEN));

  const extractQueryFn = (body: string) => body.match(/queryFn:\s*([^\n,]+),?\n/)?.[1]?.replace(/,$/, "");
  assert.equal(extractQueryFn(assessmentBody), extractQueryFn(homeBody));
});
