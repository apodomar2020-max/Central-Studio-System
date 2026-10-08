import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Dialog and Sheet close buttons center their icon and preserve the accessible close name", () => {
  for (const file of ["dialog", "sheet"]) {
    const source = readFileSync(new URL(`./ui/${file}.tsx`, import.meta.url), "utf8");
    assert.match(source, /data-admin2-overlay-close className="[^"]*inline-flex items-center justify-center p-0/);
    assert.match(source, /<span className="sr-only">Close<\/span>/);
  }
});

test("shared close-button styling stays centered on hover and press", () => {
  const styles = readFileSync(new URL("./admin/admin2-system.css", import.meta.url), "utf8");
  assert.match(styles, /\[data-admin2-overlay-close\]:hover:not\(:disabled\),[\s\S]*?\[data-admin2-overlay-close\]:active:not\(:disabled\)\s*\{[^}]*align-items: center;[^}]*justify-content: center;[^}]*padding: 0;[^}]*transform: none;/);
});
