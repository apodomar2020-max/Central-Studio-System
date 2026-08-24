import { router } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";
import { customFetch } from "@workspace/api-client-react";

type ContentPage = { title: string; subtitle?: string | null; content: string };
type FaqCategory = { id: number; name: string; sortOrder: number; isActive: boolean };
type FaqItem = { id: number; question: string; answer: string; sortOrder: number; isActive: boolean; category?: FaqCategory | null };
type HelpSupportResponse = { page: ContentPage; faqs: FaqItem[]; faqCategories?: FaqCategory[] };

const FALLBACK_PAGE: ContentPage = { title: "Help & Support", content: "" };

function SearchIcon() {
  return <Svg width={17} height={16} viewBox="0 0 17 16" fill="none"><Path d="M12.9685 12.8628L15.6133 15.4852" stroke="#03B6D7" strokeLinecap="round" /><Path d="M4.0894 1.45226C5.1453 0.846622 6.37123 0.5 7.6788 0.5C11.6435 0.5 14.8576 3.68682 14.8576 7.61796C14.8576 11.5491 11.6435 14.7359 7.6788 14.7359C3.71406 14.7359 0.5 11.5491 0.5 7.61796C0.5 6.32148 0.849585 5.10594 1.4604 4.05898" stroke="#03B6D7" strokeLinecap="round" /></Svg>;
}

function BackIcon() {
  return <Svg width={34} height={34} viewBox="0 0 34 34" fill="none"><Path d="M19.0839 12.1125L14.4968 16.6607L19.0839 21.2089" stroke="white" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" /><Path d="M32.0806 16.6607C32.0806 23.8075 32.0806 27.381 29.8413 29.6012C27.6022 31.8214 23.9981 31.8214 16.7903 31.8214C9.58238 31.8214 5.97842 31.8214 3.73922 29.6012C1.5 27.381 1.5 23.8075 1.5 16.6607C1.5 9.51388 1.5 5.94047 3.73922 3.72024C5.97842 1.5 9.58238 1.5 16.7903 1.5C23.9981 1.5 27.6022 1.5 29.8413 3.72024C31.3303 5.1965 31.8292 7.271 31.9964 10.5964" stroke="white" strokeWidth={3} strokeLinecap="round" /></Svg>;
}

function Chevron({ open }: { open: boolean }) {
  return <Svg width={11} height={6} viewBox="0 0 11 6" fill="none" style={open ? styles.chevronOpen : undefined}><Path d="M9.59644 5.08709L5.04822 0.5L0.500002 5.08709" stroke="#03B6D7" strokeLinecap="round" strokeLinejoin="round" /></Svg>;
}

function FaqRow({ item }: { item: FaqItem }) {
  const [open, setOpen] = useState(false);
  return <TouchableOpacity onPress={() => setOpen((value) => !value)} style={[styles.faqItem, open && styles.faqItemOpen]} activeOpacity={0.82}>
    <View style={styles.faqHeader}><Text style={styles.faqQuestion}>{item.question}</Text><Chevron open={open} /></View>
    {open ? <Text style={styles.faqAnswer}>{item.answer}</Text> : null}
  </TouchableOpacity>;
}

export default function HelpSupportScreen() {
  const insets = useSafeAreaInsets();
  const [page, setPage] = useState<ContentPage>(FALLBACK_PAGE);
  const [faqs, setFaqs] = useState<FaqItem[]>([]);
  const [categories, setCategories] = useState<FaqCategory[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    customFetch<HelpSupportResponse>("/api/content/help-support")
      .then((data) => { if (active) { setPage(data.page); setFaqs(data.faqs); setCategories(data.faqCategories ?? []); } })
      .catch(() => active && setPage(FALLBACK_PAGE))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, []);

  const visibleFaqs = useMemo(() => {
    const term = search.trim().toLowerCase();
    return faqs.filter((faq) => (selectedCategory === null || faq.category?.id === selectedCategory) && (!term || `${faq.question} ${faq.answer}`.toLowerCase().includes(term)));
  }, [faqs, search, selectedCategory]);

  return <View style={styles.container}>
    <View style={[styles.hero, { paddingTop: Platform.OS === "web" ? 18 : insets.top + 10 }]}>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Go back" onPress={() => router.back()} style={styles.backButton}><BackIcon /></TouchableOpacity>
      <View style={styles.heroTitleWrap}><Text style={styles.heroKicker}>How Can We</Text><Text style={styles.heroTitle}>Help You?</Text></View>
      <View style={styles.searchBox}><SearchIcon /><TextInput value={search} onChangeText={setSearch} placeholder="Search Topics..." placeholderTextColor="#03B6D7" style={styles.searchInput} returnKeyType="search" /></View>
    </View>

    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[styles.scroll, { paddingBottom: Platform.OS === "web" ? 44 : 32 }]}>
      <Text style={styles.topicsTitle}>Topics</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.topicList} style={styles.topicScroller}>
        <TouchableOpacity onPress={() => setSelectedCategory(null)} style={[styles.topic, selectedCategory === null && styles.topicActive]}><Text style={[styles.topicText, selectedCategory === null && styles.topicTextActive]}>All Topics</Text></TouchableOpacity>
        {categories.map((category) => <TouchableOpacity key={category.id} onPress={() => setSelectedCategory(category.id)} style={[styles.topic, selectedCategory === category.id && styles.topicActive]}><Text style={[styles.topicText, selectedCategory === category.id && styles.topicTextActive]}>{category.name}</Text></TouchableOpacity>)}
      </ScrollView>
      {loading ? <View style={styles.loading}><ActivityIndicator size="small" color="#03B6D7" /></View> : visibleFaqs.length ? <View style={styles.faqList}>{visibleFaqs.map((item) => <FaqRow key={item.id} item={item} />)}</View> : <Text style={styles.empty}>No topics found.</Text>}
    </ScrollView>
  </View>;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0D1110" },
  hero: { height: 267, backgroundColor: "#08B4D3", borderBottomLeftRadius: 30, borderBottomRightRadius: 30, zIndex: 2, elevation: 2 },
  backButton: { width: 34, height: 34, marginLeft: 16 },
  heroTitleWrap: { marginTop: 17, marginLeft: 69 },
  heroKicker: { color: "#FFFFFF", fontFamily: "Archivo_400Regular", fontSize: 25, lineHeight: 29, textTransform: "uppercase" },
  heroTitle: { color: "#FFFFFF", fontFamily: "Anton_400Regular", fontSize: 72, lineHeight: 68, textTransform: "uppercase" },
  scroll: { paddingTop: 40, paddingHorizontal: 17 },
  searchBox: { position: "absolute", left: 50, right: 50, bottom: -21, height: 43, borderRadius: 24, backgroundColor: "#FFFFFF", flexDirection: "row", alignItems: "center", paddingHorizontal: 13, gap: 9, zIndex: 10, elevation: 10 },
  searchInput: { flex: 1, padding: 0, color: "#151515", fontFamily: "Archivo_400Regular", fontSize: 13, height: 43 },
  topicsTitle: { color: "#FFFFFF", fontFamily: "Archivo_700Bold", fontSize: 18, lineHeight: 22 },
  topicScroller: { marginTop: 7, marginHorizontal: -17 },
  topicList: { paddingHorizontal: 17, gap: 5, paddingRight: 34 },
  topic: { minHeight: 34, paddingHorizontal: 14, borderRadius: 18, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center" },
  topicActive: { backgroundColor: "#04B5D7" },
  topicText: { color: "#03B6D7", fontFamily: "Archivo_400Regular", fontSize: 13, lineHeight: 16 },
  topicTextActive: { color: "#FFFFFF" },
  faqList: { gap: 12, marginTop: 26 },
  faqItem: { minHeight: 58, backgroundColor: "#FFFFFF", borderRadius: 10, borderWidth: 1, borderColor: "#D1D1D1", paddingHorizontal: 14, paddingVertical: 14, justifyContent: "center" },
  faqItemOpen: { paddingBottom: 16 },
  faqHeader: { flexDirection: "row", alignItems: "center", gap: 12 },
  faqQuestion: { flex: 1, color: "#03B6D7", fontFamily: "Archivo_600SemiBold", fontSize: 16, lineHeight: 20 },
  faqAnswer: { color: "#626262", fontFamily: "Archivo_400Regular", fontSize: 14, lineHeight: 18, marginTop: 12, paddingRight: 8 },
  chevronOpen: { transform: [{ rotate: "180deg" }] },
  loading: { minHeight: 160, alignItems: "center", justifyContent: "center" },
  empty: { marginTop: 32, color: "#8A9191", fontFamily: "Archivo_400Regular", fontSize: 13, textAlign: "center" },
});
