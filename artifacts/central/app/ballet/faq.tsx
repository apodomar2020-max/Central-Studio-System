/**
 * app/ballet/faq.tsx — Ballet FAQ
 *
 * Source of truth:
 *   GET /api/ballet/faqs → active admin-managed FAQ rows ordered by sortOrder.
 *
 * No hardcoded production FAQ records are rendered here.
 */

import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  LayoutAnimation,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  UIManager,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { fetchBalletFaqs, type BalletFaq, type BalletFaqCategory } from "@/services/balletAssessmentService";
import { iosCapGuard, iosDisplayTextStyle } from "@/utils/iosTypography";

// UI-only fallback bucket for FAQs with no active category — never a
// persisted DB category (locked decision: client-only, never persisted).
const OTHER_QUESTIONS_LABEL = "Other Questions";

type FaqGroup = { key: string; title: string; items: BalletFaq[] };

/**
 * Group the flat, server-sorted `faqs` array by category, in a single pass
 * that preserves each item's existing relative order (no client-side
 * re-sort — the server's sortOrder,id order is trusted, exactly as
 * before). Categories are ordered per `faqCategories` (already
 * sortOrder,id from the server); "Other Questions" — uncategorized, or
 * pointing at an inactive category (server already nulls that out) —
 * always renders last.
 */
function groupFaqsByCategory(faqs: BalletFaq[], faqCategories: BalletFaqCategory[]): FaqGroup[] {
  const byCategoryId = new Map<number, BalletFaq[]>();
  const uncategorized: BalletFaq[] = [];

  for (const item of faqs) {
    if (item.category != null) {
      const bucket = byCategoryId.get(item.category.id);
      if (bucket) bucket.push(item);
      else byCategoryId.set(item.category.id, [item]);
    } else {
      uncategorized.push(item);
    }
  }

  const groups: FaqGroup[] = [];
  for (const category of faqCategories) {
    const items = byCategoryId.get(category.id);
    // Categories with zero matching FAQs render no section at all.
    if (items && items.length > 0) {
      groups.push({ key: `category-${category.id}`, title: category.name, items });
    }
  }
  if (uncategorized.length > 0) {
    groups.push({ key: "other-questions", title: OTHER_QUESTIONS_LABEL, items: uncategorized });
  }
  return groups;
}

if (
  Platform.OS === "android" &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const BASE = "#0A0B0D";
const CYAN = "#00B6D7";
const INK_200 = "#D1D5DB";
const INK_300 = "#9CA3AF";
const INK_400 = "#6B7280";
const R_MD = 12;

function FaqRow({
  item,
  open,
  onToggle,
  isLast,
}: {
  item: BalletFaq;
  open: boolean;
  onToggle: () => void;
  isLast: boolean;
}) {
  const rot = useRef(new Animated.Value(open ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(rot, { toValue: open ? 1 : 0, duration: 200, useNativeDriver: true }).start();
  }, [open, rot]);
  const rotate = rot.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "90deg"] });

  return (
    <View style={[s.faqRow, !isLast && s.faqRowBorder]}>
      <TouchableOpacity onPress={onToggle} style={s.faqQBtn} activeOpacity={0.7}>
        <Text style={s.faqQ}>{item.question}</Text>
        <Animated.View style={{ transform: [{ rotate }] }}>
          <Ionicons name="chevron-forward" size={17} color={CYAN} />
        </Animated.View>
      </TouchableOpacity>
      {open && <Text style={s.faqA}>{item.answer}</Text>}
    </View>
  );
}

export default function BalletFaqScreen() {
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === "web" ? 67 : insets.top;

  const [faqs, setFaqs] = useState<BalletFaq[]>([]);
  const [faqCategories, setFaqCategories] = useState<BalletFaqCategory[]>([]);
  const [open, setOpen] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const data = await fetchBalletFaqs(signal);
      if (signal?.aborted) return;
      setFaqs(data.faqs);
      setFaqCategories(data.faqCategories);
    } catch (err) {
      if ((err as any)?.name === "AbortError") return;
      setFaqs([]);
      setFaqCategories([]);
      setErrorMessage("Unable to load Ballet FAQs right now.");
    } finally {
      if (!signal?.aborted) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    load(ctrl.signal);
    return () => ctrl.abort();
  }, [load]);

  function toggle(id: number) {
    Haptics.selectionAsync();
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setOpen((cur) => (cur === id ? null : id));
  }

  const faqGroups = groupFaqsByCategory(faqs, faqCategories);

  return (
    <View style={s.screen}>
      <LinearGradient
        colors={["rgba(0,182,215,0.22)", "rgba(0,182,215,0.08)", "transparent"]}
        locations={[0, 0.35, 1]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={[s.atmosphericGlow, { height: topPad + 240 }]}
        pointerEvents="none"
      />

      <View style={s.headerWrap}>
        <LinearGradient
          colors={["rgba(0,0,0,0.92)", "rgba(0,0,0,0.58)", "rgba(0,0,0,0)"]}
          locations={[0, 0.58, 1]}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
        <View style={[s.header, { paddingTop: topPad + 14 }]}>
          <TouchableOpacity onPress={() => router.back()} style={s.backBtn} activeOpacity={0.7}>
            <Ionicons name="chevron-back" size={20} color={CYAN} />
            <Text style={s.backText}>Back</Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} bounces>
        <View style={[s.heroSection, { minHeight: topPad + 222 }]}>
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

          <View style={[s.heroContent, { paddingTop: topPad + 54 }]}>
            <Text style={s.heroEyebrow}>Central Studio</Text>
            <Text style={s.heroTitle}>{"BALLET\nFAQ"}</Text>
            <Text style={s.heroDesc}>
              Find quick answers about the Ballet program, assessments, and participation.
            </Text>
          </View>
        </View>

        <View style={s.heroDivider} />

        <View style={s.content}>
          {isLoading ? (
            <View style={s.center}>
              <ActivityIndicator color={CYAN} />
            </View>
          ) : errorMessage ? (
            <View style={s.empty}>
              <View style={s.emptyIcon}>
                <Ionicons name="alert-circle-outline" size={28} color={INK_400} />
              </View>
              <Text style={s.emptyTitle}>FAQ unavailable</Text>
              <Text style={s.emptyDesc}>{errorMessage}</Text>
              <TouchableOpacity
                onPress={() => {
                  const ctrl = new AbortController();
                  load(ctrl.signal);
                }}
                style={s.retryButton}
                activeOpacity={0.82}
              >
                <Text style={s.retryText}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : faqs.length === 0 ? (
            <View style={s.empty}>
              <View style={s.emptyIcon}>
                <Ionicons name="help-circle-outline" size={28} color={INK_400} />
              </View>
              <Text style={s.emptyTitle}>No FAQs listed yet</Text>
              <Text style={s.emptyDesc}>Ballet FAQs will appear here soon.</Text>
            </View>
          ) : (
            <>
              <View style={s.groupList}>
                {faqGroups.map((group) => (
                  <View key={group.key} style={s.group}>
                    {/* Only shown when there's more than one group — a
                        single group (e.g. no categories configured yet)
                        renders exactly as the flat list did before this
                        change. */}
                    {faqGroups.length > 1 && (
                      <Text style={s.groupTitle}>{group.title}</Text>
                    )}
                    <View style={s.accordion}>
                      {group.items.map((faq, i) => (
                        <FaqRow
                          key={faq.id}
                          item={faq}
                          open={open === faq.id}
                          onToggle={() => toggle(faq.id)}
                          isLast={i === group.items.length - 1}
                        />
                      ))}
                    </View>
                  </View>
                ))}
              </View>

              <TouchableOpacity
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  router.push("/ballet/contact" as any);
                }}
                style={s.contactBtn}
                activeOpacity={0.85}
              >
                <Text style={s.contactBtnText}>Contact Ballet Department</Text>
              </TouchableOpacity>
            </>
          )}
        </View>

        <View style={{ height: Platform.OS === "web" ? 120 : 80 }} />
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BASE },
  atmosphericGlow: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
  },
  headerWrap: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 16,
    backgroundColor: "transparent",
  },
  backBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  backText: {
    fontSize: 14,
    fontFamily: "Archivo_600SemiBold",
    color: CYAN,
    textShadowColor: "rgba(0,0,0,0.85)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  heroSection: {
    borderBottomWidth: 1,
    borderBottomColor: "rgba(0,182,215,0.12)",
    overflow: "hidden",
  },
  heroContent: {
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
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
    fontFamily: "Anton_400Regular",
    textTransform: "uppercase",
    lineHeight: 40,
    letterSpacing: 0.5,
    color: "#FFFFFF",
    marginBottom: 8,
    ...iosDisplayTextStyle(44, 40),
    marginTop: -iosCapGuard(44, 40),
  },
  heroDesc: {
    fontSize: 14,
    fontFamily: "Archivo_400Regular",
    color: INK_200,
    lineHeight: 21,
    maxWidth: 330,
  },
  heroDivider: {
    height: 1,
    backgroundColor: "rgba(0,182,215,0.12)",
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 16,
    gap: 12,
  },
  groupList: { gap: 20 },
  group: { gap: 8 },
  groupTitle: {
    fontSize: 12,
    fontFamily: "Archivo_700Bold",
    letterSpacing: 0.4,
    textTransform: "uppercase",
    color: INK_300,
    paddingHorizontal: 2,
  },
  accordion: {
    backgroundColor: "#15171B",
    borderWidth: 1,
    borderColor: "rgba(0,182,215,0.18)",
    borderRadius: 18,
    overflow: "hidden",
  },
  faqRow: { paddingHorizontal: 16 },
  faqRowBorder: { borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.06)" },
  faqQBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 15,
    gap: 10,
  },
  faqQ: { flex: 1, fontSize: 14, fontFamily: "Archivo_700Bold", color: "#fff", lineHeight: 20 },
  faqA: { fontSize: 13, fontFamily: "Archivo_400Regular", color: INK_300, lineHeight: 21, paddingBottom: 15 },
  contactBtn: {
    paddingVertical: 13,
    borderRadius: R_MD,
    backgroundColor: "rgba(0,182,215,0.12)",
    borderWidth: 1.5,
    borderColor: "rgba(0,182,215,0.30)",
    alignItems: "center",
  },
  contactBtnText: { fontSize: 14, fontFamily: "Archivo_700Bold", color: CYAN },
  center: {
    paddingVertical: 54,
    alignItems: "center",
  },
  empty: {
    alignItems: "center",
    paddingVertical: 50,
    paddingHorizontal: 24,
  },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "rgba(255,255,255,0.05)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },
  emptyTitle: {
    fontSize: 18,
    fontFamily: "Archivo_700Bold",
    color: "#fff",
    marginBottom: 8,
    textAlign: "center",
  },
  emptyDesc: {
    fontSize: 13,
    fontFamily: "Archivo_400Regular",
    color: INK_400,
    textAlign: "center",
    lineHeight: 19,
  },
  retryButton: {
    marginTop: 18,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: R_MD,
    backgroundColor: "rgba(0,182,215,0.14)",
    borderWidth: 1,
    borderColor: "rgba(0,182,215,0.35)",
  },
  retryText: {
    fontSize: 13,
    fontFamily: "Archivo_700Bold",
    color: CYAN,
  },
});
