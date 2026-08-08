import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { customFetch } from "@workspace/api-client-react";

import colors from "@/constants/colors";

const FALLBACK_PAGE = {
  title: "Help & Support",
  subtitle: "Our team is available Saturday-Thursday, 10 AM - 9 PM",
  content: "Help & Support is temporarily unavailable. Please contact the studio directly for assistance.",
};

type ContactType =
  | "whatsapp"
  | "phone"
  | "facebook"
  | "instagram"
  | "tiktok"
  | "youtube"
  | "website"
  | "email";

type ContentPage = {
  title: string;
  subtitle?: string | null;
  content: string;
  isActive?: boolean;
};

type FaqCategory = {
  id: number;
  name: string;
  sortOrder: number;
  isActive: boolean;
};

type FaqItem = {
  id: number;
  question: string;
  answer: string;
  sortOrder: number;
  isActive: boolean;
  // Additive field — old cached responses / a stale server simply omit it,
  // which the grouping logic below treats identically to null (uncategorized).
  // Server nulls this out for FAQs whose category is inactive too (see
  // appContent.ts), so no separate "inactive category" branch is needed here.
  category?: FaqCategory | null;
};

type ContactLink = {
  id: number;
  type: ContactType;
  label: string;
  value: string;
  icon?: string | null;
  sortOrder: number;
  isActive: boolean;
};

type HelpSupportResponse = {
  page: ContentPage;
  faqs: FaqItem[];
  contacts: ContactLink[];
  // Additive, optional — absent on responses from a server that predates
  // FAQ categories. Always read via `data.faqCategories ?? []`.
  faqCategories?: FaqCategory[];
};

// UI-only fallback bucket for FAQs with no active category — never a
// persisted DB category (see APP_FAQ_CATEGORIES_IMPLEMENTATION_PLAN.md §4/§7.2).
const OTHER_QUESTIONS_LABEL = "Other Questions";

type FaqGroup = {
  key: string;
  title: string;
  items: FaqItem[];
};

/**
 * Group the flat, server-sorted `faqs` array by category, in a single pass
 * that preserves each item's existing relative order (no client-side
 * re-sort — the server's sortOrder,id order is trusted, exactly as before).
 * Categories are ordered per `faqCategories` (already sortOrder,id from the
 * server); "Other Questions" — uncategorized, or pointing at an inactive
 * category (server already nulls that out) — always renders last.
 */
function groupFaqsByCategory(faqs: FaqItem[], faqCategories: FaqCategory[]): FaqGroup[] {
  const byCategoryId = new Map<number, FaqItem[]>();
  const uncategorized: FaqItem[] = [];

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

const CONTACT_ICON: Record<ContactType, keyof typeof Ionicons.glyphMap> = {
  whatsapp: "logo-whatsapp",
  phone: "call-outline",
  facebook: "logo-facebook",
  instagram: "logo-instagram",
  tiktok: "logo-tiktok",
  youtube: "logo-youtube",
  website: "globe-outline",
  email: "mail-outline",
};

const CONTACT_COLOR: Record<ContactType, string> = {
  whatsapp: "#25D366",
  phone: colors.studio.primary,
  facebook: "#1877F2",
  instagram: "#E4405F",
  tiktok: "#FFFFFF",
  youtube: "#FF0000",
  website: colors.studio.primary,
  email: colors.studio.primary,
};

function normalizePhone(value: string): string {
  const trimmed = value.trim();
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/[^\d]/g, "");
  return hasPlus ? `+${digits}` : digits;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function buildContactUrl(link: ContactLink): string | null {
  const value = link.value.trim();
  if (!value) return null;

  switch (link.type) {
    case "whatsapp": {
      if (isHttpUrl(value)) return value;
      const digits = normalizePhone(value).replace(/[^\d]/g, "");
      return digits ? `https://wa.me/${digits}` : null;
    }
    case "phone": {
      const phone = normalizePhone(value);
      return phone ? `tel:${phone}` : null;
    }
    case "email":
      return value.includes("@") ? `mailto:${value}` : null;
    case "facebook":
    case "instagram":
    case "tiktok":
    case "youtube":
    case "website":
      return isHttpUrl(value) ? value : null;
    default:
      return null;
  }
}

function FaqRow({ item }: { item: FaqItem }) {
  const [open, setOpen] = useState(false);
  return (
    <TouchableOpacity
      onPress={() => setOpen((value) => !value)}
      style={styles.faqItem}
      activeOpacity={0.8}
    >
      <View style={styles.faqHeader}>
        <Text style={styles.faqQ}>{item.question}</Text>
        <Ionicons name={open ? "chevron-up" : "chevron-down"} size={16} color="#9CA3AF" />
      </View>
      {open && <Text style={styles.faqA}>{item.answer}</Text>}
    </TouchableOpacity>
  );
}

export default function HelpSupportScreen() {
  const insets = useSafeAreaInsets();
  const [page, setPage] = useState<ContentPage>(FALLBACK_PAGE);
  const [faqs, setFaqs] = useState<FaqItem[]>([]);
  const [faqCategories, setFaqCategories] = useState<FaqCategory[]>([]);
  const [contacts, setContacts] = useState<ContactLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let active = true;
    customFetch<HelpSupportResponse>("/api/content/help-support")
      .then((data) => {
        if (!active) return;
        setPage(data.page);
        setFaqs(data.faqs);
        setFaqCategories(data.faqCategories ?? []);
        setContacts(data.contacts);
        setUnavailable(false);
      })
      .catch((err: unknown) => {
        if (!active) return;
        const status =
          err !== null && typeof err === "object" && "status" in err
            ? (err as { status: number }).status
            : 0;
        if (status === 404) {
          setUnavailable(true);
          setPage({
            title: "Help & Support",
            subtitle: null,
            content: "Help & Support is currently unavailable. Please contact the studio directly for assistance.",
          });
        } else {
          setPage(FALLBACK_PAGE);
        }
        setFaqs([]);
        setFaqCategories([]);
        setContacts([]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const faqGroups = groupFaqsByCategory(faqs, faqCategories);

  async function openContact(link: ContactLink) {
    const url = buildContactUrl(link);
    if (!url) return;
    try {
      await Linking.openURL(url);
    } catch {
      // Ignore link failures; invalid values can be corrected from admin.
    }
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: Platform.OS === "web" ? 12 : insets.top + 12 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerButton}>
          <Ionicons name="chevron-back" size={20} color={colors.studio.primary} />
          <Text style={styles.headerButtonText}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{page.title}</Text>
        <View style={styles.headerButtonPlaceholder} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingBottom: Platform.OS === "web" ? 60 : 40 }]}
      >
        <LinearGradient
          colors={[`${colors.studio.primary}18`, colors.studio.card]}
          style={styles.hero}
        >
          <View style={styles.heroIcon}>
            {loading ? (
              <ActivityIndicator size="small" color={colors.studio.primary} />
            ) : (
              <Ionicons
                name={unavailable ? "alert-circle-outline" : "help-circle-outline"}
                size={22}
                color={colors.studio.primary}
              />
            )}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.heroTitle}>{page.title}</Text>
            {page.subtitle ? <Text style={styles.heroSubtitle}>{page.subtitle}</Text> : null}
          </View>
        </LinearGradient>

        {loading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="small" color={colors.studio.primary} />
            <Text style={styles.loadingText}>Loading support content...</Text>
          </View>
        ) : (
          <>
            {page.content.trim() ? <Text style={styles.content}>{page.content}</Text> : null}

            {contacts.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Contact Us</Text>
                <View style={styles.contactGrid}>
                  {contacts.map((link) => {
                    const color = CONTACT_COLOR[link.type] ?? colors.studio.primary;
                    return (
                      <TouchableOpacity
                        key={link.id}
                        onPress={() => void openContact(link)}
                        style={styles.contactBtn}
                        activeOpacity={0.78}
                      >
                        <View style={[styles.contactIcon, { backgroundColor: `${color}20` }]}>
                          <Ionicons
                            name={CONTACT_ICON[link.type] ?? "link-outline"}
                            size={20}
                            color={color}
                          />
                        </View>
                        <Text style={styles.contactLabel} numberOfLines={1}>{link.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            )}

            {faqs.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Frequently Asked Questions</Text>
                <View style={styles.faqGroups}>
                  {faqGroups.map((group) => (
                    <View key={group.key} style={styles.faqGroup}>
                      <Text style={styles.faqGroupTitle}>{group.title}</Text>
                      <View style={styles.faqList}>
                        {group.items.map((item) => <FaqRow key={item.id} item={item} />)}
                      </View>
                    </View>
                  ))}
                </View>
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0A0B0D" },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 20, paddingBottom: 16,
    borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.07)",
  },
  headerButton: {
    flexDirection: "row", alignItems: "center", gap: 4, minWidth: 54,
  },
  headerButtonText: {
    fontSize: 14, fontFamily: "Archivo_600SemiBold", color: colors.studio.primary,
  },
  headerTitle: { fontSize: 17, fontFamily: "Archivo_800ExtraBold", color: "#FFFFFF" },
  headerButtonPlaceholder: { minWidth: 54 },
  scroll: { paddingHorizontal: 20, paddingTop: 16, gap: 24 },
  hero: {
    flexDirection: "row", alignItems: "center", gap: 14,
    borderRadius: 16, padding: 18,
    borderWidth: 1, borderColor: "rgba(0,182,215,0.38)",
  },
  heroIcon: {
    width: 44, height: 44, borderRadius: 22,
    alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(0,182,215,0.1)",
  },
  heroTitle: { fontSize: 18, fontFamily: "Archivo_800ExtraBold", color: "#FFFFFF" },
  heroSubtitle: { marginTop: 4, fontSize: 13, fontFamily: "Archivo_400Regular", color: "#9CA3AF", lineHeight: 18 },
  loadingBox: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, paddingVertical: 24 },
  loadingText: { fontSize: 13, fontFamily: "Archivo_400Regular", color: "#9CA3AF" },
  content: { fontSize: 14, fontFamily: "Archivo_400Regular", color: "#9CA3AF", lineHeight: 22 },
  section: { gap: 14 },
  sectionTitle: { fontSize: 16, fontFamily: "Archivo_800ExtraBold", color: "#FFFFFF" },
  contactGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  contactBtn: {
    width: "30.8%",
    minWidth: 96,
    alignItems: "center",
    gap: 8,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    backgroundColor: "#15171B",
  },
  contactIcon: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center" },
  contactLabel: { fontSize: 12, fontFamily: "Archivo_600SemiBold", color: "#FFFFFF", textAlign: "center" },
  faqGroups: { gap: 18 },
  faqGroup: { gap: 10 },
  faqGroupTitle: { fontSize: 13, fontFamily: "Archivo_700Bold", color: "#9CA3AF", textTransform: "uppercase", letterSpacing: 0.4 },
  faqList: { gap: 8 },
  faqItem: {
    borderRadius: 14, borderWidth: 1, borderColor: "rgba(255,255,255,0.08)",
    backgroundColor: "#15171B", padding: 16, gap: 10,
  },
  faqHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  faqQ: { flex: 1, fontSize: 14, fontFamily: "Archivo_700Bold", color: "#FFFFFF", lineHeight: 18 },
  faqA: { fontSize: 14, fontFamily: "Archivo_400Regular", color: "#9CA3AF", lineHeight: 20 },
});
