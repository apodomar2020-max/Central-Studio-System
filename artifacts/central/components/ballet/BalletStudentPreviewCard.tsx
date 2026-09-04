import { Ionicons } from "@expo/vector-icons";
import { Image as ExpoImage } from "expo-image";
import React, { useMemo, useState } from "react";
import {
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import Svg, { Path } from "react-native-svg";

import { SkeletonBox } from "@/components/SkeletonLoader";
import { shouldShowAddBalletChildCard, type BalletStudentPreview } from "./balletStudentPreviewModel";

const CYAN = "#03B6D7";
const CARD_GAP = 8;
const CARD_HEIGHT = 84;
const BALLERINA_ARTWORK = require("../../assets/images/ballerina-card.png");
const STATUS_COLORS = {
  pending: "#F1B40B",
  warning: "#F1B40B",
  accepted: "#22C55E",
  progress: CYAN,
  active: "#22C55E",
} as const;

type CarouselItem =
  | { kind: "student"; key: string; student: BalletStudentPreview }
  | { kind: "addChild"; key: "add-child" };

function AddIcon() {
  return (
    <Svg width={34} height={34} viewBox="0 0 32 32" fill="none">
      <Path d="M20.209 15.7902H11.1125M15.6608 11.2031V20.3773" stroke="#FFFFFF" strokeLinecap="round" />
      <Path d="M8.08036 2.54557C10.3103 1.24459 12.8993.5 15.6607.5C24.0337.5 30.8214 7.3457 30.8214 15.7903C30.8214 24.2348 24.0337 31.0806 15.6607 31.0806C7.28768 31.0806.5 24.2348.5 15.7903C.5 13.0053 1.23828 10.3942 2.52823 8.14515" stroke="#FFFFFF" strokeLinecap="round" />
    </Svg>
  );
}

function StudentCard({ student, width, onOpen }: {
  student: BalletStudentPreview;
  width: number;
  onOpen?: (student: BalletStudentPreview) => void;
}) {
  const statusColor = STATUS_COLORS[student.statusTone];
  const content = (
    <>
      <ExpoImage source={BALLERINA_ARTWORK} style={styles.avatar} contentFit="cover" contentPosition="top" />
      <View style={styles.identityCopy}>
        <Text style={styles.studentName} numberOfLines={1}>{student.childName}</Text>
        <View style={[styles.statusPill, { backgroundColor: `${statusColor}28` }]}>
          <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
          <Text style={[styles.statusText, { color: statusColor }]} numberOfLines={1}>{student.statusLabel.replace("Application ", "")}</Text>
        </View>
      </View>
    </>
  );

  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={`Open ${student.childName}'s Ballet application`}
      activeOpacity={0.86}
      onPress={() => onOpen?.(student)}
      style={[styles.studentCardShadow, { width, height: CARD_HEIGHT }]}
    >
      <View style={styles.studentCard}>{content}</View>
    </TouchableOpacity>
  );
}

function AddChildCard({ width, onPress }: { width: number; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.84} style={[styles.addCard, { width }]}>
      <AddIcon />
      <View style={styles.addCopy}>
        <Text style={styles.addTitle}>Add Another Child</Text>
        <Text style={styles.addSubtitle} numberOfLines={1}>Start a ballet application for another child</Text>
      </View>
      <Ionicons name="arrow-forward" color="#FFFFFF" size={30} />
    </TouchableOpacity>
  );
}

export function BalletStudentPreviewSection({
  students,
  loading,
  eligibleChildCount,
  onAddAnotherChild,
  onOpenStudent,
}: {
  students: BalletStudentPreview[];
  loading: boolean;
  eligibleChildCount: number;
  onAddAnotherChild: () => void;
  onOpenStudent?: (student: BalletStudentPreview) => void;
}) {
  const { width: viewportWidth } = useWindowDimensions();
  const cardWidth = Math.min(Math.max(viewportWidth * 0.68, 264), 300);
  const [activeIndex, setActiveIndex] = useState(0);
  const items = useMemo<CarouselItem[]>(() => {
    const list: CarouselItem[] = students.map((student) => ({ kind: "student", key: student.key, student }));
    if (students.length === 0 || shouldShowAddBalletChildCard(students.length, eligibleChildCount)) list.push({ kind: "addChild", key: "add-child" });
    return list;
  }, [eligibleChildCount, students]);

  if (!loading && items.length === 0) return null;

  function handleMomentumEnd(event: NativeSyntheticEvent<NativeScrollEvent>) {
    setActiveIndex(Math.max(0, Math.min(Math.round(event.nativeEvent.contentOffset.x / (cardWidth + CARD_GAP)), items.length - 1)));
  }

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Your Ballet Students</Text>
      {loading ? (
        <View style={[styles.skeletonCard, { width: cardWidth }]}><SkeletonBox width="100%" height={CARD_HEIGHT} borderRadius={20} /></View>
      ) : (
        <>
          <FlatList
            horizontal
            data={items}
            keyExtractor={(item) => item.key}
            renderItem={({ item }) => item.kind === "student"
              ? <StudentCard student={item.student} width={cardWidth} onOpen={onOpenStudent} />
              : <AddChildCard width={cardWidth} onPress={onAddAnotherChild} />}
            contentContainerStyle={styles.carouselContent}
            ItemSeparatorComponent={() => <View style={{ width: CARD_GAP }} />}
            showsHorizontalScrollIndicator={false}
            snapToInterval={cardWidth + CARD_GAP}
            decelerationRate="fast"
            onMomentumScrollEnd={handleMomentumEnd}
          />
          {items.length > 1 ? (
            <View style={styles.pagination}>
              {items.map((item, index) => <View key={item.key} style={[styles.paginationDot, index === activeIndex && styles.paginationDotActive]} />)}
            </View>
          ) : <View style={styles.singleCardSpace} />}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { backgroundColor: "#000000", paddingTop: 8, paddingBottom: 1 },
  sectionTitle: { color: "#FFFFFF", fontFamily: "Archivo_700Bold", fontSize: 17, lineHeight: 21, marginBottom: 8, paddingHorizontal: 16 },
  carouselContent: { paddingLeft: 16, paddingRight: 3 },
  studentCardShadow: { borderRadius: 20, backgroundColor: "#031416", shadowColor: CYAN, shadowOpacity: 0.2, shadowRadius: 7, shadowOffset: { width: 0, height: 1 }, elevation: 3 },
  studentCard: { height: CARD_HEIGHT, borderRadius: 20, backgroundColor: "#031416", paddingHorizontal: 15, flexDirection: "row", alignItems: "center", gap: 9 },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: "#08343E", borderWidth: 1, borderColor: "rgba(3,182,215,0.34)" },
  identityCopy: { flex: 1, minWidth: 0 },
  studentName: { color: CYAN, fontFamily: "Anton_400Regular", fontSize: 18, lineHeight: 22 },
  statusPill: { alignSelf: "flex-start", maxWidth: "100%", flexDirection: "row", alignItems: "center", gap: 4, borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2, marginTop: 2 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { flexShrink: 1, fontFamily: "Archivo_600SemiBold", fontSize: 8.5, lineHeight: 11 },
  addCard: { height: CARD_HEIGHT, borderRadius: 20, borderWidth: 1.25, borderColor: CYAN, backgroundColor: "#042F34", paddingHorizontal: 18, flexDirection: "row", alignItems: "center", gap: 10 },
  addCopy: { flex: 1, minWidth: 0 },
  addTitle: { color: "#FFFFFF", fontFamily: "Anton_400Regular", fontSize: 17, lineHeight: 22 },
  addSubtitle: { color: "#FFFFFF", fontFamily: "Archivo_400Regular", fontSize: 7, lineHeight: 9, opacity: 0.92 },
  pagination: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 9, height: 26 },
  paginationDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: "#D9D9D9" },
  paginationDotActive: { width: 26, backgroundColor: CYAN },
  singleCardSpace: { height: 10 },
  skeletonCard: { marginLeft: 16, marginBottom: 18 },
});
