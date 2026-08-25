/**
 * app/ballet/requirements.tsx — Ballet program requirements.
 *
 * Requirement copy remains admin-managed through
 * GET /api/ballet/program-requirements. This screen only owns presentation.
 */

import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import CentralBackButton from "@/components/CentralBackButton";
import {
  fetchBalletProgramRequirements,
  type BalletProgramRequirementSection,
} from "@/services/balletAssessmentService";
import { iosCapGuard, iosDisplayTextStyle } from "@/utils/iosTypography";

const BASE = "#0A0B0D";
const CYAN = "#08B8D6";
const WHITE = "#FFFFFF";

function RequirementAccordion({
  section,
  isExpanded,
  onPress,
}: {
  section: BalletProgramRequirementSection;
  isExpanded: boolean;
  onPress: () => void;
}) {
  return (
    <View style={styles.accordionItem}>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityState={{ expanded: isExpanded }}
        activeOpacity={0.88}
        onPress={onPress}
        style={styles.accordionHeader}
      >
        <Text numberOfLines={2} style={styles.accordionTitle}>{section.title}</Text>
        <Ionicons name="chevron-down-outline" size={24} color={CYAN} />
      </TouchableOpacity>

      {isExpanded ? (
        <View style={styles.expandedPanel}>
          {!!section.description?.trim() ? (
            <Text style={styles.sectionDescription}>{section.description.trim()}</Text>
          ) : null}

          {section.items.length > 0 ? (
            <View style={styles.itemList}>
              {section.items.map((item) => (
                <View key={item.id} style={styles.itemRow}>
                  <Text style={styles.bullet}>•</Text>
                  <Text style={styles.itemText}>{item.text}</Text>
                </View>
              ))}
            </View>
          ) : !section.description?.trim() ? (
            <Text style={styles.noItemsText}>Details will be added soon.</Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

export default function BalletRequirementsScreen() {
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === "web" ? 67 : insets.top;

  const [sections, setSections] = useState<BalletProgramRequirementSection[]>([]);
  const [expandedSectionId, setExpandedSectionId] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const data = await fetchBalletProgramRequirements(signal);
      if (signal?.aborted) return;
      setSections(data);
      setExpandedSectionId((current) => current ?? data[0]?.id ?? null);
    } catch (error) {
      if ((error as { name?: string })?.name === "AbortError") return;
      setSections([]);
      setErrorMessage("Unable to load Ballet requirements right now.");
    } finally {
      if (!signal?.aborted) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  return (
    <View style={styles.screen}>
      <LinearGradient
        colors={["rgba(0,182,215,0.22)", "rgba(0,182,215,0.08)", "transparent"]}
        locations={[0, 0.35, 1]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={[styles.atmosphericGlow, { height: topPad + 240 }]}
        pointerEvents="none"
      />

      <View style={styles.headerWrap}>
        <LinearGradient
          colors={["rgba(0,0,0,0.92)", "rgba(0,0,0,0.58)", "rgba(0,0,0,0)"]}
          locations={[0, 0.58, 1]}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
        <View style={[styles.header, { paddingTop: topPad + 14 }]}>
          <CentralBackButton style={styles.backBtn} activeOpacity={0.7} />
        </View>
      </View>

      <ScrollView
        bounces
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: Math.max(insets.bottom + 36, 54) }]}
      >
        <View style={[styles.heroSection, { minHeight: topPad + 222 }]}>
          <LinearGradient
            colors={[BASE, "rgba(0,182,215,0.12)", BASE]}
            locations={[0, 0.48, 1]}
            start={{ x: 0.1, y: 0 }}
            end={{ x: 0.95, y: 1 }}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
          <LinearGradient
            colors={[
              "rgba(5,6,8,0.12)",
              "rgba(5,6,8,0.34)",
              "rgba(5,6,8,0.78)",
              "rgba(5,6,8,0.96)",
            ]}
            locations={[0, 0.3, 0.75, 1]}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />

          <View style={[styles.heroContent, { paddingTop: topPad + 54 }]}>
            <Text style={styles.heroEyebrow}>Central Studio</Text>
            <Text style={styles.heroTitle}>{"BALLET\nREQUIREMENTS"}</Text>
            <Text style={styles.heroDescription}>
              Review program expectations, preparation notes, and participation guidelines.
            </Text>
          </View>
        </View>

        <View style={styles.heroDivider} />

        <View style={styles.content}>
          <View style={styles.requirementsList}>
            {isLoading ? (
              <View style={styles.loadingState}>
                <ActivityIndicator size="small" color={CYAN} />
              </View>
            ) : errorMessage ? (
              <View style={styles.messageState}>
                <Text style={styles.messageTitle}>Requirements unavailable</Text>
                <Text style={styles.messageBody}>{errorMessage}</Text>
                <TouchableOpacity
                  activeOpacity={0.85}
                  onPress={() => void load()}
                  style={styles.retryButton}
                >
                  <Text style={styles.retryText}>Retry</Text>
                </TouchableOpacity>
              </View>
            ) : sections.length === 0 ? (
              <View style={styles.messageState}>
                <Text style={styles.messageTitle}>No requirements listed yet</Text>
                <Text style={styles.messageBody}>Ballet program requirements will appear here soon.</Text>
              </View>
            ) : (
              sections.map((section) => (
                <RequirementAccordion
                  key={section.id}
                  section={section}
                  isExpanded={expandedSectionId === section.id}
                  onPress={() => setExpandedSectionId((current) => current === section.id ? null : section.id)}
                />
              ))
            )}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: BASE,
  },
  scrollContent: {
    flexGrow: 1,
  },
  atmosphericGlow: { position: "absolute", top: 0, left: 0, right: 0 },
  headerWrap: { position: "absolute", top: 0, left: 0, right: 0, zIndex: 10 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 16,
    backgroundColor: "transparent",
  },
  backBtn: { flexDirection: "row", alignItems: "center", gap: 4 },
  heroSection: {
    borderBottomWidth: 1,
    borderBottomColor: "rgba(0,182,215,0.12)",
    overflow: "hidden",
  },
  heroContent: { paddingHorizontal: 20, paddingBottom: 8 },
  heroEyebrow: {
    fontSize: 10,
    fontFamily: "SpaceMono_700Bold",
    letterSpacing: 1.8,
    textTransform: "uppercase",
    color: CYAN,
    marginBottom: 6,
  },
  heroTitle: {
    fontSize: 44,
    lineHeight: 40,
    fontFamily: "Anton_400Regular",
    letterSpacing: 0.5,
    textTransform: "uppercase",
    color: WHITE,
    marginBottom: 8,
    ...iosDisplayTextStyle(44, 40),
    marginTop: -iosCapGuard(44, 40),
  },
  heroDescription: {
    maxWidth: 320,
    fontSize: 14,
    lineHeight: 21,
    fontFamily: "Archivo_400Regular",
    color: "#D1D5DB",
  },
  heroDivider: { height: 1, backgroundColor: "rgba(0,182,215,0.12)" },
  content: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 16 },
  requirementsList: {
    marginTop: 0,
    marginHorizontal: 14,
    gap: 10,
  },
  accordionItem: {
    width: "100%",
  },
  accordionHeader: {
    minHeight: 58,
    zIndex: 2,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingHorizontal: 26,
    paddingVertical: 14,
    borderRadius: 15,
    backgroundColor: WHITE,
  },
  accordionTitle: {
    flex: 1,
    color: CYAN,
    fontFamily: "Anton_400Regular",
    fontSize: 21,
    lineHeight: 24,
    ...iosDisplayTextStyle(21, 24),
    marginTop: -iosCapGuard(21, 24),
  },
  expandedPanel: {
    zIndex: 1,
    marginTop: -8,
    marginHorizontal: 16,
    paddingTop: 21,
    paddingHorizontal: 19,
    paddingBottom: 16,
    borderBottomLeftRadius: 15,
    borderBottomRightRadius: 15,
    backgroundColor: CYAN,
  },
  sectionDescription: {
    color: WHITE,
    fontFamily: "Archivo_700Bold",
    fontSize: 12,
    lineHeight: 16,
    marginBottom: 3,
  },
  itemList: {
    gap: 1,
  },
  itemRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 5,
  },
  bullet: {
    color: WHITE,
    fontFamily: "Archivo_700Bold",
    fontSize: 12,
    lineHeight: 16,
  },
  itemText: {
    flex: 1,
    color: WHITE,
    fontFamily: "Archivo_400Regular",
    fontSize: 12,
    lineHeight: 16,
  },
  noItemsText: {
    color: WHITE,
    fontFamily: "Archivo_400Regular",
    fontSize: 12,
    lineHeight: 16,
  },
  loadingState: {
    minHeight: 160,
    alignItems: "center",
    justifyContent: "center",
  },
  messageState: {
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 36,
  },
  messageTitle: {
    color: WHITE,
    fontFamily: "Archivo_700Bold",
    fontSize: 17,
    textAlign: "center",
  },
  messageBody: {
    marginTop: 7,
    color: "rgba(255,255,255,0.62)",
    fontFamily: "Archivo_400Regular",
    fontSize: 13,
    lineHeight: 18,
    textAlign: "center",
  },
  retryButton: {
    marginTop: 16,
    minWidth: 90,
    height: 42,
    paddingHorizontal: 20,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: WHITE,
  },
  retryText: {
    color: CYAN,
    fontFamily: "Archivo_700Bold",
    fontSize: 14,
  },
});
