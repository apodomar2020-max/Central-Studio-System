import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(new URL("./login.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("./login.css", import.meta.url), "utf8");

test("login uses the supplied looping video and all supplied icons", () => {
  assert.match(page, /Logo_animation_theater_light_glow_202607251827_gwr_video_mvp_sbp8pd\.mp4/);
  assert.match(page, /autoPlay muted loop playsInline/);
  for (const icon of ["user", "lock", "see", "unseen", "accessibility"]) {
    assert.match(page, new RegExp(`/login-icons/${icon}\\.svg`));
  }
});

test("password visibility swaps the supplied unseen and see assets", () => {
  assert.match(page, /type=\{showPassword \? "text" : "password"\}/);
  assert.match(page, /showPassword \? "\/login-icons\/see\.svg" : "\/login-icons\/unseen\.svg"/);
});

test("the page remains fixed to the viewport while the card adapts at narrow and short sizes", () => {
  assert.match(styles, /\.admin-login-page[\s\S]{0,180}height: 100vh;[\s\S]{0,60}height: 100dvh;[\s\S]{0,60}overflow: hidden/);
  assert.match(styles, /width: min\(42\.36vw, 732px\)/);
  assert.match(styles, /@media \(max-width: 1050px\)/);
  assert.match(styles, /@media \(max-height: 1050px\)/);
  assert.match(styles, /@media \(max-height: 860px\)/);
  assert.match(styles, /@media \(max-width: 640px\)/);
  assert.match(styles, /@media \(max-height: 680px\)/);
});

test("the submit action and security notice participate in card flow instead of overlapping", () => {
  assert.match(styles, /\.admin-login-card[\s\S]{0,120}display: flex;[\s\S]{0,60}flex-direction: column/);
  assert.match(styles, /\.admin-login-footer[\s\S]{0,220}margin-top: auto/);
  assert.doesNotMatch(styles, /\.admin-login-footer\s*\{[^}]*position:\s*absolute/);
  assert.doesNotMatch(styles, /\.admin-login-submit\s*\{[^}]*position:\s*absolute/);
});

test("sign-in logic still submits through AdminAuthContext", () => {
  assert.match(page, /await login\(username\.trim\(\)\.toLowerCase\(\), password\)/);
  assert.match(page, /<form className="admin-login-form" onSubmit=\{handleSubmit\}/);
  assert.match(page, /type="submit"/);
  assert.match(page, /className="admin-login-submit"/);
  assert.match(page, /disabled=\{!canSubmit\}/);
  assert.doesNotMatch(page, /admin-login-submit\$\{username/);
});
