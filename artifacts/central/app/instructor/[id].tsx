import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import React from "react";
import {
  ActivityIndicator,
  Image,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useGetInstructor } from "@workspace/api-client-react";

import { mapApiInstructorToMobile } from "@/data/apiAdapters";
import colors from "@/constants/colors";

export default function InstructorDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();

  const numericId = Number(id);
  const query = useGetInstructor(numericId, {
    query: { enabled: !!id && !isNaN(numericId) },
  });

  const instructor = query.data ? mapApiInstructorToMobile(query.data) : null;
  // Extra fields directly from the API (not mapped to the mobile model)
  const apiData = query.data;

  if (query.isLoading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color={colors.studio.primary} />
      </View>
    );
  }

  if (query.isError || !instructor) {
    return (
      <View style={[styles.container, styles.centered]}>
        <Ionicons name="alert-circle-outline" size={48} color="#6B7280" />
        <Text style={styles.errorText}>
          {query.isError ? "Couldn't load instructor — check your connection" : "Instructor not found"}
        </Text>
        <TouchableOpacity onPress={() => router.back()} style={{ marginTop: 16 }}>
          <Text style={{ color: colors.studio.primary, fontFamily: "Inter_600SemiBold" }}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const accentColor = instructor.photoColor;
  const achievements: string[] = (apiData as any)?.achievements ?? [];
  const teachingLevel: string | null = (apiData as any)?.teachingLevel ?? null;
  const instagramUrl: string | null = (apiData as any)?.instagramUrl ?? null;
  const tiktokUrl: string | null = (apiData as any)?.tiktokUrl ?? null;
  const youtubeUrl: string | null = (apiData as any)?.youtubeUrl ?? null;
  const hasSocial = instagramUrl || tiktokUrl || youtubeUrl;

  return (
    <View style={styles.container}>
      {/* Hero banner */}
      <View style={[styles.heroBg, { height: Platform.OS === "web" ? 260 : 260 + insets.top }]}>
        {instructor.photoUrl ? (
          <Image
            source={{ uri: instructor.photoUrl }}
            style={StyleSheet.absoluteFill}
            resizeMode="cover"
          />
        ) : (
          <LinearGradient
            colors={[accentColor + "CC", accentColor + "33", "#0B0B12"]}
            start={{ x: 0.2, y: 0 }}
            end={{ x: 0.8, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
        )}
        <LinearGradient
          colors={["rgba(0,0,0,0.0)", "rgba(0,0,0,0.75)", "rgba(11,11,18,1)"]}
          locations={[0.3, 0.7, 1]}
          style={StyleSheet.absoluteFill}
        />

        {/* Back button */}
        <TouchableOpacity
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.back(); }}
          style={[styles.backBtn, { top: Platform.OS === "web" ? 16 : insets.top + 8 }]}
        >
          <Ionicons name="arrow-back" size={20} color="#FFFFFF" />
        </TouchableOpacity>

        {/* Name / title overlay */}
        <View style={[styles.heroInfo, { paddingBottom: 24 }]}>
          {!instructor.photoUrl && (
            <View style={[styles.initialsCircle, { backgroundColor: accentColor + "30", borderColor: accentColor + "60" }]}>
              <Text style={[styles.initialsText, { color: accentColor }]}>{instructor.initials}</Text>
            </View>
          )}
          <Text style={styles.instructorName}>{instructor.name}</Text>
          <Text style={[styles.instructorTitle, { color: accentColor }]}>{instructor.title}</Text>
          <View style={styles.heroMeta}>
            {instructor.rating > 0 && (
              <View style={styles.ratingRow}>
                <Ionicons name="star" size={14} color="#FBBF24" />
                <Text style={styles.ratingText}>{instructor.rating.toFixed(1)}</Text>
              </View>
            )}
            {teachingLevel ? (
              <View style={styles.levelBadge}>
                <Text style={styles.levelText}>{teachingLevel}</Text>
              </View>
            ) : null}
          </View>
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingBottom: Platform.OS === "web" ? 120 : 90 }]}
      >
        {/* Bio */}
        {instructor.bio ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>About</Text>
            <Text style={styles.bioText}>{instructor.bio}</Text>
          </View>
        ) : null}

        {/* Dance Styles */}
        {instructor.danceStyles.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Dance Styles</Text>
            <View style={styles.pillRow}>
              {instructor.danceStyles.map((style) => (
                <View key={style} style={[styles.pill, { backgroundColor: accentColor + "18", borderColor: accentColor + "50" }]}>
                  <Text style={[styles.pillText, { color: accentColor }]}>{style}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Achievements */}
        {achievements.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Achievements</Text>
            {achievements.map((ach, i) => (
              <View key={i} style={styles.achievementRow}>
                <Ionicons name="trophy-outline" size={16} color="#FBBF24" />
                <Text style={styles.achievementText}>{ach}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Stats row */}
        <View style={styles.statsRow}>
          {instructor.rating > 0 && (
            <View style={[styles.statCard, { borderColor: "#FBBF24" + "30" }]}>
              <Ionicons name="star" size={22} color="#FBBF24" />
              <Text style={[styles.statValue, { color: "#FBBF24" }]}>{instructor.rating.toFixed(1)}</Text>
              <Text style={styles.statLabel}>Rating</Text>
            </View>
          )}
          {instructor.totalClasses > 0 && (
            <View style={[styles.statCard, { borderColor: accentColor + "30" }]}>
              <Ionicons name="time-outline" size={22} color={accentColor} />
              <Text style={[styles.statValue, { color: accentColor }]}>{instructor.totalClasses}</Text>
              <Text style={styles.statLabel}>Yrs Exp.</Text>
            </View>
          )}
          {instructor.danceStyles.length > 0 && (
            <View style={[styles.statCard, { borderColor: colors.studio.primary + "30" }]}>
              <Ionicons name="musical-notes-outline" size={22} color={colors.studio.primary} />
              <Text style={[styles.statValue, { color: colors.studio.primary }]}>{instructor.danceStyles.length}</Text>
              <Text style={styles.statLabel}>Styles</Text>
            </View>
          )}
        </View>

        {/* Social Media */}
        {hasSocial && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Follow</Text>
            <View style={styles.socialRow}>
              {instagramUrl && (
                <TouchableOpacity
                  style={[styles.socialBtn, { backgroundColor: "#E1306C20", borderColor: "#E1306C50" }]}
                  onPress={() => Linking.openURL(instagramUrl)}
                >
                  <Ionicons name="logo-instagram" size={20} color="#E1306C" />
                  <Text style={[styles.socialLabel, { color: "#E1306C" }]}>Instagram</Text>
                </TouchableOpacity>
              )}
              {tiktokUrl && (
                <TouchableOpacity
                  style={[styles.socialBtn, { backgroundColor: "#ffffff15", borderColor: "#ffffff30" }]}
                  onPress={() => Linking.openURL(tiktokUrl)}
                >
                  <Ionicons name="logo-tiktok" size={20} color="#FFFFFF" />
                  <Text style={[styles.socialLabel, { color: "#FFFFFF" }]}>TikTok</Text>
                </TouchableOpacity>
              )}
              {youtubeUrl && (
                <TouchableOpacity
                  style={[styles.socialBtn, { backgroundColor: "#FF000020", borderColor: "#FF000050" }]}
                  onPress={() => Linking.openURL(youtubeUrl)}
                >
                  <Ionicons name="logo-youtube" size={20} color="#FF0000" />
                  <Text style={[styles.socialLabel, { color: "#FF0000" }]}>YouTube</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}

        {/* CTA */}
        <TouchableOpacity
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            router.push("/(tabs)/classes");
          }}
          style={[styles.ctaBtn, { backgroundColor: accentColor }]}
        >
          <Text style={styles.ctaBtnText}>Browse Classes</Text>
          <Ionicons name="arrow-forward" size={18} color="#000" />
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0B0B12" },
  centered: { alignItems: "center", justifyContent: "center" },
  errorText: {
    color: "#9CA3AF", fontFamily: "Inter_400Regular",
    marginTop: 8, textAlign: "center", paddingHorizontal: 32,
  },

  heroBg: { width: "100%", justifyContent: "flex-end" },
  backBtn: {
    position: "absolute", left: 16,
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center", justifyContent: "center",
    zIndex: 10,
  },
  heroInfo: { paddingHorizontal: 20, gap: 4 },
  heroMeta: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 },
  initialsCircle: {
    width: 72, height: 72, borderRadius: 36,
    borderWidth: 2,
    alignItems: "center", justifyContent: "center",
    marginBottom: 10,
  },
  initialsText: { fontSize: 28, fontFamily: "Inter_700Bold" },
  instructorName: { fontSize: 28, fontFamily: "Inter_700Bold", color: "#FFFFFF" },
  instructorTitle: { fontSize: 14, fontFamily: "Inter_500Medium", marginTop: 2 },
  ratingRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  ratingText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#FBBF24" },
  levelBadge: { backgroundColor: "rgba(255,255,255,0.12)", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  levelText: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: "#D1D5DB" },

  scroll: { paddingTop: 24, paddingHorizontal: 20 },
  section: { marginBottom: 24 },
  sectionTitle: { fontSize: 13, fontFamily: "Inter_700Bold", color: "#9CA3AF", letterSpacing: 1, textTransform: "uppercase", marginBottom: 10 },
  bioText: { fontSize: 15, fontFamily: "Inter_400Regular", color: "#D1D5DB", lineHeight: 24 },

  pillRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  pill: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 50, borderWidth: 1 },
  pillText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },

  achievementRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  achievementText: { fontSize: 14, fontFamily: "Inter_400Regular", color: "#D1D5DB", flex: 1 },

  statsRow: { flexDirection: "row", gap: 12, marginBottom: 28 },
  statCard: {
    flex: 1, borderRadius: 16, borderWidth: 1,
    backgroundColor: "#111318",
    paddingVertical: 18, alignItems: "center", gap: 6,
  },
  statValue: { fontSize: 22, fontFamily: "Inter_700Bold" },
  statLabel: { fontSize: 11, fontFamily: "Inter_400Regular", color: "#9CA3AF" },

  socialRow: { flexDirection: "row", gap: 10, flexWrap: "wrap" },
  socialBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, borderWidth: 1,
  },
  socialLabel: { fontSize: 13, fontFamily: "Inter_600SemiBold" },

  ctaBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, paddingVertical: 16, borderRadius: 14, marginBottom: 12,
  },
  ctaBtnText: { fontSize: 16, fontFamily: "Inter_700Bold", color: "#000" },
});
