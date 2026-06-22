/**
 * app/ballet/faq.tsx — Ballet FAQ
 *
 * Static accordion FAQ mirroring the design source, with a contact CTA.
 * No backend FAQ table exists — documented in the backend gap report.
 */

import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useRef, useState } from "react";
import {
  Animated,
  LayoutAnimation,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  UIManager,
  View,
} from "react-native";

import { BalletPageShell, BAL } from "@/components/ballet/BalletPageShell";

if (
  Platform.OS === "android" &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const FAQS: { q: string; a: string }[] = [
  { q: "What age can my child start?", a: "Pre Ballet accepts children from age 3. Adult beginners are also welcome at any age." },
  { q: "How often are level assessments held?", a: "Every 6 months. Students are only assessed when the instructor recommends them." },
  { q: "What is the dress code?", a: "Girls: pink/black leotard, pink tights, pink ballet shoes. Boys: white tee, black shorts, black ballet shoes." },
  { q: "Are assessments included in class fees?", a: "The initial placement assessment is free. Level assessments cost EGP 150." },
  { q: "Is the showcase mandatory?", a: "Strongly encouraged but not mandatory for students below Intermediate level." },
  { q: "Can adults join the program?", a: "Yes! We have adult beginner and elementary tracks. Contact us for scheduling." },
];

function FaqRow({
  item,
  open,
  onToggle,
  isLast,
}: {
  item: { q: string; a: string };
  open: boolean;
  onToggle: () => void;
  isLast: boolean;
}) {
  const rot = useRef(new Animated.Value(open ? 1 : 0)).current;
  React.useEffect(() => {
    Animated.timing(rot, { toValue: open ? 1 : 0, duration: 200, useNativeDriver: true }).start();
  }, [open]);
  const rotate = rot.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "90deg"] });

  return (
    <View style={[s.faqRow, !isLast && s.faqRowBorder]}>
      <TouchableOpacity onPress={onToggle} style={s.faqQBtn} activeOpacity={0.7}>
        <Text style={s.faqQ}>{item.q}</Text>
        <Animated.View style={{ transform: [{ rotate }] }}>
          <Ionicons name="chevron-forward" size={17} color={BAL.CYAN} />
        </Animated.View>
      </TouchableOpacity>
      {open && <Text style={s.faqA}>{item.a}</Text>}
    </View>
  );
}

export default function BalletFaqScreen() {
  const [open, setOpen] = useState<number | null>(null);

  function toggle(i: number) {
    Haptics.selectionAsync();
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setOpen((cur) => (cur === i ? null : i));
  }

  return (
    <BalletPageShell title="FAQ" contentStyle={s.content}>
      <View style={s.accordion}>
        {FAQS.map((f, i) => (
          <FaqRow
            key={i}
            item={f}
            open={open === i}
            onToggle={() => toggle(i)}
            isLast={i === FAQS.length - 1}
          />
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
    </BalletPageShell>
  );
}

const s = StyleSheet.create({
  content: { padding: 20, gap: 12 },
  accordion: {
    backgroundColor: BAL.CARD,
    borderWidth: 1,
    borderColor: "rgba(0,182,215,0.14)",
    borderRadius: BAL.R_LG,
    overflow: "hidden",
  },
  faqRow: { paddingHorizontal: 16 },
  faqRowBorder: { borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.06)" },
  faqQBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
    gap: 10,
  },
  faqQ: { flex: 1, fontSize: 14, fontFamily: "Archivo_700Bold", color: "#fff" },
  faqA: { fontSize: 13, fontFamily: "Archivo_400Regular", color: BAL.INK_300, lineHeight: 21, paddingBottom: 14 },
  contactBtn: {
    paddingVertical: 13,
    borderRadius: BAL.R_MD,
    backgroundColor: "rgba(0,182,215,0.12)",
    borderWidth: 1.5,
    borderColor: "rgba(0,182,215,0.30)",
    alignItems: "center",
  },
  contactBtnText: { fontSize: 14, fontFamily: "Archivo_700Bold", color: BAL.CYAN },
});
