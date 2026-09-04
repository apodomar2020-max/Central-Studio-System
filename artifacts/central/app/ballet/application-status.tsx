import { Ionicons } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { GlassView } from "expo-glass-effect";
import { Image as ExpoImage } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
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
import Svg, { Path } from "react-native-svg";

import AppButton from "@/components/AppButton";
import CentralBackButton from "@/components/CentralBackButton";
import OfflineState from "@/components/OfflineState";
import {
  ACTIVE_APPLICATION_STATUSES,
  fetchBalletApplicationDetail,
  fetchBalletClasses,
  fetchBalletGroups,
  fetchBalletLevels,
  fetchMyApplications,
  groupBalletSchedulesByGroupId,
  isOfflineError,
  type BalletApplication,
  type BalletApplicationDetail,
  type BalletClassSchedule,
  type ResolvedBalletSchedule,
} from "@/services/balletAssessmentService";
import { scheduleLocationLabel } from "@/utils/scheduleLocation";

const CYAN = "#03B6D7";
const TEAL = "#012329";
const GREEN = "#20C65A";
const AMBER = "#FFBE00";
const HERO_ART = require("@/assets/images/ballerina-card.png");
const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type TabKey = "status" | "application" | "attendance";

interface StatusMeta {
  label: string;
  description: string;
  color: string;
}

function formatTime(value: string): string {
  const [hourText = "0", minuteText = "00"] = value.split(":");
  const hour = Number(hourText);
  if (!Number.isFinite(hour)) return value;
  return `${hour % 12 || 12}:${minuteText.slice(0, 2)} ${hour >= 12 ? "PM" : "AM"}`;
}

function parseDateValue(value: string | null | undefined): Date | null {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const isoDate = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (isoDate) {
    const parsed = new Date(Date.UTC(Number(isoDate[1]), Number(isoDate[2]) - 1, Number(isoDate[3]), 12));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const slashDate = /^(\d{1,2})[\/]([0-9]{1,2})[\/](\d{4})$/.exec(raw);
  if (slashDate) {
    const parsed = new Date(Date.UTC(Number(slashDate[3]), Number(slashDate[2]) - 1, Number(slashDate[1]), 12));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const numeric = /^\d{10,13}$/.test(raw) ? Number(raw) : Number.NaN;
  const parsed = new Date(Number.isFinite(numeric) ? (raw.length === 10 ? numeric * 1000 : numeric) : raw.replace(" ", "T"));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDateValue(value: string | null | undefined): string {
  const date = parseDateValue(value);
  if (!date) return "Not Set";
  return `${date.getUTCFullYear()}/${String(date.getUTCMonth() + 1).padStart(2, "0")}/${String(date.getUTCDate()).padStart(2, "0")}`;
}

function calculateAge(birthday: string | null): number | null {
  const date = parseDateValue(birthday);
  if (!date) return null;
  const today = new Date();
  let age = today.getFullYear() - date.getUTCFullYear();
  if (today.getMonth() < date.getUTCMonth() || (today.getMonth() === date.getUTCMonth() && today.getDate() < date.getUTCDate())) age -= 1;
  return age >= 0 ? age : null;
}

function getStatusMeta(status: string, levelName?: string | null, groupName?: string | null, schedules?: Array<BalletClassSchedule | ResolvedBalletSchedule>): StatusMeta {
  const groupPart = groupName ? ` in group “${groupName}”` : "";
  const schedulePart = schedules?.length
    ? ` (meets ${schedules.map((schedule) => `${DAY_SHORT[schedule.dayOfWeek] ?? ""} ${formatTime(schedule.startTime)}`).join(", ")})`
    : "";
  switch (status) {
    case "pending":
      return { label: "Under Review", color: AMBER, description: "Your application and assessment appointment are on file. Our team is reviewing your application and will confirm next step soon" };
    case "needsFollowUp":
      return { label: "Follow-up Required", color: AMBER, description: "Our team needs a little more information and will contact you shortly." };
    case "accepted":
      return { label: "Accepted", color: GREEN, description: "Your child has been accepted into our Ballet program. Our team will contact you with the next enrollment step." };
    case "assignedToLevel":
      return { label: "Level Assigned", color: CYAN, description: levelName ? `Your child has been assigned to ${levelName}${groupPart}.` : "Your child has been assigned to a Ballet level." };
    case "active":
      return { label: "Active Student", color: GREEN, description: levelName ? `Your child is currently an active ballet student in ${levelName}${groupPart}${schedulePart} at Central Studio` : "Your child is currently an active Ballet student at Central Studio." };
    case "rejected":
      return { label: "Not Accepted", color: "#F04444", description: "This application was not accepted. You may contact the studio for more information." };
    case "cancelled":
      return { label: "Cancelled", color: "#A7A7A7", description: "This application has been cancelled." };
    case "withdrawn":
      return { label: "Enrollment Ended", color: "#A7A7A7", description: "This Ballet enrollment has ended." };
    default:
      return { label: status, color: "#A7A7A7", description: "Please contact the studio for more information." };
  }
}

function StatCard({ label, value, empty }: { label: string; value: string; empty?: boolean }) {
  return (
    <GlassView
      glassEffectStyle="clear"
      tintColor="rgba(185,244,255,0.10)"
      colorScheme="dark"
      style={styles.statGlassShell}
    >
      <BlurView
        intensity={10}
        tint="dark"
        experimentalBlurMethod="dimezisBlurView"
        blurReductionFactor={3}
        style={styles.statCard}
      >
        <LinearGradient
          colors={["rgba(255,255,255,0.11)", "rgba(212,250,255,0.018)", "rgba(123,222,237,0.045)"]}
          locations={[0, 0.48, 1]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <Text style={styles.statLabel}>{label}</Text>
        <View style={styles.statRule} />
        <Text style={[styles.statValue, empty && styles.statValueEmpty]} numberOfLines={2}>{value}</Text>
      </BlurView>
    </GlassView>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

export default function ApplicationStatusScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const requestedApplicationIdParam = Array.isArray(params.id) ? params.id[0] : params.id;
  const requestedApplicationId = Number(requestedApplicationIdParam);

  const [loadState, setLoadState] = useState<"loading" | "success" | "empty" | "offline" | "error">("loading");
  const [application, setApplication] = useState<BalletApplication | null>(null);
  const [applicationDetail, setApplicationDetail] = useState<BalletApplicationDetail | null>(null);
  const [hasExplicitApplicationContext, setHasExplicitApplicationContext] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>("status");
  const [levelNameById, setLevelNameById] = useState<Map<number, string>>(new Map());
  const [groupNameById, setGroupNameById] = useState<Map<number, string>>(new Map());
  const [schedulesByGroupId, setSchedulesByGroupId] = useState<Map<number, BalletClassSchedule[]>>(new Map());

  useFocusEffect(useCallback(() => {
    const controller = new AbortController();
    Promise.all([fetchBalletLevels(controller.signal), fetchBalletGroups(controller.signal), fetchBalletClasses(controller.signal)])
      .then(([levels, groups, classes]) => {
        if (controller.signal.aborted) return;
        setLevelNameById(new Map(levels.map((level) => [level.id, level.name])));
        setGroupNameById(new Map(groups.map((group) => [group.id, group.name])));
        setSchedulesByGroupId(groupBalletSchedulesByGroupId(classes));
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []));

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoadState("loading");
    try {
      const applications = await fetchMyApplications(signal);
      if (signal?.aborted) return;
      if (applications.length === 0) {
        setApplication(null);
        setApplicationDetail(null);
        setLoadState("empty");
        return;
      }
      const requested = Number.isInteger(requestedApplicationId) && requestedApplicationId > 0
        ? applications.find((candidate) => candidate.id === requestedApplicationId) ?? null
        : null;
      if (requestedApplicationIdParam != null && requested == null) {
        setApplication(null);
        setApplicationDetail(null);
        setHasExplicitApplicationContext(false);
        setLoadState("error");
        return;
      }
      const onlyApplication = applications.length === 1 ? applications[0] ?? null : null;
      const selected = requested ?? onlyApplication ?? applications[0] ?? null;
      if (!selected) {
        setLoadState("empty");
        return;
      }
      setHasExplicitApplicationContext(requested != null || onlyApplication != null);
      setApplication(selected);
      try {
        const detail = await fetchBalletApplicationDetail(selected.id, signal);
        if (!signal?.aborted) setApplicationDetail(detail);
      } catch {
        if (!signal?.aborted) setApplicationDetail(null);
      }
      if (!signal?.aborted) setLoadState("success");
    } catch (error) {
      if ((error as { name?: string })?.name === "AbortError") return;
      setLoadState(isOfflineError(error) ? "offline" : "error");
    }
  }, [requestedApplicationId, requestedApplicationIdParam]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const paddingTop = Platform.OS === "web" ? 18 : insets.top;

  if (loadState === "loading") return <View style={styles.stateScreen}><ActivityIndicator size="large" color={CYAN} /><Text style={styles.stateText}>Loading application…</Text></View>;
  if (loadState === "offline") return <View style={styles.stateScreen}><OfflineState onRetry={() => void load()} /></View>;
  if (loadState === "error") return <View style={styles.stateScreen}><Ionicons name="alert-circle-outline" size={42} color="#EF4444" /><Text style={styles.stateText}>Failed to load this application.</Text><AppButton title="Retry" onPress={() => void load()} /></View>;
  if (loadState === "empty") return <View style={styles.stateScreen}><Ionicons name="document-outline" size={48} color="#64717A" /><Text style={styles.stateText}>No Ballet applications found.</Text><AppButton title="Start Application" onPress={() => router.replace("/ballet/assessment" as never)} /></View>;
  if (!application) return null;

  const levelName = application.assignedLevelId == null ? null : levelNameById.get(application.assignedLevelId) ?? null;
  const groupName = application.assignedGroupId == null ? null : groupNameById.get(application.assignedGroupId) ?? null;
  const fallbackSchedules = application.assignedGroupId == null ? [] : schedulesByGroupId.get(application.assignedGroupId) ?? [];
  const schedules: Array<BalletClassSchedule | ResolvedBalletSchedule> = application.resolvedSchedules?.length ? application.resolvedSchedules : fallbackSchedules;
  const meta = getStatusMeta(application.status, levelName, groupName, schedules);
  const age = application.childAge ?? calculateAge(application.childBirthday);
  const ageValue = age == null ? "NOT SET" : `${age} YEAR${age === 1 ? "" : "S"}`;
  const levelValue = levelName?.toUpperCase() ?? "NOT SET";
  const groupValue = groupName?.toUpperCase() ?? "NOT SET";
  const locations = [...new Set(schedules.map((schedule) => scheduleLocationLabel({ branch: schedule.branch, room: schedule.room })).filter((value): value is string => Boolean(value)))];
  const attendance = application.attendanceSummary;
  const openCancellationRequest = applicationDetail?.openCancellationRequest;
  const isTerminal = !ACTIVE_APPLICATION_STATUSES.has(application.status);
  const attendanceAvailable = application.status === "active";

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.applicationChrome}>
          <View pointerEvents="none" style={styles.pageBackgroundCrop}>
            <ExpoImage
              source={HERO_ART}
              style={styles.pageBackgroundImage}
              contentFit="cover"
              contentPosition="top center"
            />
          </View>
          <View style={[styles.hero, { paddingTop }]}>
            <CentralBackButton style={[styles.backButton, { top: paddingTop + 20 }]} />
            <Text style={[styles.headerTitle, { top: paddingTop + 24 }]}>Ballet Application</Text>
          </View>

          <View style={styles.applicationPanel}>
            <View style={styles.tabs}>
              {(["status", "application", "attendance"] as TabKey[]).map((tab) => {
                const disabled = tab === "attendance" && !attendanceAvailable;
                return (
                  <TouchableOpacity key={tab} disabled={disabled} onPress={() => setActiveTab(tab)} style={[styles.tab, activeTab === tab && styles.tabActive, disabled && styles.tabDisabled]}>
                    <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>{tab === "status" ? "Status" : tab === "application" ? "Application" : "Attendance"}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={styles.contentArea}>
              <Text style={styles.childName}>{application.childName}</Text>
              <Text style={[styles.statusName, { color: meta.color }]}>{meta.label}</Text>

            {!hasExplicitApplicationContext ? (
              <View style={styles.contextWarning}>
                <Text style={styles.contextWarningTitle}>Choose the child first</Text>
                <Text style={styles.contextWarningText}>Open a student from the Ballet Program page to view the correct application.</Text>
              </View>
            ) : null}

            {activeTab === "status" ? (
              <View style={styles.tabContent}>
                <Text style={styles.description}>{meta.description}</Text>
                {application.status === "active" && schedules.map((schedule, index) => (
                  <InfoRow key={`${schedule.dayOfWeek}-${schedule.startTime}-${index}`} label={`Class Date ${index + 1}`} value={`${DAY_SHORT[schedule.dayOfWeek] ?? ""} ${formatTime(schedule.startTime)}`} />
                ))}
                {application.status === "active" && locations.length > 0 ? <InfoRow label="Location" value={locations.join(", ")} /> : null}
                {application.adminNotes ? <View style={styles.noteBox}><Text style={styles.noteTitle}>Note from Studio</Text><Text style={styles.noteText}>{application.adminNotes}</Text></View> : null}
              </View>
            ) : null}

            {activeTab === "application" ? (
              application.status === "pending" || application.status === "needsFollowUp" ? (
                <View style={styles.tabContent}>
                  <Text style={styles.nextTitle}>Under What Happens Next?</Text>
                  {["Our Team Review Your Application", "We Contact You To Confirm Your Assessment Appointment", "Your Child Attends The 30-Min Assessment Session", "You Receive The Result Within 48hours"].map((step, index) => <Text key={step} style={styles.nextStep}>{index + 1}. {step}</Text>)}
                </View>
              ) : (
                <View style={styles.tabContent}>
                  <InfoRow label="Assessment Date" value={formatDateValue(application.assessmentDate)} />
                  <InfoRow label="Submitted" value={formatDateValue(application.createdAt)} />
                  <InfoRow label="Application ID" value={`#${application.id}`} />
                </View>
              )
            ) : null}

            {activeTab === "attendance" ? (
              <View style={styles.tabContent}>
                {attendance ? (
                  <>
                    <InfoRow label="Expiration Date" value={formatDateValue(attendance.subscriptionExpiresAt)} />
                    {attendance.hasActiveSubscription ? <InfoRow label="Monthly Hours" value={`${attendance.monthlyHours ?? 0}h`} /> : null}
                    <InfoRow label="Attended" value={`${attendance.attendedHours}h`} />
                    <InfoRow label="Absent" value={`${attendance.absentHours}h`} />
                    {attendance.hasActiveSubscription ? <InfoRow label="Consumed" value={`${attendance.consumedHours}h`} /> : null}
                    {attendance.hasActiveSubscription ? <InfoRow label="Remaining" value={`${attendance.remainingHours ?? 0}h`} /> : null}
                    {!attendance.hasActiveSubscription ? <Text style={styles.description}>No active paid plan is available.</Text> : null}
                  </>
                ) : <Text style={styles.description}>Attendance details are not available for the current plan.</Text>}
              </View>
            ) : null}

              {openCancellationRequest ? (
                <View style={styles.requestBox}>
                  <Text style={styles.requestTitle}>Cancellation Request: {openCancellationRequest.status}</Text>
                  <Text style={styles.requestCopy}>Timing: {openCancellationRequest.approvedTiming ?? openCancellationRequest.requestedTiming}</Text>
                </View>
              ) : null}
            </View>
          </View>

          <View style={styles.statsRow}>
            <StatCard label="Age" value={ageValue} empty={age == null} />
            <StatCard label="Level" value={levelValue} empty={!levelName} />
            <StatCard label="Group" value={groupValue} empty={!groupName} />
          </View>
        </View>

        {isTerminal ? <TouchableOpacity onPress={() => router.replace("/ballet/assessment" as never)} style={styles.primaryFooterButton}><Text style={styles.primaryFooterText}>Submit New Application</Text></TouchableOpacity> : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#000000" },
  stateScreen: { flex: 1, backgroundColor: "#000000", alignItems: "center", justifyContent: "center", gap: 14, padding: 24 },
  stateText: { color: "#FFFFFF", fontFamily: "Archivo_500Medium", fontSize: 14, textAlign: "center" },
  scrollContent: { paddingBottom: Platform.OS === "web" ? 54 : 30, backgroundColor: "#000000" },
  applicationChrome: { position: "relative", overflow: "hidden", backgroundColor: "#000000" },
  pageBackgroundCrop: { position: "absolute", top: 0, right: 0, bottom: 36, left: 0, overflow: "hidden" },
  pageBackgroundImage: { position: "absolute", top: 0, right: 0, bottom: -36, left: 0 },
  hero: { height: 317, position: "relative", zIndex: 1, backgroundColor: "transparent" },
  backButton: { position: "absolute", left: 15, width: 34, height: 34, zIndex: 4 },
  headerTitle: { position: "absolute", left: 58, right: 18, color: "#FFFFFF", fontFamily: "Anton_400Regular", fontSize: 25, lineHeight: 30, textAlign: "center", textTransform: "uppercase", zIndex: 3 },
  statsRow: { position: "absolute", left: 33, right: 33, top: 240, flexDirection: "row", gap: 10, zIndex: 3 },
  statGlassShell: { flex: 1, height: 140, borderRadius: 17, overflow: "hidden", borderWidth: 1, borderColor: "rgba(231,253,255,0.24)", backgroundColor: "rgba(164,225,233,0.012)" },
  statCard: { flex: 1, width: "100%", alignItems: "center", paddingHorizontal: 7, paddingTop: 31, backgroundColor: "transparent" },
  statLabel: { color: "#FFFFFF", fontFamily: "Anton_400Regular", fontSize: 18, lineHeight: 22, textTransform: "uppercase", textShadowColor: "transparent", textShadowRadius: 0, textShadowOffset: { width: 0, height: 0 } },
  statRule: { width: "72%", height: 1, backgroundColor: "rgba(255,255,255,0.75)", marginTop: 16, marginBottom: 16 },
  statValue: { color: "#FFFFFF", fontFamily: "Anton_400Regular", fontSize: 15, lineHeight: 18, textAlign: "center", textTransform: "uppercase", textShadowColor: "transparent", textShadowRadius: 0, textShadowOffset: { width: 0, height: 0 } },
  statValueEmpty: { color: AMBER },
  applicationPanel: { marginTop: -12, minHeight: 455, zIndex: 1, borderTopLeftRadius: 50, borderTopRightRadius: 50, borderBottomLeftRadius: 50, borderBottomRightRadius: 50, backgroundColor: TEAL, paddingTop: 91, paddingHorizontal: 34, paddingBottom: 30 },
  tabs: { height: 47, marginTop: 16, borderRadius: 23.5, backgroundColor: "#003741", flexDirection: "row", alignItems: "center", padding: 7, gap: 3 },
  tab: { flex: 1, height: 33, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  tabActive: { backgroundColor: "#048BA4" },
  tabDisabled: { opacity: 0.27 },
  tabText: { color: "#087788", fontFamily: "Archivo_400Regular", fontSize: 13 },
  tabTextActive: { color: "#FFFFFF" },
  contentArea: { paddingTop: 40, minHeight: 280 },
  childName: { color: CYAN, fontFamily: "Anton_400Regular", fontSize: 39, lineHeight: 43 },
  statusName: { fontFamily: "Archivo_700Bold", fontSize: 15, lineHeight: 20, marginTop: 1 },
  tabContent: { marginTop: 18, gap: 3 },
  description: { color: "#DCE5E6", fontFamily: "Archivo_400Regular", fontSize: 13, lineHeight: 18, marginBottom: 5 },
  infoRow: { minHeight: 36, flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 14, paddingVertical: 7 },
  infoLabel: { flex: 1, color: "#FFFFFF", fontFamily: "Archivo_400Regular", fontSize: 14.5, lineHeight: 20 },
  infoValue: { flex: 1, color: "#FFFFFF", fontFamily: "Archivo_700Bold", fontSize: 14.5, lineHeight: 20, textAlign: "right" },
  nextTitle: { color: "#FFFFFF", fontFamily: "Archivo_700Bold", fontSize: 14.5, lineHeight: 19, marginBottom: 6 },
  nextStep: { color: "#FFFFFF", fontFamily: "Archivo_400Regular", fontSize: 11.5, lineHeight: 19, marginBottom: 8 },
  noteBox: { borderRadius: 14, backgroundColor: "rgba(0,182,214,0.12)", padding: 12, marginTop: 10 },
  noteTitle: { color: CYAN, fontFamily: "Archivo_700Bold", fontSize: 12, marginBottom: 4 },
  noteText: { color: "#FFFFFF", fontFamily: "Archivo_400Regular", fontSize: 12, lineHeight: 17 },
  requestBox: { borderRadius: 14, borderWidth: 1, borderColor: "rgba(255,190,0,0.35)", backgroundColor: "rgba(255,190,0,0.07)", padding: 12, marginTop: 15 },
  contextWarning: { borderRadius: 14, borderWidth: 1, borderColor: "rgba(3,182,215,0.35)", backgroundColor: "rgba(3,182,215,0.09)", padding: 12, marginTop: 14 },
  contextWarningTitle: { color: "#FFFFFF", fontFamily: "Archivo_700Bold", fontSize: 12.5 },
  contextWarningText: { color: "#C7D4D6", fontFamily: "Archivo_400Regular", fontSize: 11.5, lineHeight: 17, marginTop: 4 },
  requestTitle: { color: AMBER, fontFamily: "Archivo_700Bold", fontSize: 12.5, textTransform: "capitalize" },
  requestCopy: { color: "#FFFFFF", fontFamily: "Archivo_400Regular", fontSize: 12, marginTop: 5 },
  primaryFooterButton: { height: 51, borderRadius: 999, marginHorizontal: 20, marginTop: 14, backgroundColor: CYAN, alignItems: "center", justifyContent: "center" },
  primaryFooterText: { color: "#FFFFFF", fontFamily: "Archivo_700Bold", fontSize: 15 },
});
