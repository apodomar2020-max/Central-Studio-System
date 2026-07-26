import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import React, { useMemo, useState } from "react";
import {
  FlatList,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";

import { SkeletonBox } from "@/components/SkeletonLoader";
import { BA, BA_RADIUS } from "./assessmentTokens";
import {
  shouldShowAddBalletChildCard,
  type BalletStudentPreview,
  type BalletStudentPreviewDetailKind,
} from "./balletStudentPreviewModel";

const CARD_GAP = 12;
const BALLERINA_ARTWORK = require("../../assets/images/ballerina-card.png");

const STATUS_TONE_COLORS = {
  pending: BA.ink300,
  warning: BA.amber,
  accepted: BA.success,
  progress: BA.cyan400,
  active: BA.cyan400,
} as const;

const DETAIL_ICONS: Record<BalletStudentPreviewDetailKind, React.ComponentProps<typeof Ionicons>["name"]> = {
  assessment: "calendar-outline",
  package: "cube-outline",
  payment: "wallet-outline",
  level: "ribbon-outline",
  group: "people-outline",
  classes: "calendar-outline",
  subscription: "checkmark-circle-outline",
};

type CarouselItem =
  | { kind: "student"; key: string; student: BalletStudentPreview }
  | { kind: "addChild"; key: "add-child" };

function DetailRow({
  icon,
  label,
  value,
  last,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
  value: string;
  last?: boolean;
}) {
  return (
    <View style={[styles.detailRow, last && styles.detailRowLast]}>
      <Ionicons name={icon} size={14} color={BA.cyan400} style={styles.detailIcon} />
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

export function BalletStudentPreviewCard({
  student,
  width,
}: {
  student: BalletStudentPreview;
  width: number;
}) {
  const statusColor = STATUS_TONE_COLORS[student.statusTone];
  const detailSummary = student.detailRows.map((row) => `${row.label} ${row.value}`).join(". ");

  return (
    <View
      style={[styles.card, { width }]}
      accessibilityLabel={`${student.childName}, ${student.statusLabel}. ${detailSummary}`}
    >
      <View style={styles.cardMain}>
        <View style={styles.visualPanel}>
          <Image
            source={BALLERINA_ARTWORK}
            style={styles.artworkImage}
            resizeMode="cover"
            accessibilityLabel="Ballerina artwork"
          />
        </View>

        <View style={styles.informationPanel}>
          <View style={styles.identity}>
            <Text style={styles.name}>{student.childName}</Text>
            <View style={styles.statusRow}>
              <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
              <Text style={[styles.statusText, { color: statusColor }]}>{student.statusLabel}</Text>
            </View>
            <Text style={styles.identitySubtitle}>Central Studio Ballet Program</Text>
          </View>

          <View style={styles.details}>
            {student.detailRows.map((row, index) => (
              <DetailRow
                key={`${row.kind}:${row.label}`}
                icon={DETAIL_ICONS[row.kind]}
                label={row.label}
                value={row.value}
                last={index === student.detailRows.length - 1}
              />
            ))}
          </View>
        </View>
      </View>

      <View style={styles.footerDivider} />
      <View style={styles.comingSoon}>
        <Ionicons name="information-circle-outline" size={13} color={BA.ink300} />
        <Text style={styles.comingSoonText}>Dedicated child profile coming soon.</Text>
      </View>
    </View>
  );
}

export function AddBalletChildCard({
  width,
  onPress,
}: {
  width: number;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.84}
      accessibilityRole="button"
      accessibilityLabel="Add Another Child. Start a Ballet application for another child."
      style={[styles.card, styles.addCard, { width }]}
    >
      <LinearGradient
        colors={["rgba(0,182,215,0.19)", "rgba(21,23,27,0.96)", BA.ink800]}
        locations={[0, 0.55, 1]}
        style={styles.addCardGradient}
      >
        <View style={styles.addIconWrap}>
          <Ionicons name="add" size={38} color={BA.cyan400} />
        </View>
        <Text style={styles.addTitle}>Add Another Child</Text>
        <Text style={styles.addSubtitle}>Start a Ballet application for another child</Text>
        <View style={styles.addAction}>
          <Text style={styles.addActionText}>Start application</Text>
          <Ionicons name="arrow-forward" size={15} color={BA.cyan400} />
        </View>
      </LinearGradient>
    </TouchableOpacity>
  );
}

export function BalletStudentPreviewSection({
  students,
  loading,
  eligibleChildCount,
  onAddAnotherChild,
}: {
  students: BalletStudentPreview[];
  loading: boolean;
  eligibleChildCount: number;
  onAddAnotherChild: () => void;
}) {
  const { width: viewportWidth } = useWindowDimensions();
  const cardWidth = Math.min(Math.max(viewportWidth - 52, 286), 360);
  const [activeIndex, setActiveIndex] = useState(0);
  const items = useMemo<CarouselItem[]>(() => {
    const studentItems: CarouselItem[] = students.map((student) => ({
      kind: "student",
      key: student.key,
      student,
    }));
    if (shouldShowAddBalletChildCard(students.length, eligibleChildCount)) {
      studentItems.push({ kind: "addChild", key: "add-child" });
    }
    return studentItems;
  }, [eligibleChildCount, students]);

  if (!loading && items.length === 0) return null;

  function handleMomentumEnd(event: NativeSyntheticEvent<NativeScrollEvent>) {
    const nextIndex = Math.round(event.nativeEvent.contentOffset.x / (cardWidth + CARD_GAP));
    setActiveIndex(Math.max(0, Math.min(nextIndex, items.length - 1)));
  }

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeading}>
        <Text style={styles.eyebrow}>ENROLLED DANCERS</Text>
        <Text style={styles.sectionTitle}>Your Ballet Students</Text>
      </View>
      {loading ? (
        <View style={[styles.skeletonCard, { width: cardWidth }]} accessibilityLabel="Loading Ballet students">
          <SkeletonBox width="36%" height={190} borderRadius={14} />
          <View style={styles.skeletonInformation}>
            <SkeletonBox width="86%" height={20} borderRadius={10} />
            <SkeletonBox width="56%" height={12} borderRadius={6} />
            <SkeletonBox width="100%" height={126} borderRadius={10} />
          </View>
        </View>
      ) : (
        <>
          <FlatList
            horizontal
            data={items}
            keyExtractor={(item) => item.key}
            renderItem={({ item }) => item.kind === "student"
              ? <BalletStudentPreviewCard student={item.student} width={cardWidth} />
              : <AddBalletChildCard width={cardWidth} onPress={onAddAnotherChild} />}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.carouselContent}
            ItemSeparatorComponent={() => <View style={{ width: CARD_GAP }} />}
            snapToInterval={cardWidth + CARD_GAP}
            snapToAlignment="start"
            decelerationRate="fast"
            disableIntervalMomentum
            onMomentumScrollEnd={handleMomentumEnd}
            getItemLayout={(_, index) => ({
              length: cardWidth + CARD_GAP,
              offset: (cardWidth + CARD_GAP) * index,
              index,
            })}
          />
          {items.length > 1 ? (
            <View style={styles.pagination} accessibilityLabel={`Carousel page ${activeIndex + 1} of ${items.length}`}>
              {items.map((item, index) => (
                <View key={item.key} style={[styles.paginationDot, index === activeIndex && styles.paginationDotActive]} />
              ))}
            </View>
          ) : null}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    paddingTop: 22,
    paddingBottom: 14,
    backgroundColor: "#000000",
  },
  sectionHeading: { marginBottom: 12, paddingHorizontal: 20 },
  eyebrow: {
    color: BA.cyan400,
    fontFamily: "SpaceMono_700Bold",
    fontSize: 10,
    letterSpacing: 1.3,
    marginBottom: 4,
  },
  sectionTitle: {
    color: BA.white,
    fontFamily: "Archivo_800ExtraBold",
    fontSize: 21,
    lineHeight: 26,
  },
  carouselContent: { paddingHorizontal: 20 },
  card: {
    minWidth: 0,
    alignSelf: "flex-start",
    overflow: "hidden",
    borderRadius: BA_RADIUS.xl,
    borderWidth: 1,
    borderColor: "rgba(45,205,236,0.42)",
    backgroundColor: BA.ink800,
    shadowColor: BA.cyan500,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.14,
    shadowRadius: 16,
    elevation: 3,
  },
  cardMain: { flexDirection: "row", alignItems: "stretch", minWidth: 0 },
  visualPanel: {
    position: "relative",
    width: "36%",
    minWidth: 0,
    alignSelf: "stretch",
    overflow: "hidden",
    backgroundColor: "rgba(2,11,15,0.88)",
  },
  artworkImage: { flex: 1, width: "100%", height: "100%" },
  informationPanel: {
    flex: 1,
    minWidth: 0,
    // Sized for the normal 4-row Active layout (identity block + 4 detail
    // rows) so pending/shorter-content cards match Active card height via
    // visualPanel's alignSelf: "stretch" instead of the card growing to fit
    // fabricated content. The footer stays outside this region.
    minHeight: 200,
    paddingTop: 12,
    paddingRight: 12,
    paddingBottom: 10,
    paddingLeft: 12,
  },
  identity: { minWidth: 0, marginBottom: 8 },
  name: {
    color: BA.white,
    fontFamily: "Archivo_800ExtraBold",
    fontSize: 18,
    lineHeight: 21,
    flexShrink: 1,
  },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 3 },
  statusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: BA.cyan400 },
  statusText: {
    color: BA.cyan400,
    fontFamily: "SpaceMono_700Bold",
    fontSize: 9,
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  identitySubtitle: {
    color: BA.ink300,
    fontFamily: "Archivo_400Regular",
    fontSize: 9.5,
    lineHeight: 13,
    marginTop: 3,
  },
  details: {},
  detailRow: {
    minWidth: 0,
    minHeight: 29,
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.09)",
    paddingVertical: 5,
  },
  detailRowLast: { borderBottomWidth: 0 },
  detailIcon: { width: 19, flexShrink: 0 },
  detailLabel: {
    color: BA.ink300,
    fontFamily: "Archivo_400Regular",
    fontSize: 9.5,
    lineHeight: 13,
    flexShrink: 0,
  },
  detailValue: {
    color: BA.white,
    fontFamily: "Archivo_600SemiBold",
    fontSize: 10.5,
    lineHeight: 13,
    marginLeft: "auto",
    paddingLeft: 6,
    textAlign: "right",
    minWidth: 0,
    flex: 1,
    flexShrink: 1,
  },
  footerDivider: { height: 1, backgroundColor: "rgba(45,205,236,0.16)" },
  comingSoon: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  comingSoonText: {
    color: BA.ink300,
    fontFamily: "Archivo_400Regular",
    fontSize: 10,
    lineHeight: 14,
    textAlign: "center",
    flexShrink: 1,
  },
  addCard: { padding: 0 },
  addCardGradient: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  addIconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: BA.cyan400,
    backgroundColor: "rgba(0,182,215,0.10)",
    marginBottom: 16,
  },
  addTitle: {
    color: BA.white,
    fontFamily: "Archivo_800ExtraBold",
    fontSize: 21,
    lineHeight: 26,
    textAlign: "center",
  },
  addSubtitle: {
    color: BA.ink300,
    fontFamily: "Archivo_400Regular",
    fontSize: 12.5,
    lineHeight: 18,
    textAlign: "center",
    marginTop: 5,
  },
  addAction: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 16 },
  addActionText: {
    color: BA.cyan400,
    fontFamily: "Archivo_700Bold",
    fontSize: 12,
  },
  pagination: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginTop: 10,
  },
  paginationDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "rgba(255,255,255,0.20)",
  },
  paginationDotActive: { width: 18, backgroundColor: BA.cyan400 },
  skeletonCard: {
    height: 266,
    marginHorizontal: 20,
    padding: 12,
    flexDirection: "row",
    gap: 12,
    borderRadius: BA_RADIUS.xl,
    borderWidth: 1,
    borderColor: "rgba(45,205,236,0.20)",
    backgroundColor: BA.ink800,
  },
  skeletonInformation: { flex: 1, gap: 10, paddingVertical: 8 },
});
