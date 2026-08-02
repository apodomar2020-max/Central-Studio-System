import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import React, { useEffect, useState } from "react";
import { Image, StyleSheet, Text, TouchableOpacity, View } from "react-native";

import type { PricePackage } from "@workspace/api-client-react";
import { normalizeMediaUrl } from "@workspace/api-client-react";
import CsIcon from "@/components/CsIcon";
import { iosDisplayTextStyle } from "@/utils/iosTypography";

const INK_900 = "#0A0B0D";
const INK_800 = "#15171B";
const INK_700 = "#22262C";
const INK_300 = "#8E97A2";
const CYAN = "#00B6D7";
const CYAN_400 = "#2DCDEC";
const BORDER = "rgba(255,255,255,0.08)";

export const PACKAGE_CARD_WIDTH = 232;
export const PACKAGE_CARD_HEIGHT = 320;

// How far the artwork bleeds above the card's top edge — the "breaking out
// of the frame" effect. The card's own layout box (width/height used by the
// FlatList/skeleton) is unchanged; only the artwork visually overflows it.
const ARTWORK_BLEED = 30;

/**
 * Home package card — poster-style: Admin-controlled artwork (cardImageUrl)
 * rendered as an open, unboxed layer that bleeds past the card's top edge,
 * with a rounded card frame on top holding the dark overlay panel and the
 * app-rendered dynamic text (name / age eligibility / price left, sessions
 * or an unlimited glyph right — enlarged for emphasis). The image itself
 * carries no text — every value here comes from the API.
 */
export default function PackageVisualCard({
  pkg,
  onPress,
}: {
  pkg: PricePackage;
  onPress: (pkg: PricePackage) => void;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  useEffect(() => setImgFailed(false), [pkg.cardImageUrl]);

  const uri = normalizeMediaUrl(pkg.cardImageUrl);
  const hasImage = Boolean(uri && !imgFailed);
  const unlimited = pkg.sessions == null;

  return (
    <TouchableOpacity
      style={s.cardOuter}
      activeOpacity={0.9}
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress(pkg);
      }}
    >
      {/* Artwork — open/unboxed layer that bleeds above the card frame; not
          clipped by the card's own bounds, so the subject can break out. */}
      <View style={s.artworkLayer} pointerEvents="none">
        {hasImage ? (
          <Image
            source={{ uri }}
            style={StyleSheet.absoluteFill}
            resizeMode="cover"
            onError={() => setImgFailed(true)}
          />
        ) : (
          // Safe local fallback — no image asset required. A faint watermark
          // glyph keeps this from reading as a broken/empty state.
          <LinearGradient colors={[INK_700, INK_900]} style={StyleSheet.absoluteFill}>
            <View style={s.fallbackGlyphWrap}>
              <CsIcon name={unlimited ? "infinity" : "ticket"} size={64} stroke={1.4} color="rgba(255,255,255,0.06)" />
            </View>
          </LinearGradient>
        )}
      </View>

      {/* Card frame — rounded border + bottom text panel. Transparent over
          the artwork; only clips its own gradient/text to the card shape. */}
      <View style={s.cardFrame}>
        {pkg.isFeatured && (
          <View style={s.featuredBadge}>
            <CsIcon name="star" size={11} color={INK_900} />
            <Text style={s.featuredText}>FEATURED</Text>
          </View>
        )}

        <LinearGradient
          colors={["transparent", "rgba(6,7,8,0.80)", "rgba(6,7,8,0.98)"]}
          locations={[0, 0.3, 1]}
          style={s.overlay}
        >
          <View style={s.overlayRow}>
            <View style={s.overlayLeft}>
              <Text style={s.name} numberOfLines={2}>{pkg.name}</Text>
              <View style={s.ageChip}>
                <Text style={s.ageChipText} numberOfLines={1}>{pkg.ageRangeLabel}</Text>
              </View>
              <View style={s.priceRow}>
                <Text style={s.priceNum} numberOfLines={1}>{pkg.priceEgp.toLocaleString()}</Text>
                <Text style={s.priceUnit}>EGP</Text>
              </View>
            </View>
            <View style={s.overlayRight}>
              {unlimited ? (
                <>
                  <CsIcon name="infinity" size={62} stroke={2.6} color={CYAN} />
                  <Text style={s.sessionsLabel} numberOfLines={1}>UNLIMITED</Text>
                </>
              ) : (
                <>
                  <Text style={s.sessionsNum} numberOfLines={1}>{pkg.sessions}</Text>
                  <Text style={s.sessionsLabel}>CLASSES</Text>
                </>
              )}
            </View>
          </View>
        </LinearGradient>
      </View>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  // Layout box only — no background/clipping, so the artwork layer can
  // bleed past its top edge (per-tweak: card must not box the artwork in).
  cardOuter: {
    width: PACKAGE_CARD_WIDTH,
    height: PACKAGE_CARD_HEIGHT,
    overflow: "visible",
  },
  artworkLayer: {
    position: "absolute",
    top: -ARTWORK_BLEED,
    left: 0,
    right: 0,
    height: PACKAGE_CARD_HEIGHT + ARTWORK_BLEED,
  },
  fallbackGlyphWrap: {
    flex: 1, alignItems: "center", justifyContent: "center",
  },
  // The visible "card" — rounded frame + border. Transparent background so
  // the artwork layer behind it shows through in the image zone; clips only
  // its own contents (gradient panel, text, badge) to the rounded shape.
  cardFrame: {
    position: "absolute",
    top: 0, left: 0, right: 0, bottom: 0,
    borderRadius: 18,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: BORDER,
  },
  featuredBadge: {
    position: "absolute",
    top: 12,
    left: 12,
    zIndex: 2,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: CYAN,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  featuredText: { fontSize: 10, fontFamily: "Archivo_800ExtraBold", color: INK_900, letterSpacing: 0.6 },
  // Image occupies the top ~55%; this panel covers the bottom ~45% and
  // reads as a solid dark panel (short fade-in, then flat) rather than a
  // long soft gradient wash.
  overlay: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: "46%",
    justifyContent: "flex-end",
    paddingHorizontal: 16,
    paddingBottom: 16,
    paddingTop: 24,
  },
  overlayRow: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: 8 },
  overlayLeft: { flex: 1, gap: 7 },
  name: {
    fontSize: 19, fontFamily: "Archivo_800ExtraBold", color: "#fff", lineHeight: 21,
    textTransform: "uppercase", letterSpacing: -0.2,
  },
  ageChip: {
    alignSelf: "flex-start",
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.24)",
    backgroundColor: "rgba(0,0,0,0.32)",
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  ageChipText: { fontSize: 10, fontFamily: "Archivo_700Bold", color: INK_300, textTransform: "uppercase", letterSpacing: 0.4 },
  priceRow: { flexDirection: "row", alignItems: "baseline", gap: 4 },
  priceNum: {
    fontSize: 22, fontFamily: "Anton_400Regular", color: CYAN_400, lineHeight: 22,
    ...iosDisplayTextStyle(22, 22),
  },
  priceUnit: { fontSize: 11, fontFamily: "Archivo_700Bold", color: INK_300, letterSpacing: 0.4 },
  // No maxWidth cap — the sessions number is the card's hero element now
  // (~2x its previous size) and should claim the room it needs.
  overlayRight: { alignItems: "center", flexShrink: 0 },
  sessionsNum: {
    fontSize: 82, fontFamily: "Anton_400Regular", color: "#fff", lineHeight: 74,
    ...iosDisplayTextStyle(82, 74),
  },
  sessionsLabel: { fontSize: 11, fontFamily: "Archivo_800ExtraBold", color: CYAN_400, letterSpacing: 1, marginTop: 3, textAlign: "center" },
});
