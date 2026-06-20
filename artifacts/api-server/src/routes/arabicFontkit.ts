/**
 * Fontkit adapter used by pdf-lib for Unicode fonts.
 *
 * Full fontkit already applies Arabic shaping and returns the glyph run in the
 * visual order expected by pdf-lib. Reversing that run a second time corrupts
 * Arabic word order in dense report tables, so this adapter deliberately passes
 * fontkit's layout through unchanged.
 */
import * as realFontkit from "fontkit";

// Fontkit-compatible object accepted by pdf-lib's `registerFontkit`.
export const bidiFontkit = {
  create(buffer: Buffer, postscriptName?: string): unknown {
    return (realFontkit as { create: (b: Buffer, n?: string) => unknown }).create(buffer, postscriptName);
  },
  openSync(filename: string, postscriptName?: string): unknown {
    return (realFontkit as { openSync: (f: string, n?: string) => unknown }).openSync(filename, postscriptName);
  },
};
