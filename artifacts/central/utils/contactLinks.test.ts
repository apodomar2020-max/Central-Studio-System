import assert from "node:assert/strict";
import test from "node:test";

import {
  getContactHref,
  isDirectContactLink,
  isSocialContactLink,
  type AppContactLink,
  visibleContactLinks,
} from "./contactLinks";

function contact(overrides: Partial<AppContactLink>): AppContactLink {
  return {
    id: 1,
    type: "instagram",
    label: "Instagram",
    value: "https://instagram.com/centralstudio",
    sortOrder: 0,
    isActive: true,
    ...overrides,
  };
}

test("formats plain phone, email, and WhatsApp values for native contact actions", () => {
  assert.equal(getContactHref(contact({ type: "phone", value: "+20 100 123 4567" })), "tel:+201001234567");
  assert.equal(getContactHref(contact({ type: "email", value: "hello@centralstudio.com" })), "mailto:hello@centralstudio.com");
  assert.equal(getContactHref(contact({ type: "whatsapp", value: "+20 100 123 4567" })), "https://wa.me/201001234567");
});

test("preserves configured web URLs and supports social handles", () => {
  assert.equal(getContactHref(contact({ type: "facebook", value: "https://facebook.com/centralstudio" })), "https://facebook.com/centralstudio");
  assert.equal(getContactHref(contact({ type: "instagram", value: "@centralstudio" })), "https://instagram.com/centralstudio");
  assert.equal(getContactHref(contact({ type: "website", value: "centralstudio.com" })), "https://centralstudio.com");
});

test("only active, valid links are displayed and system ordering is preserved", () => {
  const result = visibleContactLinks([
    contact({ id: 3, sortOrder: 2, type: "email", value: "bad-email" }),
    contact({ id: 2, sortOrder: 1, type: "phone", value: "+20 100 123 4567" }),
    contact({ id: 1, sortOrder: 0, isActive: false }),
    contact({ id: 4, sortOrder: 1, type: "youtube", value: "centralstudio" }),
  ]);

  assert.deepEqual(result.map((link) => link.id), [2, 4]);
  assert.equal(isDirectContactLink(result[0]!), true);
  assert.equal(isSocialContactLink(result[1]!), true);
});
