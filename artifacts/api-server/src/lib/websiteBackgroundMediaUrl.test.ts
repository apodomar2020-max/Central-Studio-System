import assert from "node:assert/strict";
import test from "node:test";
import {
  validateWebsiteBackgroundUrl,
  WebsiteBackgroundUrlValidationError,
} from "./websiteBackgroundMediaUrl";

function fetchReturning(status: number, contentType: string | null): typeof fetch {
  return (async () =>
    new Response(null, {
      status,
      headers: contentType ? { "content-type": contentType } : {},
    })) as unknown as typeof fetch;
}

test("rejects malformed URLs", async () => {
  await assert.rejects(
    () => validateWebsiteBackgroundUrl("not a url", "image"),
    WebsiteBackgroundUrlValidationError,
  );
});

test("rejects non-http/https protocols", async () => {
  await assert.rejects(
    () => validateWebsiteBackgroundUrl("javascript:alert(1)", "image"),
    /http or https/,
  );
});

test("rejects data: URLs", async () => {
  await assert.rejects(
    () => validateWebsiteBackgroundUrl("data:image/png;base64,AAAA", "image"),
    /http or https/,
  );
});

test("rejects credentials in the URL", async () => {
  await assert.rejects(
    () => validateWebsiteBackgroundUrl("https://user:pass@res.cloudinary.com/image.png", "image"),
    /credentials/,
  );
});

test("rejects disallowed hosts even with a valid image content type", async () => {
  await assert.rejects(
    () => validateWebsiteBackgroundUrl("https://evil-cdn.example.com/image.png", "image", {
      fetchImpl: fetchReturning(200, "image/png"),
    }),
    /approved media list/,
  );
});

test("accepts an allowed host serving the correct image content type", async () => {
  const result = await validateWebsiteBackgroundUrl(
    "https://res.cloudinary.com/demo/image/upload/photo.png",
    "image",
    { fetchImpl: fetchReturning(200, "image/png") },
  );
  assert.equal(result.mediaKind, "image");
  assert.equal(result.contentType, "image/png");
});

test("accepts an allowed host serving the correct video content type", async () => {
  const result = await validateWebsiteBackgroundUrl(
    "https://res.cloudinary.com/demo/video/upload/clip.mp4",
    "video",
    { fetchImpl: fetchReturning(200, "video/mp4") },
  );
  assert.equal(result.mediaKind, "video");
  assert.equal(result.contentType, "video/mp4");
});

test("rejects a valid image URL for a video-only section", async () => {
  await assert.rejects(
    () => validateWebsiteBackgroundUrl("https://res.cloudinary.com/demo/image/upload/photo.png", "video", {
      fetchImpl: fetchReturning(200, "image/png"),
    }),
    /only accepts videos/,
  );
});

test("rejects a valid video URL for an image-only section", async () => {
  await assert.rejects(
    () => validateWebsiteBackgroundUrl("https://res.cloudinary.com/demo/video/upload/clip.mp4", "image", {
      fetchImpl: fetchReturning(200, "video/mp4"),
    }),
    /only accepts images/,
  );
});

test("rejects when the host does not report a content type", async () => {
  await assert.rejects(
    () => validateWebsiteBackgroundUrl("https://res.cloudinary.com/demo/image/upload/photo", "image", {
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
    () => validateWebsiteBackgroundUrl("https://res.cloudinary.com/demo/image/upload/photo.png", "image", { fetchImpl }),
    /could not be reached/,
  );
});

test("rejects private/inaccessible media (403)", async () => {
  await assert.rejects(
    () => validateWebsiteBackgroundUrl("https://res.cloudinary.com/demo/image/upload/photo.png", "image", {
      fetchImpl: fetchReturning(403, "image/png"),
    }),
    /private or inaccessible/,
  );
});

test("accepts case-insensitive host matching", async () => {
  const result = await validateWebsiteBackgroundUrl(
    "https://RES.CLOUDINARY.COM/demo/image/upload/photo.png",
    "image",
    { fetchImpl: fetchReturning(200, "image/png") },
  );
  assert.equal(result.mediaKind, "image");
});
