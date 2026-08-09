import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

import type { AssessmentScheduleOption, BalletPackageOption } from "@/services/balletAssessmentService";
import type { ChildProfile } from "@/contexts/AppContext";
import { BA, BA_RADIUS } from "./assessmentTokens";

type SectionKey = "child" | "appointment" | "package";

function formatDate(value?: string) {
  if (!value) return "—";
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-GB", { weekday: "long", day: "2-digit", month: "long" });
}

function Section({
  title,
  icon,
  children,
  onEdit,
}: {
  title: string;
  icon: keyof typeof Ionicons.glyphMap;
  children: React.ReactNode;
  onEdit?: () => void;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <View style={styles.titleRow}>
          <Ionicons name={icon} size={17} color={BA.cyan400} />
          <Text style={styles.sectionTitle}>{title}</Text>
        </View>
        {onEdit ? (
          <TouchableOpacity onPress={onEdit} activeOpacity={0.75}>
            <Text style={styles.editText}>Edit</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      {children}
    </View>
  );
}

export default function BalletAssessmentSummaryCard({
  child,
  appointment,
  pkg,
  paymentLabel,
  assessmentFeeEgp,
  onEdit,
}: {
  child: ChildProfile;
  appointment: AssessmentScheduleOption;
  pkg: BalletPackageOption;
  paymentLabel: string;
  assessmentFeeEgp?: number | null;
  onEdit: (section: SectionKey) => void;
}) {
  const hasFee = assessmentFeeEgp != null && assessmentFeeEgp > 0;

  return (
    <View style={styles.card}>
      <Section title="Child" icon="happy-outline" onEdit={() => onEdit("child")}>
        <Text style={styles.primary}>{child.fullName}</Text>
        <Text style={styles.secondary}>Age {child.age || "—"} Years</Text>
      </Section>
      <Section title="Assessment" icon="calendar-outline" onEdit={() => onEdit("appointment")}>
        <Text style={styles.primary}>{appointment.className}</Text>
        <Text style={styles.secondary}>{formatDate(appointment.date)}</Text>
        <Text style={styles.secondary}>{appointment.time}</Text>
      </Section>
      <Section title="Preferred Package" icon="pricetag-outline" onEdit={() => onEdit("package")}>
        <Text style={styles.primary}>{pkg.name} ({pkg.priceEgp.toLocaleString("en-US")} EGP/mo)</Text>
        <Text style={styles.disclaimerText}>Preference only — Payment arranged after assessment approval.</Text>
      </Section>
      <Section title="Assessment Fee" icon="cash-outline">
        <Text style={styles.primary}>
          {hasFee ? `${assessmentFeeEgp?.toLocaleString("en-US")} EGP` : "Free / No Fee"}
        </Text>
        <Text style={styles.secondary}>
          {hasFee ? "Payable at studio during assessment appointment" : "No assessment fee required"}
        </Text>
      </Section>
      <Section title="Payment Method" icon="card-outline">
        <Text style={styles.primary}>{paymentLabel}</Text>
      </Section>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: BA_RADIUS.xl,
    borderWidth: 1,
    borderColor: "rgba(0,182,215,0.28)",
    backgroundColor: BA.ink800,
    paddingHorizontal: 16,
    paddingVertical: 2,
  },
  section: {
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.07)",
    gap: 4,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 2,
  },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  sectionTitle: {
    color: BA.ink300,
    fontFamily: "SpaceMono_700Bold",
    fontSize: 10,
    letterSpacing: 0.9,
    textTransform: "uppercase",
  },
  editText: {
    color: BA.cyan400,
    fontFamily: "Archivo_800ExtraBold",
    fontSize: 12.5,
  },
  primary: {
    color: BA.white,
    fontFamily: "Archivo_800ExtraBold",
    fontSize: 15,
  },
  secondary: {
    color: BA.ink300,
    fontFamily: "Archivo_400Regular",
    fontSize: 13,
    lineHeight: 18,
  },
  disclaimerText: {
    color: BA.cyan400,
    fontFamily: "Archivo_400Regular",
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2,
  },
});
