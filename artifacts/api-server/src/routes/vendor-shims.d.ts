/**
 * Ambient type shims for two untyped vendor packages used only by the PDF
 * report's Arabic shaping pipeline (see pdfReport.ts).
 */
declare module "arabic-reshaper" {
  const ArabicReshaper: {
    /** Join Arabic letters into their contextual Presentation Forms-B glyphs. */
    convertArabic(text: string): string;
    convertArabicBack(text: string): string;
  };
  export default ArabicReshaper;
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
