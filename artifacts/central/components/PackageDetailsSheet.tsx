import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import React, { useEffect, useState } from "react";
import { SvgXml } from "react-native-svg";
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

const MOST_POPULAR_SVG = `<svg width="162" height="31" viewBox="0 0 162 31" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M155.441 0.00299072L161.61 15.3033H150.026L155.441 0.00299072Z" fill="#890808"/>
<path d="M6.45782 0L12.3049 15.3033H0L6.45782 0Z" fill="#890808"/>
<path d="M6.45782 0H155.458L144.623 30.9714H18.2925L6.45782 0Z" fill="#DF0000"/>
<path d="M26.4786 23.7626V6.57513H31.713L33.1583 17.0536L34.5938 6.57513H39.877V23.7626H36.7325V11.3798L34.7598 23.7626H31.6739L29.584 11.3798V23.7626H26.4786ZM45.502 23.9189C44.1283 23.9189 43.0769 23.5055 42.3477 22.6786C41.6251 21.8453 41.2637 20.6441 41.2637 19.0751V10.9111C41.2637 9.43972 41.6218 8.32318 42.338 7.56146C43.0606 6.79974 44.1153 6.41888 45.502 6.41888C46.8887 6.41888 47.9402 6.79974 48.6563 7.56146C49.379 8.32318 49.7403 9.43972 49.7403 10.9111V19.0751C49.7403 20.6441 49.3757 21.8453 48.6465 22.6786C47.9239 23.5055 46.8757 23.9189 45.502 23.9189ZM45.5313 20.7548C46.0521 20.7548 46.3126 20.2503 46.3126 19.2411V10.8525C46.3126 10.0061 46.0587 9.58295 45.5508 9.58295C44.9779 9.58295 44.6915 10.0159 44.6915 10.8818V19.2607C44.6915 19.7945 44.7566 20.1786 44.8868 20.413C45.017 20.6409 45.2318 20.7548 45.5313 20.7548ZM55.209 23.9189C53.64 23.9189 52.5072 23.5283 51.8106 22.747C51.1205 21.9658 50.7755 20.7223 50.7755 19.0165V17.3369H54.1739V19.4853C54.1739 19.8824 54.2325 20.1949 54.3497 20.4228C54.4734 20.6441 54.685 20.7548 54.9844 20.7548C55.2969 20.7548 55.5118 20.6637 55.629 20.4814C55.7527 20.2991 55.8145 19.9996 55.8145 19.5829C55.8145 19.0556 55.7624 18.6161 55.6583 18.2646C55.5541 17.9065 55.3718 17.568 55.1114 17.249C54.8575 16.9234 54.5027 16.5458 54.0469 16.1161L52.504 14.6513C51.3516 13.5641 50.7755 12.3206 50.7755 10.9208C50.7755 9.45599 51.114 8.33946 51.7911 7.57123C52.4747 6.803 53.461 6.41888 54.7501 6.41888C56.3256 6.41888 57.4421 6.83881 58.0997 7.67865C58.7637 8.51849 59.0958 9.79454 59.0958 11.5068H55.5997V10.3251C55.5997 10.0908 55.5313 9.90847 55.3946 9.77826C55.2644 9.64805 55.0853 9.58295 54.8575 9.58295C54.584 9.58295 54.3822 9.66107 54.252 9.81732C54.1283 9.96706 54.0665 10.1624 54.0665 10.4033C54.0665 10.6441 54.1316 10.9046 54.2618 11.1845C54.392 11.4645 54.6491 11.7867 55.0333 12.1513L57.0157 14.0556C57.4128 14.4332 57.7774 14.8336 58.1094 15.2568C58.4415 15.6734 58.7084 16.1617 58.9102 16.7216C59.112 17.275 59.213 17.9521 59.213 18.7529C59.213 20.3675 58.9135 21.6337 58.3145 22.5517C57.7221 23.4632 56.6869 23.9189 55.209 23.9189ZM61.8399 23.7626V9.87592H59.7989V6.57513H67.3184V9.87592H65.2774V23.7626H61.8399ZM72.963 23.7626V6.57513H77.504C78.4545 6.57513 79.2064 6.78672 79.7598 7.2099C80.3197 7.63308 80.7201 8.23529 80.961 9.01654C81.2019 9.79779 81.3223 10.7288 81.3223 11.8095C81.3223 12.8512 81.2214 13.7594 81.0196 14.5341C80.8178 15.3023 80.4564 15.8981 79.9356 16.3212C79.4213 16.7444 78.6889 16.956 77.7383 16.956H76.3419V23.7626H72.963ZM76.3419 13.8701H76.5372C77.1752 13.8701 77.5658 13.691 77.709 13.3329C77.8523 12.9749 77.9239 12.4475 77.9239 11.7509C77.9239 11.0999 77.8523 10.5986 77.709 10.247C77.5723 9.88894 77.2436 9.7099 76.7227 9.7099H76.3419V13.8701ZM86.5176 23.9189C85.1439 23.9189 84.0925 23.5055 83.3633 22.6786C82.6407 21.8453 82.2794 20.6441 82.2794 19.0751V10.9111C82.2794 9.43972 82.6374 8.32318 83.3536 7.56146C84.0762 6.79974 85.1309 6.41888 86.5176 6.41888C87.9044 6.41888 88.9558 6.79974 89.6719 7.56146C90.3946 8.32318 90.7559 9.43972 90.7559 10.9111V19.0751C90.7559 20.6441 90.3913 21.8453 89.6622 22.6786C88.9395 23.5055 87.8913 23.9189 86.5176 23.9189ZM86.5469 20.7548C87.0678 20.7548 87.3282 20.2503 87.3282 19.2411V10.8525C87.3282 10.0061 87.0743 9.58295 86.5665 9.58295C85.9936 9.58295 85.7071 10.0159 85.7071 10.8818V19.2607C85.7071 19.7945 85.7722 20.1786 85.9024 20.413C86.0326 20.6409 86.2475 20.7548 86.5469 20.7548ZM92.1426 23.7626V6.57513H96.6837C97.6342 6.57513 98.3861 6.78672 98.9395 7.2099C99.4994 7.63308 99.8998 8.23529 100.141 9.01654C100.382 9.79779 100.502 10.7288 100.502 11.8095C100.502 12.8512 100.401 13.7594 100.199 14.5341C99.9975 15.3023 99.6361 15.8981 99.1153 16.3212C98.601 16.7444 97.8686 16.956 96.918 16.956H95.5215V23.7626H92.1426ZM95.5215 13.8701H95.7169C96.3549 13.8701 96.7455 13.691 96.8887 13.3329C97.032 12.9749 97.1036 12.4475 97.1036 11.7509C97.1036 11.0999 97.032 10.5986 96.8887 10.247C96.752 9.88894 96.4232 9.7099 95.9024 9.7099H95.5215V13.8701ZM105.57 23.9189C104.138 23.9189 103.083 23.5185 102.406 22.7177C101.729 21.9104 101.391 20.7255 101.391 19.163V6.57513H104.731V19.0263C104.731 19.3128 104.747 19.5895 104.779 19.8564C104.812 20.1168 104.887 20.3316 105.004 20.5009C105.121 20.6702 105.31 20.7548 105.57 20.7548C105.837 20.7548 106.029 20.6734 106.147 20.5107C106.264 20.3414 106.335 20.1233 106.361 19.8564C106.394 19.5895 106.41 19.3128 106.41 19.0263V6.57513H109.75V19.163C109.75 20.7255 109.412 21.9104 108.734 22.7177C108.057 23.5185 107.003 23.9189 105.57 23.9189ZM111.068 23.7626V6.57513H114.506V20.8329H118.041V23.7626H111.068ZM118.549 23.7626L120.209 6.57513H126.039L127.67 23.7626H124.418L124.174 20.9892H122.104L121.889 23.7626H118.549ZM122.348 18.2451H123.91L123.158 9.50482H123.002L122.348 18.2451ZM128.725 23.7626V6.57513H133.998C134.877 6.57513 135.541 6.77696 135.99 7.1806C136.44 7.57774 136.739 8.13763 136.889 8.86029C137.045 9.57644 137.123 11.3896 137.123 11.3896C137.123 12.3271 137.003 13.0758 136.762 13.6357C136.527 14.1956 136.081 14.5829 135.424 14.7978C135.964 14.9085 136.342 15.1786 136.557 15.6083C136.778 16.0315 136.889 16.5816 136.889 17.2587V23.7626H133.5V17.0341C133.5 16.5328 133.396 16.2236 133.188 16.1064C132.986 15.9827 132.657 15.9208 132.201 15.9208V23.7626H128.725ZM132.221 12.9423H133.051C133.526 12.9423 133.764 12.4247 133.764 11.3896C133.764 10.719 133.712 10.2796 133.607 10.0712C133.503 9.86289 133.308 9.75873 133.022 9.75873H132.221V12.9423Z" fill="white"/>
</svg>`;

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
              <SvgXml xml={MOST_POPULAR_SVG} width={170} height={32.5} />
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
    fontSize: 30, fontFamily: "Anton_400Regular", color: "#fff", lineHeight: 32,
    textTransform: "uppercase", letterSpacing: -0.3,
    ...iosDisplayTextStyle(30, 32, "anton"),
  },
  heroDesc: { fontSize: 12, fontFamily: "Archivo_400Regular", color: "rgba(255,255,255,0.72)", lineHeight: 17, marginTop: 2 },
  heroRight: { flexDirection: "row", alignItems: "baseline", gap: 4, flexShrink: 0 },
  heroPriceNum: {
    fontSize: 64, fontFamily: "Anton_400Regular", color: CYAN_400, lineHeight: 60,
    ...iosDisplayTextStyle(64, 60),
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
