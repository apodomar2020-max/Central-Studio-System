import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeSvg } from "./sanitizeSvg";

test("safe SVG icon paths and local gradients are preserved", () => {
  const result = sanitizeSvg(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true">
      <defs><linearGradient id="paint"><stop offset="0%" stop-color="#03B6D7"/></linearGradient></defs>
      <path d="M2 12 L12 2 L22 12 Z" fill="url(#paint)" stroke="currentColor" stroke-width="2"/>
    </svg>
  `);
  assert.ok("svg" in result, "legitimate icon should remain renderable");
  if ("svg" in result) {
    assert.match(result.svg, /<path/);
    assert.match(result.svg, /viewBox="0 0 24 24"/);
    assert.match(result.svg, /url\(#paint\)/);
  }
});

for (const [name, payload] of [
  ["script", `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><path d="M0 0"/></svg>`],
  ["event handler", `<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><path d="M0 0"/></svg>`],
  ["foreignObject", `<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div xmlns="http://www.w3.org/1999/xhtml">x</div></foreignObject></svg>`],
  ["external href", `<svg xmlns="http://www.w3.org/2000/svg"><use href="https://evil.example/icon.svg#x"/></svg>`],
  ["data URL", `<svg xmlns="http://www.w3.org/2000/svg"><path fill="url(data:image/svg+xml;base64,AAAA)" d="M0 0"/></svg>`],
  ["style", `<svg xmlns="http://www.w3.org/2000/svg"><path style="fill:url(https://evil.example/x)" d="M0 0"/></svg>`],
  ["doctype", `<!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><svg xmlns="http://www.w3.org/2000/svg"><title>&xxe;</title></svg>`],
] as const) {
  test(`unsafe SVG ${name} is rejected`, () => {
    assert.ok("error" in sanitizeSvg(payload));
  });
}

test("SVG size limit remains enforced", () => {
  assert.ok("error" in sanitizeSvg(`<svg xmlns="http://www.w3.org/2000/svg"><desc>${"x".repeat(1024)}</desc></svg>`, 128));
});
