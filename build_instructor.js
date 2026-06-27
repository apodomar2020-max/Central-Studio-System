const fs = require('fs');
const path = require('path');

const newCode = `import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import React, { useState, useMemo } from "react";
import {
  Image,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import {
  useGetInstructor,
  useListClasses,
  useListSchedules,
} from "@workspace/api-client-react";

import { mapApiInstructorToMobile } from "@/data/apiAdapters";
import colors from "@/constants/colors";
import { DetailSkeleton } from "@/components/SkeletonLoader";
import OfflineState from "@/components/OfflineState";
import ErrorState from "@/components/ErrorState";
import { isOfflineError } from "@/services/connectivity";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const ORDERED_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function ISection({ title, children, action }: { title: string, children: React.ReactNode, action?: { label: string, onClick: () => void } }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeaderRow}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {action && (
          <TouchableOpacity onPress={action.onClick} style={styles.sectionActionBtn}>
            <Text style={styles.sectionActionText}>{action.label}</Text>
            <Ionicons name="chevron-forward" size={14} color="rgba(255,255,255,0.4)" />
          </TouchableOpacity>
        )}
      </View>
      {children}
    </View>
  );
}

function formatTime(timeStr: string): string {
  if (!timeStr) return "";
  const [hoursStr = "0", minsStr = "00"] = timeStr.split(":");
  const hours = parseInt(hoursStr, 10);
  const ampm = hours >= 12 ? "PM" : "AM";
  const h = hours % 12 || 12;
  return \`\${h}:\${minsStr} \${ampm}\`;
}

function durationMinsText(start: string, end: string): string {
  if (!start || !end) return "";
  const [h1, m1] = start.split(":").map(Number);
  const [h2, m2] = end.split(":").map(Number);
  let d = (h2 * 60 + m2) - (h1 * 60 + m1);
  if (d < 0) d += 24 * 60;
  return \`\${d} min\`;
}

export default function InstructorDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const [imageFailed, setImageFailed] = useState(false);

  const numericId = Number(id);
  const query = useGetInstructor(numericId, {
    // @ts-ignore
    query: { enabled: !!id && !isNaN(numericId) },
  });

  const { data: allClasses } = useListClasses();
  const { data: allSchedules } = useListSchedules();

  const instructor = query.data ? mapApiInstructorToMobile(query.data) : null;
  const apiData: any = query.data;

  const instructorClasses = useMemo(() => {
    if (!allClasses) return [];
    return allClasses.filter((c: any) => c.instructorId === numericId);
  }, [allClasses, numericId]);

  const scheduleMap = useMemo(() => {
    if (!allSchedules || instructorClasses.length === 0) return {};
    const map: Record<string, any[]> = {};
    const classIds = new Set(instructorClasses.map((c: any) => c.id));
    
    allSchedules.forEach((sch: any) => {
      if (classIds.has(sch.classId) && sch.type === 'weekly' && sch.dayOfWeek != null) {
        const cls = instructorClasses.find((c: any) => c.id === sch.classId);
        const dayName = DAY_NAMES[sch.dayOfWeek];
        if (!map[dayName]) map[dayName] = [];
        map[dayName].push({
          className: cls.title,
          startTime: formatTime(sch.startTime),
          duration: durationMinsText(sch.startTime, sch.endTime),
        });
      }
    });
    return map;
  }, [allSchedules, instructorClasses]);

  if (query.isLoading) {
    return <DetailSkeleton />;
  }

  if (query.isError && isOfflineError(query.error)) {
    return (
      <View style={[styles.container, { paddingTop: (Platform.OS === "web" ? 67 : insets.top) + 12 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtnFallback}>
          <Ionicons name="arrow-back" size={22} color="#FFFFFF" />
        </TouchableOpacity>
        <OfflineState onRetry={() => query.refetch()} />
      </View>
    );
  }

  if (query.isError || !instructor) {
    return (
      <View style={[styles.container, { paddingTop: (Platform.OS === "web" ? 67 : insets.top) + 12 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtnFallback}>
          <Ionicons name="arrow-back" size={22} color="#FFFFFF" />
        </TouchableOpacity>
        {query.isError ? (
          <ErrorState onRetry={() => query.refetch()} message="Couldn't load instructor details." />
        ) : (
          <ErrorState title="Instructor not found" message="This instructor may no longer be available." onRetry={() => router.back()} />
        )}
      </View>
    );
  }

  const accentColor = instructor.photoColor || "#00B6D7";
  const achievements: string[] = apiData?.achievements ?? [];
  const teachingLevel: string | null = apiData?.teachingLevel ?? null;
  const instagramUrl: string | null = apiData?.instagramUrl ?? null;
  const tiktokUrl: string | null = apiData?.tiktokUrl ?? null;
  const youtubeUrl: string | null = apiData?.youtubeUrl ?? null;
  const hasSocial = !!(instagramUrl || tiktokUrl || youtubeUrl);

  const openSafeUrl = (url: string | null) => {
    if (typeof url === "string" && url.startsWith("https://")) {
      Linking.openURL(url);
    }
  };

  const hasAnySchedule = Object.keys(scheduleMap).length > 0;

  return (
    <View style={styles.container}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: Platform.OS === "web" ? 120 : 90 + insets.bottom }}
        style={{ flex: 1 }}
      >
        {/* HERO */}
        <View style={{ position: "relative", height: 280 }}>
          {instructor.photoUrl && !imageFailed ? (
            <Image
              source={{ uri: instructor.photoUrl }}
              style={StyleSheet.absoluteFill}
              resizeMode="cover"
              onError={() => setImageFailed(true)}
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
            colors={["rgba(5,6,8,0.55)", "rgba(5,6,8,0.10)", "rgba(5,6,8,0.90)"]}
            locations={[0, 0.38, 1]}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
          {/* Top bar */}
          <View style={[styles.topBar, { top: Math.max(insets.top, 16) }]}>
            <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
              <Ionicons name="arrow-back" size={22} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
          {/* Name overlay */}
          <View style={styles.heroOverlay}>
            <View style={styles.badgeRow}>
              {teachingLevel && (
                <View style={styles.pillBadge}>
                  <Text style={styles.pillBadgeText}>{teachingLevel}</Text>
                </View>
              )}
            </View>
            <Text style={styles.nameText}>{instructor.name}</Text>
            <Text style={[styles.titleText, { color: accentColor }]}>{instructor.title}</Text>
          </View>
        </View>

        {/* STATS */}
        <View style={styles.statsContainer}>
          {[
            { key: 'exp', value: apiData?.experienceYears || "—", label: 'Experience' },
            { key: 'classes', value: instructorClasses.length || "—", label: 'Classes' },
            { key: 'students', value: "—", label: 'Students' },
            { key: 'styles', value: apiData?.specialties?.length || "—", label: 'Styles' },
          ].map((s, idx, arr) => (
            <View key={s.key} style={[styles.statBox, idx < arr.length - 1 && styles.statBoxBorder]}>
              <Text style={[styles.statValue, { color: accentColor }]}>{s.value}</Text>
              <Text style={styles.statLabel}>{s.label}</Text>
            </View>
          ))}
        </View>

        <View style={styles.contentPadding}>
          {/* ABOUT */}
          <ISection title="About">
            <Text style={styles.bioText}>{instructor.bio || "No biography provided."}</Text>
            
            {/* Teaching Philosophy - Neutral missing state per plan */}
            <View style={styles.comingSoonBox}>
              <Text style={styles.comingSoonEyebrow}>Teaching Philosophy</Text>
              <Text style={styles.comingSoonText}>Coming soon...</Text>
            </View>
          </ISection>

          {/* SPECIALIZATIONS */}
          {apiData?.specialties?.length > 0 && (
            <ISection title="Specializations">
              <View style={{ gap: 9 }}>
                {apiData.specialties.map((style: string) => (
                  <View key={style} style={styles.specRow}>
                    <Text style={styles.specTitle}>{style}</Text>
                  </View>
                ))}
              </View>
            </ISection>
          )}

          {/* QUALIFICATIONS & CERTIFICATIONS - missing state */}
          <ISection title="Qualifications & Certifications">
            <Text style={styles.neutralEmptyText}>No certifications listed yet.</Text>
          </ISection>

          {/* EXPERIENCE TIMELINE - missing state */}
          <ISection title="Professional Experience">
            <Text style={styles.neutralEmptyText}>Experience timeline coming soon.</Text>
          </ISection>

          {/* WEEKLY SCHEDULE */}
          <ISection title="Weekly Schedule">
            {hasAnySchedule ? (
              <View style={{ gap: 8 }}>
                {ORDERED_DAYS.filter((d) => scheduleMap[d]?.length > 0).map((d) => (
                  <View key={d} style={styles.scheduleRowContainer}>
                    <Text style={styles.scheduleDay}>{d.slice(0, 3)}</Text>
                    <View style={styles.scheduleItemsCol}>
                      {scheduleMap[d].map((cls, i) => (
                        <View key={i} style={styles.scheduleItem}>
                          <Ionicons name="time-outline" size={14} color={accentColor} />
                          <Text style={styles.scheduleItemText}>
                            {cls.className} · {cls.startTime} · {cls.duration}
                          </Text>
                        </View>
                      ))}
                    </View>
                  </View>
                ))}
              </View>
            ) : (
              <Text style={styles.neutralEmptyText}>No classes scheduled for this instructor.</Text>
            )}
          </ISection>
          
          {/* RELATED CLASSES */}
          {instructorClasses.length > 0 && (
            <ISection title="Related Classes">
              <View style={{ gap: 8 }}>
                 {instructorClasses.map((cls: any) => (
                    <View key={cls.id} style={styles.relatedClassRow}>
                      <Ionicons name="musical-notes" size={16} color={accentColor} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.relatedClassTitle}>{cls.title}</Text>
                        <Text style={styles.relatedClassSub}>{cls.level} · {cls.category}</Text>
                      </View>
                    </View>
                 ))}
              </View>
            </ISection>
          )}

          {/* GALLERY - missing state */}
          <ISection title="Gallery">
            <Text style={styles.neutralEmptyText}>Instructor gallery coming soon.</Text>
          </ISection>

          {/* ACHIEVEMENTS */}
          {achievements.length > 0 && (
            <ISection title="Achievements">
              <View style={{ gap: 9 }}>
                {achievements.map((ach, i) => (
                  <View key={i} style={styles.achievementRow}>
                    <View style={styles.achievementIconBox}>
                      <Ionicons name="trophy" size={20} color="#FFB81C" />
                    </View>
                    <View style={{ flex: 1, justifyContent: "center" }}>
                      <Text style={styles.achievementText}>{ach}</Text>
                    </View>
                  </View>
                ))}
              </View>
            </ISection>
          )}

          {/* CONTACT */}
          {hasSocial && (
            <ISection title="Contact Studio">
              <View style={{ gap: 9 }}>
                {instagramUrl && (
                  <TouchableOpacity style={styles.contactBtn} onPress={() => openSafeUrl(instagramUrl)}>
                    <View style={styles.contactIconBox}>
                      <Ionicons name="logo-instagram" size={19} color={accentColor} />
                    </View>
                    <View>
                      <Text style={styles.contactBtnTitle}>Instagram</Text>
                      <Text style={styles.contactBtnSub}>Follow</Text>
                    </View>
                  </TouchableOpacity>
                )}
                {tiktokUrl && (
                  <TouchableOpacity style={styles.contactBtn} onPress={() => openSafeUrl(tiktokUrl)}>
                    <View style={styles.contactIconBox}>
                      <Ionicons name="logo-tiktok" size={19} color={accentColor} />
                    </View>
                    <View>
                      <Text style={styles.contactBtnTitle}>TikTok</Text>
                      <Text style={styles.contactBtnSub}>Follow</Text>
                    </View>
                  </TouchableOpacity>
                )}
                {youtubeUrl && (
                  <TouchableOpacity style={styles.contactBtn} onPress={() => openSafeUrl(youtubeUrl)}>
                    <View style={styles.contactIconBox}>
                      <Ionicons name="logo-youtube" size={19} color={accentColor} />
                    </View>
                    <View>
                      <Text style={styles.contactBtnTitle}>YouTube</Text>
                      <Text style={styles.contactBtnSub}>Subscribe</Text>
                    </View>
                  </TouchableOpacity>
                )}
              </View>
            </ISection>
          )}

        </View>
      </ScrollView>

      {/* STICKY BOTTOM BAR */}
      <LinearGradient
        colors={["rgba(10,11,13,0)", "#0B0B12"]}
        locations={[0, 0.28]}
        style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 24) }]}
        pointerEvents="box-none"
      >
        <TouchableOpacity
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            router.push("/(tabs)/classes");
          }}
          style={[styles.bookBtn, { backgroundColor: accentColor }]}
        >
          <Ionicons name="book" size={17} color="#0B0B12" />
          <Text style={styles.bookBtnText}>Book a Class</Text>
        </TouchableOpacity>
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0A0B0D" },
  backBtnFallback: {
    position: "absolute", top: 60, left: 20, zIndex: 10,
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: "#1E1E26", alignItems: "center", justifyContent: "center",
  },
  topBar: {
    position: "absolute", left: 18, right: 18,
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    zIndex: 10,
  },
  backBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: "rgba(0,0,0,0.5)",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.18)",
    alignItems: "center", justifyContent: "center",
  },
  heroOverlay: {
    position: "absolute", left: 18, right: 18, bottom: 18,
  },
  badgeRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 8 },
  pillBadge: {
    paddingHorizontal: 9, paddingVertical: 3, borderRadius: 50,
    backgroundColor: "rgba(0,182,215,0.85)",
  },
  pillBadgeText: {
    fontFamily: "Archivo_800ExtraBold", fontSize: 10, letterSpacing: 0.7,
    textTransform: "uppercase", color: "#0B0B12",
  },
  nameText: {
    fontFamily: "Anton_400Regular", fontSize: 44, lineHeight: 46,
    textTransform: "uppercase", color: "#FFFFFF", marginBottom: 6,
  },
  titleText: { fontFamily: "Archivo_600SemiBold", fontSize: 14 },
  
  statsContainer: {
    flexDirection: "row", backgroundColor: "#15171B",
    borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.07)",
    alignItems: "center", justifyContent: "center",
  },
  statBox: { flex: 1, alignItems: "center", paddingVertical: 14, paddingHorizontal: 4 },
  statBoxBorder: { borderRightWidth: 1, borderRightColor: "rgba(255,255,255,0.07)" },
  statValue: { fontFamily: "Anton_400Regular", fontSize: 22, lineHeight: 24 },
  statLabel: {
    fontFamily: "Archivo_400Regular", fontSize: 10.5, color: "#9CA3AF",
    marginTop: 5, textTransform: "uppercase", letterSpacing: 0.5,
  },

  contentPadding: { paddingHorizontal: 20 },
  
  section: { paddingTop: 22, paddingBottom: 4, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.07)", marginTop: 8 },
  sectionHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 14 },
  sectionTitle: { fontFamily: "SpaceMono_700Bold", fontSize: 10, letterSpacing: 1, textTransform: "uppercase", color: "#00B6D7" },
  sectionActionBtn: { flexDirection: "row", alignItems: "center", gap: 3 },
  sectionActionText: { fontFamily: "Archivo_600SemiBold", fontSize: 12.5, color: "#9CA3AF" },
  
  bioText: { fontFamily: "Archivo_400Regular", color: "#E5E7EB", lineHeight: 24, fontSize: 15 },
  comingSoonBox: {
    marginTop: 14, paddingVertical: 13, paddingHorizontal: 16,
    borderRadius: 8, backgroundColor: "rgba(0,182,215,0.07)",
    borderWidth: 1, borderColor: "rgba(0,182,215,0.22)",
  },
  comingSoonEyebrow: { fontFamily: "SpaceMono_700Bold", fontSize: 10, letterSpacing: 1, textTransform: "uppercase", color: "#00B6D7", marginBottom: 6 },
  comingSoonText: { fontFamily: "Archivo_400Regular", color: "#FFFFFF", fontStyle: "italic", lineHeight: 22 },
  neutralEmptyText: { fontFamily: "Archivo_400Regular", color: "#9CA3AF", fontStyle: "italic", fontSize: 14 },

  specRow: {
    flexDirection: "row", alignItems: "center", paddingVertical: 11, paddingHorizontal: 14,
    backgroundColor: "#15171B", borderWidth: 1, borderColor: "rgba(255,255,255,0.08)", borderRadius: 8,
  },
  specTitle: { flex: 1, fontFamily: "Archivo_700Bold", fontSize: 15, color: "#FFFFFF" },

  scheduleRowContainer: {
    flexDirection: "row", gap: 10, paddingVertical: 10, paddingHorizontal: 14,
    backgroundColor: "#15171B", borderWidth: 1, borderColor: "rgba(0,182,215,0.28)", borderRadius: 8,
  },
  scheduleDay: { fontFamily: "Archivo_800ExtraBold", fontSize: 13.5, color: "#00B6D7", width: 45 },
  scheduleItemsCol: { flex: 1, gap: 6 },
  scheduleItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  scheduleItemText: { fontFamily: "Archivo_600SemiBold", fontSize: 13, color: "#E5E7EB" },

  relatedClassRow: {
    flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, paddingHorizontal: 14,
    backgroundColor: "#15171B", borderWidth: 1, borderColor: "rgba(255,255,255,0.08)", borderRadius: 8,
  },
  relatedClassTitle: { fontFamily: "Archivo_700Bold", fontSize: 14.5, color: "#FFFFFF" },
  relatedClassSub: { fontFamily: "Archivo_400Regular", fontSize: 12, color: "#9CA3AF", marginTop: 2 },

  achievementRow: {
    flexDirection: "row", gap: 12, paddingVertical: 12, paddingHorizontal: 14,
    backgroundColor: "#15171B", borderWidth: 1, borderColor: "rgba(255,255,255,0.07)", borderRadius: 8,
  },
  achievementIconBox: {
    width: 38, height: 38, borderRadius: 8, backgroundColor: "rgba(255,184,28,0.12)",
    alignItems: "center", justifyContent: "center",
  },
  achievementText: { fontFamily: "Archivo_700Bold", fontSize: 14.5, color: "#FFFFFF", lineHeight: 20 },

  contactBtn: {
    flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 13, paddingHorizontal: 14,
    backgroundColor: "#15171B", borderWidth: 1, borderColor: "rgba(255,255,255,0.08)", borderRadius: 12,
  },
  contactIconBox: {
    width: 38, height: 38, borderRadius: 8, backgroundColor: "rgba(0,182,215,0.10)",
    alignItems: "center", justifyContent: "center",
  },
  contactBtnTitle: { fontFamily: "Archivo_700Bold", fontSize: 14.5, color: "#FFFFFF" },
  contactBtnSub: { fontFamily: "Archivo_400Regular", fontSize: 12, color: "#9CA3AF", marginTop: 1 },

  bottomBar: {
    position: "absolute", left: 0, right: 0, bottom: 0,
    paddingHorizontal: 16, paddingTop: 12,
    flexDirection: "row", gap: 10,
  },
  bookBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7,
    paddingVertical: 13, borderRadius: 8,
  },
  bookBtnText: { fontFamily: "Archivo_800ExtraBold", fontSize: 15, color: "#0B0B12" },
});
`;

fs.writeFileSync(path.join(__dirname, 'artifacts/central/app/instructor/[id].tsx'), newCode);
console.log('Successfully updated instructor detail page.');
