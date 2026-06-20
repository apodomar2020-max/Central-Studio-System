/**
 * Ambient type shims for untyped vendor packages used only by the PDF report's
 * Arabic shaping pipeline (see pdfReport.ts / arabicFontkit.ts).
 */
declare module "fontkit" {
  interface FontkitGlyph {
    id: number;
    advanceWidth: number;
  }
  interface FontkitGlyphRun {
    glyphs: FontkitGlyph[];
  }
  interface FontkitFont {
    layout(text: string, features?: unknown): FontkitGlyphRun;
    [key: string]: unknown;
  }
  export function create(buffer: Buffer | Uint8Array, postscriptName?: string): FontkitFont;
  export function openSync(filename: string, postscriptName?: string): FontkitFont;
}

declare module "bidi-js" {
  interface EmbeddingLevels {
    levels: Uint8Array;
    paragraphs: { start: number; end: number; level: number }[];
  }
  interface Bidi {
    getEmbeddingLevels(text: string, explicitDirection?: "ltr" | "rtl"): EmbeddingLevels;
    getReorderSegments(
      text: string,
      embeddingLevels: EmbeddingLevels,
      start?: number,
      end?: number,
    ): [number, number][];
    getMirroredCharactersMap(
      text: string,
      embeddingLevels: EmbeddingLevels,
      start?: number,
      end?: number,
    ): Map<number, string>;
  }
  export default function bidiFactory(): Bidi;
}
