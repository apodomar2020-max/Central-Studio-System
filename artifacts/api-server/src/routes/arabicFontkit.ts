/**
 * A thin wrapper around the full `fontkit` library that makes pdf-lib render
 * complex scripts (Arabic) correctly.
 *
 * Why this exists: pdf-lib calls `font.layout(text)` and draws the resulting
 * glyphs left-to-right in the order returned. The full `fontkit` layout engine
 * DOES apply OpenType shaping (Arabic cursive joining + ligatures via GSUB/GPOS)
 * — unlike the stripped `@pdf-lib/fontkit`, which leaves Arabic letters isolated
 * and disconnected — but it returns glyphs in LOGICAL order. Drawn left-to-right
 * that makes right-to-left text appear reversed.
 *
 * This wrapper overrides `layout()` so it shapes each directional run in logical
 * order (correct joining/ligatures), reverses the glyphs of right-to-left runs,
 * and orders the runs per the Unicode bidi algorithm (UAX #9, rule L2). The
 * result is a glyph list already in VISUAL order, so pdf-lib draws it correctly.
 *
 * pdf-lib only reads `.glyphs[].id` and `.glyphs[].advanceWidth` from the layout
 * result, so returning `{ glyphs }` is sufficient; every other font property and
 * method is left untouched.
 */
import * as realFontkit from "fontkit";
import bidiFactory from "bidi-js";

const bidi = bidiFactory();

interface Glyph {
  id: number;
  advanceWidth: number;
}
interface GlyphRun {
  glyphs: Glyph[];
}
type LayoutFn = (text: string, features?: unknown) => GlyphRun;

/** UAX #9 rule L2 applied at run granularity (each run has a constant level). */
function reorderRunsVisually<T extends { level: number }>(runs: T[]): T[] {
  if (runs.length <= 1) return runs;
  const maxLevel = Math.max(...runs.map((r) => r.level));
  let minOdd = Infinity;
  for (const r of runs) if (r.level % 2 === 1 && r.level < minOdd) minOdd = r.level;
  if (minOdd === Infinity) return runs; // nothing right-to-left

  const arr = runs.slice();
  for (let lvl = maxLevel; lvl >= minOdd; lvl--) {
    let i = 0;
    while (i < arr.length) {
      if (arr[i].level >= lvl) {
        let j = i + 1;
        while (j < arr.length && arr[j].level >= lvl) j++;
        const seg = arr.slice(i, j).reverse();
        arr.splice(i, j - i, ...seg);
        i = j;
      } else {
        i++;
      }
    }
  }
  return arr;
}

function bidiVisualLayout(origLayout: LayoutFn, text: string, features?: unknown): GlyphRun {
  if (!text) return origLayout(text, features);

  const { levels } = bidi.getEmbeddingLevels(text);

  // Fast path: a single direction (the common case — a pure Arabic or pure Latin
  // value). Shape the whole string (so joining/ligatures span the run), then
  // reverse the shaped glyphs for a right-to-left run to get visual order.
  let uniform = true;
  for (let i = 1; i < text.length; i++) {
    if (levels[i] !== levels[0]) {
      uniform = false;
      break;
    }
  }
  if (uniform) {
    const run = origLayout(text, features);
    if ((levels[0] & 1) === 1) run.glyphs = run.glyphs.slice().reverse();
    return run;
  }

  // Mixed direction: split into maximal equal-level runs, shape each in logical
  // order, reverse right-to-left runs, then order the runs visually.
  const runs: { level: number; glyphs: Glyph[] }[] = [];
  let start = 0;
  for (let i = 1; i <= text.length; i++) {
    if (i === text.length || levels[i] !== levels[start]) {
      const shaped = origLayout(text.slice(start, i), features).glyphs;
      runs.push({
        level: levels[start],
        glyphs: (levels[start] & 1) === 1 ? shaped.slice().reverse() : shaped,
      });
      start = i;
    }
  }
  const glyphs: Glyph[] = [];
  for (const run of reorderRunsVisually(runs)) glyphs.push(...run.glyphs);
  return { glyphs };
}

function wrapFont(font: { layout: LayoutFn }): unknown {
  const origLayout = font.layout.bind(font) as LayoutFn;
  font.layout = (text: string, features?: unknown) => bidiVisualLayout(origLayout, text, features);
  return font;
}

// Fontkit-compatible object accepted by pdf-lib's `registerFontkit`.
export const bidiFontkit = {
  create(buffer: Buffer, postscriptName?: string): unknown {
    return wrapFont((realFontkit as { create: (b: Buffer, n?: string) => { layout: LayoutFn } }).create(buffer, postscriptName));
  },
  openSync(filename: string, postscriptName?: string): unknown {
    return wrapFont((realFontkit as { openSync: (f: string, n?: string) => { layout: LayoutFn } }).openSync(filename, postscriptName));
  },
};
