/**
 * app/ballet/index.tsx — Ballet entry gate
 *
 * This is the ONLY screen users navigate to when opening the ballet section.
 * It fetches the parent's applications first (before rendering any form or status
 * screen), decides which screen is appropriate, and replaces immediately.
 *
 * Navigation decision:
 *   - At least one ACTIVE application → /ballet/application-status
 *   - No active applications (or any error/offline) → /ballet/assessment
 *
 * Why this file exists:
 *   Previously, assessment.tsx was the entry point. It would render the form UI
 *   first, then asynchronously check for active applications and redirect if one
 *   was found. This caused a ~1–2 second flicker where the form was visible before
 *   the redirect fired. By making this gate the entry point, the form never renders
 *   until we know the parent needs to see it.
 */

import React, { useEffect } from "react";
import { ActivityIndicator, Platform, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  fetchMyApplications,
  ACTIVE_APPLICATION_STATUSES,
} from "@/services/balletAssessmentService";
import colors from "@/constants/colors";

const BALLET_COLOR = "#00B6D6";

export default function BalletGate() {
  const insets = useSafeAreaInsets();

  useEffect(() => {
    const ctrl = new AbortController();

    fetchMyApplications(ctrl.signal)
      .then((apps) => {
        if (ctrl.signal.aborted) return;
        const hasActive = apps.some((a) => ACTIVE_APPLICATION_STATUSES.has(a.status));
        if (hasActive) {
          router.replace("/ballet/application-status" as any);
        } else {
          router.replace("/ballet/assessment" as any);
        }
      })
      .catch(() => {
        if (ctrl.signal.aborted) return;
        // Any error (offline, network, 401) → fall through to assessment.
        // The assessment screen handles its own offline gate.
        router.replace("/ballet/assessment" as any);
      });

    return () => ctrl.abort();
  }, []);

  return (
    <View
      style={[
        gateStyles.container,
        { paddingTop: Platform.OS === "web" ? 67 : insets.top },
      ]}
    >
      <View style={gateStyles.iconWrap}>
        <Ionicons name="musical-notes" size={36} color={BALLET_COLOR} />
      </View>
      <Text style={gateStyles.title}>Ballet Program</Text>
      <Text style={gateStyles.subtitle}>Loading your details…</Text>
      <ActivityIndicator
        size="small"
        color={BALLET_COLOR}
        style={gateStyles.spinner}
      />
    </View>
  );
}

const gateStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.studio.background,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  iconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: `${BALLET_COLOR}18`,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
    borderWidth: 1,
    borderColor: `${BALLET_COLOR}30`,
  },
  title: {
    fontSize: 20,
    fontFamily: "Inter_700Bold",
    color: "#FFFFFF",
  },
  subtitle: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: "#6B7280",
  },
  spinner: { marginTop: 12 },
});
