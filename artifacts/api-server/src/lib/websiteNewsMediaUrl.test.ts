import assert from "node:assert/strict";
import test from "node:test";
import {
  validateWebsiteNewsImageUrl,
  WebsiteNewsImageUrlValidationError,
} from "./websiteNewsMediaUrl";

function fetchReturning(status: number, contentType: string | null): typeof fetch {
  return (async () =>
    new Response(null, {
      status,
      headers: contentType ? { "content-type": contentType } : {},
    })) as unknown as typeof fetch;
}

test("rejects malformed URLs", async () => {
  await assert.rejects(
    () => validateWebsiteNewsImageUrl("not a url"),
    WebsiteNewsImageUrlValidationError,
  );
});

test("rejects non-http/https protocols", async () => {
  await assert.rejects(
    () => validateWebsiteNewsImageUrl("javascript:alert(1)"),
    /http or https/,
  );
});

test("rejects data: URLs", async () => {
  await assert.rejects(
    () => validateWebsiteNewsImageUrl("data:image/png;base64,AAAA"),
    /http or https/,
  );
});

test("rejects credentials in the URL", async () => {
  await assert.rejects(
    () => validateWebsiteNewsImageUrl("https://user:pass@images.unsplash.com/photo.png"),
    /credentials/,
  );
});

test("rejects disallowed hosts even with a valid image content type", async () => {
  await assert.rejects(
    () => validateWebsiteNewsImageUrl("https://evil-cdn.example.com/image.png", {
      fetchImpl: fetchReturning(200, "image/png"),
    }),
    /approved image list/,
  );
});

test("accepts an allowed host serving an image content type", async () => {
  const result = await validateWebsiteNewsImageUrl(
    "https://images.unsplash.com/photo-123?auto=format&fit=crop&q=80&w=1200",
    { fetchImpl: fetchReturning(200, "image/jpeg") },
  );
  assert.equal(result.contentType, "image/jpeg");
});

test("rejects a non-image content type (e.g. video)", async () => {
  await assert.rejects(
    () => validateWebsiteNewsImageUrl("https://res.cloudinary.com/demo/video/upload/clip.mp4", {
      fetchImpl: fetchReturning(200, "video/mp4"),
    }),
    /only accepts images/,
  );
});

test("rejects when the host does not report a content type", async () => {
  await assert.rejects(
    () => validateWebsiteNewsImageUrl("https://images.unsplash.com/photo-123", {
      fetchImpl: fetchReturning(200, null),
    }),
    /did not report a content type/,
  );
});

test("rejects unreachable URLs", async () => {
  const fetchImpl = (async () => {
    throw new Error("network error");
  }) as unknown as typeof fetch;
  await assert.rejects(
    () => validateWebsiteNewsImageUrl("https://images.unsplash.com/photo-123", { fetchImpl }),
    /could not be reached/,
  );
});

test("rejects private/inaccessible media (403)", async () => {
  await assert.rejects(
    () => validateWebsiteNewsImageUrl("https://images.unsplash.com/photo-123", {
      fetchImpl: fetchReturning(403, "image/png"),
    }),
    /private or inaccessible/,
  );
});

test("accepts case-insensitive host matching", async () => {
  const result = await validateWebsiteNewsImageUrl(
    "https://IMAGES.UNSPLASH.COM/photo-123",
    { fetchImpl: fetchReturning(200, "image/png") },
  );
  assert.equal(result.contentType, "image/png");
});
