import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import Svg, { Path } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import BalletAssessmentAppointmentCard from "@/components/ballet/BalletAssessmentAppointmentCard";
import BalletAssessmentChildCard from "@/components/ballet/BalletAssessmentChildCard";
import BalletAssessmentHeader from "@/components/ballet/BalletAssessmentHeader";
import BalletAssessmentPackageCard from "@/components/ballet/BalletAssessmentPackageCard";
import BalletAssessmentSuccessActions from "@/components/ballet/BalletAssessmentSuccessActions";
import BalletAssessmentSummaryCard from "@/components/ballet/BalletAssessmentSummaryCard";
import BalletStepIndicator from "@/components/ballet/BalletStepIndicator";
import { BA, BA_RADIUS } from "@/components/ballet/assessmentTokens";
import ErrorState from "@/components/ErrorState";
import OfflineState from "@/components/OfflineState";
import { SkeletonBox } from "@/components/SkeletonLoader";
import { useAppContext, type ChildProfile } from "@/contexts/AppContext";
import { nextStepRoute } from "@/services/authProfile";
import {
  ACTIVE_APPLICATION_STATUSES,
  AssessmentScheduleOption,
  BalletApplication,
  BalletPackageOption,
  cancelBalletApplication,
  fetchBalletApplicationDetail,
  fetchAvailableAssessmentSchedules,
  fetchBalletPackages,
  fetchMyApplications,
  isOfflineError,
  submitBalletApplication,
  updateBalletApplication,
} from "@/services/balletAssessmentService";
import { showAuthRequiredPrompt, showParentAccountRequiredPrompt } from "@/utils/authRequired";
import { iosDisplayTextStyle, iosTextInputStyle } from "@/utils/iosTypography";

const RETURN_TO_ASSESSMENT = "/ballet/assessment";
const BLOCKING_CHILD_APPLICATION_STATUSES = new Set([
  ...ACTIVE_APPLICATION_STATUSES,
]);

const CANONICAL_PAYMENT_METHOD = "inPerson" as const;
const CANONICAL_PAYMENT_LABEL = "Pay at Studio";

type Step = "child" | "appointment" | "package" | "review";

const STEP_ORDER: Step[] = ["child", "appointment", "package", "review"];

type LoadState = "loading" | "ready" | "empty" | "error" | "offline";

function calculateAge(birthday?: string | null): number {
  if (!birthday || !/^\d{4}-\d{2}-\d{2}$/.test(birthday)) return 0;
  const [y, m, d] = birthday.split("-").map((part) => Number(part));
  if ([y, m, d].some((part) => Number.isNaN(part))) return 0;
  const today = new Date();
  let age = today.getFullYear() - y;
  if (today.getMonth() < m - 1 || (today.getMonth() === m - 1 && today.getDate() < d)) age -= 1;
  return Math.max(age, 0);
}

function formatDisplayDate(value?: string | null, withWeekday = false) {
  if (!value) return "—";
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-GB", {
    weekday: withWeekday ? "long" : undefined,
    day: "2-digit",
    month: "long",
    year: withWeekday ? undefined : "numeric",
  });
}

function getChildApplicationStatus(child: ChildProfile, applications: BalletApplication[]) {
  const childId = Number(child.id);
  const matching = applications.find((app) => {
    if (!Number.isNaN(childId) && app.childId === childId) return true;
    const sameName = app.childName.trim().toLowerCase() === child.fullName.trim().toLowerCase();
    const sameBirthday = !!child.birthday && app.childBirthday === child.birthday;
    return sameName && sameBirthday;
  });
  return matching?.status ?? null;
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  multiline,
  style,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  keyboardType?: "default" | "number-pad";
  multiline?: boolean;
  style?: object;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="rgba(255,255,255,0.34)"
        keyboardType={keyboardType}
        multiline={multiline}
        textAlignVertical={multiline ? "top" : "center"}
        style={[styles.input, style]}
      />
    </View>
  );
}

function LoadingCards() {
  return (
    <View style={{ gap: 12 }}>
      {[0, 1, 2].map((item) => (
        <View key={item} style={styles.skeletonCard}>
          <SkeletonBox width={44} height={44} borderRadius={22} />
          <View style={{ flex: 1, gap: 8 }}>
            <SkeletonBox width="70%" height={15} borderRadius={8} />
            <SkeletonBox width="48%" height={12} borderRadius={6} />
          </View>
        </View>
      ))}
    </View>
  );
}

function ScreenTitle({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <View style={styles.stepIntro}>
      <Text style={styles.stepTitle}>{title}</Text>
      <Text style={styles.stepSubtitle}>{subtitle}</Text>
    </View>
  );
}

export default function BalletAssessmentScreen() {
  const insets = useSafeAreaInsets();
  const { user, children, addChild } = useAppContext();

  const [step, setStep] = useState<Step>("child");
  const [selectedChild, setSelectedChild] = useState<ChildProfile | null>(null);
  const [selectedAppointment, setSelectedAppointment] = useState<AssessmentScheduleOption | null>(null);
  const [selectedPackage, setSelectedPackage] = useState<BalletPackageOption | null>(null);
  const [applications, setApplications] = useState<BalletApplication[]>([]);
  const [applicationsState, setApplicationsState] = useState<LoadState>("loading");
  const [appointments, setAppointments] = useState<AssessmentScheduleOption[]>([]);
  const [appointmentsState, setAppointmentsState] = useState<LoadState>("loading");
  const [packages, setPackages] = useState<BalletPackageOption[]>([]);
  const [packagesState, setPackagesState] = useState<LoadState>("loading");
  const [submitting, setSubmitting] = useState(false);
  const [submittedApplicationId, setSubmittedApplicationId] = useState<number | null>(null);
  const [editingApplicationId, setEditingApplicationId] = useState<number | null>(null);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [cancelReasonOpen, setCancelReasonOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [addChildOpen, setAddChildOpen] = useState(false);
  const [newChildName, setNewChildName] = useState("");
  const [newChildDay, setNewChildDay] = useState("");
  const [newChildMonth, setNewChildMonth] = useState("");
  const [newChildYear, setNewChildYear] = useState("");
  const [newChildGender, setNewChildGender] = useState<"female" | "male">("female");
  const authPromptShownRef = useRef(false);
  const parentPromptShownRef = useRef(false);
  const successScale = useRef(new Animated.Value(0)).current;
  const trimmedCancelReason = cancelReason.trim();
  const cancelReasonError = trimmedCancelReason.length === 0
    ? "Reason is required."
    : trimmedCancelReason.length < 5
      ? "Reason must be at least 5 characters."
      : trimmedCancelReason.length > 500
        ? "Reason must be at most 500 characters."
        : null;

  const stepIndex = STEP_ORDER.indexOf(step);
  const profileComplete = user?.profileCompletion?.isComplete ?? user?.profileCompleted ?? false;

  useEffect(() => {
    if (!user) {
      if (!authPromptShownRef.current) {
        authPromptShownRef.current = true;
        showAuthRequiredPrompt();
        router.replace("/ballet" as never);
      }
      return;
    }

    if (!profileComplete) {
      const nextStep = user.profileCompletion?.nextStep ?? "profile";
      router.replace({
        pathname: nextStepRoute(nextStep) as never,
        params: { returnTo: RETURN_TO_ASSESSMENT },
      } as never);
      return;
    }

    if (user.accountType !== "parent") {
      if (!parentPromptShownRef.current) {
        parentPromptShownRef.current = true;
        showParentAccountRequiredPrompt();
        router.replace("/ballet" as never);
      }
    }
  }, [profileComplete, user]);

  const loadApplications = useCallback(async (signal?: AbortSignal) => {
    setApplicationsState("loading");
    try {
      const data = await fetchMyApplications(signal);
      if (signal?.aborted) return;
      setApplications(data);
      setApplicationsState("ready");
    } catch (err) {
      if ((err as { name?: string })?.name === "AbortError") return;
      setApplicationsState(isOfflineError(err) ? "offline" : "error");
    }
  }, []);

  const loadPackages = useCallback(async (signal?: AbortSignal) => {
    setPackagesState("loading");
    try {
      const data = await fetchBalletPackages(signal);
      if (signal?.aborted) return;
      setPackages(data);
      setPackagesState(data.length ? "ready" : "empty");
    } catch (err) {
      if ((err as { name?: string })?.name === "AbortError") return;
      setPackagesState(isOfflineError(err) ? "offline" : "error");
    }
  }, []);

  const loadAppointments = useCallback(async (child: ChildProfile, signal?: AbortSignal) => {
    setAppointmentsState("loading");
    try {
      const data = await fetchAvailableAssessmentSchedules(signal, child.birthday);
      if (signal?.aborted) return;
      setAppointments(data);
      setAppointmentsState(data.length ? "ready" : "empty");
    } catch (err) {
      if ((err as { name?: string })?.name === "AbortError") return;
      setAppointmentsState(isOfflineError(err) ? "offline" : "error");
    }
  }, []);

  useEffect(() => {
    if (!user || !profileComplete || user.accountType !== "parent") return;
    const controller = new AbortController();
    loadApplications(controller.signal);
    loadPackages(controller.signal);
    return () => controller.abort();
  }, [loadApplications, loadPackages, profileComplete, user]);

  useEffect(() => {
    if (!selectedChild) return;
    const controller = new AbortController();
    setSelectedAppointment(null);
    loadAppointments(selectedChild, controller.signal);
    return () => controller.abort();
  }, [loadAppointments, selectedChild]);

  useEffect(() => {
    if (submittedApplicationId == null) return;
    Animated.spring(successScale, { toValue: 1, friction: 5, tension: 90, useNativeDriver: true }).start();
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [submittedApplicationId, successScale]);

  function goBack() {
    if (submittedApplicationId != null) {
      router.replace("/ballet" as never);
      return;
    }
    if (stepIndex <= 0) {
      router.back();
      return;
    }
    setStep(STEP_ORDER[stepIndex - 1]);
  }

  function goNext() {
    if (step === "child" && !selectedChild) {
      Alert.alert("Select Child", "Choose the child applying for Ballet Assessment.");
      return;
    }
    if (step === "appointment" && !selectedAppointment) {
      Alert.alert("Select Appointment", "Choose an available assessment appointment.");
      return;
    }
    if (step === "package" && !selectedPackage) {
      Alert.alert("Select Package", "Choose a Ballet package.");
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setStep(STEP_ORDER[Math.min(stepIndex + 1, STEP_ORDER.length - 1)]);
  }

  async function handleAddChild() {
    if (!newChildName.trim()) {
      Alert.alert("Child Name", "Please enter the child's full name.");
      return;
    }
    const birthday = newChildDay && newChildMonth && newChildYear
      ? `${newChildYear}-${newChildMonth.padStart(2, "0")}-${newChildDay.padStart(2, "0")}`
      : "";
    const age = calculateAge(birthday);
    if (!birthday || age <= 0) {
      Alert.alert("Birthday", "Please enter a valid child birthday.");
      return;
    }
    const created = await addChild({
      id: "",
      fullName: newChildName.trim(),
      birthday,
      age,
      gender: newChildGender,
    });
    if (!created) return;
    setSelectedChild(created);
    setAddChildOpen(false);
    setNewChildName("");
    setNewChildDay("");
    setNewChildMonth("");
    setNewChildYear("");
    setNewChildGender("female");
  }

  async function handleSubmit() {
    if (!user || !selectedChild || !selectedAppointment || !selectedPackage || submitting) return;
    const selectedChildId = Number(selectedChild.id);
    if (!Number.isInteger(selectedChildId) || selectedChildId <= 0) {
      Alert.alert("Invalid Child", "Please select a saved child profile before submitting.");
      return;
    }
    setSubmitting(true);
    try {
      if (editingApplicationId != null) {
        await updateBalletApplication(editingApplicationId, {
          assessmentScheduleId: selectedAppointment.scheduleId,
          assessmentDate: selectedAppointment.date,
          preferredPackageId: selectedPackage.id,
          preferredPaymentMethod: CANONICAL_PAYMENT_METHOD,
        });
        setSubmittedApplicationId(editingApplicationId);
        setEditingApplicationId(null);
        return;
      }

      const result = await submitBalletApplication({
        parentName: user.fullName,
        parentPhone: user.phone,
        parentEmail: user.email,
        childName: selectedChild.fullName,
        childBirthday: selectedChild.birthday,
        childAge: selectedChild.age || calculateAge(selectedChild.birthday),
        childGender: selectedChild.gender,
        previousExperience: false,
        medicalNotes: selectedChild.medicalNotes,
        emergencyContactName: selectedChild.emergencyContactName,
        emergencyContactPhone: selectedChild.emergencyContactPhone,
        assessmentScheduleId: selectedAppointment.scheduleId,
        assessmentDate: selectedAppointment.date,
        preferredPaymentMethod: CANONICAL_PAYMENT_METHOD,
        preferredPackageId: selectedPackage.id,
        childId: selectedChildId,
      });
      setSubmittedApplicationId(result.application.id);
      setApplications((prev) => [
        {
          id: result.application.id,
          childId: selectedChildId,
          parentName: user.fullName,
          parentPhone: user.phone,
          parentEmail: user.email,
          childName: selectedChild.fullName,
          childBirthday: selectedChild.birthday,
          childAge: selectedChild.age || calculateAge(selectedChild.birthday),
          childGender: selectedChild.gender,
          emergencyContactName: selectedChild.emergencyContactName ?? null,
          emergencyContactPhone: selectedChild.emergencyContactPhone ?? null,
          previousExperience: false,
          experienceDetails: null,
          medicalNotes: selectedChild.medicalNotes ?? null,
          notes: null,
          assessmentScheduleId: selectedAppointment.scheduleId,
          assessmentDate: selectedAppointment.date,
          preferredPackageId: selectedPackage.id,
          status: result.application.status,
          adminNotes: null,
          assignedLevelId: null,
          assignedGroupId: null,
          resolvedSchedules: null,
          resolvedInstructors: null,
          attendanceSummary: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        ...prev,
      ]);
    } catch (err) {
      const typed = err as { status?: number; data?: { error?: string; code?: string }; message?: string };
      if (typed.status === 409) {
        Alert.alert("Already Applied", typed.data?.error ?? "This child already has a Ballet application.");
        await loadApplications();
        return;
      }
      Alert.alert(
        isOfflineError(err) ? "No Connection" : "Submission Failed",
        typed.data?.error ?? typed.message ?? "We couldn't submit the application. Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  function resetForAnotherChild() {
    setSubmittedApplicationId(null);
    setEditingApplicationId(null);
    setSelectedChild(null);
    setSelectedAppointment(null);
    setSelectedPackage(null);
    setStep("child");
    loadApplications();
  }

  function confirmCancel() {
    if (submittedApplicationId == null) return;
    Alert.alert(
      "Cancel Application?",
      "This will cancel the submitted Ballet Assessment application. You can apply again afterwards.",
      [
        { text: "Keep Application", style: "cancel" },
        {
          text: "Cancel Application",
          style: "destructive",
          onPress: () => {
            setCancelReason("");
            setCancelReasonOpen(true);
          },
        },
      ],
    );
  }

  async function submitCancelApplication() {
    if (submittedApplicationId == null || cancelReasonError) return;
    setCancelLoading(true);
    try {
      const latest = await fetchBalletApplicationDetail(submittedApplicationId);
      if (!["pending", "needsFollowUp", "accepted", "assignedToLevel"].includes(latest.application.status)) {
        Alert.alert(
          "Cannot Cancel Here",
          latest.application.status === "active"
            ? "This application is now an active enrollment. Please use Request Ballet Cancellation from the application status screen."
            : "This application can no longer be cancelled from this screen.",
        );
        router.replace("/ballet/application-status" as any);
        return;
      }
      await cancelBalletApplication(submittedApplicationId, { reason: trimmedCancelReason });
      Alert.alert("Application Cancelled", "The application has been cancelled.");
      setCancelReasonOpen(false);
      resetForAnotherChild();
    } catch (err) {
      Alert.alert("Could Not Cancel", err instanceof Error ? err.message : "Please try again.");
    } finally {
      setCancelLoading(false);
    }
  }

  if (!user || !profileComplete || user.accountType !== "parent") {
    return <View style={[styles.container, { paddingTop: Platform.OS === "web" ? 67 : insets.top }]} />;
  }

  if (submittedApplicationId != null && selectedChild && selectedAppointment) {
    return (
      <View style={styles.container}>
        <LinearGradient colors={["#04161B", BA.ink900]} style={StyleSheet.absoluteFill} />
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[styles.successScroll, { paddingTop: (Platform.OS === "web" ? 40 : insets.top) + 34 }]}
        >
          <Animated.View style={[styles.successIcon, { transform: [{ scale: successScale }] }]}>
            <Svg width={42} height={42} viewBox="0 0 24 24" fill="none">
              <Path d="M20 6 9 17l-5-5" stroke={BA.ink900} strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round" />
            </Svg>
          </Animated.View>
          <Text style={styles.successTitle}>Application Submitted Successfully</Text>
          <View style={styles.successCard}>
            <Text style={styles.successLabel}>Child</Text>
            <Text style={styles.successValue}>{selectedChild.fullName}</Text>
            <Text style={styles.successLabel}>Assessment</Text>
            <Text style={styles.successValue}>{formatDisplayDate(selectedAppointment.date, true)}</Text>
            <Text style={styles.successValue}>{selectedAppointment.time}</Text>
            <Text style={styles.successLabel}>Payment Method</Text>
            <Text style={styles.successValue}>{CANONICAL_PAYMENT_LABEL}</Text>
            <Text style={styles.successLabel}>Status</Text>
            <Text style={[styles.successValue, { color: BA.amber }]}>Pending Review</Text>
          </View>
        </ScrollView>
        <View style={[styles.footer, { paddingBottom: (Platform.OS === "web" ? 20 : insets.bottom) + 14 }]}>
          <BalletAssessmentSuccessActions
            onHome={() => router.replace("/" as never)}
            onModify={() => {
              setEditingApplicationId(submittedApplicationId);
              setSubmittedApplicationId(null);
              setStep("review");
            }}
            onAnotherChild={resetForAnotherChild}
            onCancel={confirmCancel}
            cancelLoading={cancelLoading}
          />
        </View>
        <Modal visible={cancelReasonOpen} animationType="slide" transparent onRequestClose={() => !cancelLoading && setCancelReasonOpen(false)}>
          <View style={styles.modalOverlay}>
            <View style={styles.modalSheet}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Cancel Application</Text>
                <TouchableOpacity onPress={() => !cancelLoading && setCancelReasonOpen(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Ionicons name="close" size={22} color={BA.ink300} />
                </TouchableOpacity>
              </View>
              <Text style={styles.modalHelper}>Please tell the studio why you are cancelling this application.</Text>
              <Field
                label="Reason *"
                value={cancelReason}
                onChangeText={(value) => setCancelReason(value.slice(0, 500))}
                placeholder="Write your reason…"
                multiline
                style={{ minHeight: 120 }}
              />
              <View style={styles.reasonMetaRow}>
                <Text style={[styles.reasonValidation, !cancelReasonError || trimmedCancelReason.length === 0 ? styles.reasonHint : null]}>
                  {trimmedCancelReason.length === 0 ? "Minimum 5 characters." : cancelReasonError ?? "Looks good."}
                </Text>
                <Text style={styles.reasonCount}>{cancelReason.length}/500</Text>
              </View>
              <TouchableOpacity
                onPress={submitCancelApplication}
                activeOpacity={0.86}
                disabled={Boolean(cancelReasonError) || cancelLoading}
                style={[styles.primaryButton, { minHeight: 50 }, (Boolean(cancelReasonError) || cancelLoading) && { opacity: 0.5 }]}
              >
                {cancelLoading ? <ActivityIndicator color={BA.ink900} /> : <Text style={styles.primaryButtonText}>Submit Cancellation</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: Platform.OS === "web" ? 67 : insets.top }]}>
      <LinearGradient
        colors={["rgba(0,182,215,0.18)", "rgba(0,182,215,0.04)", "transparent"]}
        locations={[0, 0.42, 1]}
        style={styles.glow}
        pointerEvents="none"
      />
      <BalletAssessmentHeader onBack={goBack} />
      <BalletStepIndicator currentIndex={stepIndex} />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingBottom: 124 }]}
        keyboardShouldPersistTaps="handled"
      >
        {step === "child" && (
          <View style={styles.section}>
            <ScreenTitle title="Select Child" subtitle="Choose the child applying for Ballet Assessment" />
            {applicationsState === "loading" ? <LoadingCards /> : null}
            {applicationsState === "offline" ? <OfflineState variant="compact" onRetry={() => loadApplications()} /> : null}
            {applicationsState === "error" ? <ErrorState variant="compact" message="Couldn't load existing applications." onRetry={() => loadApplications()} /> : null}
            {applicationsState === "ready" && children.length === 0 ? (
              <View style={styles.emptyBox}>
                <Text style={styles.emptyTitle}>No children found</Text>
                <Text style={styles.emptyText}>Add a child profile before starting the Ballet Assessment application.</Text>
              </View>
            ) : null}
            {applicationsState === "ready" && children.map((child) => {
              const status = getChildApplicationStatus(child, applications);
              const disabled = status != null && BLOCKING_CHILD_APPLICATION_STATUSES.has(status);
              const label = status === "pending" || status === "needsFollowUp"
                ? "Application Pending"
                : disabled
                  ? "Already Applied"
                  : undefined;
              return (
                <BalletAssessmentChildCard
                  key={child.id}
                  child={child}
                  selected={selectedChild?.id === child.id}
                  disabled={disabled}
                  unavailableLabel={label}
                  onPress={() => {
                    if (disabled) return;
                    Haptics.selectionAsync();
                    setSelectedChild(child);
                  }}
                />
              );
            })}
            <TouchableOpacity style={styles.addChildButton} onPress={() => setAddChildOpen(true)} activeOpacity={0.82}>
              <Ionicons name="add-circle-outline" size={19} color={BA.cyan500} />
              <Text style={styles.addChildText}>+ Add New Child</Text>
            </TouchableOpacity>
          </View>
        )}

        {step === "appointment" && selectedChild && (
          <View style={styles.section}>
            <ScreenTitle title="Select Assessment Appointment" subtitle="Choose an age-eligible assessment appointment." />
            <View style={styles.infoBanner}>
              <Ionicons name="information-circle-outline" size={18} color={BA.cyan400} />
              <Text style={styles.infoText}>This appointment is for your Ballet Assessment, not your weekly Ballet class.</Text>
            </View>
            {appointmentsState === "loading" ? <LoadingCards /> : null}
            {appointmentsState === "offline" ? <OfflineState variant="compact" onRetry={() => loadAppointments(selectedChild)} /> : null}
            {appointmentsState === "error" ? <ErrorState variant="compact" message="Couldn't load assessment appointments." onRetry={() => loadAppointments(selectedChild)} /> : null}
            {appointmentsState === "empty" ? (
              <View style={styles.emptyBox}>
                <Text style={styles.emptyTitle}>No assessment appointments available</Text>
                <Text style={styles.emptyText}>No active assessment schedules match {selectedChild.fullName}'s age right now.</Text>
              </View>
            ) : null}
            {appointmentsState === "ready" && appointments.map((appointment) => (
              <BalletAssessmentAppointmentCard
                key={`${appointment.scheduleId}-${appointment.date}`}
                appointment={appointment}
                selected={selectedAppointment?.scheduleId === appointment.scheduleId && selectedAppointment.date === appointment.date}
                onPress={() => {
                  Haptics.selectionAsync();
                  setSelectedAppointment(appointment);
                }}
              />
            ))}
          </View>
        )}

        {step === "package" && (
          <View style={styles.section}>
            <ScreenTitle title="Select Package" subtitle="Choose the Ballet package you prefer for this application." />
            {packagesState === "loading" ? <LoadingCards /> : null}
            {packagesState === "offline" ? <OfflineState variant="compact" onRetry={() => loadPackages()} /> : null}
            {packagesState === "error" ? <ErrorState variant="compact" message="Couldn't load Ballet packages." onRetry={() => loadPackages()} /> : null}
            {packagesState === "empty" ? (
              <View style={styles.emptyBox}>
                <Text style={styles.emptyTitle}>No packages available</Text>
                <Text style={styles.emptyText}>The studio has not published active Ballet packages yet.</Text>
              </View>
            ) : null}
            {packagesState === "ready" && packages.map((pkg) => (
              <BalletAssessmentPackageCard
                key={pkg.id}
                pkg={pkg}
                selected={selectedPackage?.id === pkg.id}
                onPress={() => {
                  Haptics.selectionAsync();
                  setSelectedPackage(pkg);
                }}
              />
            ))}
          </View>
        )}

        {step === "review" && selectedChild && selectedAppointment && selectedPackage && (
          <View style={styles.section}>
            <ScreenTitle title="Review Application" subtitle="Confirm every detail before submitting." />
            <BalletAssessmentSummaryCard
              child={selectedChild}
              appointment={selectedAppointment}
              pkg={selectedPackage}
              paymentLabel={CANONICAL_PAYMENT_LABEL}
              onEdit={(section) => {
                const target: Step = section === "child" ? "child" : section === "appointment" ? "appointment" : "package";
                setStep(target);
              }}
            />
          </View>
        )}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: (Platform.OS === "web" ? 20 : insets.bottom) + 14 }]}>
        {stepIndex > 0 ? (
          <TouchableOpacity style={[styles.footerButton, styles.secondaryButton]} onPress={goBack} activeOpacity={0.86}>
            <Text style={styles.secondaryButtonText}>Back</Text>
          </TouchableOpacity>
        ) : null}
        {step === "review" ? (
          <TouchableOpacity
            style={[styles.footerButton, styles.primaryButton, submitting && { opacity: 0.6 }]}
            onPress={handleSubmit}
            disabled={submitting}
            activeOpacity={0.86}
          >
            {submitting ? <ActivityIndicator color={BA.ink900} /> : <Text style={styles.primaryButtonText}>Submit Application</Text>}
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={[styles.footerButton, styles.primaryButton]} onPress={goNext} activeOpacity={0.86}>
            <Text style={styles.primaryButtonText}>Continue</Text>
          </TouchableOpacity>
        )}
      </View>

      <Modal visible={addChildOpen} animationType="slide" transparent onRequestClose={() => setAddChildOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add New Child</Text>
              <TouchableOpacity onPress={() => setAddChildOpen(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="close" size={22} color={BA.ink300} />
              </TouchableOpacity>
            </View>
            <Field label="Child Full Name" value={newChildName} onChangeText={setNewChildName} placeholder="Sara Ahmed" />
            <View style={styles.birthRow}>
              <Field label="Day" value={newChildDay} onChangeText={setNewChildDay} placeholder="12" keyboardType="number-pad" />
              <Field label="Month" value={newChildMonth} onChangeText={setNewChildMonth} placeholder="03" keyboardType="number-pad" />
              <Field label="Year" value={newChildYear} onChangeText={setNewChildYear} placeholder="2021" keyboardType="number-pad" />
            </View>
            <View style={styles.genderRow}>
              {(["female", "male"] as const).map((gender) => {
                const selected = newChildGender === gender;
                return (
                  <TouchableOpacity key={gender} onPress={() => setNewChildGender(gender)} style={[styles.genderButton, selected && styles.genderButtonSelected]}>
                    <Text style={[styles.genderText, selected && styles.genderTextSelected]}>{gender === "female" ? "Girl" : "Boy"}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <TouchableOpacity onPress={handleAddChild} activeOpacity={0.86} style={[styles.primaryButton, { minHeight: 50 }]}>
              <Text style={styles.primaryButtonText}>Save Child</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BA.ink900 },
  glow: { position: "absolute", left: 0, right: 0, top: 0, height: 260 },
  scroll: { paddingHorizontal: 20, paddingTop: 2 },
  section: { gap: 12 },
  stepIntro: { gap: 6, marginBottom: 4 },
  stepTitle: {
    color: BA.white,
    fontFamily: "Archivo_800ExtraBold",
    fontSize: 24,
  },
  stepSubtitle: {
    color: BA.ink300,
    fontFamily: "Archivo_400Regular",
    fontSize: 14,
    lineHeight: 20,
  },
  skeletonCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: BA_RADIUS.lg,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    backgroundColor: BA.ink800,
    padding: 14,
  },
  emptyBox: {
    borderRadius: BA_RADIUS.lg,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: BA.ink800,
    padding: 16,
    gap: 6,
  },
  emptyTitle: {
    color: BA.white,
    fontFamily: "Archivo_800ExtraBold",
    fontSize: 16,
  },
  emptyText: {
    color: BA.ink300,
    fontFamily: "Archivo_400Regular",
    fontSize: 13,
    lineHeight: 19,
  },
  addChildButton: {
    minHeight: 48,
    borderRadius: BA_RADIUS.md,
    borderWidth: 1,
    borderColor: "rgba(0,182,215,0.32)",
    backgroundColor: "rgba(0,182,215,0.08)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  addChildText: {
    color: BA.cyan400,
    fontFamily: "Archivo_800ExtraBold",
    fontSize: 14,
  },
  infoBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 9,
    padding: 12,
    borderRadius: BA_RADIUS.md,
    borderWidth: 1,
    borderColor: "rgba(0,182,215,0.24)",
    backgroundColor: "rgba(0,182,215,0.08)",
  },
  infoText: {
    flex: 1,
    color: BA.ink300,
    fontFamily: "Archivo_600SemiBold",
    fontSize: 12.5,
    lineHeight: 18,
  },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    backgroundColor: BA.ink900,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.08)",
    flexDirection: "row",
    gap: 10,
  },
  footerButton: {
    flex: 1,
    minHeight: 52,
    borderRadius: BA_RADIUS.md,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryButton: {
    backgroundColor: BA.cyan500,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: BA_RADIUS.md,
  },
  primaryButtonText: {
    color: BA.ink900,
    fontFamily: "Archivo_800ExtraBold",
    fontSize: 15,
  },
  secondaryButton: {
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  secondaryButtonText: {
    color: BA.white,
    fontFamily: "Archivo_800ExtraBold",
    fontSize: 15,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.62)",
    justifyContent: "flex-end",
  },
  modalSheet: {
    backgroundColor: BA.ink800,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderTopColor: "rgba(0,182,215,0.28)",
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 28,
    gap: 14,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  modalTitle: {
    color: BA.white,
    fontFamily: "Archivo_800ExtraBold",
    fontSize: 18,
  },
  modalHelper: {
    color: BA.ink300,
    fontFamily: "Archivo_400Regular",
    fontSize: 13,
    lineHeight: 19,
  },
  field: { flex: 1, gap: 6 },
  fieldLabel: {
    color: BA.ink300,
    fontFamily: "SpaceMono_700Bold",
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  input: {
    minHeight: 46,
    borderRadius: BA_RADIUS.md,
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "rgba(255,255,255,0.05)",
    color: BA.white,
    fontFamily: "Archivo_400Regular",
    fontSize: 14,
    paddingHorizontal: 13,
    ...iosTextInputStyle(14, 18),
  },
  birthRow: { flexDirection: "row", gap: 8 },
  genderRow: { flexDirection: "row", gap: 8 },
  genderButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: BA_RADIUS.md,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  genderButtonSelected: {
    borderColor: BA.cyan500,
    backgroundColor: "rgba(0,182,215,0.12)",
  },
  genderText: {
    color: BA.ink300,
    fontFamily: "Archivo_800ExtraBold",
    fontSize: 13,
  },
  genderTextSelected: { color: BA.cyan400 },
  reasonMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  reasonValidation: {
    flex: 1,
    color: BA.danger,
    fontFamily: "Archivo_400Regular",
    fontSize: 12,
  },
  reasonHint: {
    color: BA.ink300,
  },
  reasonCount: {
    color: BA.ink400,
    fontFamily: "Archivo_400Regular",
    fontSize: 12,
  },
  successScroll: {
    paddingHorizontal: 24,
    paddingBottom: 220,
    alignItems: "center",
  },
  successIcon: {
    width: 82,
    height: 82,
    borderRadius: 41,
    backgroundColor: BA.cyan500,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 22,
  },
  successTitle: {
    color: BA.white,
    fontFamily: "Anton_400Regular",
    fontSize: 40,
    lineHeight: 39,
    textTransform: "uppercase",
    textAlign: "center",
    ...iosDisplayTextStyle(40, 39),
    marginBottom: 24,
  },
  successCard: {
    width: "100%",
    borderRadius: BA_RADIUS.xl,
    borderWidth: 1,
    borderColor: "rgba(0,182,215,0.28)",
    backgroundColor: BA.ink800,
    padding: 16,
    gap: 4,
  },
  successLabel: {
    color: BA.ink400,
    fontFamily: "SpaceMono_700Bold",
    fontSize: 10,
    letterSpacing: 0.9,
    textTransform: "uppercase",
    marginTop: 8,
  },
  successValue: {
    color: BA.white,
    fontFamily: "Archivo_800ExtraBold",
    fontSize: 15,
  },
});
