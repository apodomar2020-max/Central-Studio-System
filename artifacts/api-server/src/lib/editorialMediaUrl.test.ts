/**
 * Unit tests for the Unified Editorial CMS media validator and body-block
 * schema (Wave 1). No database and no real network: `fetch` and the DNS
 * resolver are both injected, so every SSRF rule is asserted deterministically.
 *
 * Run:
 *   pnpm --filter @workspace/api-server run test:editorial
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  EDITORIAL_ALLOWED_MEDIA_HOSTS,
  EditorialMediaUrlValidationError,
  isPrivateIpAddress,
  validateEditorialMediaUrl,
  validateEditorialMediaUrls,
} from "./editorialMediaUrl";
import { editorialBodySchema, findBlocksMissingAlt } from "./editorialBody";

const ALLOWED = `https://${EDITORIAL_ALLOWED_MEDIA_HOSTS[0]}/photo.jpg`;

/** A resolver that always answers with one public address. */
const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }];

function imageResponse(contentType = "image/jpeg"): Response {
  return new Response(null, { status: 200, headers: { "content-type": contentType } });
}

function redirectResponse(location: string, status = 302): Response {
  return new Response(null, { status, headers: { location } });
}

async function expectRejection(promise: Promise<unknown>, fragment: RegExp): Promise<void> {
  await assert.rejects(promise, (err: unknown) => {
    assert.ok(err instanceof EditorialMediaUrlValidationError, `expected EditorialMediaUrlValidationError, got ${String(err)}`);
    assert.match(err.message, fragment);
    return true;
  });
}

// ─── Protocol / host / shape ────────────────────────────────────────────────

test("rejects http (https only) — stricter than the legacy News validator", async () => {
  await expectRejection(
    validateEditorialMediaUrl(`http://${EDITORIAL_ALLOWED_MEDIA_HOSTS[0]}/a.jpg`, { skipLiveCheck: true }),
    /must use https/i,
  );
});

test("rejects a non-allowlisted host", async () => {
  await expectRejection(
    validateEditorialMediaUrl("https://evil.example.com/a.jpg", { skipLiveCheck: true }),
    /approved image list/i,
  );
});

test("rejects a raw IP literal even over https", async () => {
  await expectRejection(
    validateEditorialMediaUrl("https://169.254.169.254/latest/meta-data", { skipLiveCheck: true }),
    /approved hostname, not a raw IP/i,
  );
});

test("rejects embedded credentials", async () => {
  await expectRejection(
    validateEditorialMediaUrl(`https://user:pw@${EDITORIAL_ALLOWED_MEDIA_HOSTS[0]}/a.jpg`, { skipLiveCheck: true }),
    /cannot include credentials/i,
  );
});

test("rejects a malformed URL", async () => {
  await expectRejection(validateEditorialMediaUrl("not a url", { skipLiveCheck: true }), /valid image URL/i);
});

test("accepts an allowlisted https host", async () => {
  const result = await validateEditorialMediaUrl(ALLOWED, { skipLiveCheck: true });
  assert.equal(result.normalizedUrl, ALLOWED);
  assert.equal(result.contentType, null);
});

// ─── Private-range detection ────────────────────────────────────────────────

test("isPrivateIpAddress covers every required range", () => {
  for (const address of [
    "10.0.0.1", "10.255.255.255",       // RFC1918 10/8
    "172.16.0.1", "172.31.255.255",     // RFC1918 172.16/12
    "192.168.1.1",                      // RFC1918 192.168/16
    "127.0.0.1", "127.10.0.1",          // loopback 127/8
    "169.254.169.254",                  // link-local (cloud metadata)
    "0.0.0.0",                          // this-network
    "::1",                              // IPv6 loopback
    "fc00::1", "fd12:3456::1",          // fc00::/7 unique-local
    "fe80::1",                          // fe80::/10 link-local
    "::ffff:127.0.0.1",                 // IPv4-mapped loopback
    "::ffff:10.0.0.5",                  // IPv4-mapped RFC1918
    "not-an-ip",                        // unparseable -> refuse
  ]) {
    assert.equal(isPrivateIpAddress(address), true, `${address} must be treated as private`);
  }
  for (const address of ["93.184.216.34", "8.8.8.8", "2606:2800:220:1:248:1893:25c8:1946"]) {
    assert.equal(isPrivateIpAddress(address), false, `${address} must be treated as public`);
  }
});

test("rejects an allowlisted host that resolves to a private address (DNS rebinding)", async () => {
  await expectRejection(
    validateEditorialMediaUrl(ALLOWED, {
      lookupImpl: async () => [{ address: "127.0.0.1", family: 4 }],
      fetchImpl: async () => imageResponse(),
    }),
    /private or internal address/i,
  );
});

test("rejects when ANY resolved address is private, not just the first", async () => {
  await expectRejection(
    validateEditorialMediaUrl(ALLOWED, {
      lookupImpl: async () => [
        { address: "93.184.216.34", family: 4 },
        { address: "10.1.2.3", family: 4 },
      ],
      fetchImpl: async () => imageResponse(),
    }),
    /private or internal address/i,
  );
});

// ─── Redirects ──────────────────────────────────────────────────────────────

test("re-validates every redirect hop: an allowlisted host cannot redirect off-allowlist", async () => {
  await expectRejection(
    validateEditorialMediaUrl(ALLOWED, {
      lookupImpl: publicLookup,
      fetchImpl: async () => redirectResponse("https://evil.example.com/a.jpg"),
    }),
    /approved image list/i,
  );
});

test("re-validates every redirect hop: cannot redirect to an internal IP", async () => {
  await expectRejection(
    validateEditorialMediaUrl(ALLOWED, {
      lookupImpl: publicLookup,
      fetchImpl: async () => redirectResponse("http://169.254.169.254/latest/meta-data"),
    }),
    /https|raw IP/i,
  );
});

test("follows an allowlisted redirect and reports every hop", async () => {
  const second = `https://${EDITORIAL_ALLOWED_MEDIA_HOSTS[1]}/final.jpg`;
  let call = 0;
  const result = await validateEditorialMediaUrl(ALLOWED, {
    lookupImpl: publicLookup,
    fetchImpl: async () => (call++ === 0 ? redirectResponse(second) : imageResponse("image/png")),
  });
  assert.deepEqual(result.hops, [ALLOWED, second]);
  assert.equal(result.contentType, "image/png");
});

test("stops after 3 redirects", async () => {
  let n = 0;
  await expectRejection(
    validateEditorialMediaUrl(ALLOWED, {
      lookupImpl: publicLookup,
      fetchImpl: async () =>
        redirectResponse(`https://${EDITORIAL_ALLOWED_MEDIA_HOSTS[0]}/hop-${n++}.jpg`),
    }),
    /redirected more than 3 times/i,
  );
});

test("rejects a redirect with no Location header", async () => {
  await expectRejection(
    validateEditorialMediaUrl(ALLOWED, {
      lookupImpl: publicLookup,
      fetchImpl: async () => new Response(null, { status: 302 }),
    }),
    /redirected without a destination/i,
  );
});

// ─── Content-Type ───────────────────────────────────────────────────────────

test("rejects a non-image Content-Type", async () => {
  await expectRejection(
    validateEditorialMediaUrl(ALLOWED, {
      lookupImpl: publicLookup,
      fetchImpl: async () => imageResponse("text/html"),
    }),
    /only accepts images/i,
  );
});

test("rejects a missing Content-Type", async () => {
  await expectRejection(
    validateEditorialMediaUrl(ALLOWED, {
      lookupImpl: publicLookup,
      fetchImpl: async () => new Response(null, { status: 200 }),
    }),
    /did not report a content type/i,
  );
});

test("rejects an unreachable URL", async () => {
  await expectRejection(
    validateEditorialMediaUrl(ALLOWED, {
      lookupImpl: publicLookup,
      fetchImpl: async () => {
        throw new Error("ECONNREFUSED");
      },
    }),
    /could not be reached/i,
  );
});

test("batch helper returns the first failure with the offending URL", async () => {
  const result = await validateEditorialMediaUrls([ALLOWED, "https://evil.example.com/x.jpg"], {
    skipLiveCheck: true,
  });
  assert.ok(result);
  assert.match(result.error, /^https:\/\/evil\.example\.com\/x\.jpg: /);
});

test("batch helper passes when every URL is allowlisted", async () => {
  assert.equal(await validateEditorialMediaUrls([ALLOWED, ALLOWED], { skipLiveCheck: true }), null);
});

// ─── Body block schema ──────────────────────────────────────────────────────

const paragraph = { type: "paragraph" as const, text: "hello" };

test("accepts a well-formed body of every block type", () => {
  const parsed = editorialBodySchema.safeParse({
    blocks: [
      paragraph,
      { type: "heading", level: 2, text: "Section" },
      { type: "image", url: ALLOWED, alt: "A dancer mid-leap", caption: "Opening night" },
      { type: "bulleted-list", items: ["one", "two"] },
    ],
  });
  assert.equal(parsed.success, true, JSON.stringify(parsed.error?.issues));
});

test("rejects an oversized body (>250 blocks)", () => {
  const parsed = editorialBodySchema.safeParse({ blocks: Array.from({ length: 251 }, () => paragraph) });
  assert.equal(parsed.success, false);
  assert.match(parsed.error!.issues[0]!.message, /more than 250 blocks/i);
});

test("rejects more than 30 image blocks", () => {
  const parsed = editorialBodySchema.safeParse({
    blocks: Array.from({ length: 31 }, () => ({ type: "image", url: ALLOWED, alt: "x" })),
  });
  assert.equal(parsed.success, false);
  assert.match(parsed.error!.issues[0]!.message, /more than 30 image blocks/i);
});

test("rejects an image block with missing or blank alt", () => {
  assert.equal(editorialBodySchema.safeParse({ blocks: [{ type: "image", url: ALLOWED }] }).success, false);
  assert.equal(
    editorialBodySchema.safeParse({ blocks: [{ type: "image", url: ALLOWED, alt: "   " }] }).success,
    false,
  );
});

test("rejects an out-of-range heading level", () => {
  assert.equal(editorialBodySchema.safeParse({ blocks: [{ type: "heading", level: 1, text: "x" }] }).success, false);
  assert.equal(editorialBodySchema.safeParse({ blocks: [{ type: "heading", level: 4, text: "x" }] }).success, false);
  assert.equal(editorialBodySchema.safeParse({ blocks: [{ type: "heading", level: 3, text: "x" }] }).success, true);
});

test("rejects an over-long paragraph and an over-long heading", () => {
  assert.equal(
    editorialBodySchema.safeParse({ blocks: [{ type: "paragraph", text: "x".repeat(5001) }] }).success,
    false,
  );
  assert.equal(
    editorialBodySchema.safeParse({ blocks: [{ type: "heading", level: 2, text: "x".repeat(151) }] }).success,
    false,
  );
});

test("rejects a bulleted list outside 2..30 items", () => {
  assert.equal(editorialBodySchema.safeParse({ blocks: [{ type: "bulleted-list", items: ["only"] }] }).success, false);
  assert.equal(
    editorialBodySchema.safeParse({
      blocks: [{ type: "bulleted-list", items: Array.from({ length: 31 }, (_, i) => `i${i}`) }],
    }).success,
    false,
  );
});

test("findBlocksMissingAlt reports the offending block indexes over stored rows", () => {
  assert.deepEqual(
    findBlocksMissingAlt({
      blocks: [
        paragraph,
        { type: "image", url: ALLOWED, alt: "fine" },
        { type: "image", url: ALLOWED, alt: "  " },
        { type: "image", url: ALLOWED },
      ],
    }),
    [2, 3],
  );
});
