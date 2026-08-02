import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import React, { useEffect, useState } from "react";
import {
  Dimensions,
  Image,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { PricePackage } from "@workspace/api-client-react";
import { normalizeMediaUrl } from "@workspace/api-client-react";
import AppButton from "@/components/AppButton";
import CsIcon, { type CsIconName } from "@/components/CsIcon";
import { useAppContext, type PackageParticipantSelection } from "@/contexts/AppContext";
import {
  buildPackageParticipantOptions,
  participantSelectionFor,
} from "@/utils/packagePurchaseParticipants";
import { iosDisplayTextStyle } from "@/utils/iosTypography";

const INK_900 = "#0A0B0D";
const INK_800 = "#15171B";
const INK_700 = "#22262C";
const INK_300 = "#8E97A2";
const INK_400 = "#6B747F";
const CYAN = "#00B6D7";
const CYAN_400 = "#2DCDEC";
const SUCCESS = "#1FB871";
const ERROR = "#FF3B47";
const BORDER = "rgba(255,255,255,0.08)";

const { height: SCREEN_H } = Dimensions.get("window");
// Responsive hero height — roughly a third of the screen, clamped so it
// stays proportionate on both small and tall devices (tuned against
// iPhone 13/14's 844pt height).
const HERO_HEIGHT = Math.max(230, Math.min(300, Math.round(SCREEN_H * 0.33)));

type PackageDetailsSheetProps = {
  pkg: PricePackage | null;
  visible: boolean;
  submitting: boolean;
  onClose: () => void;
  onContinue: (participant: PackageParticipantSelection) => void;
};

function typeLabel(type: string): string {
  return type
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function StatItem({
  icon, value, label, suffix, compact,
}: {
  icon: CsIconName;
  value: string;
  label: string;
  suffix?: string;
  compact?: boolean;
}) {
  return (
    <View style={s.statItem}>
      <View style={s.statIconSlot}>
        <CsIcon name={icon} size={30} stroke={2.2} color={CYAN} />
      </View>
      <View style={s.statValueSlot}>
        <Text style={[s.statValue, compact && s.statValueCompact]} numberOfLines={1}>{value}</Text>
        {suffix ? <Text style={s.statSuffix} numberOfLines={1}>{suffix}</Text> : null}
      </View>
      <View style={s.statLabelSlot}>
        <Text style={s.statLabel} numberOfLines={1}>{label}</Text>
      </View>
    </View>
  );
}

/**
 * Large (~88% screen) package details modal. Read-only presentation of the
 * full catalog record, plus (Parent accounts only) participant selection
 * reusing the same eligibility logic as the rest of the purchase flow.
 * Continue hands the resolved participant back to the caller, which drives
 * the existing purchase/payment flow — this component creates no orders.
 */
export default function PackageDetailsSheet({
  pkg,
  visible,
  submitting,
  onClose,
  onContinue,
}: PackageDetailsSheetProps) {
  const { user, children } = useAppContext();
  const insets = useSafeAreaInsets();
  const [heroFailed, setHeroFailed] = useState(false);
  const [selectedKey, setSelectedKey] = useState("self");

  useEffect(() => {
    if (visible) setSelectedKey("self");
  }, [visible, pkg?.id]);

  useEffect(() => setHeroFailed(false), [pkg?.detailsImageUrl, pkg?.cardImageUrl]);

  // Recomputed every render (not memoized) so age-eligibility always
  // reflects "now" — the same freshness the rest of the purchase flow
  // relies on. No new eligibility rule: same buildPackageParticipantOptions
  // used by the purchase flow elsewhere.
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  const isParent = user?.accountType === "parent";
  const options = pkg ? buildPackageParticipantOptions(user, children, pkg, today) : [];
  const selected = isParent
    ? (options.find((option) => option.key === selectedKey) ?? options[0])
    : options[0];
  const canContinue = Boolean(selected?.eligible) && !submitting;

  useEffect(() => {
    if (isParent && !options.some((option) => option.key === selectedKey)) {
      setSelectedKey("self");
    }
  }, [isParent, options, selectedKey]);

  if (!pkg) return null;

  const heroUri = normalizeMediaUrl(pkg.detailsImageUrl) ?? normalizeMediaUrl(pkg.cardImageUrl);
  const hasHeroImage = Boolean(heroUri && !heroFailed);
  const unlimited = pkg.sessions == null;
  const perClassPrice = pkg.singleClassPriceEgp
    ?? (pkg.sessions && pkg.sessions > 0 ? Math.round(pkg.priceEgp / pkg.sessions) : null);
  const danceTypeChips = pkg.allowedDanceTypeDetails.length > 0
    ? pkg.allowedDanceTypeDetails.map((item) => item.name)
    : ["Any dance style"];
  const validityLabel = `${pkg.validityMonths} ${pkg.validityMonths === 1 ? "Month" : "Months"}`;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.backdrop}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} />
        <View style={[s.sheet, { maxHeight: "88%", paddingBottom: insets.bottom + 14 }]}>
          {pkg.isFeatured ? (
            <View style={s.featuredRibbonWrap} pointerEvents="none">
              <Image
                source={require("@/assets/images/featured-badge.png")}
                style={s.featuredBadgeAsset}
                resizeMode="contain"
              />
            </View>
          ) : (
            <View style={s.handle} />
          )}

          <ScrollView showsVerticalScrollIndicator={false} bounces={false} contentContainerStyle={s.scrollContent}>
            {/* Hero — image fills the top, name/description/price overlaid */}
            <View style={[s.hero, { height: HERO_HEIGHT }]}>
              {hasHeroImage ? (
                <Image
                  source={{ uri: heroUri }}
                  style={StyleSheet.absoluteFill}
                  resizeMode="cover"
                  onError={() => setHeroFailed(true)}
                />
              ) : (
                <LinearGradient colors={[INK_700, INK_900]} style={StyleSheet.absoluteFill}>
                  <View style={s.heroFallbackGlyph}>
                    <CsIcon name={unlimited ? "infinity" : "ticket"} size={110} stroke={1.1} color="rgba(255,255,255,0.05)" />
                  </View>
                </LinearGradient>
              )}
              <LinearGradient
                colors={["rgba(6,7,8,0.20)", "transparent", "rgba(6,7,8,0.62)", "rgba(6,7,8,0.97)"]}
                locations={[0, 0.26, 0.6, 1]}
                style={StyleSheet.absoluteFill}
              />

              <TouchableOpacity style={s.closeBtn} onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="close" size={20} color="#FFFFFF" />
              </TouchableOpacity>

              <View style={s.heroContent}>
                <View style={s.heroContentRow}>
                  <View style={s.heroLeft}>
                    <View style={s.typeChip}><Text style={s.typeChipText}>{typeLabel(pkg.type)}</Text></View>
                    <Text style={s.heroName} numberOfLines={2}>{pkg.name}</Text>
                    {pkg.description ? (
                      <Text style={s.heroDesc} numberOfLines={2}>{pkg.description}</Text>
                    ) : null}
                  </View>
                  <View style={s.heroRight}>
                    <Text style={s.heroPriceNum} numberOfLines={1}>{pkg.priceEgp.toLocaleString()}</Text>
                    <Text style={s.heroPriceUnit}>EGP</Text>
                  </View>
                </View>
              </View>
            </View>

            <View style={s.body}>
              {/* One glass stats bar */}
              <View style={s.statsBarWrap}>
                {Platform.OS === "web" ? (
                  <View style={[StyleSheet.absoluteFill, s.statsBarWebBg]} />
                ) : (
                  <BlurView
                    intensity={Platform.OS === "ios" ? 46 : 60}
                    tint="dark"
                    experimentalBlurMethod={Platform.OS === "android" ? "dimezisBlurView" : undefined}
                    style={StyleSheet.absoluteFill}
                  />
                )}
                <View style={s.statsBar}>
                  <StatItem
                    icon={unlimited ? "infinity" : "calendar"}
                    value={unlimited ? "∞" : String(pkg.sessions)}
                    label={unlimited ? "Unlimited" : "Sessions"}
                  />
                  <View style={s.statDivider} />
                  <StatItem icon="users" value={pkg.ageRangeLabel} label="Age Eligibility" compact />
                  <View style={s.statDivider} />
                  <StatItem icon="clock" value={validityLabel} label="Validity" compact />
                  <View style={s.statDivider} />
                  <StatItem
                    icon="ticket"
                    value={perClassPrice != null ? perClassPrice.toLocaleString() : "—"}
                    suffix={perClassPrice != null ? "EGP" : undefined}
                    label="Per Class"
                  />
                </View>
              </View>

              {/* What's included */}
              {pkg.features.length > 0 && (
                <View style={s.sectionBlock}>
                  <Text style={s.sectionLabel}>WHAT&apos;S INCLUDED</Text>
                  <View style={s.featureList}>
                    {pkg.features.slice(0, 3).map((f, i) => (
                      <View key={i} style={s.featureRow}>
                        <CsIcon name="check" size={15} stroke={2.6} color={CYAN_400} />
                        <Text style={s.featureText}>{f}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              )}

              {/* Dance types */}
              <View style={s.sectionBlock}>
                <Text style={s.sectionLabel}>ALLOWED DANCE STYLE</Text>
                <View style={s.chipRow}>
                  {danceTypeChips.map((name) => (
                    <View key={name} style={s.danceChip}>
                      <Text style={s.danceChipText}>{name}</Text>
                    </View>
                  ))}
                </View>
              </View>

              {/* Payment method */}
              <View style={s.sectionBlock}>
                <Text style={s.sectionLabel}>PAYMENT METHOD</Text>
                <View style={[s.paymentOption, s.paymentOptionSelected]}>
                  <View style={s.radioOuter}><View style={s.radioInner} /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.paymentName}>Pay at Studio / Cash</Text>
                    <Text style={s.paymentMeta}>Settle in person — our team confirms and activates it.</Text>
                  </View>
                </View>
                <View style={[s.paymentOption, s.paymentOptionDisabled]}>
                  <Ionicons name="card-outline" size={18} color={INK_400} />
                  <View style={{ flex: 1 }}>
                    <Text style={[s.paymentName, { color: INK_400 }]}>Online Payment</Text>
                  </View>
                  <View style={s.comingSoonPill}><Text style={s.comingSoonText}>Coming Soon</Text></View>
                </View>
              </View>

              {/* Participant selection — Parent accounts only, horizontal compact cards */}
              {isParent && (
                <View style={s.sectionBlock}>
                  <Text style={s.sectionLabel}>SELECT USER</Text>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={s.participantRow}
                  >
                    {options.map((option) => {
                      const isSelected = option.key === selectedKey && option.eligible;
                      return (
                        <TouchableOpacity
                          key={option.key}
                          disabled={!option.eligible}
                          onPress={() => setSelectedKey(option.key)}
                          style={[
                            s.participantCard,
                            isSelected && s.participantCardSelected,
                            !option.eligible && s.participantCardIneligible,
                          ]}
                        >
                          {isSelected && (
                            <View style={s.participantCheckBadge}>
                              <Ionicons name="checkmark" size={10} color={INK_900} />
                            </View>
                          )}
                          <View style={[
                            s.participantAvatar,
                            isSelected && s.participantAvatarSelected,
                            !option.eligible && s.participantAvatarIneligible,
                          ]}>
                            <CsIcon
                              name="user"
                              size={16}
                              stroke={2}
                              color={!option.eligible ? ERROR : isSelected ? INK_900 : CYAN}
                            />
                          </View>
                          <Text style={s.participantName} numberOfLines={1}>{option.name}</Text>
                          <Text style={s.participantAge} numberOfLines={1}>
                            {option.age == null ? "DOB required" : `${option.age} Years Old`}
                          </Text>
                          <Text style={[s.eligibilityText, { color: option.eligible ? SUCCESS : ERROR }]} numberOfLines={1}>
                            {option.eligible ? "Eligible" : "Not eligible"}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                  {selected?.type === "child" && selected.age == null ? (
                    <Text style={s.dobHelp}>
                      Add this child&apos;s date of birth in their profile before purchasing an age-restricted package.
                    </Text>
                  ) : null}
                </View>
              )}

              {!isParent && selected && !selected.eligible && (
                <Text style={s.dobHelp}>
                  {selected.age == null
                    ? "Add your date of birth in your profile to purchase this package."
                    : "This package isn't available for your age group."}
                </Text>
              )}
            </View>
          </ScrollView>

          <View style={s.footer}>
            <AppButton
              title={submitting ? "Submitting…" : "Continue"}
              disabled={!canContinue}
              onPress={() => {
                if (!selected || !selected.eligible) return;
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                onContinue(participantSelectionFor(selected));
              }}
              fullWidth
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.72)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: INK_900,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: "visible",
  },
  handle: {
    width: 40, height: 4, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.28)",
    alignSelf: "center", marginTop: 10, position: "absolute", top: 0, zIndex: 3,
  },
  scrollContent: { paddingBottom: 8 },

  // ── Hero ──────────────────────────────────────────────────────────────────
  hero: {
    justifyContent: "flex-end",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: "hidden",
  },
  heroFallbackGlyph: { flex: 1, alignItems: "center", justifyContent: "center" },
  featuredRibbonWrap: {
    position: "absolute",
    top: -16,
    left: 0,
    right: 0,
    zIndex: 99,
    alignItems: "center",
  },
  featuredBadgeAsset: {
    width: 170,
    height: 32.5,
  },
  closeBtn: {
    position: "absolute", top: 14, right: 14, zIndex: 2,
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: "rgba(0,0,0,0.45)", borderWidth: 1, borderColor: "rgba(255,255,255,0.22)",
    alignItems: "center", justifyContent: "center",
  },
  heroContent: { padding: 18, paddingTop: 30 },
  heroContentRow: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: 12 },
  heroLeft: { flex: 1, gap: 6 },
  typeChip: {
    alignSelf: "flex-start", borderRadius: 999,
    backgroundColor: "rgba(0,0,0,0.38)", borderWidth: 1, borderColor: "rgba(255,255,255,0.22)",
    paddingHorizontal: 9, paddingVertical: 3, marginBottom: 2,
  },
  typeChipText: { fontSize: 10, fontFamily: "Archivo_700Bold", color: CYAN_400, textTransform: "uppercase", letterSpacing: 0.6 },
  heroName: {
    fontSize: 24, fontFamily: "Archivo_800ExtraBold", color: "#fff", lineHeight: 26,
    textTransform: "uppercase", letterSpacing: -0.3,
    ...iosDisplayTextStyle(24, 26, "inter"),
  },
  heroDesc: { fontSize: 12, fontFamily: "Archivo_400Regular", color: "rgba(255,255,255,0.72)", lineHeight: 17, marginTop: 2 },
  heroRight: { flexDirection: "row", alignItems: "baseline", gap: 4, flexShrink: 0 },
  heroPriceNum: {
    fontSize: 56, fontFamily: "Anton_400Regular", color: CYAN_400, lineHeight: 52,
    ...iosDisplayTextStyle(56, 52),
  },
  heroPriceUnit: { fontSize: 20, fontFamily: "Anton_400Regular", color: "#FFFFFF", letterSpacing: 0.5 },

  // ── Body ──────────────────────────────────────────────────────────────────
  body: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 4, gap: 20 },

  // Single glass stats bar
  statsBarWrap: { borderRadius: 16, overflow: "hidden", borderWidth: 1, borderColor: "rgba(255,255,255,0.12)" },
  statsBarWebBg: { backgroundColor: "rgba(21,23,27,0.92)" },
  statsBar: { flexDirection: "row", alignItems: "stretch", paddingVertical: 16, paddingHorizontal: 6 },
  statItem: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 2 },
  statIconSlot: { height: 32, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  statValueSlot: { height: 22, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 2, marginBottom: 3 },
  statValue: { fontSize: 16, fontFamily: "Archivo_800ExtraBold", color: "#fff", textAlign: "center" },
  statValueCompact: { fontSize: 12.5, textAlign: "center" },
  statSuffix: { fontSize: 10, fontFamily: "Archivo_700Bold", color: INK_300 },
  statLabelSlot: { height: 16, alignItems: "center", justifyContent: "center" },
  statLabel: { fontSize: 9.5, fontFamily: "Archivo_600SemiBold", color: INK_300, textTransform: "uppercase", letterSpacing: 0.3, textAlign: "center" },
  statDivider: { width: 1, alignSelf: "stretch", backgroundColor: "rgba(255,255,255,0.10)", marginVertical: 4 },

  sectionBlock: { gap: 10 },
  sectionLabel: { fontSize: 11, fontFamily: "SpaceMono_700Bold", color: CYAN, textTransform: "uppercase", letterSpacing: 1.4 },

  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  featureList: { gap: 8 },
  featureRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  featureText: { flex: 1, fontSize: 13, fontFamily: "Archivo_500Medium", color: "#E5E7EB" },

  danceChip: {
    borderRadius: 999, backgroundColor: "rgba(0,182,215,0.10)", borderWidth: 1, borderColor: "rgba(0,182,215,0.30)",
    paddingHorizontal: 10, paddingVertical: 5,
  },
  danceChipText: { fontSize: 11, fontFamily: "Archivo_700Bold", color: CYAN_400 },

  paymentOption: {
    flexDirection: "row", alignItems: "center", gap: 10,
    borderRadius: 12, borderWidth: 1, borderColor: BORDER, backgroundColor: INK_800,
    padding: 12, marginBottom: 8,
  },
  paymentOptionSelected: { borderColor: CYAN, backgroundColor: "rgba(0,182,215,0.08)" },
  paymentOptionDisabled: { opacity: 0.55 },
  paymentName: { fontSize: 13.5, fontFamily: "Archivo_700Bold", color: "#fff" },
  paymentMeta: { fontSize: 10.5, fontFamily: "Archivo_400Regular", color: INK_400, marginTop: 2 },
  radioOuter: {
    width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: CYAN,
    alignItems: "center", justifyContent: "center", flexShrink: 0,
  },
  radioInner: { width: 8, height: 8, borderRadius: 4, backgroundColor: CYAN },
  comingSoonPill: { borderRadius: 999, backgroundColor: "rgba(255,255,255,0.08)", paddingHorizontal: 9, paddingVertical: 4 },
  comingSoonText: { fontSize: 10, fontFamily: "Archivo_700Bold", color: INK_300 },

  // Horizontal compact participant cards
  participantRow: { flexDirection: "row", gap: 10, paddingRight: 4, paddingTop: 4 },
  participantCard: {
    width: 92, borderWidth: 1, borderColor: BORDER, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 8,
    alignItems: "center", gap: 4, backgroundColor: INK_800,
  },
  participantCardSelected: { borderColor: CYAN, backgroundColor: "rgba(0,182,215,0.10)" },
  participantCardIneligible: { opacity: 0.6, borderColor: "rgba(255,59,71,0.35)" },
  participantCheckBadge: {
    position: "absolute", top: 6, right: 6, width: 16, height: 16, borderRadius: 8,
    backgroundColor: CYAN, alignItems: "center", justifyContent: "center", zIndex: 1,
  },
  participantAvatar: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(0,182,215,0.14)",
    alignItems: "center", justifyContent: "center", marginBottom: 2,
  },
  participantAvatarSelected: { backgroundColor: CYAN },
  participantAvatarIneligible: { backgroundColor: "rgba(255,59,71,0.12)" },
  participantName: { color: "#fff", fontFamily: "Archivo_700Bold", fontSize: 12, textAlign: "center" },
  participantAge: { color: INK_400, fontFamily: "Archivo_400Regular", fontSize: 10, textAlign: "center" },
  eligibilityText: { fontFamily: "Archivo_700Bold", fontSize: 9.5, marginTop: 2, textAlign: "center" },
  dobHelp: { color: "#FCA5A5", fontFamily: "Archivo_500Medium", fontSize: 12, lineHeight: 17 },

  footer: {
    paddingHorizontal: 20, paddingTop: 12,
    borderTopWidth: 1, borderTopColor: BORDER,
  },
});
