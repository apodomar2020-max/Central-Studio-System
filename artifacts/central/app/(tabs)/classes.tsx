import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import React, {
  useCallback, useMemo, useRef, useState,
  useEffect,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Animated,
  FlatList,
  Image,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import Svg, { Defs, RadialGradient, Rect as SvgRect, Stop } from "react-native-svg";

import XI from "@/components/XiIcon";
import CategoryIcon from "@/components/CategoryIcon";
import { iosCapGuard, iosDisplayTextStyle, iosTextInputStyle } from "@/utils/iosTypography";
import { useListClasses, useListInstructors, useListSchedules, useListDanceTypes, getListSchedulesQueryKey } from "@workspace/api-client-react";

import {
  DANCE_CATEGORIES,
  AgeGroup,
  type DanceClass,
  type Instructor,
} from "@/data/mockData";
import {
  classCapacityDisplay,
  compareSchedulesByNextOccurrence,
  isClassCapacityDisplayEnabled,
  isMobileVisibleSchedule,
  mapApiClassWithScheduleToMobile,
  mapApiInstructorToMobile,
} from "@/data/apiAdapters";
import { ListSkeleton } from "@/components/SkeletonLoader";
import OfflineState from "@/components/OfflineState";
import ErrorState from "@/components/ErrorState";
import { isOfflineError } from "@/services/connectivity";
import {
  DEFAULT_SINGLE_CLASS_PRICE_EGP,
  fetchClassPricing,
} from "@/services/classPricingService";
import {
  DEFAULT_CLASS_CAPACITY_ENABLED,
  fetchClassCapacitySettings,
} from "@/services/classCapacityService";
import { useAppContext } from "@/contexts/AppContext";
import { showAuthRequiredPrompt } from "@/utils/authRequired";
import { useCentralAlert } from "@/hooks/useCentralAlert";

/* ─── Design tokens ─────────────────────────────────────────────── */
const INK_900 = "#0A0B0D";
const INK_800 = "#15171B";
const INK_700 = "#22262C";
const INK_400 = "#6B747F";
const INK_300 = "#8E97A2";
const INK_200 = "#B6BDC6";
const CYAN   = "#00B6D7";
const MAGENTA = "#FF2E7E";
const AMBER  = "#FFB02E";
const SUCCESS = "#1FB871";
const DANGER  = "#FF3B47";
const BORDER  = "rgba(255,255,255,0.08)";
const R_MD = 12;
const R_LG = 16;
const R_PILL = 999;

/* ─── Category accent colors (rgb triplets) ──────────────────────── */
const CAT_RGB: Record<string, string> = {
  c1:  "45,205,236",   // Hip Hop
  c2:  "255,176,46",   // Afro Dance
  c3:  "163,230,53",   // Breaking
  c4:  "255,46,126",   // Salsa
  c5:  "255,46,126",   // Bachata
  c6:  "167,139,250",  // Contemporary
  c8:  "45,205,236",   // Zumba
  c9:  "163,230,53",   // Popping
  c10: "255,176,46",
  c11: "255,176,46",
};
const catRgb = (id: string) => CAT_RGB[id] ?? "45,205,236";

const CAT_ICON: Record<string, any> = {
  c1: "musical-notes-outline",
  c2: "sunny-outline",
  c3: "flame-outline",
  c4: "heart-outline",
  c5: "heart-circle-outline",
  c6: "sync-outline",
  c8: "barbell-outline",
  c9: "radio-outline",
};
const catIcon = (id: string): any => CAT_ICON[id] ?? "star-outline";

/* ── Backend-driven category view-model (with legacy fallback during migration) ── */
type CategoryVM = {
  id: string;
  name: string;
  rgb: string;                // "r,g,b" — feeds the existing rgba(...) styling unchanged
  iconSvg: string | null;
  iconUrl: string | null;
  legacyIcon: string | null;  // Ionicons name — set ONLY on the legacy fallback path
  matchesClass: (c: DanceClass) => boolean;
};

const normCat = (s: string) => (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const isBalletName = (name: string, slug: string) => normCat(name) === "ballet" || normCat(slug) === "ballet";

function hexToRgb(hex?: string | null): string | null {
  if (!hex) return null;
  let h = hex.replace("#", "").trim();
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (h.length !== 6) return null;
  const n = parseInt(h, 16);
  return Number.isNaN(n) ? null : `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}

/* ─── Class status helpers ───────────────────────────────────────── */
function statusLabel(st: DanceClass["status"]) {
  return st === "available" ? "Available"
       : st === "fewSeats"  ? "Few Seats"
       : st === "full"      ? "Full"
       : st === "cancelled" ? "Cancelled"
       : st === "unavailable" ? "Unavailable"
       : "Waitlist";
}
function statusColor(st: DanceClass["status"]) {
  return st === "available" ? SUCCESS
       : st === "fewSeats"  ? AMBER
       : st === "full"      ? DANGER
       : st === "cancelled" ? DANGER
       : st === "unavailable" ? INK_400
       : INK_300;
}
function statusBg(st: DanceClass["status"]) {
  return st === "available" ? "rgba(31,184,113,0.16)"
       : st === "fewSeats"  ? "rgba(255,176,46,0.16)"
       : st === "full"      ? "rgba(255,59,71,0.10)"
       : st === "cancelled" ? "rgba(255,59,71,0.10)"
       : st === "unavailable" ? "rgba(255,255,255,0.06)"
       : "rgba(255,255,255,0.06)";
}

/* ─── Difficulty derived from ageGroup ───────────────────────────── */
function deriveDifficulty(ag: AgeGroup) {
  return ag === "Kids" ? "Beginner" : ag === "Teens" ? "Intermediate" : "Advanced";
}
function diffColor(d: string) {
  return d === "Beginner" ? CYAN : d === "Intermediate" ? AMBER : MAGENTA;
}

/* ─── Instructor spec cleanup ────────────────────────────────────── */
function styleLabel(t?: string) {
  return (t ?? "").replace(/\s*Instructor\s*$/i, "").trim() || "Instructor";
}

/* ─── XStars ─────────────────────────────────────────────────────── */
function XStars({ rating }: { rating: number }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
      {Array.from({ length: 5 }).map((_, i) => (
        <XI
          key={i}
          name="star"
          size={11}
          color={i < Math.round(rating) ? "#FFB81C" : "rgba(255,255,255,0.18)"}
        />
      ))}
      <Text style={{ fontSize: 11, fontFamily: "Archivo_400Regular", color: INK_300, marginLeft: 3 }}>
        {rating.toFixed(1)}
      </Text>
    </View>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   EXPLORE HERO
═══════════════════════════════════════════════════════════════════ */
function ExploreHero({ count, topPad }: { count: number; topPad: number }) {
  return (
    <View style={[s.heroWrap, { paddingTop: topPad + 22 }]}>
      <Text style={s.heroEyebrow}>Explore</Text>
      <Text style={s.heroTitle}>Classes</Text>
      <Text style={s.heroDesc}>
        Discover dance styles, instructors, and programs designed for every level.
      </Text>
      <View style={s.heroCountBadge}>
        <View style={s.heroCountDot} />
        <Text style={s.heroCountText}>{count} Active Classes</Text>
      </View>
    </View>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   SEARCH BAR
═══════════════════════════════════════════════════════════════════ */
function ExploreSearch({
  query,
  onChange,
}: {
  query: string;
  onChange: (v: string) => void;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={s.searchWrap}>
      <View style={[s.searchContainer, focused && s.searchContainerFocused]}>
        <View style={s.searchIcon}><XI name="search" size={18} stroke={2.2} color={focused ? CYAN : INK_400} /></View>
        <TextInput
          value={query}
          onChangeText={onChange}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder="Search classes, instructors, styles…"
          placeholderTextColor={INK_400}
          style={s.searchInput}
        />
        {!!query && (
          <TouchableOpacity onPress={() => onChange("")} style={s.searchClear} activeOpacity={0.8}>
            <XI name="x" size={14} stroke={2.4} color="#fff" />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   FILTERS
═══════════════════════════════════════════════════════════════════ */
const AGE_TABS = ["All", "Kids", "Teens", "Adults"] as const;
const LEVEL_TABS = ["All Levels", "Beginner", "Intermediate", "Advanced"] as const;

function ExploreFilters({
  age, level, onAge, onLevel,
}: {
  age: string; level: string;
  onAge: (v: string) => void; onLevel: (v: string) => void;
}) {
  return (
    <View style={s.filtersWrap}>
      <View style={s.ageSegment}>
        {AGE_TABS.map((a) => {
          const active = age === a.toLowerCase() || (age === "all" && a === "All");
          return (
            <TouchableOpacity
              key={a}
              onPress={() => { Haptics.selectionAsync(); onAge(a === "All" ? "all" : a.toLowerCase()); }}
              style={[s.ageTab, active && s.ageTabActive]}
              activeOpacity={0.85}
            >
              <Text style={[s.ageTabText, active && s.ageTabTextActive]}>{a}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.levelRow}>
        {LEVEL_TABS.map((l) => {
          const key = l === "All Levels" ? "all" : l.toLowerCase();
          const active = level === key;
          return (
            <TouchableOpacity
              key={l}
              onPress={() => { Haptics.selectionAsync(); onLevel(key); }}
              style={[s.levelChip, active && s.levelChipActive]}
              activeOpacity={0.85}
            >
              <Text style={[s.levelChipText, active && s.levelChipTextActive]}>{l}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   FEATURED CARD + CAROUSEL (trending)
═══════════════════════════════════════════════════════════════════ */
function FeaturedCard({
  item, onSelect,
}: {
  item: DanceClass; onSelect: (c: DanceClass) => void;
}) {
  const stC = statusColor(item.status);
  const stBg = statusBg(item.status);
  const isTrending = isClassCapacityDisplayEnabled(item) && item.capacity > 0 && item.bookedCount / item.capacity > 0.5;
  return (
    <TouchableOpacity onPress={() => onSelect(item)} style={s.featCard} activeOpacity={0.88}>
      {item.photoUrl ? (
        <Image source={{ uri: item.photoUrl }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      ) : (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: INK_700 }]} />
      )}
      <LinearGradient
        colors={["rgba(5,6,8,0.08)", "rgba(5,6,8,0.44)", "rgba(5,6,8,0.93)"]}
        locations={[0, 0.5, 1]}
        style={StyleSheet.absoluteFill}
      />
      <View style={s.featCardTopRow}>
        <View style={s.featCardStyleChip}>
          <Text style={s.featCardStyleText}>{item.categoryName}</Text>
        </View>
        <View style={[s.featCardStatusChip, { backgroundColor: stBg }]}>
          <View style={[s.dot, { backgroundColor: stC }]} />
          <Text style={[s.featCardStatusText, { color: stC }]}>{statusLabel(item.status)}</Text>
        </View>
      </View>
      {isTrending && (
        <View style={s.trendingCenterBadge}>
          <XI name="fire" size={10} stroke={2.2} color="#fff" />
          <Text style={s.trendingBadgeText}>Trending</Text>
        </View>
      )}
      <View style={s.featCardBottom}>
        <Text style={s.featCardTitle} numberOfLines={1}>{item.title}</Text>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          {(item as any).rating ? <XStars rating={(item as any).rating} /> : <View />}
          <Text style={s.featCardPrice}>EGP {item.price}</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

function FeaturedCarousel({
  classes, onSelect,
}: {
  classes: DanceClass[]; onSelect: (c: DanceClass) => void;
}) {
  const trending = useMemo(
    () => classes.filter((c) => isClassCapacityDisplayEnabled(c) && c.capacity > 0 && c.bookedCount / c.capacity > 0.4).slice(0, 6),
    [classes],
  );
  if (trending.length === 0) return null;
  return (
    <View style={s.carouselSection}>
      <View style={s.carouselHeader}>
        <View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 7, marginBottom: 3 }}>
            <XI name="fire" size={15} stroke={2} color={MAGENTA} />
            <Text style={s.carouselEyebrow}>Most Popular</Text>
          </View>
          <Text style={s.carouselTitle}>Trending Now</Text>
        </View>
        <TouchableOpacity style={{ flexDirection: "row", alignItems: "center", gap: 2 }} activeOpacity={0.7}>
          <Text style={s.seeAllText}>See all</Text>
          <XI name="chevron" size={15} stroke={2.4} color={INK_300} />
        </TouchableOpacity>
      </View>
      <FlatList
        horizontal
        data={trending}
        keyExtractor={(i) => i.id}
        renderItem={({ item }) => <FeaturedCard item={item} onSelect={onSelect} />}
        contentContainerStyle={{ paddingHorizontal: 20, gap: 12 }}
        showsHorizontalScrollIndicator={false}
        decelerationRate="fast"
      />
    </View>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   EXPLORE CLASS CARD
═══════════════════════════════════════════════════════════════════ */
function ExploreClassCard({
  item, instructor, packageCreditsRemaining, onBook, onSelect,
}: {
  item: DanceClass;
  instructor?: Instructor;
  packageCreditsRemaining: number;
  onBook: (c: DanceClass, method: "package" | "cash") => void;
  onSelect: (c: DanceClass) => void;
}) {
  const { bookings, cancelBooking } = useAppContext();
  const alert = useCentralAlert();
  const queryClient = useQueryClient();

  // The current user's ACTIVE booking for THIS occurrence (drives Cancel CTA).
  // Occurrence-scoped: the booking must be for the same occurrence the card is
  // currently showing (item.date = the schedule's current upcoming occurrence), so
  // a weekly class's Cancel CTA flips back to "Book Now" once that occurrence
  // passes — it does NOT stay "Cancel Booking" forever.
  // TODO: When a full recurring occurrence model lands, match on occurrenceId.
  const activeBooking = useMemo(
    () => bookings.find((b) =>
      b.classId === item.id &&
      (item.scheduleId ? b.scheduleId === item.scheduleId : true) &&
      b.occurrenceDate === item.date &&
      (b.bookingStatus === "pending" || b.bookingStatus === "confirmed"),
    ),
    [bookings, item.id, item.scheduleId, item.date],
  );

  const handleCancel = useCallback(() => {
    if (!activeBooking) return;
    alert.show({
      tone: "destructive",
      title: "Cancel booking?",
      message: `Cancel your booking for ${item.title}? This frees up your seat.`,
      actions: [
        { label: "Keep booking", tone: "neutral" },
        {
          label: "Cancel booking",
          tone: "danger",
          onPress: async () => {
            try {
              await cancelBooking(activeBooking.id);
              // Refresh schedules so the progress bar / booked count update.
              await queryClient.invalidateQueries({ queryKey: getListSchedulesQueryKey() });
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            } catch (e) {
              alert.show({ tone: "error", title: "Couldn't cancel", message: e instanceof Error ? e.message : "Please try again." });
            }
          },
        },
      ],
    });
  }, [activeBooking, cancelBooking, item.title, queryClient, alert]);

  // Display-only capacity. Reflects the current canonical occurrence; completed
  // schedules are treated as unavailable, not capacity-full.
  const cap = classCapacityDisplay(item);
  const showCapacity = isClassCapacityDisplayEnabled(item);
  const pct = cap.pct;
  const barColor = pct >= 85 ? DANGER : pct >= 60 ? AMBER : CYAN;
  const st = item.status;
  const stC = statusColor(st);
  const stBg = statusBg(st);
  const difficulty = deriveDifficulty(item.ageGroup);
  const isTrending = showCapacity && pct > 50;
  const creditsLeft = item.packageEligible ? packageCreditsRemaining : 0;
  const availableSeats = cap.available;
  const rating = (item as any).rating as number | undefined;

  return (
    <View style={s.classCard}>
      {/* Image header */}
      <TouchableOpacity onPress={() => onSelect(item)} style={s.classCardImg} activeOpacity={0.92}>
        {item.photoUrl ? (
          <Image source={{ uri: item.photoUrl }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        ) : (
          <View style={[StyleSheet.absoluteFill, { backgroundColor: INK_700 }]} />
        )}
        <LinearGradient
          colors={["rgba(5,6,8,0.06)", "rgba(5,6,8,0.70)"]}
          locations={[0, 1]}
          style={StyleSheet.absoluteFill}
        />
        <View style={s.classCardTopChips}>
          <View style={{ flexDirection: "row", gap: 6 }}>
            <View style={s.chipDark}>
              <Text style={s.chipDarkText}>{item.categoryName}</Text>
            </View>
            <View style={s.chipDark}>
              <Text style={[s.chipDarkText, { color: diffColor(difficulty) }]}>{difficulty}</Text>
            </View>
          </View>
          <View style={[s.classCardStatusChip, { backgroundColor: stBg }]}>
            <View style={[s.dot, { backgroundColor: stC }]} />
            <Text style={[s.classCardStatusText, { color: stC }]}>{statusLabel(st)}</Text>
          </View>
        </View>
        {isTrending && (
          <View style={s.classCardTrendingBadge}>
            <XI name="fire" size={10} stroke={2.2} color="#fff" />
            <Text style={s.trendingBadgeText}>Trending</Text>
          </View>
        )}
      </TouchableOpacity>

      {/* Body */}
      <TouchableOpacity onPress={() => onSelect(item)} activeOpacity={0.92} style={s.classCardBody}>
        <View style={s.classCardTitleRow}>
          <Text style={s.classCardTitle} numberOfLines={2}>{item.title}</Text>
          {rating ? <XStars rating={rating} /> : null}
        </View>
        {!!item.description && (
          <Text style={s.classCardDesc} numberOfLines={2}>{item.description}</Text>
        )}
        <View style={s.classCardMeta}>
          <View style={s.metaItem}>
            <XI name="cal" size={14} stroke={2} color={CYAN} />
            <Text style={s.metaText}>
              {item.dayOfWeek ?? "—"} · {item.startTime ?? "—"}
            </Text>
          </View>
          {!!item.duration && (
            <View style={s.metaItem}>
              <XI name="clock" size={13} stroke={2} color={INK_400} />
              <Text style={s.metaText}>{item.duration}</Text>
            </View>
          )}
        </View>
        <View style={s.classCardInstRow}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 9 }}>
            {instructor?.photoUrl ? (
              <Image source={{ uri: instructor.photoUrl }} style={s.instAvatar} resizeMode="cover" />
            ) : (
              <View style={[s.instAvatar, { backgroundColor: CYAN + "22", alignItems: "center", justifyContent: "center" }]}>
                <Text style={{ fontSize: 11, fontFamily: "Archivo_700Bold", color: CYAN }}>
                  {(instructor?.name ?? "?")[0]}
                </Text>
              </View>
            )}
            <View>
              <Text style={s.instName}>{instructor?.name ?? "Instructor"}</Text>
              <Text style={s.instSpec}>{styleLabel(instructor?.title)}</Text>
            </View>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={s.classCardPrice}>EGP {item.price}</Text>
            <Text style={s.classCardPriceSub}>per class</Text>
          </View>
        </View>
        <View style={s.divider} />
        {showCapacity && (
          <View style={s.capacitySection}>
            <View style={s.capacityRow}>
              <Text style={s.capacityText}>
                <Text style={{ color: SUCCESS, fontFamily: "Archivo_700Bold" }}>{availableSeats}</Text>
                {" available · "}{cap.booked}/{item.capacity} booked
              </Text>
              <XI name="users" size={14} stroke={2} color={INK_400} />
            </View>
            <View style={s.capBarBg}>
              <View style={[s.capBarFill, { width: `${pct}%` as any, backgroundColor: barColor }]} />
            </View>
          </View>
        )}
        <View style={s.creditsRow}>
          {creditsLeft > 0 ? (
            <>
              <View style={s.creditsBubble}>
                <Text style={s.creditsBubbleText}>P</Text>
              </View>
              <Text style={s.creditsText}>
                Package ·{" "}
                <Text style={{ color: "#fff", fontFamily: "Archivo_700Bold" }}>{creditsLeft} credits left</Text>
              </Text>
            </>
          ) : (
            <>
              <View style={[s.creditsBubble, { backgroundColor: "rgba(255,255,255,0.06)" }]}>
                <Text style={[s.creditsBubbleText, { color: INK_400 }]}>P</Text>
              </View>
              <Text style={s.creditsText}>No Active Package</Text>
            </>
          )}
        </View>
      </TouchableOpacity>

      {/* Actions */}
      <View style={s.classCardActions}>
        {activeBooking ? (
          // User already has an active booking for this class/schedule → Cancel CTA
          // (no Book). Cancelling releases the seat and returns the CTA to Book.
          <TouchableOpacity onPress={handleCancel} style={s.btnCancel} activeOpacity={0.85}>
            <Text style={s.btnCancelText}>Cancel Booking</Text>
          </TouchableOpacity>
        ) : (
          <>
            {creditsLeft > 0 && st !== "full" && st !== "cancelled" && st !== "unavailable" && (
              <TouchableOpacity
                onPress={() => onBook(item, "package")}
                style={s.btnPackage}
                activeOpacity={0.85}
              >
                <Text style={s.btnPackageText}>Use Package</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              onPress={() => { if (st !== "full" && st !== "cancelled" && st !== "unavailable") onBook(item, "cash"); }}
              style={[s.btnBook, (st === "full" || st === "cancelled" || st === "unavailable") && { backgroundColor: "rgba(255,255,255,0.06)" }]}
              activeOpacity={0.85}
            >
              <Text style={[s.btnBookText, (st === "full" || st === "cancelled" || st === "unavailable") && { color: INK_400 }]}>
                {st === "cancelled" ? "Cancelled" : st === "unavailable" ? "Unavailable" : st === "full" ? "Full" : "Book Now"}
              </Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </View>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   CATEGORY SECTION (accordion)
═══════════════════════════════════════════════════════════════════ */
function CategorySection({
  cat, classes, expanded, onToggle,
  instructorById, packageCreditsRemaining, onSelect, onBook,
}: {
  cat: CategoryVM;
  classes: DanceClass[];
  expanded: boolean;
  onToggle: () => void;
  instructorById: Map<string, Instructor>;
  packageCreditsRemaining: number;
  onSelect: (c: DanceClass) => void;
  onBook: (c: DanceClass, method: "package" | "cash") => void;
}) {
  const rgb = cat.rgb;
  const rotAnim = useRef(new Animated.Value(expanded ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(rotAnim, {
      toValue: expanded ? 1 : 0,
      duration: 220,
      useNativeDriver: true,
    }).start();
  }, [expanded]);

  const rotate = rotAnim.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "90deg"] });

  return (
    <View>
      <TouchableOpacity
        onPress={() => { Haptics.selectionAsync(); onToggle(); }}
        style={[
          s.catHeader,
          {
            borderColor: expanded ? `rgba(${rgb},0.50)` : BORDER,
            borderBottomLeftRadius: expanded ? 0 : R_LG,
            borderBottomRightRadius: expanded ? 0 : R_LG,
          },
        ]}
        activeOpacity={0.85}
      >
        <View style={[s.catIcon, { backgroundColor: `rgba(${rgb},0.13)` }]}>
          <CategoryIcon
            iconSvg={cat.iconSvg}
            iconUrl={cat.iconUrl}
            legacyIcon={cat.legacyIcon}
            name={cat.name}
            color={`rgba(${rgb},1)`}
            size={22}
          />
        </View>
        <View style={s.catHeaderText}>
          <Text style={s.catName}>{cat.name}</Text>
          <Text style={s.catCount}>{classes.length} {classes.length === 1 ? "class" : "classes"}</Text>
        </View>
        <Animated.View style={{ transform: [{ rotate }] }}>
          <XI name="chevron" size={20} stroke={2.2} color={INK_400} />
        </Animated.View>
      </TouchableOpacity>

      {expanded && (
        <View style={[s.catExpanded, { borderColor: `rgba(${rgb},0.38)` }]}>
          {classes.map((c, i) => (
            <React.Fragment key={c.id}>
              {i > 0 && <View style={{ height: 14 }} />}
              <ExploreClassCard
                item={c}
                instructor={instructorById.get(c.instructorId)}
                packageCreditsRemaining={packageCreditsRemaining}
                onSelect={onSelect}
                onBook={onBook}
              />
            </React.Fragment>
          ))}
        </View>
      )}
    </View>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   MAIN SCREEN
═══════════════════════════════════════════════════════════════════ */
export default function ClassesScreen() {
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const { user, userPackages } = useAppContext();

  const [search, setSearch]     = useState("");
  const [ageFilter, setAge]     = useState("all");
  const [levelFilter, setLevel] = useState("all");
  const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set());

  const classesQuery      = useListClasses();
  const instructorsQuery  = useListInstructors();
  const schedulesQuery    = useListSchedules();
  const classPricingQuery = useQuery({
    queryKey: ["class-pricing"],
    queryFn: fetchClassPricing,
    staleTime: 5 * 60 * 1000,
  });
  const classCapacityQuery = useQuery({
    queryKey: ["class-capacity"],
    queryFn: fetchClassCapacitySettings,
    staleTime: 60 * 1000,
  });
  const singleClassPriceEgp =
    classPricingQuery.data?.singleClassPriceEgp ?? DEFAULT_SINGLE_CLASS_PRICE_EGP;
  const classCapacityEnabled =
    classCapacityQuery.data?.classCapacityEnabled ?? DEFAULT_CLASS_CAPACITY_ENABLED;

  const isLoading = classesQuery.isLoading || instructorsQuery.isLoading || schedulesQuery.isLoading;
  const isError   = classesQuery.isError   || instructorsQuery.isError   || schedulesQuery.isError;
  const queryError = classesQuery.error ?? instructorsQuery.error ?? schedulesQuery.error;
  const isOffline  = isOfflineError(queryError);
  const isRefreshing = classesQuery.isRefetching || instructorsQuery.isRefetching || schedulesQuery.isRefetching;

  const onRefresh = useCallback(() => {
    classesQuery.refetch();
    instructorsQuery.refetch();
    schedulesQuery.refetch();
    classPricingQuery.refetch();
    classCapacityQuery.refetch();
  }, [classesQuery, instructorsQuery, schedulesQuery, classPricingQuery, classCapacityQuery]);

  const instructors: Instructor[] = useMemo(
    () => (instructorsQuery.data ?? []).map(mapApiInstructorToMobile),
    [instructorsQuery.data],
  );
  const instructorById = useMemo(() => {
    const m = new Map<string, Instructor>();
    instructors.forEach((i) => m.set(i.id, i));
    return m;
  }, [instructors]);

  const packageCreditsRemaining = useMemo(
    () => userPackages
      .filter((p) => p.status === "active" && p.remainingCredits > 0)
      .reduce((sum, p) => sum + p.remainingCredits, 0),
    [userPackages],
  );

  const allClasses: DanceClass[] = useMemo(() => {
    const schedulesByClassId = new Map<number, NonNullable<typeof schedulesQuery.data>[number]>();
    const scheduledClassIds = new Set((schedulesQuery.data ?? []).map((schedule) => schedule.classId));
    const visibleScheduledClassIds = new Set<number>();
    [...(schedulesQuery.data ?? [])]
      .filter(isMobileVisibleSchedule)
      .sort((a, b) => compareSchedulesByNextOccurrence(a, b))
      .forEach((schedule) => {
        visibleScheduledClassIds.add(schedule.classId);
        if (!schedulesByClassId.has(schedule.classId)) {
          schedulesByClassId.set(schedule.classId, schedule);
        }
      });
    return (classesQuery.data ?? [])
      .filter((c) => c.isActive)
      .filter((c) => !scheduledClassIds.has(c.id) || visibleScheduledClassIds.has(c.id))
      .map((c) => mapApiClassWithScheduleToMobile(c, schedulesByClassId.get(c.id), singleClassPriceEgp, classCapacityEnabled));
  }, [classesQuery.data, schedulesQuery.data, singleClassPriceEgp, classCapacityEnabled]);

  const nonBalletClasses = useMemo(() => allClasses.filter((c) => !c.isBallet), [allClasses]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return nonBalletClasses.filter((c) => {
      if (ageFilter !== "all" && c.ageGroup.toLowerCase() !== ageFilter) return false;
      if (levelFilter !== "all" && deriveDifficulty(c.ageGroup).toLowerCase() !== levelFilter) return false;
      if (q && !c.title.toLowerCase().includes(q) && !c.categoryName.toLowerCase().includes(q) &&
          !(instructorById.get(c.instructorId)?.name ?? "").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [nonBalletClasses, ageFilter, levelFilter, search, instructorById]);

  // ── Categories now come from backend Dance Types (with legacy fallback) ──────
  const { data: danceTypesRaw } = useListDanceTypes();
  const nonBalletCats: CategoryVM[] = useMemo(() => {
    const active = (danceTypesRaw ?? []).filter(
      (dt) => dt.isActive !== false && !isBalletName(dt.name, dt.slug),
    );
    if (active.length > 0) {
      return [...active]
        .sort((a, b) => (a.sortOrder - b.sortOrder) || a.name.localeCompare(b.name))
        .map((dt): CategoryVM => ({
          id: `dt-${dt.id}`,
          name: dt.name,
          rgb: hexToRgb(dt.color) ?? "45,205,236",
          iconSvg: dt.iconSvg ?? null,
          iconUrl: dt.iconUrl ?? null,
          legacyIcon: null,
          matchesClass: (c) => {
            const dtId = (c as { danceTypeId?: number | null }).danceTypeId;
            if (dtId != null) return dtId === dt.id; // prefer ID when present
            const n = normCat(c.categoryName);        // legacy string/slug/name fallback
            return n === normCat(dt.name) || n === normCat(dt.slug);
          },
        }));
    }
    // Legacy fallback — behaviour & icons unchanged until backend has Dance Types.
    return DANCE_CATEGORIES.filter((c) => !c.isBallet).map((cat): CategoryVM => ({
      id: cat.id,
      name: cat.name,
      rgb: catRgb(cat.id),
      iconSvg: null,
      iconUrl: null,
      legacyIcon: catIcon(cat.id),
      matchesClass: (c) => c.categoryId === cat.id,
    }));
  }, [danceTypesRaw]);

  /* Auto-expand first category on initial load */
  useEffect(() => {
    if (!isLoading && expandedCats.size === 0 && filtered.length > 0) {
      const first = nonBalletCats.find((cat) => filtered.some((c) => cat.matchesClass(c)));
      if (first) setExpandedCats(new Set([first.id]));
    }
  }, [isLoading, filtered.length]);

  const showFeatures = !search && ageFilter === "all" && levelFilter === "all";
  const visibleCats  = nonBalletCats.filter((cat) => filtered.some((c) => cat.matchesClass(c)));

  function handleSelectClass(c: DanceClass) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push({ pathname: "/class/[id]", params: { id: c.id, scheduleId: c.scheduleId } });
  }

  function handleBook(c: DanceClass, method: "package" | "cash") {
    if (c.status === "full" || c.status === "cancelled" || c.status === "unavailable") return;
    if (!user) {
      showAuthRequiredPrompt();
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.push({
      pathname: "/booking/flow",
      params: {
        classId: c.id,
        scheduleId: c.scheduleId,
        ...(method === "package" ? { usePackage: "true" } : {}),
      },
    } as any);
  }

  return (
    <View style={s.screen}>
      {/* Exact design feed glow (full-bleed cyan radials):
          radial-gradient(90% 130% at 94% -6%, rgba(0,182,215,0.18) 0%, transparent 52%)  (top-right)
          radial-gradient(70% 80%  at -8% 100%, rgba(0,182,215,0.10) 0%, transparent 55%)  (bottom-left) */}
      <Svg style={s.bgGlow} pointerEvents="none">
        <Defs>
          <RadialGradient id="classGlowTop" cx="94%" cy="-6%" rx="90%" ry="130%">
            <Stop offset="0%" stopColor="#00B6D7" stopOpacity={0.18} />
            <Stop offset="52%" stopColor="#00B6D7" stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id="classGlowBottom" cx="-8%" cy="100%" rx="70%" ry="80%">
            <Stop offset="0%" stopColor="#00B6D7" stopOpacity={0.10} />
            <Stop offset="55%" stopColor="#00B6D7" stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <SvgRect x="0" y="0" width="100%" height="100%" fill="url(#classGlowTop)" />
        <SvgRect x="0" y="0" width="100%" height="100%" fill="url(#classGlowBottom)" />
      </Svg>
      {isLoading ? (
        <View style={{ paddingTop: topPad + 80 }}>
          <ListSkeleton count={4} />
        </View>
      ) : isError ? (
        <View style={{ paddingTop: topPad + 80 }}>
          {isOffline ? <OfflineState onRetry={onRefresh} /> : <ErrorState onRetry={onRefresh} />}
        </View>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} tintColor={CYAN} colors={[CYAN]} />
          }
          contentContainerStyle={{ paddingBottom: Platform.OS === "web" ? 120 : 100 }}
        >
          <ExploreHero count={nonBalletClasses.length} topPad={topPad} />
          <ExploreSearch query={search} onChange={setSearch} />
          <ExploreFilters age={ageFilter} level={levelFilter} onAge={setAge} onLevel={setLevel} />

          {showFeatures && filtered.length > 0 && (
            <FeaturedCarousel classes={filtered} onSelect={handleSelectClass} />
          )}

          {/* By Style categories */}
          <View style={s.catsSection}>
            <View style={s.catsSectionHeader}>
              <Text style={s.catsSectionTitle}>By Style</Text>
              <Text style={s.catsSectionCount}>{filtered.length} classes</Text>
            </View>
            {visibleCats.length === 0 ? (
              <View style={s.emptyState}>
                <View style={s.emptyIcon}>
                  <XI name="search" size={30} stroke={1.6} color="#4C545E" />
                </View>
                <Text style={s.emptyTitle}>No classes found</Text>
                <Text style={s.emptyDesc}>Try different keywords or clear your filters.</Text>
                <TouchableOpacity
                  onPress={() => { setSearch(""); setAge("all"); setLevel("all"); }}
                  style={s.clearBtn}
                  activeOpacity={0.8}
                >
                  <Text style={s.clearBtnText}>Clear Filters</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={{ gap: 12 }}>
                {visibleCats.map((cat) => (
                  <CategorySection
                    key={cat.id}
                    cat={cat}
                    classes={filtered.filter((c) => cat.matchesClass(c))}
                    expanded={expandedCats.has(cat.id)}
                    onToggle={() => {
                      setExpandedCats((prev) => {
                        const n = new Set(prev);
                        n.has(cat.id) ? n.delete(cat.id) : n.add(cat.id);
                        return n;
                      });
                    }}
                    instructorById={instructorById}
                    packageCreditsRemaining={packageCreditsRemaining}
                    onSelect={handleSelectClass}
                    onBook={handleBook}
                  />
                ))}
              </View>
            )}
          </View>
        </ScrollView>
      )}

    </View>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   STYLES
═══════════════════════════════════════════════════════════════════ */
const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: INK_900 },
  bgGlow: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 0, pointerEvents: "none" as any },

  /* hero */
  heroWrap: { paddingHorizontal: 22, paddingBottom: 22 },
  heroEyebrow: {
    fontSize: 10, fontFamily: "SpaceMono_700Bold", letterSpacing: 1.8,
    textTransform: "uppercase", color: CYAN, marginBottom: 8,
  },
  heroTitle: {
    fontSize: 68, fontFamily: "Anton_400Regular", textTransform: "uppercase",
    color: "#fff", lineHeight: 60, ...iosDisplayTextStyle(68, 60), letterSpacing: -1,
    // Cancel the iOS cap-guard inset from the block's footprint so the gap to the
    // subtitle matches Android (the inset only needs to protect the caps, not add
    // height below the baseline). No-op on Android.
    marginBottom: -iosCapGuard(68, 60),
  },
  heroDesc: {
    fontSize: 14, fontFamily: "Archivo_400Regular", color: INK_300,
    marginTop: 12, maxWidth: 210, lineHeight: 21,
  },
  heroCountBadge: {
    flexDirection: "row", alignItems: "center", gap: 8, marginTop: 14,
    paddingHorizontal: 14, paddingVertical: 6, borderRadius: R_PILL,
    backgroundColor: "rgba(0,182,215,0.12)", borderWidth: 1,
    borderColor: "rgba(0,182,215,0.38)", alignSelf: "flex-start",
  },
  heroCountDot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: CYAN },
  heroCountText: { fontSize: 13, fontFamily: "Archivo_700Bold", color: CYAN },

  /* search */
  searchWrap: { paddingHorizontal: 20, marginBottom: 16 },
  searchContainer: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1.5, borderColor: "rgba(255,255,255,0.10)", borderRadius: R_PILL,
  },
  searchContainerFocused: {
    backgroundColor: "rgba(255,255,255,0.09)",
    borderColor: "rgba(0,182,215,0.72)",
  },
  searchIcon: { position: "absolute", left: 16 },
  searchInput: {
    flex: 1, paddingHorizontal: 46,
    fontSize: 15, fontFamily: "Archivo_400Regular", color: "#fff", ...iosTextInputStyle(15, 18),
    // after the spread so they override its paddingTop:0/paddingBottom:0 on iOS
    // and preserve the field's original height.
    paddingTop: 14, paddingBottom: 14,
  },
  searchClear: {
    position: "absolute", right: 12, width: 28, height: 28, borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.12)", alignItems: "center", justifyContent: "center",
  },

  /* filters */
  filtersWrap: { marginBottom: 20 },
  ageSegment: {
    flexDirection: "row", marginHorizontal: 20, marginBottom: 10, padding: 4,
    backgroundColor: "rgba(255,255,255,0.04)", borderWidth: 1,
    borderColor: "rgba(255,255,255,0.07)", borderRadius: R_PILL,
  },
  ageTab: { flex: 1, paddingVertical: 9, paddingHorizontal: 4, borderRadius: R_PILL, alignItems: "center" },
  ageTabActive: {
    backgroundColor: INK_900,
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 4,
    elevation: 3,
  },
  ageTabText: { fontSize: 13, fontFamily: "Archivo_700Bold", color: INK_400 },
  ageTabTextActive: { color: "#fff" },
  levelRow: { paddingHorizontal: 20, gap: 8 },
  levelChip: {
    paddingHorizontal: 15, paddingVertical: 8, borderRadius: R_PILL,
    backgroundColor: "rgba(255,255,255,0.05)", borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.08)",
  },
  levelChipActive: { backgroundColor: INK_900, borderColor: "rgba(255,255,255,0.28)" },
  levelChipText: { fontSize: 12.5, fontFamily: "Archivo_700Bold", color: INK_400 },
  levelChipTextActive: { color: "#fff" },

  /* trending carousel */
  carouselSection: { marginBottom: 26 },
  carouselHeader: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingHorizontal: 20, marginBottom: 14,
  },
  carouselEyebrow: {
    fontSize: 10, fontFamily: "SpaceMono_700Bold", letterSpacing: 1.8,
    textTransform: "uppercase", color: MAGENTA,
  },
  carouselTitle: { fontSize: 22, fontFamily: "Archivo_700Bold", color: "#fff", letterSpacing: -0.3 },
  seeAllText: { fontSize: 13, fontFamily: "Archivo_600SemiBold", color: INK_300 },
  featCard: {
    width: 260, height: 162, borderRadius: R_LG, overflow: "hidden",
    borderWidth: 1, borderColor: BORDER, backgroundColor: INK_800,
  },
  featCardTopRow: {
    position: "absolute", top: 10, left: 10, right: 10,
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
  },
  featCardStyleChip: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: R_PILL, backgroundColor: "rgba(0,0,0,0.50)" },
  featCardStyleText: { fontSize: 10, fontFamily: "Archivo_800ExtraBold", color: "#fff", textTransform: "uppercase", letterSpacing: 0.8 },
  featCardStatusChip: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 8, paddingVertical: 3, borderRadius: R_PILL },
  featCardStatusText: { fontSize: 10, fontFamily: "Archivo_700Bold" },
  trendingCenterBadge: {
    position: "absolute", top: 10, alignSelf: "center",
    flexDirection: "row", alignItems: "center", gap: 5,
    paddingHorizontal: 9, paddingVertical: 3, borderRadius: R_PILL,
    backgroundColor: "rgba(255,59,71,0.85)",
    left: "50%" as any, transform: [{ translateX: -34 }],
  },
  trendingBadgeText: { fontSize: 10, fontFamily: "Archivo_800ExtraBold", color: "#fff" },
  featCardBottom: { position: "absolute", left: 12, right: 12, bottom: 12 },
  featCardTitle: { fontSize: 15, fontFamily: "Archivo_800ExtraBold", color: "#fff", lineHeight: 18, marginBottom: 5 },
  featCardPrice: { fontSize: 18, fontFamily: "Anton_400Regular", color: CYAN, ...iosDisplayTextStyle(18, 18) },

  /* categories */
  catsSection: { paddingHorizontal: 20, marginBottom: 24 },
  catsSectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 14 },
  catsSectionTitle: { fontSize: 22, fontFamily: "Archivo_700Bold", color: "#fff", letterSpacing: -0.3 },
  catsSectionCount: { fontSize: 13, fontFamily: "Archivo_600SemiBold", color: INK_400 },
  catHeader: {
    flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 13,
    backgroundColor: INK_800, borderWidth: 1, borderRadius: R_LG,
  },
  catIcon: { width: 42, height: 42, borderRadius: R_MD, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  catHeaderText: { flex: 1 },
  catName: { fontSize: 17, fontFamily: "Archivo_800ExtraBold", color: "#fff", marginBottom: 1 },
  catCount: { fontSize: 12.5, fontFamily: "Archivo_400Regular", color: INK_400 },
  catExpanded: {
    borderWidth: 1, borderTopWidth: 0,
    borderBottomLeftRadius: R_LG, borderBottomRightRadius: R_LG,
    padding: 14, backgroundColor: "rgba(255,255,255,0.02)",
  },

  /* class card */
  classCard: { backgroundColor: INK_800, borderWidth: 1, borderColor: BORDER, borderRadius: R_LG, overflow: "hidden" },
  classCardImg: { height: 136, position: "relative" },
  classCardTopChips: {
    position: "absolute", top: 12, left: 12, right: 12,
    flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start",
  },
  chipDark: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: R_PILL, backgroundColor: "rgba(0,0,0,0.52)" },
  chipDarkText: { fontSize: 10, fontFamily: "Archivo_800ExtraBold", color: "#fff", textTransform: "uppercase", letterSpacing: 0.8 },
  classCardStatusChip: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 9, paddingVertical: 4, borderRadius: R_PILL },
  classCardStatusText: { fontSize: 10, fontFamily: "Archivo_700Bold" },
  classCardTrendingBadge: {
    position: "absolute", bottom: 10, left: 12,
    flexDirection: "row", alignItems: "center", gap: 5,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: R_PILL,
    backgroundColor: "rgba(255,59,71,0.75)",
  },
  dot: { width: 5, height: 5, borderRadius: 2.5 },
  classCardBody: { padding: 14, paddingBottom: 0 },
  classCardTitleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 8, marginBottom: 5 },
  classCardTitle: { flex: 1, fontSize: 18, fontFamily: "Archivo_800ExtraBold", color: "#fff", lineHeight: 21 },
  classCardDesc: { fontSize: 13, fontFamily: "Archivo_400Regular", color: INK_300, lineHeight: 19, marginBottom: 11 },
  classCardMeta: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 11 },
  metaItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  metaText: { fontSize: 12, fontFamily: "Archivo_600SemiBold", color: INK_300 },
  classCardInstRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  instAvatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: INK_700 },
  instName: { fontSize: 13.5, fontFamily: "Archivo_700Bold", color: "#fff" },
  instSpec: { fontSize: 11.5, fontFamily: "Archivo_400Regular", color: INK_400 },
  classCardPrice: { fontSize: 20, fontFamily: "Anton_400Regular", color: "#fff", lineHeight: 18, ...iosDisplayTextStyle(20, 18) },
  classCardPriceSub: { fontSize: 11, fontFamily: "Archivo_400Regular", color: INK_400, marginTop: 2, textAlign: "right" },
  divider: { height: 1, backgroundColor: "rgba(255,255,255,0.07)", marginBottom: 11 },
  capacitySection: { marginBottom: 10 },
  capacityRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 },
  capacityText: { fontSize: 11.5, fontFamily: "Archivo_600SemiBold", color: INK_400 },
  capBarBg: { height: 5, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.07)", overflow: "hidden" },
  capBarFill: { height: "100%", borderRadius: 3 },
  creditsRow: { flexDirection: "row", alignItems: "center", gap: 7, marginBottom: 13 },
  creditsBubble: {
    width: 20, height: 20, borderRadius: 10, backgroundColor: "rgba(0,182,215,0.16)",
    alignItems: "center", justifyContent: "center",
  },
  creditsBubbleText: { fontSize: 10, fontFamily: "Archivo_800ExtraBold", color: CYAN },
  creditsText: { fontSize: 12, fontFamily: "Archivo_600SemiBold", color: INK_400 },
  classCardActions: { flexDirection: "row", gap: 9, padding: 15, paddingTop: 0 },
  btnPackage: {
    flex: 1, paddingVertical: 11, borderRadius: R_MD,
    borderWidth: 1.5, borderColor: "rgba(0,182,215,0.46)",
    backgroundColor: "rgba(0,182,215,0.08)", alignItems: "center",
  },
  btnPackageText: { fontSize: 13, fontFamily: "Archivo_700Bold", color: CYAN },
  // Design parity: button content centered via row + justify/align center (was
  // alignItems-only, which left the label visually off-centre in some states).
  btnBook: {
    flex: 1, paddingVertical: 11, borderRadius: R_MD, backgroundColor: CYAN,
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
  },
  btnBookText: { fontSize: 13, fontFamily: "Archivo_800ExtraBold", color: INK_900, textAlign: "center" },
  // Cancel Booking CTA (shown when the user already has an active booking).
  btnCancel: {
    flex: 1, paddingVertical: 11, borderRadius: R_MD,
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    borderWidth: 1.5, borderColor: "rgba(255,59,71,0.5)", backgroundColor: "rgba(255,59,71,0.10)",
  },
  btnCancelText: { fontSize: 13, fontFamily: "Archivo_800ExtraBold", color: DANGER, textAlign: "center" },

  /* empty state */
  emptyState: { alignItems: "center", paddingVertical: 56, paddingHorizontal: 30 },
  emptyIcon: {
    width: 68, height: 68, borderRadius: 34,
    backgroundColor: "rgba(255,255,255,0.05)", alignItems: "center", justifyContent: "center", marginBottom: 14,
  },
  emptyTitle: { fontSize: 20, fontFamily: "Archivo_700Bold", color: "#fff", marginBottom: 8 },
  emptyDesc: { fontSize: 13, fontFamily: "Archivo_400Regular", color: INK_400, textAlign: "center", maxWidth: 230, marginBottom: 20 },
  clearBtn: {
    paddingHorizontal: 20, paddingVertical: 10, borderRadius: R_MD,
    backgroundColor: "rgba(0,182,215,0.12)", borderWidth: 1, borderColor: "rgba(0,182,215,0.38)",
  },
  clearBtnText: { fontSize: 13, fontFamily: "Archivo_700Bold", color: CYAN },

  scheduleTile: {
    flex: 1, paddingVertical: 12, paddingHorizontal: 10,
    backgroundColor: INK_800, borderWidth: 1, borderColor: "rgba(255,255,255,0.07)",
    borderRadius: R_MD, alignItems: "center",
  },
  scheduleTileLabel: {
    fontSize: 11, fontFamily: "Archivo_600SemiBold", color: INK_400,
    textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 5,
  },
  scheduleTileVal: { fontSize: 13, fontFamily: "Archivo_700Bold", color: "#fff", lineHeight: 16, textAlign: "center" },
});
