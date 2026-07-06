import { Platform, TextStyle } from "react-native";

type DisplayFont = "anton" | "archivo" | "inter";

const DISPLAY_LINE_HEIGHT_RATIO: Record<DisplayFont, number> = {
  anton: 1.18,
  archivo: 1.14,
  inter: 1.12,
};

// iOS renders tall display faces — Anton above all — with the FIRST line's caps
// overflowing the text frame's top edge whenever lineHeight is tight, shearing
// the tops of the glyphs. The previous fix hid this by inflating lineHeight to
// ~1.18·fs, but that pushed stacked headlines far apart and broke the poster
// look the design intends (and that Android already renders correctly).
//
// Instead we KEEP the design's tight lineHeight — so stacked lines stay close,
// matching Android — and add the exact per-line deficit as an iOS-only top
// inset. `DISPLAY_LINE_HEIGHT_RATIO[font]·fs` is the lineHeight at which the caps
// no longer overflow the box top; any shortfall below that is precisely how far
// the caps poke above the frame, so we pad by that shortfall instead of stealing
// it from the inter-line gap. paddingTop shifts the whole block down uniformly —
// it does NOT change the space BETWEEN lines — so the tight stacking is fully
// preserved. A lineHeight already at/above the ratio yields ≤0 and gets no inset
// (e.g. most Inter/Archivo numerics), so they render exactly as before. Android
// returns {} and is untouched.
//
// Verified on-device (native 3× captures, first-line cap height vs the un-clipped
// second line): Anton fs52/lh46 clips 23px with no inset and 0px at ceil(1.18·52
// − 46)=16px; Anton fs68/lh60 (the app's tightest) is full at ceil(1.18·68−60)=
// 21px. This is the minimum inset that removes the clip without loosening lines.
// The iOS-only top inset (in px) that iosDisplayTextStyle adds for a given
// display line — i.e. how far the caps overflow the tight line box. 0 on Android
// and for already-safe lineHeights. Exposed so a layout that was thrown off by
// the inset can cancel exactly that much (e.g. `marginBottom: -iosCapGuard(...)`)
// without re-deriving the number or disturbing the clip fix.
export function iosCapGuard(
  fontSize: number,
  currentLineHeight: number,
  font: DisplayFont = "anton",
): number {
  if (Platform.OS !== "ios") {
    return 0;
  }
  return Math.max(0, Math.ceil(fontSize * DISPLAY_LINE_HEIGHT_RATIO[font] - currentLineHeight));
}

export function iosDisplayTextStyle(
  fontSize: number,
  currentLineHeight: number,
  font: DisplayFont = "anton",
): TextStyle {
  if (Platform.OS !== "ios") {
    return {};
  }

  const style: TextStyle = { lineHeight: currentLineHeight };
  const capGuard = iosCapGuard(fontSize, currentLineHeight, font);
  if (capGuard > 0) {
    style.paddingTop = capGuard;
  }
  return style;
}

export function iosTextInputStyle(
  fontSize: number,
  currentLineHeight: number,
  font: DisplayFont = "archivo",
): TextStyle {
  if (Platform.OS !== "ios") {
    return {};
  }

  return {
    lineHeight: Math.max(currentLineHeight, Math.ceil(fontSize * DISPLAY_LINE_HEIGHT_RATIO[font])),
    paddingTop: 0,
    paddingBottom: 0,
  };
}
