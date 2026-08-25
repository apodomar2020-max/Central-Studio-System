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
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  LayoutAnimation,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  UIManager,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import CentralBackButton from "@/components/CentralBackButton";

import { fetchBalletFaqs, type BalletFaq, type BalletFaqCategory } from "@/services/balletAssessmentService";
import { iosCapGuard, iosDisplayTextStyle } from "@/utils/iosTypography";

if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const BASE = "#0A0B0D";
const CYAN = "#00B6D7";
const INK_200 = "#D1D5DB";
const INK_400 = "#6B7280";
const R_MD = 12;

function FaqRow({
  item,
  open,
  onToggle,
}: {
  item: BalletFaq;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <View style={[s.faqRow, open && s.faqRowOpen]}>
      <TouchableOpacity onPress={onToggle} style={s.faqQBtn} activeOpacity={0.7}>
        <Text style={s.faqQ}>{item.question}</Text>
        <Ionicons name={open ? "chevron-up-outline" : "chevron-down-outline"} size={18} color={CYAN} />
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
  const [selectedCategory, setSelectedCategory] = useState<number | null>(null);
  const [search, setSearch] = useState("");
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
      setOpen((current) => current ?? data.faqs[0]?.id ?? null);
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

  const visibleFaqs = useMemo(() => {
    const term = search.trim().toLowerCase();
    return faqs.filter((faq) => {
      const matchesCategory = selectedCategory == null || faq.category?.id === selectedCategory;
      const matchesSearch = !term || `${faq.question} ${faq.answer}`.toLowerCase().includes(term);
      return matchesCategory && matchesSearch;
    });
  }, [faqs, search, selectedCategory]);

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
          <CentralBackButton style={s.backBtn} activeOpacity={0.7} />
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
          <View style={s.searchBox}>
            <Ionicons name="search-outline" size={19} color={CYAN} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search Topics..."
              placeholderTextColor={CYAN}
              style={s.searchInput}
              returnKeyType="search"
            />
          </View>

          <Text style={s.topicsTitle}>Topics</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={s.topicList}
            style={s.topicScroller}
          >
            <TouchableOpacity
              onPress={() => setSelectedCategory(null)}
              style={[s.topic, selectedCategory == null && s.topicActive]}
            >
              <Text style={[s.topicText, selectedCategory == null && s.topicTextActive]}>All Topics</Text>
            </TouchableOpacity>
            {faqCategories.map((category) => (
              <TouchableOpacity
                key={category.id}
                onPress={() => setSelectedCategory(category.id)}
                style={[s.topic, selectedCategory === category.id && s.topicActive]}
              >
                <Text style={[s.topicText, selectedCategory === category.id && s.topicTextActive]}>{category.name}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

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
          ) : visibleFaqs.length === 0 ? (
            <Text style={s.noResults}>No topics found.</Text>
          ) : (
            <View style={s.faqList}>
              {visibleFaqs.map((faq) => (
                <FaqRow key={faq.id} item={faq} open={open === faq.id} onToggle={() => toggle(faq.id)} />
              ))}
            </View>
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
    paddingTop: 20,
    paddingBottom: 16,
  },
  searchBox: {
    height: 43,
    marginHorizontal: 33,
    borderRadius: 24,
    backgroundColor: "#FFFFFF",
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 13,
    gap: 9,
  },
  searchInput: {
    flex: 1,
    height: 43,
    padding: 0,
    color: "#151515",
    fontFamily: "Archivo_400Regular",
    fontSize: 13,
  },
  topicsTitle: {
    marginTop: 22,
    color: "#FFFFFF",
    fontFamily: "Archivo_700Bold",
    fontSize: 18,
    lineHeight: 22,
  },
  topicScroller: { marginTop: 7, marginHorizontal: -16 },
  topicList: { paddingHorizontal: 16, paddingRight: 34, gap: 5 },
  topic: {
    minHeight: 34,
    paddingHorizontal: 14,
    borderRadius: 18,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },
  topicActive: { backgroundColor: CYAN },
  topicText: { color: CYAN, fontFamily: "Archivo_400Regular", fontSize: 13, lineHeight: 16 },
  topicTextActive: { color: "#FFFFFF" },
  faqList: { gap: 12, marginTop: 24 },
  faqRow: {
    minHeight: 58,
    paddingHorizontal: 14,
    paddingVertical: 14,
    justifyContent: "center",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#D1D1D1",
    backgroundColor: "#FFFFFF",
  },
  faqRowOpen: { paddingBottom: 16 },
  faqQBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  faqQ: {
    flex: 1,
    color: CYAN,
    fontFamily: "Archivo_600SemiBold",
    fontSize: 16,
    lineHeight: 20,
  },
  faqA: { color: "#626262", fontFamily: "Archivo_400Regular", fontSize: 14, lineHeight: 18, marginTop: 12, paddingRight: 8 },
  noResults: { marginTop: 32, color: "#8A9191", fontFamily: "Archivo_400Regular", fontSize: 13, textAlign: "center" },
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
