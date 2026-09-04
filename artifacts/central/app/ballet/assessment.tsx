import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ActivityIndicator,
  Animated,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import BalletAssessmentAppointmentCard from "@/components/ballet/BalletAssessmentAppointmentCard";
import BalletAssessmentChildCard from "@/components/ballet/BalletAssessmentChildCard";
import BalletAssessmentHeader from "@/components/ballet/BalletAssessmentHeader";
import BalletAssessmentIcon from "@/components/ballet/BalletAssessmentIcon";
import BalletAssessmentPackageCard from "@/components/ballet/BalletAssessmentPackageCard";
import BalletAssessmentSuccessActions from "@/components/ballet/BalletAssessmentSuccessActions";
import BalletAssessmentSuccessSummaryCard from "@/components/ballet/BalletAssessmentSuccessSummaryCard";
import BalletAssessmentSummaryCard from "@/components/ballet/BalletAssessmentSummaryCard";
import BalletStepIndicator from "@/components/ballet/BalletStepIndicator";
import { BA, BA_RADIUS } from "@/components/ballet/assessmentTokens";
import { SuccessConfetti } from "@/components/success/SuccessCelebration";
import {
  buildEffectiveEligibleBalletChildIds,
  parseEligibleBalletChildIds,
  shouldLockSingleRoutedBalletChild,
} from "@/components/ballet/balletStudentPreviewModel";
import {
  buildAssessmentSubmissionDraft,
  canSubmitAssessment,
  computeReviewMissingStep,
  computeVisibleAssessmentChildren,
  decideChildEligibilityAction,
  finalizeAssessmentSubmissionSnapshot,
  parseCanonicalChildId,
  type AssessmentSubmissionSnapshot,
} from "@/components/ballet/balletAssessmentStateModel";
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
  fetchAvailableAssessmentSchedules,
  fetchBalletPackages,
  fetchBalletSettings,
  fetchMyApplications,
  isOfflineError,
  submitBalletApplication,
  updateBalletApplication,
} from "@/services/balletAssessmentService";
import { showAuthRequiredPrompt, showParentAccountRequiredPrompt } from "@/utils/authRequired";
import { iosDisplayTextStyle, iosTextInputStyle } from "@/utils/iosTypography";
import { useCentralAlert } from "@/hooks/useCentralAlert";

const RETURN_TO_ASSESSMENT = "/ballet/assessment";
const BLOCKING_CHILD_APPLICATION_STATUSES = new Set([
  ...ACTIVE_APPLICATION_STATUSES,
]);

const CANONICAL_PAYMENT_METHOD = "inPerson" as const;
const CANONICAL_PAYMENT_LABEL = "Cash";

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

function appointmentLocation(appointment: AssessmentScheduleOption): string {
  return appointment.branchName?.trim() || appointment.roomName?.trim() || "Central Studio";
}

function calendarStamp(date: string, time: string): string {
  return `${date.replaceAll("-", "")}T${time.slice(0, 5).replace(":", "")}00`;
}

function getChildApplicationStatus(child: ChildProfile, applications: BalletApplication[]) {
  const childId = Number(child.id);
  const matching = applications.filter((app) => {
    if (!Number.isNaN(childId) && app.childId === childId) return true;
    const sameName = app.childName.trim().toLowerCase() === child.fullName.trim().toLowerCase();
    const sameBirthday = !!child.birthday && app.childBirthday === child.birthday;
    return sameName && sameBirthday;
  });
  return matching.find((app) => BLOCKING_CHILD_APPLICATION_STATUSES.has(app.status))?.status
    ?? matching[0]?.status
    ?? null;
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  multiline,
  style,
  error,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  keyboardType?: "default" | "number-pad";
  multiline?: boolean;
  style?: object;
  error?: string | null;
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
      {error ? <Text style={styles.fieldError}>{error}</Text> : null}
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
  const { eligibleChildIds: eligibleChildIdsParam } = useLocalSearchParams<{
    eligibleChildIds?: string | string[];
  }>();
  const { user, children, addChild } = useAppContext();
  const alert = useCentralAlert();

  const [step, setStep] = useState<Step>("child");
  const [selectedChild, setSelectedChild] = useState<ChildProfile | null>(null);
  const [selectedAppointment, setSelectedAppointment] = useState<AssessmentScheduleOption | null>(null);
  const [applications, setApplications] = useState<BalletApplication[]>([]);
  const [applicationsState, setApplicationsState] = useState<LoadState>("loading");
  const [appointments, setAppointments] = useState<AssessmentScheduleOption[]>([]);
  const [appointmentsState, setAppointmentsState] = useState<LoadState>("loading");
  const [packages, setPackages] = useState<BalletPackageOption[]>([]);
  const [packagesState, setPackagesState] = useState<LoadState>("loading");
  const [submitting, setSubmitting] = useState(false);
  const [submittedApplicationId, setSubmittedApplicationId] = useState<number | null>(null);
  const [submittedSnapshot, setSubmittedSnapshot] = useState<
    AssessmentSubmissionSnapshot<ChildProfile, AssessmentScheduleOption> | null
  >(null);
  const [editingApplicationId, setEditingApplicationId] = useState<number | null>(null);
  const [addChildOpen, setAddChildOpen] = useState(false);
  const [newChildName, setNewChildName] = useState("");
  const [newChildDay, setNewChildDay] = useState("");
  const [newChildMonth, setNewChildMonth] = useState("");
  const [newChildYear, setNewChildYear] = useState("");
  const [newChildGender, setNewChildGender] = useState<"female" | "male">("female");
  const [sessionCreatedChildIds, setSessionCreatedChildIds] = useState<Set<number>>(() => new Set());
  const [addChildErrors, setAddChildErrors] = useState<{ name?: string; birthday?: string }>({});
  const [addingChild, setAddingChild] = useState(false);
  const authPromptShownRef = useRef(false);
  const parentPromptShownRef = useRef(false);
  const submittingRef = useRef(false);
  const successScale = useRef(new Animated.Value(0)).current;

  const settingsQuery = useQuery({
    queryKey: ["ballet-settings"],
    queryFn: ({ signal }) => fetchBalletSettings(signal),
    staleTime: 5 * 60 * 1000,
  });
  const assessmentFeeEgp = settingsQuery.data?.assessmentFeeEgp ?? null;

  const stepIndex = STEP_ORDER.indexOf(step);
  const profileComplete = user?.profileCompletion?.isComplete ?? user?.profileCompleted ?? false;
  const routedEligibleChildIds = useMemo(
    () => parseEligibleBalletChildIds(eligibleChildIdsParam),
    [eligibleChildIdsParam],
  );
  const effectiveEligibleChildIds = useMemo(() => {
    return buildEffectiveEligibleBalletChildIds(routedEligibleChildIds, sessionCreatedChildIds);
  }, [routedEligibleChildIds, sessionCreatedChildIds]);
  const visibleChildren = useMemo(() => {
    return computeVisibleAssessmentChildren({
      children,
      applications,
      applicationsReady: applicationsState === "ready",
      effectiveEligibleChildIds,
      sessionCreatedChildIds,
      blockingStatuses: BLOCKING_CHILD_APPLICATION_STATUSES,
      getChildApplicationStatus,
    });
  }, [applications, applicationsState, children, effectiveEligibleChildIds, sessionCreatedChildIds]);
  const routedChildLocked = shouldLockSingleRoutedBalletChild({
    hasRoutedAllowList: routedEligibleChildIds != null,
    applicationsReady: applicationsState === "ready",
    visibleChildCount: visibleChildren.length,
    sessionCreatedChildCount: sessionCreatedChildIds.size,
  });

  useEffect(() => {
    const action = decideChildEligibilityAction({
      hasRoutedAllowList: routedEligibleChildIds != null,
      applicationsReady: applicationsState === "ready",
      hasSubmittedSnapshot: submittedSnapshot != null,
      hasEditingApplication: editingApplicationId != null,
      isSubmissionInFlight: submitting,
      selectedChildId: selectedChild?.id ?? null,
      isSessionCreatedSelectedChild: selectedChild != null && sessionCreatedChildIds.has(Number(selectedChild.id)),
      step,
      visibleChildIds: visibleChildren.map((child) => child.id),
    });

    if (action.type === "preselect") {
      const child = visibleChildren.find((candidate) => candidate.id === action.childId);
      if (child) setSelectedChild(child);
      return;
    }

    if (action.type === "clearOnChildStep") {
      setSelectedChild(null);
      alert.show({
        tone: "warning",
        title: "Child No Longer Eligible",
        message: "This child already has a current Ballet application. Please choose another child.",
      });
      return;
    }

    if (action.type === "bounceToChild") {
      const childName = selectedChild?.fullName ?? "This child";
      setSelectedChild(null);
      setSelectedAppointment(null);
      setStep("child");
      alert.show({
        tone: "warning",
        title: "Application Already Exists",
        message: `${childName} already has a current Ballet application. Please choose another child to continue.`,
      });
    }
  }, [alert, applicationsState, editingApplicationId, routedEligibleChildIds, selectedChild, sessionCreatedChildIds, step, submittedSnapshot, submitting, visibleChildren]);

  const reviewMissingStep = useMemo(() => {
    return computeReviewMissingStep({
      step,
      hasChild: selectedChild != null,
      hasAppointment: selectedAppointment != null,
    });
  }, [step, selectedChild, selectedAppointment]);

  useEffect(() => {
    if (reviewMissingStep != null) setStep(reviewMissingStep);
  }, [reviewMissingStep]);

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
      // childId is an optional ownership-verifying refinement here (the
      // backend re-derives an authoritative birthday from it when present);
      // childBirthday alone is sufficient for the fetch, so an invalid id
      // is safely omitted rather than coerced or blocked on.
      const childId = parseCanonicalChildId(child.id) ?? undefined;
      const data = await fetchAvailableAssessmentSchedules(signal, child.birthday, childId);
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
    successScale.setValue(0);
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
      alert.show({ tone: "warning", title: "Select Child", message: "Choose the child applying for Ballet Assessment." });
      return;
    }
    if (step === "appointment" && !selectedAppointment) {
      alert.show({ tone: "warning", title: "Select Appointment", message: "Choose an available assessment appointment." });
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setStep(STEP_ORDER[Math.min(stepIndex + 1, STEP_ORDER.length - 1)]);
  }

  async function handleAddChild() {
    if (addingChild) return;
    const errors: { name?: string; birthday?: string } = {};
    if (!newChildName.trim()) errors.name = "Please enter the child's full name.";
    const birthday = newChildDay && newChildMonth && newChildYear
      ? `${newChildYear}-${newChildMonth.padStart(2, "0")}-${newChildDay.padStart(2, "0")}`
      : "";
    const age = calculateAge(birthday);
    const parsedBirthday = birthday ? new Date(`${birthday}T12:00:00Z`) : null;
    const calendarMatches = parsedBirthday != null
      && !Number.isNaN(parsedBirthday.getTime())
      && parsedBirthday.toISOString().slice(0, 10) === birthday;
    if (!birthday || !calendarMatches || age <= 0) errors.birthday = "Enter a valid Day, Month, and Year.";
    setAddChildErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setAddingChild(true);
    try {
      const created = await addChild({
        id: "",
        fullName: newChildName.trim(),
        birthday,
        age,
        gender: newChildGender,
      });
      if (!created) return;
      const createdId = Number(created.id);
      if (Number.isInteger(createdId) && createdId > 0) {
        setSessionCreatedChildIds((current) => new Set(current).add(createdId));
      }
      setSelectedChild(created);
      setAddChildOpen(false);
      setAddChildErrors({});
      setNewChildName("");
      setNewChildDay("");
      setNewChildMonth("");
      setNewChildYear("");
      setNewChildGender("female");
    } finally {
      setAddingChild(false);
    }
  }

  async function handleSubmit() {
    // 1. reject if already submitting
    if (submittingRef.current) return;

    // 2. validate child, appointment, and payment method (a fixed
    // canonical constant in this flow — never user-selected, so always
    // valid once reached).
    if (!canSubmitAssessment({
      hasUser: !!user,
      hasChild: !!selectedChild,
      hasAppointment: !!selectedAppointment,
      isSubmitting: submitting,
      hasSubmittedSnapshot: submittedSnapshot != null,
    })) {
      return;
    }
    // Non-null by the guard above; narrowed for TypeScript.
    const user_ = user!;
    const selectedChild_ = selectedChild!;
    const selectedAppointment_ = selectedAppointment!;
    const selectedChildId = parseCanonicalChildId(selectedChild_.id);
    if (selectedChildId == null) {
      alert.show({ tone: "warning", title: "Invalid Child", message: "Please select a saved child profile before submitting." });
      return;
    }

    // 3. build an immutable draft snapshot from the validated local
    // variables — before the submission lock is set and before any network
    // request begins, so it can never be built from state re-read after an
    // await.
    const draftSnapshot = buildAssessmentSubmissionDraft({
      child: selectedChild_,
      appointment: selectedAppointment_,
      paymentLabel: CANONICAL_PAYMENT_LABEL,
    });

    // 4. set the synchronous submission lock
    submittingRef.current = true;
    setSubmitting(true);
    try {
      // 5. begin the POST request
      if (editingApplicationId != null) {
        await updateBalletApplication(editingApplicationId, {
          assessmentScheduleId: selectedAppointment_.scheduleId,
          assessmentDate: selectedAppointment_.date,
          preferredPaymentMethod: CANONICAL_PAYMENT_METHOD,
        });
        // 6. finalize the submitted snapshot by adding the returned
        // identity onto the draft — never rebuilt from state.
        setSubmittedSnapshot(finalizeAssessmentSubmissionSnapshot(draftSnapshot, {
          applicationId: editingApplicationId,
          status: null,
        }));
        setSubmittedApplicationId(editingApplicationId);
        setEditingApplicationId(null);
        return;
      }

      const result = await submitBalletApplication({
        parentName: user_.fullName,
        parentPhone: user_.phone,
        parentEmail: user_.email,
        childName: selectedChild_.fullName,
        childBirthday: selectedChild_.birthday,
        childAge: selectedChild_.age || calculateAge(selectedChild_.birthday),
        childGender: selectedChild_.gender,
        previousExperience: false,
        medicalNotes: selectedChild_.medicalNotes,
        emergencyContactName: selectedChild_.emergencyContactName,
        emergencyContactPhone: selectedChild_.emergencyContactPhone,
        assessmentScheduleId: selectedAppointment_.scheduleId,
        assessmentDate: selectedAppointment_.date,
        preferredPaymentMethod: CANONICAL_PAYMENT_METHOD,
        childId: selectedChildId,
      });
      // 6. finalize the submitted snapshot from the draft + server response
      // (7. success view renders from this snapshot only — see below).
      // This happens before any success-side state update (optimistic list
      // update, refetch) so the success screen can never be starved by a
      // subsequent eligibility reconciliation pass.
      setSubmittedSnapshot(finalizeAssessmentSubmissionSnapshot(draftSnapshot, {
        applicationId: result.application.id,
        status: result.application.status,
      }));
      setSubmittedApplicationId(result.application.id);
      // 8. then update/refetch applications
      setApplications((prev) => [
        {
          id: result.application.id,
          childId: selectedChildId,
          parentName: user_.fullName,
          parentPhone: user_.phone,
          parentEmail: user_.email,
          childName: selectedChild_.fullName,
          childBirthday: selectedChild_.birthday,
          childAge: selectedChild_.age || calculateAge(selectedChild_.birthday),
          childGender: selectedChild_.gender,
          emergencyContactName: selectedChild_.emergencyContactName ?? null,
          emergencyContactPhone: selectedChild_.emergencyContactPhone ?? null,
          previousExperience: false,
          experienceDetails: null,
          medicalNotes: selectedChild_.medicalNotes ?? null,
          notes: null,
          assessmentScheduleId: selectedAppointment_.scheduleId,
          assessmentDate: selectedAppointment_.date,
          preferredPackageId: null,
          preferredPaymentMethod: CANONICAL_PAYMENT_METHOD,
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
      void loadApplications();
    } catch (err) {
      const typed = err as { status?: number; data?: { error?: string; code?: string }; message?: string };
      if (typed.status === 409) {
        alert.show({ tone: "warning", title: "Already Applied", message: typed.data?.error ?? "This child already has a Ballet application." });
        setSelectedChild(null);
        setSelectedAppointment(null);
        setStep("child");
        await loadApplications();
        return;
      }
      alert.show({
        tone: "error",
        title: isOfflineError(err) ? "No Connection" : "Submission Failed",
        message: typed.data?.error ?? typed.message ?? "We couldn't submit the application. Please try again.",
      });
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  async function addAssessmentReminder() {
    if (!submittedSnapshot) return;
    const appointment = submittedSnapshot.appointment;
    const start = calendarStamp(appointment.date, appointment.startTime || appointment.time);
    const end = calendarStamp(appointment.date, appointment.endTime || appointment.startTime || appointment.time);
    const params = new URLSearchParams({
      action: "TEMPLATE",
      text: "Ballet Assessment",
      dates: `${start}/${end}`,
      details: `Central Studio Ballet application #${submittedSnapshot.applicationId}`,
      location: appointmentLocation(appointment),
      ctz: "Africa/Cairo",
    });
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      await Linking.openURL(`https://calendar.google.com/calendar/render?${params.toString()}`);
    } catch {
      alert.show({ tone: "error", title: "Couldn't open your calendar", message: "Please add the assessment appointment to your calendar manually." });
    }
  }

  if (!user || !profileComplete || user.accountType !== "parent") {
    return <View style={[styles.container, { paddingTop: Platform.OS === "web" ? 67 : insets.top }]} />;
  }

  if (submittedApplicationId != null && submittedSnapshot) {
    return (
      <View style={styles.container}>
        <LinearGradient colors={["#17191B", "#050607"]} style={StyleSheet.absoluteFill} />
        <LinearGradient colors={["rgba(0,182,215,0.50)", "rgba(0,182,215,0.03)", "transparent"]} start={{ x: 1, y: 0 }} end={{ x: 0.05, y: 0.75 }} style={styles.successGlow} />
        <SuccessConfetti />
        <ScrollView
          showsVerticalScrollIndicator={false}
          bounces
          contentContainerStyle={[styles.successScroll, {
            paddingTop: (Platform.OS === "web" ? 54 : insets.top) + 72,
            paddingBottom: Math.max(insets.bottom, 12) + 20,
          }]}
        >
          <Animated.View style={[styles.successHeading, { transform: [{ scale: successScale }] }]}>
            <Text style={styles.successTitleWhite}>APPLICATION</Text>
            <Text style={styles.successTitleCyan}>SUBMITTED</Text>
          </Animated.View>
          <View style={styles.applicationReference}>
            <Text style={styles.applicationReferenceLabel}>App Ref</Text>
            <Text style={styles.applicationReferenceValue}>#{String(submittedApplicationId).padStart(3, "0")}</Text>
          </View>
          <BalletAssessmentSuccessSummaryCard
            childName={submittedSnapshot.child.fullName}
            childGender={submittedSnapshot.child.gender}
            assessmentDateLabel={formatDisplayDate(submittedSnapshot.appointment.date, true)}
            assessmentTimeLabel={submittedSnapshot.appointment.time}
            paymentLabel={submittedSnapshot.paymentLabel}
            locationLabel={appointmentLocation(submittedSnapshot.appointment)}
            assessmentFeeEgp={assessmentFeeEgp}
            statusLabel="Pending Review"
          />
          <View style={styles.successClosingCard}>
            <Text style={styles.successClosingTitle}>See You On The Floor,</Text>
            <Text style={styles.successClosingText}>Your application has been sent to the studio team.{"\n"}You will be notified once it is reviewed.</Text>
            <BalletAssessmentSuccessActions
              onModify={() => {
                setEditingApplicationId(submittedApplicationId);
                setSelectedChild(submittedSnapshot.child);
                setSelectedAppointment(submittedSnapshot.appointment);
                setSubmittedApplicationId(null);
                setSubmittedSnapshot(null);
                setStep("review");
              }}
              onRemind={() => { void addAssessmentReminder(); }}
              onHome={() => router.replace("/(tabs)/" as never)}
            />
          </View>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: Platform.OS === "web" ? 67 : insets.top }]}>
      <LinearGradient
        colors={["rgba(0,182,215,0.42)", "rgba(0,182,215,0.04)", "transparent"]}
        locations={[0, 0.46, 1]}
        start={{ x: 1, y: 0 }}
        end={{ x: 0.06, y: 0.9 }}
        style={styles.glow}
        pointerEvents="none"
      />
      <BalletAssessmentHeader onBack={goBack} showBack={step === "child"} />
      <BalletStepIndicator currentIndex={stepIndex} />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingBottom: step === "child" ? 90 : 20 }]}
        keyboardShouldPersistTaps="handled"
      >
        {step === "child" && (
          <View style={styles.section}>
            <ScreenTitle title="Select Child" subtitle="Choose the child applying for Ballet Assessment" />
            <Text style={styles.groupLabel}>My Childs</Text>
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
              const childId = Number(child.id);
              const outsideRoutedSelection = effectiveEligibleChildIds != null && !effectiveEligibleChildIds.has(childId);
              const disabled = outsideRoutedSelection || (status != null && BLOCKING_CHILD_APPLICATION_STATUSES.has(status));
              const lockedOut = routedChildLocked && selectedChild?.id !== child.id;
              const label = status === "pending" || status === "needsFollowUp"
                ? "Application Pending"
                : status != null && BLOCKING_CHILD_APPLICATION_STATUSES.has(status)
                  ? "Already Applied"
                  : outsideRoutedSelection
                    ? "Not Available"
                    : undefined;
              return (
                <BalletAssessmentChildCard
                  key={child.id}
                  child={child}
                  selected={selectedChild?.id === child.id}
                  disabled={disabled}
                  locked={lockedOut}
                  unavailableLabel={label}
                  onPress={() => {
                    if (disabled || lockedOut) return;
                    Haptics.selectionAsync();
                    setSelectedChild(child);
                  }}
                />
              );
            })}
            <View style={styles.orDivider}><View style={styles.orLine} /><Text style={styles.orText}>OR</Text><View style={styles.orLine} /></View>
            <TouchableOpacity style={styles.addChildButton} onPress={() => { setAddChildErrors({}); setAddChildOpen(true); }} activeOpacity={0.82}>
              <View style={styles.addIcon}><Ionicons name="add" size={24} color="#FFFFFF" /></View>
              <View style={styles.addChildCopy}>
                <Text style={styles.addChildText}>Add Another Child</Text>
                <Text style={styles.addChildHint}>Start a ballet application for another child</Text>
              </View>
              <Ionicons name="arrow-forward" size={31} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
        )}

        {step === "appointment" && selectedChild && (
          <View style={styles.section}>
            <ScreenTitle title="Select Assessment Appointment" subtitle="Choose an age-eligible assessment appointment" />
            {appointmentsState === "loading" ? <LoadingCards /> : null}
            {appointmentsState === "offline" ? <OfflineState variant="compact" onRetry={() => loadAppointments(selectedChild)} /> : null}
            {appointmentsState === "error" ? <ErrorState variant="compact" message="Couldn't load assessment appointments." onRetry={() => loadAppointments(selectedChild)} /> : null}
            {appointmentsState === "empty" ? (
              <View style={styles.emptyBox}>
                <Text style={styles.emptyTitle}>No assessment appointments available</Text>
                <Text style={styles.emptyText}>
                  {(appointments as unknown as { emptyReason?: string }).emptyReason ?? `No active assessment schedules match ${selectedChild.fullName}'s age right now.`}
                </Text>
              </View>
            ) : null}
            {appointmentsState === "ready" && appointments.map((appointment) => (
              <BalletAssessmentAppointmentCard
                key={`${appointment.scheduleId}-${appointment.date}`}
                appointment={appointment}
                assessmentFeeEgp={assessmentFeeEgp}
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
            <ScreenTitle
              title="Explore Ballet Plans"
              subtitle="View the available plans. Your plan will be arranged after the assessment is approved"
            />
            {packagesState === "loading" ? <LoadingCards /> : null}
            {packagesState === "offline" ? <OfflineState variant="compact" onRetry={() => loadPackages()} /> : null}
            {packagesState === "error" ? <ErrorState variant="compact" message="Couldn't load Ballet packages." onRetry={() => loadPackages()} /> : null}
            {packagesState === "empty" ? (
              <View style={styles.emptyBox}>
                <Text style={styles.emptyTitle}>No packages available</Text>
                <Text style={styles.emptyText}>The studio has not published active Ballet packages yet.</Text>
              </View>
            ) : null}
            {packagesState === "ready" ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.packagesCarousel}>
                {packages.map((pkg) => <BalletAssessmentPackageCard key={pkg.id} pkg={pkg} />)}
              </ScrollView>
            ) : null}
            <View style={styles.assessmentFeeCard}>
              <View style={styles.assessmentFeeHeader}>
                <BalletAssessmentIcon name="shoes" size={32} />
                <View style={styles.assessmentFeeCopy}>
                  <Text style={styles.assessmentFeeTitle}>ASSESSMENT FEE</Text>
                  <Text style={styles.assessmentFeeDescription}>This is a separate assessment fee, paid at the studio on your appointment date.</Text>
                </View>
              </View>
              <View style={styles.assessmentFeeValueRow}>
                <Text style={styles.assessmentFeeValue}>{assessmentFeeEgp != null ? assessmentFeeEgp.toLocaleString("en-US") : "TBC"}</Text>
                {assessmentFeeEgp != null ? <Text style={styles.assessmentFeeCurrency}>EGP</Text> : null}
              </View>
            </View>
          </View>
        )}

        {step === "review" && reviewMissingStep == null && selectedChild && selectedAppointment && (
          <View style={styles.section}>
            <ScreenTitle title="Review Application" subtitle="Confirm every detail before submitting" />
            <BalletAssessmentSummaryCard
              child={selectedChild}
              appointment={selectedAppointment}
              paymentLabel={CANONICAL_PAYMENT_LABEL}
              assessmentFeeEgp={assessmentFeeEgp}
              onEdit={(section) => {
                const target: Step = section === "child" ? "child" : "appointment";
                setStep(target);
              }}
            />
          </View>
        )}
        {step === "review" && reviewMissingStep != null && (
          <View style={styles.section}>
            <ScreenTitle title="Review Application" subtitle="Confirm every detail before submitting." />
            <LoadingCards />
          </View>
        )}
      </ScrollView>

      <View style={[styles.footer, stepIndex > 0 && styles.footerPanel, { paddingBottom: (Platform.OS === "web" ? 20 : insets.bottom) + 14 }]}>
        {step === "appointment" || step === "package" ? (
          <View style={styles.noteBlock}>
              <View style={styles.noteHeading}><BalletAssessmentIcon name="info" size={22} /><Text style={styles.noteTitle}>Be Noted</Text></View>
            {step === "appointment" ? (
              <>
                <Text style={styles.noteText}>• This appointment is for your ballet assessment, not your weekly ballet class.</Text>
                <Text style={styles.noteText}>• The assessment fee is separate from class packages and is non-refundable after acceptance.</Text>
              </>
            ) : (
              <>
                <Text style={styles.noteText}>• These plans are shown for information only; no plan is selected during this application.</Text>
                <Text style={styles.noteText}>• The studio will arrange your plan after the assessment is approved.</Text>
              </>
            )}
          </View>
        ) : null}
        <View style={styles.footerActions}>
          {stepIndex > 0 ? (
            <TouchableOpacity style={[styles.footerButton, styles.secondaryButton]} onPress={goBack} activeOpacity={0.86}>
              <Text style={styles.secondaryButtonText}>Back</Text>
            </TouchableOpacity>
          ) : null}
          {step === "review" ? (
            <TouchableOpacity style={[styles.footerButton, styles.primaryButton, (submitting || reviewMissingStep != null) && { opacity: 0.6 }]} onPress={handleSubmit} disabled={submitting || reviewMissingStep != null} activeOpacity={0.86}>
              {submitting ? <ActivityIndicator color={BA.ink900} /> : <Text style={styles.primaryButtonText}>Submit</Text>}
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={[styles.footerButton, styles.primaryButton]} onPress={goNext} activeOpacity={0.86}>
              <Text style={styles.primaryButtonText}>Continue</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      <Modal visible={addChildOpen} animationType="slide" transparent onRequestClose={() => setAddChildOpen(false)}>
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add New Child</Text>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Close Add New Child"
                onPress={() => setAddChildOpen(false)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="close" size={22} color={BA.ink300} />
              </TouchableOpacity>
            </View>
            <ScrollView
              style={styles.modalScroll}
              contentContainerStyle={[styles.modalForm, { paddingBottom: Math.max(insets.bottom, 18) }]}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.formSection}>
                <Field
                  label="Child Name"
                  value={newChildName}
                  onChangeText={(value) => {
                    setNewChildName(value);
                    if (addChildErrors.name) setAddChildErrors((current) => ({ ...current, name: undefined }));
                  }}
                  placeholder="Sara Ahmed"
                  error={addChildErrors.name}
                />
              </View>

              <View style={styles.formSection}>
                <Text style={styles.groupLabel}>Date of Birth</Text>
                <View style={styles.birthRow}>
                  <View style={styles.birthField}><Field label="Day" value={newChildDay} onChangeText={(value) => { setNewChildDay(value); setAddChildErrors((current) => ({ ...current, birthday: undefined })); }} placeholder="12" keyboardType="number-pad" /></View>
                  <View style={styles.birthField}><Field label="Month" value={newChildMonth} onChangeText={(value) => { setNewChildMonth(value); setAddChildErrors((current) => ({ ...current, birthday: undefined })); }} placeholder="03" keyboardType="number-pad" /></View>
                  <View style={styles.birthField}><Field label="Year" value={newChildYear} onChangeText={(value) => { setNewChildYear(value); setAddChildErrors((current) => ({ ...current, birthday: undefined })); }} placeholder="2021" keyboardType="number-pad" /></View>
                </View>
                {addChildErrors.birthday ? <Text style={styles.fieldError}>{addChildErrors.birthday}</Text> : null}
              </View>

              <View style={styles.formSection}>
                <Text style={styles.groupLabel}>Gender</Text>
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
              </View>

              <TouchableOpacity
                onPress={handleAddChild}
                disabled={addingChild}
                activeOpacity={0.86}
                style={[styles.primaryButton, styles.saveChildButton, addingChild && { opacity: 0.6 }]}
              >
                {addingChild ? <ActivityIndicator color={BA.ink900} /> : <Text style={styles.primaryButtonText}>Save Child</Text>}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#101214" },
  glow: { position: "absolute", top: -25, right: -10, width: "86%", height: 190, transform: [{ rotate: "-8deg" }] },
  scroll: { width: "100%", maxWidth: 430, alignSelf: "center", paddingHorizontal: 30, paddingTop: 0 },
  section: { gap: 9 },
  stepIntro: { gap: 1, marginBottom: 9 },
  stepTitle: {
    color: BA.white,
    fontFamily: "Archivo_700Bold",
    fontSize: 22,
    lineHeight: 26,
  },
  stepSubtitle: {
    color: BA.white,
    fontFamily: "Archivo_400Regular",
    fontSize: 14,
    lineHeight: 18,
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
    minHeight: 64,
    borderRadius: 32,
    borderWidth: 1.5,
    borderColor: "rgba(0,182,215,0.58)",
    backgroundColor: "#003741",
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    gap: 9,
  },
  addIcon: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: "#FFFFFF", alignItems: "center", justifyContent: "center" },
  addChildCopy: { flex: 1, minWidth: 0 },
  addChildText: {
    color: "#FFFFFF",
    fontFamily: "Anton_400Regular",
    fontSize: 20,
    lineHeight: 23,
  },
  addChildHint: { color: "#FFFFFF", fontFamily: "Archivo_400Regular", fontSize: 12.5, lineHeight: 16 },
  orDivider: { flexDirection: "row", alignItems: "center", gap: 18, paddingHorizontal: 41, marginVertical: 6 },
  orLine: { flex: 1, height: 1, backgroundColor: "rgba(255,255,255,0.78)" },
  orText: { color: "#FFFFFF", fontFamily: "Anton_400Regular", fontSize: 20, lineHeight: 23 },
  packagesCarousel: { gap: 11, paddingRight: 20, paddingVertical: 4 },
  assessmentFeeCard: { minHeight: 160, marginTop: 10, borderRadius: 27, paddingHorizontal: 18, paddingVertical: 16, justifyContent: "space-between", backgroundColor: "#F4F4F4" },
  assessmentFeeHeader: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  assessmentFeeCopy: { flex: 1, minWidth: 0 },
  assessmentFeeTitle: { color: BA.cyan500, fontFamily: "Anton_400Regular", fontSize: 24, lineHeight: 28 },
  assessmentFeeDescription: { color: BA.cyan500, fontFamily: "Archivo_600SemiBold", fontSize: 12, lineHeight: 16, textTransform: "uppercase" },
  assessmentFeeValueRow: { flexDirection: "row", alignItems: "flex-end", gap: 8, paddingLeft: 25 },
  assessmentFeeValue: { color: BA.cyan500, fontFamily: "Anton_400Regular", fontSize: 72, lineHeight: 72, ...iosDisplayTextStyle(72, 72) },
  assessmentFeeCurrency: { color: BA.cyan500, fontFamily: "Anton_400Regular", fontSize: 19, lineHeight: 24, marginBottom: 5 },
  footer: {
    width: "100%",
    maxWidth: 430,
    alignSelf: "center",
    paddingHorizontal: 20,
    paddingTop: 12,
    backgroundColor: "#101214",
  },
  footerPanel: { borderTopLeftRadius: 42, borderTopRightRadius: 42, backgroundColor: "#003741", paddingHorizontal: 32, paddingTop: 18 },
  footerActions: { flexDirection: "row", gap: 8 },
  noteBlock: { marginBottom: 17 },
  noteHeading: { flexDirection: "row", alignItems: "center", gap: 7, marginBottom: 6 },
  noteTitle: { color: "#FFFFFF", fontFamily: "Archivo_700Bold", fontSize: 20, lineHeight: 24 },
  noteText: { color: "#FFFFFF", fontFamily: "Archivo_400Regular", fontSize: 13, lineHeight: 18, paddingLeft: 4 },
  footerButton: {
    flex: 1,
    minHeight: 52,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryButton: {
    backgroundColor: BA.cyan500,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 999,
  },
  primaryButtonText: {
    color: BA.ink900,
    fontFamily: "Archivo_800ExtraBold",
    fontSize: 15,
  },
  secondaryButton: {
    backgroundColor: "transparent",
    borderWidth: 1.5,
    borderColor: BA.cyan500,
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
    maxHeight: "90%",
    paddingTop: 18,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 14,
  },
  modalTitle: {
    color: BA.white,
    fontFamily: "Archivo_800ExtraBold",
    fontSize: 18,
  },
  modalScroll: { flexGrow: 0 },
  modalForm: { paddingHorizontal: 20, gap: 18 },
  formSection: { gap: 9 },
  field: { gap: 6 },
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
  fieldError: {
    color: BA.danger,
    fontFamily: "Archivo_400Regular",
    fontSize: 12,
    lineHeight: 17,
  },
  groupLabel: {
    color: BA.white,
    fontFamily: "Archivo_700Bold",
    fontSize: 15,
    lineHeight: 19,
  },
  birthRow: { flexDirection: "row", gap: 8 },
  birthField: { flex: 1, minWidth: 0 },
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
  saveChildButton: { minHeight: 50, marginTop: 2 },
  successGlow: { position: "absolute", top: -45, right: -10, width: "90%", height: 180, transform: [{ rotate: "-9deg" }] },
  successScroll: { width: "100%", maxWidth: 430, alignSelf: "center", paddingHorizontal: 15 },
  successHeading: { alignItems: "center", marginBottom: 27 },
  successTitleWhite: { color: "#FFFFFF", fontFamily: "Anton_400Regular", fontSize: 39, lineHeight: 39, ...iosDisplayTextStyle(39, 39) },
  successTitleCyan: { marginTop: -4, color: BA.cyan500, fontFamily: "Anton_400Regular", fontSize: 39, lineHeight: 39, ...iosDisplayTextStyle(39, 39) },
  applicationReference: { marginBottom: 10, paddingHorizontal: 14 },
  applicationReferenceLabel: { color: "#FFFFFF", fontFamily: "Archivo_500Medium", fontSize: 14, lineHeight: 17 },
  applicationReferenceValue: { color: "#FFFFFF", fontFamily: "Archivo_700Bold", fontSize: 20, lineHeight: 23 },
  successClosingCard: { marginTop: 12, borderRadius: 42, paddingHorizontal: 20, paddingTop: 18, paddingBottom: 14, backgroundColor: "#003741" },
  successClosingTitle: { color: "#FFFFFF", fontFamily: "Anton_400Regular", fontSize: 28, lineHeight: 33, textAlign: "center", ...iosDisplayTextStyle(28, 33) },
  successClosingText: { marginTop: 3, marginBottom: 12, color: "#FFFFFF", fontFamily: "Archivo_400Regular", fontSize: 13, lineHeight: 17, textAlign: "center" },
});
