/**
 * Wave 2.1A — Editorial reference-data hook contract.
 *
 * Source-inspection style: the hook imports the generated React Query client
 * and can only run inside a React render tree. What matters here is the
 * contract — which generated hooks it calls, the shared staleTime, and that
 * it never touches the global QueryClient.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const hook = readFileSync(new URL("./use-editorial-reference-data.ts", import.meta.url), "utf8");
const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
const generated = readFileSync(
  new URL("../../../../lib/api-client-react/src/generated/api.ts", import.meta.url),
  "utf8",
);

test("it calls the three real generated reference-list hooks", () => {
  for (const name of ["useListEditorialLanguages", "useListEditorialAuthors", "useListEditorialTopics"]) {
    assert.match(generated, new RegExp(`export function ${name}<`), `${name} must exist in the generated client`);
    assert.match(hook, new RegExp(`\\b${name}\\(`), `${name} must be called by the hook`);
  }
});

test("each call supplies the generated query key, as the codebase convention requires", () => {
  for (const name of [
    "getListEditorialLanguagesQueryKey",
    "getListEditorialAuthorsQueryKey",
    "getListEditorialTopicsQueryKey",
  ]) {
    assert.match(generated, new RegExp(`export const ${name} =`));
    assert.match(hook, new RegExp(`queryKey: ${name}\\(`));
  }
});

test("a shared 5-minute staleTime is applied through the hooks' own options", () => {
  assert.match(hook, /export const EDITORIAL_REFERENCE_STALE_TIME = 5 \* 60 \* 1000;/);
  assert.equal(
    (hook.match(/staleTime: EDITORIAL_REFERENCE_STALE_TIME,/g) ?? []).length,
    3,
    "all three reference lists must share the same staleTime",
  );
  assert.equal((hook.match(/query: \{/g) ?? []).length, 3);
});

test("the global QueryClient is not touched — no import, no mutation, no defaults", () => {
  // Strip the doc comment, which mentions the global QueryClient by name.
  const code = hook.replace(/^\/\*\*[\s\S]*?\*\/\n/, "");
  assert.doesNotMatch(code, /QueryClient|useQueryClient|setQueryDefaults|defaultOptions/);
  // And App.tsx's instantiation stays the bare default.
  assert.match(app, /^const queryClient = new QueryClient\(\);$/m);
  assert.doesNotMatch(app, /defaultOptions/);
});

test("it fetches reference data only — no posts, bodies, translations or revisions", () => {
  assert.doesNotMatch(
    hook,
    /useListEditorialPosts|useGetEditorialPost|Revision|Translation|Placement|Recommendation/,
  );
});

test("per-list loading/error states are preserved alongside the aggregates", () => {
  for (const list of ["languages", "authors", "topics"]) {
    assert.match(hook, new RegExp(`^\\s+${list},$`, "m"), `${list} query must be returned whole`);
  }
  assert.match(hook, /isLoading: languages\.isLoading \|\| authors\.isLoading \|\| topics\.isLoading,/);
  assert.match(hook, /isError: languages\.isError \|\| authors\.isError \|\| topics\.isError,/);
  assert.match(hook, /error: languages\.error \?\? authors\.error \?\? topics\.error \?\? null,/);
});

test("this branch consumes the generated client without regenerating it", () => {
  // The hook imports only; it declares no new endpoint or schema.
  assert.match(hook, /from "@workspace\/api-client-react";/);
  assert.doesNotMatch(hook, /customFetch|orval|axios|fetch\(/);
});
