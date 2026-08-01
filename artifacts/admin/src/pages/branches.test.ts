import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./branches.tsx", import.meta.url), "utf8");

test("read-only Branch and Room codes do not use FormLabel outside FormField", () => {
  assert.match(source, /editingBranch && <FormItem><Label>Branch Code<\/Label>/);
  assert.match(source, /editingRoom && <FormItem><Label>Room Code<\/Label>/);
  assert.doesNotMatch(source, /<FormItem><FormLabel>(?:Branch|Room) Code<\/FormLabel>/);
});
