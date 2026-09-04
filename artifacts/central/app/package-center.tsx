import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Dimensions,
  Image,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import Svg, { Defs, Path, RadialGradient, Rect, Stop } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { normalizeMediaUrl, useGetMyPackages } from "@workspace/api-client-react";
import type { PackageOrder } from "@workspace/api-client-react";
import AvailablePackagesSection from "@/components/AvailablePackagesSection";
import CentralBackButton from "@/components/CentralBackButton";
import { useAppContext } from "@/contexts/AppContext";
import { useCentralAlert } from "@/hooks/useCentralAlert";
import { formatApiDate, isApiDatePast } from "@/utils/dateTime";
import { iosDisplayTextStyle } from "@/utils/iosTypography";
import { parsePackageAgeBand } from "@/utils/packageAgeBands";

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const CYAN = "#00B6D7";
const GREEN = "#20D65A";
const RED = "#FF0004";
const YELLOW = "#FFC400";
const CARD_BG = "#012329";
const CARD_WIDTH = Math.min(322, SCREEN_WIDTH - 68);
const CARD_HEIGHT = 392;
const CARD_GAP = 12;
const CARD_SNAP = CARD_WIDTH + CARD_GAP;
const CAROUSEL_SIDE = Math.max(20, (SCREEN_WIDTH - CARD_WIDTH) / 2);

type PackageKind = "active" | "pending" | "expired";
type Dateish = string | Date | null | undefined;
type PackageOrderWithAliases = PackageOrder & {
  created_at?: Dateish;
  activated_at?: Dateish;
  expires_at?: Dateish;
  price_egp?: number | null;
  packagePrice?: number | null;
  package_price?: number | null;
  amount?: number | null;
};

function expiresAtOf(pkg: PackageOrderWithAliases): Dateish {
  return pkg.expiresAt ?? pkg.expires_at ?? null;
}

function kindOf(pkg: PackageOrderWithAliases): PackageKind {
  if (pkg.status === "pendingPayment" || pkg.status === "pending") return "pending";
  if (
    pkg.status === "expired"
    || pkg.status === "fullyUsed"
    || pkg.status === "cancelled"
    || pkg.status === "rejected"
    || (pkg.status === "active" && isApiDatePast(expiresAtOf(pkg)))
    || (pkg.status === "active" && pkg.remainingCredits <= 0)
  ) return "expired";
  return "active";
}

function kindColor(kind: PackageKind): string {
  if (kind === "active") return GREEN;
  if (kind === "pending") return YELLOW;
  return RED;
}

function kindLabel(kind: PackageKind): string {
  if (kind === "active") return "ACTIVE";
  if (kind === "pending") return "PENDING";
  return "EXPIRED";
}

function priceOf(pkg: PackageOrderWithAliases): number | null {
  return pkg.priceEgp
    ?? pkg.price_egp
    ?? pkg.packagePrice
    ?? pkg.package_price
    ?? pkg.amount
    ?? null;
}

function priceLabel(pkg: PackageOrderWithAliases): string {
  const price = priceOf(pkg);
  return typeof price === "number" && Number.isFinite(price)
    ? `EGP ${price.toLocaleString()}`
    : "PRICE NOT SET";
}

function expirationLabel(pkg: PackageOrderWithAliases): string {
  const date = expiresAtOf(pkg);
  if (!date) return kindOf(pkg) === "pending" ? "NOT CONFIRMED" : "NOT SET";
  return formatApiDate(date, "NOT SET", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).toUpperCase();
}

function packageSortWeight(pkg: PackageOrderWithAliases): number {
  const kind = kindOf(pkg);
  if (kind === "active") return 0;
  if (kind === "pending") return 1;
  return 2;
}

function WarningIcon() {
  return (
    <Svg width={17} height={17} viewBox="0 0 17 17" fill="none">
      <Path d="M8.251 4.376v4.65" stroke={RED} strokeLinecap="round" />
      <Path d="M8.251 11.077a.275.275 0 1 1 0 .55.275.275 0 0 1 0-.55Z" fill={RED} stroke={RED} />
      <Path d="M4.376 1.537A7.751 7.751 0 1 1 1.537 4.376" stroke={RED} strokeLinecap="round" />
    </Svg>
  );
}

function PackageOwnerAvatar({ pkg }: { pkg: PackageOrderWithAliases }) {
  const { user } = useAppContext();
  const isChild = pkg.participantType === "child";
  const avatarUri = !isChild ? normalizeMediaUrl(user?.avatarUrl, "image") : null;
  const displayName = pkg.participantName?.trim() || pkg.studentName || user?.fullName || "Member";

  return (
    <View style={styles.avatar}>
      {avatarUri ? (
        <Image source={{ uri: avatarUri }} style={styles.avatarImage} resizeMode="cover" />
      ) : (
        <Text style={styles.avatarInitial}>{displayName.charAt(0).toUpperCase()}</Text>
      )}
    </View>
  );
}

function StatusCard({
  pkg,
  cancelling,
  onTrashPress,
}: {
  pkg: PackageOrderWithAliases;
  cancelling: boolean;
  onTrashPress: () => void;
}) {
  const { user } = useAppContext();
  const kind = kindOf(pkg);
  const color = kindColor(kind);
  const owner = pkg.participantName?.trim() || pkg.studentName || user?.fullName || "Member";
  const total = Math.max(0, pkg.totalCredits || 0);
  const remaining = Math.max(0, Math.min(total, pkg.remainingCredits || 0));
  const used = Math.max(0, total - remaining);
  const remainingRatio = total > 0 ? remaining / total : 0;

  return (
    <View style={styles.statusCard}>
      <View style={styles.ownerRow}>
        <PackageOwnerAvatar pkg={pkg} />
        <View style={styles.ownerCopy}>
          <Text style={styles.ownerLabel}>HELLO, THIS IS FOR:</Text>
          <Text style={styles.ownerName} numberOfLines={2}>{owner}</Text>
        </View>
      </View>

      <View style={styles.packageRow}>
        <View style={styles.packageCopy}>
          <Text style={styles.packageLabel}>PACKAGE</Text>
          <Text style={styles.packageName} numberOfLines={2}>{pkg.packageName}</Text>
          <Text style={styles.packageMeta}>{total} CLASSES - {priceLabel(pkg)}</Text>
        </View>
        <View style={styles.statusWrap}>
          <View style={[styles.statusDot, { borderColor: color }]}>
            <View style={[styles.statusDotCore, { backgroundColor: color }]} />
          </View>
          <Text style={[styles.statusText, { color }]}>{kindLabel(kind)}</Text>
        </View>
      </View>

      <View style={styles.creditHero}>
        {kind === "pending" ? (
          <Text style={[styles.waitingText, { color }]}>WAITING APPROVAL</Text>
        ) : (
          <Text style={[styles.creditNumber, { color }]}>{remaining}</Text>
        )}
        <Text style={styles.creditLabel}>CREDITS LEFT</Text>
      </View>

      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${Math.round(remainingRatio * 100)}%`, backgroundColor: color }]} />
      </View>
      <View style={styles.progressMeta}>
        <Text style={styles.progressText}>{used} Used</Text>
        <Text style={styles.progressText}>{remaining}/{total} Remaining</Text>
      </View>

      <View style={styles.cardFooter}>
        <View style={styles.expirationBox}>
          <WarningIcon />
          <View style={styles.expirationCopy}>
            <Text style={styles.expirationNote}>BE NOTED</Text>
            <Text style={styles.expirationHelper}>YOUR BUNDLE EXPIRATION IS:</Text>
            <Text style={styles.expirationDate} numberOfLines={1}>{expirationLabel(pkg)}</Text>
          </View>
        </View>
        <TouchableOpacity
          onPress={onTrashPress}
          disabled={cancelling || kind === "active"}
          activeOpacity={0.82}
          style={[
            styles.trashButton,
            kind === "expired" && styles.trashButtonExpired,
            kind === "active" && styles.trashButtonDisabled,
            cancelling && { opacity: 0.45 },
          ]}
        >
          <Ionicons name="trash-outline" size={25} color={kind === "active" ? "#8A9597" : RED} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

function NothingYetCard() {
  return (
    <View style={[styles.statusCard, styles.nothingCard]}>
      <Text style={styles.questionMark}>?</Text>
      <Text style={styles.nothingTitle}>NOTHING YET</Text>
      <Text style={styles.nothingSubtitle}>BUY A PACKAGE TO PROCEED</Text>
    </View>
  );
}

function StatusSkeleton() {
  return <View style={[styles.statusCard, styles.skeleton]} />;
}

export default function PackageCenterScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ ageBand?: string | string[] }>();
  const alert = useCentralAlert();
  const { cancelPackage, user } = useAppContext();
  const [refreshing, setRefreshing] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [hiddenPackageIds, setHiddenPackageIds] = useState<Set<string>>(new Set());
  const hiddenPackageIdsRef = useRef<Set<string>>(new Set());
  const scrollX = useRef(new Animated.Value(0)).current;
  const { data, isLoading, isError, refetch } = useGetMyPackages();
  const hiddenPackagesStorageKey = `package-center:hidden:${user?.id ?? "guest"}`;
  const requestedAgeBand = parsePackageAgeBand(Array.isArray(params.ageBand) ? params.ageBand[0] : params.ageBand);

  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(hiddenPackagesStorageKey)
      .then((stored) => {
        if (!active) return;
        const parsed = stored ? JSON.parse(stored) : [];
        const next = new Set<string>(Array.isArray(parsed) ? parsed.map(String) : []);
        hiddenPackageIdsRef.current = next;
        setHiddenPackageIds(next);
      })
      .catch(() => {
        if (!active) return;
        hiddenPackageIdsRef.current = new Set();
        setHiddenPackageIds(new Set());
      });
    return () => { active = false; };
  }, [hiddenPackagesStorageKey]);

  const hidePackageLocally = useCallback(async (packageId: string) => {
    const next = new Set(hiddenPackageIdsRef.current);
    next.add(packageId);
    hiddenPackageIdsRef.current = next;
    setHiddenPackageIds(next);
    await AsyncStorage.setItem(hiddenPackagesStorageKey, JSON.stringify([...next]));
  }, [hiddenPackagesStorageKey]);

  const packages = useMemo(
    () => [...(data ?? [])]
      .filter((pkg) => !hiddenPackageIds.has(String(pkg.id)))
      .sort((a, b) => packageSortWeight(a) - packageSortWeight(b)),
    [data, hiddenPackageIds],
  );

  useFocusEffect(useCallback(() => {
    refetch();
  }, [refetch]));

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refetch();
    } finally {
      setRefreshing(false);
    }
  }, [refetch]);

  const requestCancellation = useCallback((pkg: PackageOrderWithAliases) => {
    const kind = kindOf(pkg);
    if (kind === "active") return;

    if (kind === "expired") {
      alert.show({
        tone: "destructive",
        title: "Remove expired package?",
        message: "This package will disappear from this app only. It will remain safely stored in the studio's system records.",
        actions: [
          { label: "Keep it", tone: "neutral" },
          {
            label: "Remove",
            tone: "danger",
            onPress: async () => {
              try {
                await hidePackageLocally(String(pkg.id));
              } catch {
                alert.show({
                  tone: "error",
                  title: "Couldn't remove package",
                  message: "Please try again.",
                });
              }
            },
          },
        ],
      });
      return;
    }

    alert.show({
      tone: "destructive",
      title: "Cancel package request?",
      message: `Cancel your request for ${pkg.packageName}? This removes it before any payment is processed.`,
      actions: [
        { label: "Keep request", tone: "neutral" },
        {
          label: "Cancel request",
          tone: "danger",
          onPress: async () => {
            setCancellingId(String(pkg.id));
            try {
              await cancelPackage(String(pkg.id));
              await hidePackageLocally(String(pkg.id));
              await refetch();
            } catch (error) {
              alert.show({
                tone: "error",
                title: "Couldn't cancel",
                message: error instanceof Error ? error.message : "Please try again.",
              });
            } finally {
              setCancellingId(null);
            }
          },
        },
      ],
    });
  }, [alert, cancelPackage, hidePackageLocally, refetch]);

  const headerTop = (Platform.OS === "web" ? 56 : insets.top) + 8;
  const contentBottom = (Platform.OS === "web" ? 52 : insets.bottom) + 30;

  return (
    <View style={styles.screen}>
      <Svg style={styles.headerGlow} pointerEvents="none">
        <Defs>
          <RadialGradient id="packageCenterGlow" cx="50%" cy="-10%" rx="120%" ry="90%">
            <Stop offset="0%" stopColor={CYAN} stopOpacity={0.16} />
            <Stop offset="60%" stopColor={CYAN} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#packageCenterGlow)" />
      </Svg>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: contentBottom }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor="#FFFFFF" colors={[CYAN]} />
        }
      >
        <View style={[styles.header, { paddingTop: headerTop }]}>
          <CentralBackButton activeOpacity={0.8} style={styles.backButton} />
          <Text style={styles.headerTitle}>PACKAGE CENTER</Text>
        </View>

        <View style={styles.carouselWrap}>
          {isLoading && !refreshing ? (
            <View style={styles.singleCardWrap}><StatusSkeleton /></View>
          ) : isError ? (
            <View style={styles.errorWrap}>
              <Text style={styles.errorTitle}>COULDN'T LOAD PACKAGES</Text>
              <Text style={styles.errorText}>Pull down to try again</Text>
            </View>
          ) : packages.length === 0 ? (
            <View style={styles.singleCardWrap}><NothingYetCard /></View>
          ) : (
            <Animated.FlatList
              data={packages}
              horizontal
              showsHorizontalScrollIndicator={false}
              keyExtractor={(pkg) => String(pkg.id)}
              snapToInterval={CARD_SNAP}
              snapToAlignment="start"
              decelerationRate="fast"
              bounces={false}
              contentContainerStyle={styles.carouselContent}
              onScroll={Animated.event(
                [{ nativeEvent: { contentOffset: { x: scrollX } } }],
                { useNativeDriver: true },
              )}
              scrollEventThrottle={16}
              renderItem={({ item, index }) => {
                const inputRange = [
                  (index - 1) * CARD_SNAP,
                  index * CARD_SNAP,
                  (index + 1) * CARD_SNAP,
                ];
                const scale = scrollX.interpolate({
                  inputRange,
                  outputRange: [0.88, 1, 0.88],
                  extrapolate: "clamp",
                });
                const translateY = scrollX.interpolate({
                  inputRange,
                  outputRange: [12, 0, 12],
                  extrapolate: "clamp",
                });
                return (
                  <Animated.View style={[styles.animatedCard, { transform: [{ scale }, { translateY }] }]}>
                    <StatusCard
                      pkg={item}
                      cancelling={cancellingId === String(item.id)}
                      onTrashPress={() => requestCancellation(item)}
                    />
                  </Animated.View>
                );
              }}
            />
          )}
        </View>

        <AvailablePackagesSection
          mode="packageCenter"
          initialAgeFilter={requestedAgeBand ?? undefined}
          onPurchased={async () => { await refetch(); }}
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#000000" },
  headerGlow: { position: "absolute", top: 0, left: 0, right: 0, height: 380 },
  header: { height: 102, alignItems: "center", justifyContent: "flex-start", paddingHorizontal: 34 },
  backButton: { position: "absolute", left: 34, bottom: 19, width: 34, height: 34 },
  headerTitle: {
    position: "absolute", bottom: 22, color: "#FFFFFF", fontFamily: "Anton_400Regular",
    fontSize: 21, lineHeight: 25, letterSpacing: 0.3,
  },
  carouselWrap: { minHeight: CARD_HEIGHT + 16 },
  carouselContent: { paddingHorizontal: CAROUSEL_SIDE, gap: CARD_GAP, paddingBottom: 8 },
  animatedCard: { width: CARD_WIDTH, height: CARD_HEIGHT },
  singleCardWrap: { alignItems: "center", paddingBottom: 8 },
  statusCard: {
    width: CARD_WIDTH, height: CARD_HEIGHT, borderRadius: 28, backgroundColor: CARD_BG,
    paddingVertical: 18, paddingHorizontal: 22,
  },
  ownerRow: { flexDirection: "row", alignItems: "center", minHeight: 60 },
  avatar: {
    width: 54, height: 54, borderRadius: 27, backgroundColor: "#FFFFFF", alignItems: "center",
    justifyContent: "center", overflow: "hidden", marginRight: 10,
  },
  avatarImage: { width: "100%", height: "100%" },
  avatarInitial: { color: CARD_BG, fontFamily: "Anton_400Regular", fontSize: 24 },
  ownerCopy: { flex: 1, justifyContent: "center" },
  ownerLabel: { color: "#FFFFFF", fontFamily: "Archivo_400Regular", fontSize: 12, lineHeight: 14 },
  ownerName: {
    color: CYAN, fontFamily: "Anton_400Regular", fontSize: 22, lineHeight: 24, textTransform: "uppercase",
  },
  packageRow: { flexDirection: "row", alignItems: "center", marginTop: 15, minHeight: 60 },
  packageCopy: { flex: 1, paddingRight: 8 },
  packageLabel: { color: "#FFFFFF", fontFamily: "Archivo_400Regular", fontSize: 11, lineHeight: 13 },
  packageName: {
    color: CYAN, fontFamily: "Anton_400Regular", fontSize: 19, lineHeight: 20, textTransform: "uppercase",
  },
  packageMeta: { color: "#FFFFFF", fontFamily: "Archivo_500Medium", fontSize: 12, lineHeight: 14, marginTop: 2 },
  statusWrap: { flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 0 },
  statusDot: {
    width: 12, height: 12, borderRadius: 6, borderWidth: 1.5, alignItems: "center", justifyContent: "center",
  },
  statusDotCore: { width: 5, height: 5, borderRadius: 3 },
  statusText: { fontFamily: "Anton_400Regular", fontSize: 16, lineHeight: 18 },
  creditHero: { height: 92, marginTop: 4, alignItems: "center", justifyContent: "center" },
  creditNumber: {
    fontFamily: "Anton_400Regular", fontSize: 86, lineHeight: 82, ...iosDisplayTextStyle(86, 82),
  },
  waitingText: {
    fontFamily: "Anton_400Regular", fontSize: 34, lineHeight: 38, textAlign: "center", marginTop: 10,
  },
  creditLabel: { color: "#FFFFFF", fontFamily: "Archivo_500Medium", fontSize: 12, marginTop: 2 },
  progressTrack: { height: 19, marginTop: 8, borderRadius: 11, backgroundColor: "#E0E3E6", overflow: "hidden" },
  progressFill: { height: "100%", borderRadius: 11 },
  progressMeta: { flexDirection: "row", justifyContent: "space-between", marginTop: 6 },
  progressText: { color: "#FFFFFF", fontFamily: "Archivo_500Medium", fontSize: 11 },
  cardFooter: { flexDirection: "row", gap: 8, height: 54, marginTop: 12 },
  expirationBox: {
    flex: 1, height: 54, borderRadius: 7, backgroundColor: "#3A3A3A", flexDirection: "row",
    alignItems: "center", paddingHorizontal: 11,
  },
  expirationCopy: { marginLeft: 8, flex: 1 },
  expirationNote: { color: "#FFFFFF", fontFamily: "Archivo_800ExtraBold", fontSize: 11, lineHeight: 12 },
  expirationHelper: { color: "#FFFFFF", fontFamily: "Archivo_400Regular", fontSize: 8, lineHeight: 9 },
  expirationDate: { color: RED, fontFamily: "Anton_400Regular", fontSize: 24, lineHeight: 25 },
  trashButton: {
    width: 54, height: 54, borderRadius: 7, backgroundColor: "#E6ECEE", alignItems: "center", justifyContent: "center",
  },
  trashButtonExpired: { backgroundColor: "#46585A", borderWidth: 1, borderColor: RED },
  trashButtonDisabled: { backgroundColor: "#D8DEDF", opacity: 0.52 },
  nothingCard: { alignItems: "center", justifyContent: "center", paddingTop: 0 },
  questionMark: {
    color: YELLOW, fontFamily: "Anton_400Regular", fontSize: 142, lineHeight: 140,
    ...iosDisplayTextStyle(142, 140),
  },
  nothingTitle: { color: YELLOW, fontFamily: "Anton_400Regular", fontSize: 39, lineHeight: 42 },
  nothingSubtitle: { color: "#FFFFFF", fontFamily: "Archivo_400Regular", fontSize: 11, marginTop: -3 },
  skeleton: { opacity: 0.45 },
  errorWrap: {
    height: CARD_HEIGHT, alignItems: "center", justifyContent: "center", marginHorizontal: 34,
    borderRadius: 28, backgroundColor: CARD_BG,
  },
  errorTitle: { color: YELLOW, fontFamily: "Anton_400Regular", fontSize: 24 },
  errorText: { color: "#FFFFFF", fontFamily: "Archivo_400Regular", fontSize: 12, marginTop: 4 },
});
