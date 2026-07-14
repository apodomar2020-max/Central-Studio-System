import assert from "node:assert/strict";
import test from "node:test";
import { shouldPlayBackgroundMusic } from "./backgroundMusicRules";

const config = {
  enabled: true,
  sourceUrl: "file:///cache/background-music-v1.mp3",
};

test("plays only when remote, local preference, and app state allow it", () => {
  assert.equal(shouldPlayBackgroundMusic({ config, localEnabled: true, appState: "active", pauseForInternalMedia: false }), true);
});

test("does not play when remote config is disabled", () => {
  assert.equal(shouldPlayBackgroundMusic({ config: { ...config, enabled: false }, localEnabled: true, appState: "active", pauseForInternalMedia: false }), false);
});

test("does not play when the local preference is disabled", () => {
  assert.equal(shouldPlayBackgroundMusic({ config, localEnabled: false, appState: "active", pauseForInternalMedia: false }), false);
});

test("does not play while the app is inactive", () => {
  assert.equal(shouldPlayBackgroundMusic({ config, localEnabled: true, appState: "inactive", pauseForInternalMedia: false }), false);
});

test("does not play while an internal media screen should have priority", () => {
  assert.equal(shouldPlayBackgroundMusic({ config, localEnabled: true, appState: "active", pauseForInternalMedia: true }), false);
});

test("does not play without a source URL", () => {
  assert.equal(shouldPlayBackgroundMusic({ config: { ...config, sourceUrl: null }, localEnabled: true, appState: "active", pauseForInternalMedia: false }), false);
});
