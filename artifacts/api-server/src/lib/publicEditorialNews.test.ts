import assert from "node:assert/strict";
import test from "node:test";
import type { EditorialBody } from "@workspace/db/schema";
import { GetPublicWebsiteNewsResponse } from "@workspace/api-zod";
import { toLegacyCompatibleNewsContent } from "./publicEditorialNews";

test("Editorial body compatibility projection retains all supported block types", () => {
  const body: EditorialBody = { blocks: [
    { type: "paragraph", text: "Lead" },
    { type: "heading", level: 2, text: "Heading" },
    { type: "paragraph", text: "Body" },
    { type: "bulleted-list", items: ["One", "Two"] },
    { type: "quote", text: "Quote", attribution: "Victoria", attributionRole: "Director" },
    { type: "image", url: "https://example.test/image.jpg", alt: "A factual alt", caption: "Caption" },
  ] };
  const result = toLegacyCompatibleNewsContent(body);
  assert.equal(result.leadParagraph, "Lead");
  assert.deepEqual(result.sections.map((section) => section.heading), ["Heading"]);
  assert.deepEqual(result.sections[0], {
    heading: "Heading", paragraphs: ["Body"], bulletPoints: ["One", "Two"],
    quote: { text: "Quote", author: "Victoria", role: "Director" },
    image: "https://example.test/image.jpg", imageCaption: "Caption",
  });
});

test("public News detail contract accepts additive Editorial fields and strips unknown metadata", () => {
  const parsed = GetPublicWebsiteNewsResponse.parse({
    slug: "news-1", category: "news", categoryLabel: "News", title: "Title", subtitle: "Deck", heroImageUrl: "https://example.test/feature.jpg", publishedDate: "July 18, 2026", readTime: "4 min read", authorName: "Victoria", authorRole: "Director", authorAvatarUrl: null, galleryImages: ["https://example.test/gallery.jpg"], tags: ["Community"], content: { leadParagraph: "Lead", sections: [] }, relatedItems: [],
    publishedAt: "2026-07-18T00:00:00.000Z", featureImageAlt: "Feature alt", body: { blocks: [{ type: "quote", text: "Quote", attribution: "Victoria", attributionRole: "Director" }] }, gallery: { items: [{ url: "https://example.test/gallery.jpg", alt: "Gallery alt" }] }, author: { name: "Victoria", role: "Director", avatarUrl: null }, topics: [{ name: "Community", slug: "community" }], migrationSourceId: 1,
  });
  assert.equal("migrationSourceId" in parsed, false);
  assert.equal(parsed.gallery.items[0]?.alt, "Gallery alt");
  assert.equal(parsed.body.blocks[0]?.type, "quote");
});
