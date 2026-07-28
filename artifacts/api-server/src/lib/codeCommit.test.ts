import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { resolveCodeCommit } from "./codeCommit";

const SHA = "5".repeat(40);
const OTHER_SHA = "a".repeat(40);

test("Railway commit metadata returns the exact deployed SHA", async () => {
  assert.equal(await resolveCodeCommit({
    env: { NODE_ENV: "production", RAILWAY_GIT_COMMIT_SHA: SHA },
  }), SHA);
});

test("explicit application override has priority over Railway", async () => {
  assert.equal(await resolveCodeCommit({
    env: { GIT_COMMIT_SHA: OTHER_SHA, RAILWAY_GIT_COMMIT_SHA: SHA },
  }), OTHER_SHA);
});

test("standard CI metadata is used when Railway metadata is absent", async () => {
  assert.equal(await resolveCodeCommit({
    env: { CI: "true", GITHUB_SHA: SHA },
  }), SHA);
});

test("Vercel metadata is supported and whitespace is normalized", async () => {
  assert.equal(await resolveCodeCommit({
    env: { VERCEL: "1", VERCEL_GIT_COMMIT_SHA: `  ${SHA.toUpperCase()} \n` },
  }), SHA);
});

test("malformed metadata is rejected and never copied into output", async () => {
  assert.equal(await resolveCodeCommit({
    env: {
      NODE_ENV: "production",
      RAILWAY_GIT_COMMIT_SHA: "not-a-sha secret-looking-text",
    },
  }), "unavailable");
});

test("short plausible SHA is normalized without changing its length", async () => {
  assert.equal(await resolveCodeCommit({
    env: { GITHUB_SHA: " A1B2C3D " },
  }), "a1b2c3d");
});

test("no metadata in local development returns local when Git is unavailable", async () => {
  assert.equal(await resolveCodeCommit({
    env: { NODE_ENV: "development" },
    readLocalGitCommit: async () => null,
  }), "local");
});

test("local development may report a deterministic local Git SHA", async () => {
  assert.equal(await resolveCodeCommit({
    env: { NODE_ENV: "development" },
    readLocalGitCommit: async () => ` ${SHA}\n`,
  }), SHA);
});

test("unsupported deployed environment returns unavailable and never invokes Git", async () => {
  let gitInvoked = false;
  assert.equal(await resolveCodeCommit({
    env: { NODE_ENV: "production" },
    readLocalGitCommit: async () => {
      gitInvoked = true;
      return SHA;
    },
  }), "unavailable");
  assert.equal(gitInvoked, false);
});

test("Finance reports, API diagnostics, and Worker use the same resolver", () => {
  const sources = [
    "artifacts/api-server/src/lib/financeBackfillDryRun.ts",
    "artifacts/api-server/src/routes/version.ts",
    "artifacts/api-server/src/worker.ts",
  ].map((path) => readFileSync(resolve(process.cwd(), path), "utf8"));

  for (const source of sources) {
    assert.match(source, /import \{ resolveCodeCommit \} from/);
    assert.match(source, /resolveCodeCommit\(\)/);
    assert.doesNotMatch(source, /RAILWAY_GIT_COMMIT_SHA|VERCEL_GIT_COMMIT_SHA/);
  }
  assert.match(sources[0]!, /codeCommit: await resolveCodeCommit\(\)/);
  assert.match(sources[1]!, /commit: codeCommit/);
  assert.match(sources[1]!, /codeCommit,/);
});

test("resolver allowlists only commit metadata and never dumps the environment", () => {
  const source = readFileSync(resolve(
    process.cwd(),
    "artifacts/api-server/src/lib/codeCommit.ts",
  ), "utf8");
  assert.doesNotMatch(source, /Object\.(entries|keys|values)\(.*env/);
  assert.doesNotMatch(source, /JSON\.stringify\(.*env/);
  assert.doesNotMatch(source, /console\.|logger\./);
});
