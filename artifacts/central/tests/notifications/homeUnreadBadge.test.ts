import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const source = readFileSync(resolve(process.cwd(), "artifacts/central/app/(tabs)/index.tsx"), "utf8");

test("home bell renders the unread count inside the existing badge", () => {
  assert.match(source, /function BellButton\(\{ unreadCount, onPress \}/);
  assert.match(source, /\{unreadCount > 0 && \([\s\S]{0,180}<Text style=\{s\.badgeText\}>\{badgeLabel\}<\/Text>/);
  assert.match(source, /<BellButton unreadCount=\{totalUnread\}/);
});

test("large unread counts use a compact 99+ label", () => {
  assert.match(source, /const badgeLabel = unreadCount > 99 \? "99\+" : String\(unreadCount\);/);
});

test("bell icon size and surrounding button dimensions stay unchanged", () => {
  assert.match(source, /<CsIcon name="bell" size=\{21\} color=\{INK_200\} \/>/);
  assert.match(source, /headerBtn: \{[\s\S]{0,100}width: 42, height: 42, borderRadius: 21,/);
});
