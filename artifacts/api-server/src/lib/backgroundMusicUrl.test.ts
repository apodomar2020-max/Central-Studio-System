import assert from "node:assert/strict";
import test from "node:test";
import {
  MusicUrlValidationError,
  normalizeBackgroundMusicUrl,
  validateBackgroundMusicUrlWithDeps,
} from "./backgroundMusicUrl";

const publicLookup = async () => [{ address: "93.184.216.34" }];

test("normalizes Google Drive file URLs", () => {
  const result = normalizeBackgroundMusicUrl("https://drive.google.com/file/d/1AbC_def-234567890/view?usp=sharing");
  assert.equal(result.sourceType, "google_drive");
  assert.equal(result.fileId, "1AbC_def-234567890");
  assert.equal(result.normalizedUrl, "https://drive.google.com/uc?export=download&id=1AbC_def-234567890");
});

test("normalizes Google Drive open URLs", () => {
  const result = normalizeBackgroundMusicUrl("https://drive.google.com/open?id=1AbC_def-234567890");
  assert.equal(result.sourceType, "google_drive");
  assert.equal(result.normalizedUrl, "https://drive.google.com/uc?export=download&id=1AbC_def-234567890");
});

test("normalizes Google Drive uc URLs", () => {
  const result = normalizeBackgroundMusicUrl("https://drive.google.com/uc?id=1AbC_def-234567890");
  assert.equal(result.sourceType, "google_drive");
  assert.equal(result.normalizedUrl, "https://drive.google.com/uc?export=download&id=1AbC_def-234567890");
});

test("normalizes Google Drive uc export URLs", () => {
  const result = normalizeBackgroundMusicUrl("https://drive.google.com/uc?export=download&id=1AbC_def-234567890");
  assert.equal(result.sourceType, "google_drive");
  assert.equal(result.normalizedUrl, "https://drive.google.com/uc?export=download&id=1AbC_def-234567890");
});

test("keeps standard direct HTTPS audio URLs", () => {
  const url = "https://cdn.example.com/audio/menu.mp3";
  const result = normalizeBackgroundMusicUrl(url);
  assert.equal(result.sourceType, "direct");
  assert.equal(result.normalizedUrl, url);
});

test("rejects malformed URLs", () => {
  assert.throws(() => normalizeBackgroundMusicUrl("not a url"), MusicUrlValidationError);
});

test("rejects non-HTTPS URLs", () => {
  assert.throws(() => normalizeBackgroundMusicUrl("http://cdn.example.com/audio.mp3"), /HTTPS/);
});

test("rejects Drive links without a valid file ID", () => {
  assert.throws(() => normalizeBackgroundMusicUrl("https://drive.google.com/file/d//view"), /file ID/);
});

test("rejects Drive links with duplicate IDs", () => {
  assert.throws(
    () => normalizeBackgroundMusicUrl("https://drive.google.com/file/d/1AbC_def-234567890/view?id=2AbC_def-234567890"),
    /multiple file IDs/,
  );
});

test("rejects userinfo credentials in URLs", () => {
  assert.throws(() => normalizeBackgroundMusicUrl("https://user:pass@cdn.example.com/audio.mp3"), /credentials/);
});

test("rejects localhost URLs before fetching", async () => {
  await assert.rejects(
    () => validateBackgroundMusicUrlWithDeps("https://localhost/audio.mp3"),
    /Localhost URLs are not allowed/,
  );
});

test("rejects private IP URLs before fetching", async () => {
  await assert.rejects(
    () => validateBackgroundMusicUrlWithDeps("https://192.168.1.10/audio.mp3"),
    /Private or local network URLs are not allowed/,
  );
});

test("rejects redirect destinations that resolve to private hosts", async () => {
  const fetchImpl = async () => new Response(null, { status: 302, headers: { Location: "https://10.0.0.5/audio.mp3" } });
  await assert.rejects(
    () => validateBackgroundMusicUrlWithDeps("https://cdn.example.com/audio.mp3", null, { fetchImpl, lookupImpl: publicLookup }),
    /Private or local network URLs are not allowed/,
  );
});

test("rejects HTML login pages even when reachable", async () => {
  const fetchImpl = async () => new Response("<html>Google Drive sign in</html>", {
    status: 200,
    headers: { "content-type": "text/html" },
  });
  await assert.rejects(
    () => validateBackgroundMusicUrlWithDeps("https://cdn.example.com/audio.mp3", null, { fetchImpl, lookupImpl: publicLookup }),
    /web page instead of an audio file|HTML page instead of audio/,
  );
});

test("accepts bounded audio validation without buffering the full file", async () => {
  let pulls = 0;
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls += 1;
      controller.enqueue(new Uint8Array(70_000).fill(1));
    },
    cancel() {
      cancelled = true;
    },
  });
  const fetchImpl = async () => new Response(stream, {
    status: 206,
    headers: { "content-type": "audio/mpeg", "content-length": "1000000" },
  });
  const result = await validateBackgroundMusicUrlWithDeps("https://cdn.example.com/audio.mp3", null, { fetchImpl, lookupImpl: publicLookup });
  assert.equal(result.contentType, "audio/mpeg");
  assert.equal(cancelled, true);
  assert.equal(pulls <= 2, true);
});
