import { GlassView } from "expo-glass-effect";
import * as Haptics from "expo-haptics";
import { Image as ExpoImage } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
  Image,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";

import DiscoveryClassCard, { type DiscoveryStyleIcon } from "@/components/DiscoveryClassCard";
import CentralBackButton from "@/components/CentralBackButton";
import type { DanceClass, Instructor } from "@/data/mockData";

const CYAN = "#00B6D7";
const BLACK = "#000000";
const STUDIO_LOGO = require("@/assets/images/central_studio_logo_transparent.png");

export type InstructorScheduleCard = {
  item: DanceClass;
  instructor?: Instructor;
  styleIcon?: DiscoveryStyleIcon;
};

export type InstructorProfileModel = {
  name: string;
  bio: string;
  photoUrl?: string | null;
  experienceYears: number | string;
  classCount: number | string;
  studentCount: number | string;
  specialties: string[];
  achievements: string[];
  professionalExperience?: string[];
};

type Props = {
  profile: InstructorProfileModel;
  classes: InstructorScheduleCard[];
  refreshing?: boolean;
  onRefresh?: () => void;
  onSelectClass: (item: DanceClass) => void;
  onBookClass: (item: DanceClass) => void;
};

function AchievementIcon() {
  return (
    <Svg width={16} height={20} viewBox="0 0 16 20" fill="none">
      <Path d="M7.11654 13.2111L6.40975 12.5749L5.42017 12.7163C4.78398 12.787 4.14787 12.3629 4.00651 11.7267L3.86515 10.8079H3.79448L1.60327 15.1902L4.14787 14.8368L5.42017 17.0987L7.2579 13.3525C7.18722 13.2818 7.18722 13.2818 7.11654 13.2111Z" fill="white" />
      <Path d="M12.1349 10.8079L11.9229 11.7267C11.7815 12.2922 11.2868 12.7163 10.7213 12.7163H10.5799L9.59034 12.5749L8.88355 13.2111L8.74219 13.3525L10.5799 17.0987L11.8522 14.9075L14.3968 15.2609L12.1349 10.8079Z" fill="white" />
      <Path d="M12.6298 6.07209L11.4282 5.50659L11.2162 4.23429C11.1454 3.95157 10.8627 3.73953 10.58 3.81021L9.23698 4.02225L8.2474 3.10342C8.03536 2.89131 7.68197 2.89131 7.46993 3.10342L6.48035 4.02225L5.34941 3.81021C4.99601 3.73953 4.7839 3.95157 4.71322 4.23429L4.50118 5.50659L3.29956 6.07209C3.01685 6.21345 2.94617 6.49617 3.08752 6.77888L3.65303 7.90983L3.08752 9.04077C2.94617 9.32348 3.08752 9.60628 3.29956 9.74763L4.50118 10.3131L4.71322 11.5854C4.7839 11.8682 5.06669 12.0802 5.34941 12.0095L6.69239 11.7974L7.68197 12.7163C7.89401 12.9283 8.2474 12.9283 8.45944 12.7163L9.44902 11.7974L10.792 12.0095C11.0747 12.0802 11.3575 11.8682 11.4282 11.5854L11.6402 10.3131L12.8418 9.74763C13.1246 9.60628 13.1952 9.32348 13.0539 9.04077L12.2763 7.90983L12.8418 6.77888C12.9832 6.49617 12.9125 6.21345 12.6298 6.07209Z" fill="white" />
    </Svg>
  );
}

function splitName(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return { first: words[0] || "Instructor", rest: words.slice(1).join(" ") };
}

function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <View style={styles.statCard}>
      <GlassView
        glassEffectStyle="clear"
        tintColor="rgba(255,255,255,0.13)"
        colorScheme="dark"
        pointerEvents="none"
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.statContent}>
        <Text style={styles.statLabel}>{label}</Text>
        <View style={styles.statRule} />
        <Text style={styles.statValue}>{value}</Text>
      </View>
    </View>
  );
}

export default function InstructorProfileView({
  profile,
  classes,
  refreshing = false,
  onRefresh,
  onSelectClass,
  onBookClass,
}: Props) {
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === "web" ? 18 : insets.top + 10;
  const [imageFailed, setImageFailed] = useState(false);
  const name = useMemo(() => splitName(profile.name), [profile.name]);
  const bulletItems = profile.professionalExperience?.length
    ? profile.professionalExperience
    : profile.achievements;

  useEffect(() => setImageFailed(false), [profile.photoUrl]);

  return (
    <View style={styles.screen}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        bounces
        refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={CYAN} colors={[CYAN]} /> : undefined}
        contentContainerStyle={{ paddingBottom: Platform.OS === "web" ? 80 : Math.max(34, insets.bottom + 24) }}
      >
        <View style={styles.hero}>
          {profile.photoUrl && !imageFailed ? (
            <ExpoImage
              source={{ uri: profile.photoUrl }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              contentPosition="top center"
              transition={180}
              onError={() => setImageFailed(true)}
            />
          ) : (
            <LinearGradient colors={["#173F46", "#061215", BLACK]} locations={[0, 0.52, 1]} style={StyleSheet.absoluteFill} />
          )}
          <LinearGradient
            colors={["rgba(0,0,0,0.06)", "rgba(0,0,0,0.04)", "rgba(0,0,0,0.96)"]}
            locations={[0, 0.58, 1]}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />

          <View style={[styles.nav, { top: topPad }]}>
            <CentralBackButton />
            <Image source={STUDIO_LOGO} resizeMode="contain" style={styles.logo} />
          </View>

          <Text style={styles.name} numberOfLines={2} adjustsFontSizeToFit>
            <Text style={styles.firstName}>{name.first}</Text>
            {name.rest ? <Text style={styles.lastName}> {name.rest}</Text> : null}
          </Text>

          <View style={styles.statsRow}>
            <StatCard label="Experience" value={profile.experienceYears} />
            <StatCard label="Classes" value={profile.classCount} />
            <StatCard label="Students" value={profile.studentCount} />
          </View>
        </View>

        <View style={styles.bioCard}>
          <Text style={styles.bioTitle}>Bio</Text>
          <Text style={styles.bio}>{profile.bio || "No biography provided."}</Text>

          <Text style={styles.specialtiesTitle}>Specialties</Text>
          <View style={styles.specialties}>
            {profile.specialties.length > 0 ? profile.specialties.map((specialty) => (
              <View key={specialty} style={styles.specialtyChip}>
                <Text style={styles.specialtyText}>{specialty}</Text>
              </View>
            )) : <Text style={styles.bio}>Not specified</Text>}
          </View>
        </View>

        {bulletItems.length > 0 ? (
          <View style={styles.plainSection}>
            <Text style={styles.sectionTitle}>Achievements</Text>
            {bulletItems.map((item, index) => (
              <View key={`${item}-${index}`} style={styles.bulletRow}>
                <Text style={styles.bullet}>•</Text>
                <Text style={styles.bulletText}>{item}</Text>
              </View>
            ))}
          </View>
        ) : null}

        <View style={styles.scheduleSection}>
          <Text style={styles.sectionTitle}>Weekly Schedule</Text>
          {classes.length > 0 ? (
            <View style={styles.classList}>
              {classes.map(({ item, instructor, styleIcon }) => (
                <DiscoveryClassCard
                  key={`${item.id}-${item.scheduleId ?? item.date}`}
                  item={item}
                  instructor={instructor}
                  styleIcon={styleIcon}
                  onSelect={(classItem) => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    onSelectClass(classItem);
                  }}
                  onBook={(classItem) => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                    onBookClass(classItem);
                  }}
                />
              ))}
            </View>
          ) : (
            <Text style={styles.emptyText}>No classes scheduled for this instructor.</Text>
          )}
        </View>

        {profile.achievements.length > 0 ? (
          <View style={styles.achievementSection}>
            <Text style={styles.sectionTitle}>Achievements</Text>
            <View style={styles.achievementList}>
              {profile.achievements.map((achievement, index) => (
                <View key={`${achievement}-${index}`} style={styles.achievementCard}>
                  <AchievementIcon />
                  <Text style={styles.achievementText}>{achievement}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BLACK },
  hero: { height: 500, backgroundColor: BLACK },
  nav: { position: "absolute", left: 16, right: 28, flexDirection: "row", alignItems: "center", justifyContent: "space-between", zIndex: 5 },
  logo: { width: 66, height: 45 },
  name: { position: "absolute", left: "9%", right: "8%", bottom: 103, fontFamily: "Anton_400Regular", fontSize: 38, lineHeight: 42, textTransform: "uppercase" },
  firstName: { color: CYAN },
  lastName: { color: "#FFFFFF" },
  statsRow: { position: "absolute", left: "9%", right: "9%", bottom: -56, height: 142, zIndex: 4, flexDirection: "row", gap: 9 },
  statCard: { flex: 1, borderRadius: 16, overflow: "hidden", backgroundColor: "rgba(255,255,255,0.08)" },
  statContent: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 7 },
  statLabel: { color: "#FFFFFF", fontFamily: "Anton_400Regular", fontSize: 15, lineHeight: 18, textTransform: "uppercase", textAlign: "center" },
  statRule: { width: "72%", height: 1, backgroundColor: "rgba(255,255,255,0.84)", marginTop: 17, marginBottom: 17 },
  statValue: { color: "#FFFFFF", fontFamily: "Anton_400Regular", fontSize: 34, lineHeight: 38, textAlign: "center" },
  bioCard: { width: "88%", alignSelf: "center", minHeight: 250, borderRadius: 18, backgroundColor: CYAN, paddingHorizontal: 18, paddingTop: 76, paddingBottom: 23 },
  bioTitle: { color: "#FFFFFF", fontFamily: "Archivo_700Bold", fontSize: 17, lineHeight: 21 },
  bio: { color: "#FFFFFF", fontFamily: "Archivo_400Regular", fontSize: 13.5, lineHeight: 17, marginTop: 6 },
  specialtiesTitle: { color: "#FFFFFF", fontFamily: "Archivo_700Bold", fontSize: 17, lineHeight: 21, marginTop: 18 },
  specialties: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 8 },
  specialtyChip: { minHeight: 29, paddingHorizontal: 13, borderRadius: 999, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center" },
  specialtyText: { color: CYAN, fontFamily: "Archivo_500Medium", fontSize: 11.5 },
  plainSection: { width: "86%", alignSelf: "center", marginTop: 18 },
  sectionTitle: { color: "#FFFFFF", fontFamily: "Archivo_700Bold", fontSize: 17, lineHeight: 21, marginBottom: 8 },
  bulletRow: { flexDirection: "row", alignItems: "flex-start", gap: 7, paddingHorizontal: 8 },
  bullet: { color: "#FFFFFF", fontFamily: "Archivo_700Bold", fontSize: 13, lineHeight: 17 },
  bulletText: { flex: 1, color: "#D6D7D9", fontFamily: "Archivo_400Regular", fontSize: 12.5, lineHeight: 16 },
  scheduleSection: { width: "86%", alignSelf: "center", marginTop: 18 },
  classList: { gap: 14 },
  emptyText: { color: "#8E949B", fontFamily: "Archivo_400Regular", fontSize: 13, fontStyle: "italic" },
  achievementSection: { width: "86%", alignSelf: "center", marginTop: 18 },
  achievementList: { gap: 8 },
  achievementCard: { minHeight: 53, borderRadius: 15, backgroundColor: CYAN, paddingHorizontal: 17, paddingVertical: 10, flexDirection: "row", alignItems: "center", gap: 11 },
  achievementText: { flex: 1, color: "#FFFFFF", fontFamily: "Archivo_700Bold", fontSize: 12.5, lineHeight: 14 },
});
