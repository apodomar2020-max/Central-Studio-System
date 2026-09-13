/**
 * Slug generation and validation for editorial post translations
 * (Wave 1.1).
 *
 * A translation's slug is the URL segment for that language's page, and its
 * uniqueness key is (channel, languageId, slug) — see
 * lib/db/src/schema/editorialPostTranslations.ts. The same slug may
 * legitimately exist once per channel and once per language.
 *
 * ─── UNICODE, AND WHAT WAS ACTUALLY VERIFIED ─────────────────────────────
 *
 * Slugs are NOT transliterated. An Arabic title produces an Arabic slug and
 * a Chinese title produces a Chinese slug, because transliteration is a
 * lossy editorial decision this layer has no business making silently (and
 * the naive Latin-only alternative — strip every non-ASCII character —
 * turns "ليلة الافتتاح" into the empty string).
 *
 * The whole path was verified end to end against a real disposable
 * Postgres rather than assumed:
 *   * Postgres `server_encoding` is UTF8 and the database collation is
 *     en_US.UTF-8, so a `text` column stores any code point.
 *   * An Arabic slug ("ليلة-الافتتاح", 13 characters / 25 bytes) inserted
 *     and selected back compared byte-exactly equal to the literal.
 *   * A CJK slug ("開幕之夜") likewise round-tripped exactly.
 *   * The (channel, language_id, slug) UNIQUE constraint correctly
 *     rejected a duplicate Arabic slug in the same (channel, language)
 *     pair, and correctly ALLOWED the same Arabic slug in a different
 *     language — i.e. the index compares the stored bytes, with no
 *     collation-dependent folding that could make two distinct slugs
 *     collide or two identical ones diverge.
 * Node's own layer needs nothing special: `String.prototype.normalize` is
 * built in, RegExp Unicode property escapes (`\p{L}`, `\p{N}`) are
 * supported natively, and Express/JSON bodies are UTF-8. No encoding,
 * routing, or collation blocker was found, so non-Latin slugs are
 * supported rather than deferred.
 *
 * ─── NORMALIZATION (why NFC, and why it is enforced) ─────────────────────
 *
 * The same visible text can have several Unicode encodings ("é" as U+00E9,
 * or "e" + U+0301). Left alone, two slugs that LOOK identical would be
 * different byte strings, would both pass the UNIQUE constraint, and would
 * produce two URLs a reader cannot tell apart. Every generated slug is
 * therefore NFC-normalized, and a MANUALLY supplied slug that is not
 * already in NFC (or not already lowercase) is REJECTED rather than
 * silently rewritten — the spec's rule is that a manual slug is never
 * silently altered, so the only honest options are accept or refuse.
 *
 * CASE: lowercased with `toLowerCase()`, which is a no-op for scripts that
 * have no case (Arabic, Hebrew, CJK, Devanagari) and correct for those
 * that do. Deliberately NOT locale-aware lowercasing — a Turkish-locale
 * "I" → "ı" would make the same title produce different slugs depending
 * on server locale.
 */

/**
 * Characters legal in a stored slug: letters or numbers from ANY script,
 * in hyphen-separated runs. No leading, trailing, or doubled hyphen.
 */
export const EDITORIAL_SLUG_RE = /^[\p{L}\p{N}]+(-[\p{L}\p{N}]+)*$/u;

/** Hard cap. Long enough for any real headline, short enough for a URL. */
export const MAX_SLUG_LENGTH = 120;

/**
 * Derive a slug from a title.
 *
 * NFC-normalize -> lowercase -> map every run of non-(letter|number) to a
 * single hyphen -> trim hyphens -> cap length on a hyphen boundary.
 *
 * Returns "" when the title contains no letters or numbers at all (e.g.
 * "!!!"), which callers must treat as "cannot auto-generate — ask for an
 * explicit slug" rather than storing a blank.
 */
export function slugifyEditorialTitle(title: string): string {
  const base = title
    .normalize("NFC")
    .toLowerCase()
    // One hyphen per run of separators/punctuation/symbols, so
    // "Opening   night — at last!" becomes "opening-night-at-last".
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/gu, "");

  if (base.length <= MAX_SLUG_LENGTH) return base;
  // Cut on a hyphen boundary so a truncated slug never ends mid-word.
  const cut = base.slice(0, MAX_SLUG_LENGTH);
  const lastHyphen = cut.lastIndexOf("-");
  return (lastHyphen > 0 ? cut.slice(0, lastHyphen) : cut).replace(/-+$/u, "");
}

/**
 * Is this exactly the canonical stored form of a slug?
 *
 * Requires NFC and lowercase as well as the character rules, so the one
 * visible slug has exactly one storable spelling and the database UNIQUE
 * cannot be bypassed by sending a different normalization form.
 */
export function isCanonicalEditorialSlug(slug: string): boolean {
  if (slug.length === 0 || slug.length > MAX_SLUG_LENGTH) return false;
  if (slug.normalize("NFC") !== slug) return false;
  if (slug.toLowerCase() !== slug) return false;
  return EDITORIAL_SLUG_RE.test(slug);
}

/**
 * Human-readable reason a manual slug was refused, or null when it is
 * acceptable. Separate from the boolean so the route can answer 400 with
 * the specific problem instead of one generic message.
 */
export function describeSlugProblem(slug: string): string | null {
  if (slug.length === 0) return "A slug cannot be empty.";
  if (slug.length > MAX_SLUG_LENGTH) {
    return `A slug cannot exceed ${MAX_SLUG_LENGTH} characters.`;
  }
  if (slug.normalize("NFC") !== slug) {
    return "That slug is not in Unicode NFC normal form. Retype it (or leave it blank to have one generated) so the URL has exactly one spelling.";
  }
  if (slug.toLowerCase() !== slug) return "A slug must be lowercase.";
  if (!EDITORIAL_SLUG_RE.test(slug)) {
    return 'A slug must be letters or numbers (any script) separated by single hyphens — for example "opening-night" or "ليلة-الافتتاح".';
  }
  return null;
}

/**
 * Deterministic collision suffixing for an AUTO-GENERATED slug:
 * "opening-night", then "opening-night-2", "opening-night-3", …
 *
 * `taken` is the set of slugs already present in the same
 * (channel, languageId) scope. Deterministic — never random — so the same
 * inputs always yield the same slug and a retried request does not create
 * a differently-named row. The base is trimmed if needed so the suffixed
 * slug still fits MAX_SLUG_LENGTH.
 *
 * A MANUALLY supplied slug never goes through this function: a manual
 * collision is a 409 the editor must resolve, never a silent rename.
 */
export function disambiguateEditorialSlug(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const tail = `-${suffix}`;
    const room = MAX_SLUG_LENGTH - tail.length;
    const trimmed = (base.length > room ? base.slice(0, room).replace(/-+$/u, "") : base) + tail;
    if (!taken.has(trimmed)) return trimmed;
  }
  // 998 posts sharing one title in one language in one channel. Treated as
  // an error by the caller rather than silently producing a 1000th guess.
  throw new Error(`Could not derive a unique slug from "${base}".`);
}
