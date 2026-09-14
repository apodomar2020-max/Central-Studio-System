/**
 * editorial-languages — presentation logic for Website → Configuration →
 * Languages (Wave 2.1B).
 *
 * Everything in this module is pure: no React, no imports, no
 * `import.meta.env`. That is deliberate — the Admin test convention runs
 * `node --test` against real modules where it can, and falls back to source
 * inspection only for `.tsx` screens. Keeping the copy, the validation and
 * the code canonicalisation here means the parts a reviewer most needs
 * pinned (the deactivation wording, the immutability of `code`) are covered
 * by real behaviour tests rather than regexes.
 *
 * The backend remains authoritative for every rule. Nothing here predicts a
 * 409: duplicate codes, "the default cannot be deactivated" and "the last
 * active language cannot be deactivated" are all decided server-side and
 * rendered verbatim through `lib/editorial-errors.ts`.
 */

export type EditorialLanguageDirectionValue = "ltr" | "rtl";

/**
 * Mirror of `EDITORIAL_LANGUAGE_CODE_RE` in `lib/db/src/schema/editorialLanguages.ts`.
 * `lib/db` is a server-side package the Admin bundle deliberately does not
 * depend on, so the pattern is restated rather than imported; a test pins
 * this copy against the schema source so the two cannot drift.
 */
export const EDITORIAL_LANGUAGE_CODE_RE =
  /^[a-z]{2,3}(-[A-Z][a-z]{3})?(-([A-Z]{2}|[0-9]{3}))?$/;

/**
 * Mirror of `canonicalizeEditorialLanguageCode` in
 * `lib/db/src/schema/editorialLanguages.ts`. Used ONLY to preview the code
 * the server will store while the operator types ("EN-gb" → "en-GB"). The
 * value actually displayed after a save is always the server's own response,
 * never this preview.
 */
export function canonicalizeEditorialLanguageCode(raw: string): string {
  const parts = raw.trim().split("-");
  return parts
    .map((part, index) => {
      if (index === 0) return part.toLowerCase();
      if (part.length === 4 && /^[A-Za-z]{4}$/.test(part)) {
        return part[0]!.toUpperCase() + part.slice(1).toLowerCase();
      }
      if (/^[A-Za-z]{2}$/.test(part)) return part.toUpperCase();
      return part;
    })
    .join("-");
}

/** Real words, not an icon: "LTR"/"RTL" alone is not readable to everyone. */
export function directionLabel(direction: EditorialLanguageDirectionValue): string {
  return direction === "rtl" ? "Right to left (RTL)" : "Left to right (LTR)";
}

export const DIRECTION_OPTIONS: ReadonlyArray<{
  value: EditorialLanguageDirectionValue;
  label: string;
}> = [
  { value: "ltr", label: directionLabel("ltr") },
  { value: "rtl", label: directionLabel("rtl") },
];

/** Shown beside the read-only code field on the edit form. */
export const LANGUAGE_CODE_IMMUTABLE_EXPLANATION =
  "The language code cannot be changed: every stored translation is keyed to it. Register a new language instead.";

export interface LanguageFormValues {
  code: string;
  name: string;
  nativeName: string;
  direction: EditorialLanguageDirectionValue;
  displayOrder: string;
}

export type LanguageFormField = "code" | "name" | "nativeName" | "displayOrder";
export type LanguageFormErrors = Partial<Record<LanguageFormField, string>>;

export const EMPTY_LANGUAGE_FORM: LanguageFormValues = {
  code: "",
  name: "",
  nativeName: "",
  direction: "ltr",
  displayOrder: "0",
};

/**
 * Client-side validation limited to what the generated schema actually
 * states: code length 2–15 plus the locale-tag shape, name / nativeName
 * 1–100, displayOrder an integer >= 0. Uniqueness is NOT checked here — only
 * the database knows it, and its 409 is rendered verbatim.
 */
export function validateLanguageForm(
  values: LanguageFormValues,
  options: { requireCode: boolean },
): LanguageFormErrors {
  const errors: LanguageFormErrors = {};

  if (options.requireCode) {
    const code = canonicalizeEditorialLanguageCode(values.code);
    if (code.length === 0) {
      errors.code = "A language code is required.";
    } else if (code.length < 2 || code.length > 15) {
      errors.code = "A language code must be between 2 and 15 characters.";
    } else if (!EDITORIAL_LANGUAGE_CODE_RE.test(code)) {
      errors.code =
        'A language code must be a locale tag like "en", "ar", "en-GB", or "zh-Hant-TW".';
    }
  }

  const name = values.name.trim();
  if (name.length === 0) errors.name = "A name is required.";
  else if (name.length > 100) errors.name = "A name can be at most 100 characters.";

  const nativeName = values.nativeName.trim();
  if (nativeName.length === 0) errors.nativeName = "A native name is required.";
  else if (nativeName.length > 100)
    errors.nativeName = "A native name can be at most 100 characters.";

  const rawOrder = values.displayOrder.trim();
  if (rawOrder.length === 0) {
    errors.displayOrder = "A display order is required.";
  } else {
    const parsed = Number(rawOrder);
    if (!Number.isInteger(parsed) || parsed < 0) {
      errors.displayOrder = "Display order must be a whole number of 0 or more.";
    }
  }

  return errors;
}

export function hasFormErrors(errors: LanguageFormErrors): boolean {
  return Object.keys(errors).length > 0;
}

export interface LanguageConfirmation {
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
}

export interface LanguageSummary {
  name: string;
  code: string;
  translationCounts: { draft: number; published: number; archived: number };
}

/**
 * Deactivation copy. It must match Wave 2.0's real retention policy exactly:
 * nothing is deleted, published translations stay live AND stay editable,
 * and the only effect is that no NEW translation or publish can happen in
 * this language until it is activated again.
 */
export function deactivateConfirmation(language: LanguageSummary): LanguageConfirmation {
  const published = language.translationCounts.published;
  const publishedSentence =
    published === 1
      ? "Its 1 published translation stays live on the website and stays editable."
      : `Its ${published} published translations stay live on the website and stay editable.`;

  return {
    title: `Deactivate ${language.name}?`,
    description: [
      `Nothing is deleted. Every existing ${language.name} translation is retained exactly as it is.`,
      publishedSentence,
      `What changes: no NEW translation can be created in ${language.name}, and nothing new can be published in it, until the language is activated again.`,
    ].join(" "),
    confirmLabel: "Deactivate language",
  };
}

export function activateConfirmationMessage(language: LanguageSummary): string {
  return `${language.name} can be used for new translations and publishing again. No translation's status is changed.`;
}

/**
 * Set-default copy. The swap is one transaction on the language rows only —
 * it never reads or writes a translation.
 */
export function setDefaultConfirmation(
  language: LanguageSummary,
  currentDefaultName: string | null,
): LanguageConfirmation {
  const replaces =
    currentDefaultName && currentDefaultName !== language.name
      ? `${currentDefaultName} stops being the default in the same operation — the swap is atomic, so the website is never left without a default language.`
      : "The incumbent default is demoted in the same operation — the swap is atomic, so the website is never left without a default language.";

  return {
    title: `Make ${language.name} the default language?`,
    description: `${replaces} No translation is created, changed, published or unpublished.`,
    confirmLabel: "Make default",
    destructive: false,
  };
}

/** Display order first, then code — the same order the API returns. */
export function sortLanguagesForDisplay<
  T extends { displayOrder: number; code: string },
>(rows: readonly T[]): T[] {
  return [...rows].sort(
    (a, b) => a.displayOrder - b.displayOrder || a.code.localeCompare(b.code),
  );
}
