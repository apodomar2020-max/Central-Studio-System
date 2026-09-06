import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const screen = readFileSync(new URL("../../app/ballet/performances.tsx", import.meta.url), "utf8");
const animation = new URL("../../assets/animations/empty-performance.json", import.meta.url);

test("empty Ballet performances use the supplied looping Lottie artwork", () => {
  assert.equal(existsSync(animation), true);
  assert.match(screen, /import LottieView from "lottie-react-native"/);
  assert.match(screen, /EMPTY_PERFORMANCE_ANIMATION/);
  assert.match(screen, /source=\{EMPTY_PERFORMANCE_ANIMATION\}[\s\S]{0,120}autoPlay[\s\S]{0,80}loop/);
});

test("the legacy sparkles icon is not rendered in the no-performances branch", () => {
  const emptyBranch = screen.slice(screen.indexOf("performances.length === 0"), screen.indexOf(": (", screen.indexOf("performances.length === 0")));
  assert.doesNotMatch(emptyBranch, /sparkles-outline/);
  assert.match(emptyBranch, /No performances scheduled yet/);
});
