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
import BalletAssessmentSuccessSummaryCard from "@/components/ballet/BalletAssessmentSuccessSummaryCard";
import BalletAssessmentSummaryCard from "@/components/ballet/BalletAssessmentSummaryCard";
import BalletStepIndicator from "@/components/ballet/BalletStepIndicator";
import { BA, BA_RADIUS } from "@/components/ballet/assessmentTokens";
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
  cancelBalletApplication,
  fetchBalletApplicationDetail,
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
  const [selectedPackage, setSelectedPackage] = useState<BalletPackageOption | null>(null);
  const [applications, setApplications] = useState<BalletApplication[]>([]);
  const [applicationsState, setApplicationsState] = useState<LoadState>("loading");
  const [appointments, setAppointments] = useState<AssessmentScheduleOption[]>([]);
  const [appointmentsState, setAppointmentsState] = useState<LoadState>("loading");
  const [packages, setPackages] = useState<BalletPackageOption[]>([]);
  const [packagesState, setPackagesState] = useState<LoadState>("loading");
  const [submitting, setSubmitting] = useState(false);
  const [submittedApplicationId, setSubmittedApplicationId] = useState<number | null>(null);
  const [submittedSnapshot, setSubmittedSnapshot] = useState<
    AssessmentSubmissionSnapshot<ChildProfile, AssessmentScheduleOption, BalletPackageOption> | null
  >(null);
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
  const [sessionCreatedChildIds, setSessionCreatedChildIds] = useState<Set<number>>(() => new Set());
  const [addChildErrors, setAddChildErrors] = useState<{ name?: string; birthday?: string }>({});
  const [addingChild, setAddingChild] = useState(false);
  const authPromptShownRef = useRef(false);
  const parentPromptShownRef = useRef(false);
  const submittingRef = useRef(false);
  const successScale = useRef(new Animated.Value(0)).current;
  const trimmedCancelReason = cancelReason.trim();
  const cancelReasonError = trimmedCancelReason.length === 0
    ? "Reason is required."
    : trimmedCancelReason.length < 5
      ? "Reason must be at least 5 characters."
      : trimmedCancelReason.length > 500
        ? "Reason must be at most 500 characters."
        : null;

  const settingsQuery = useQuery({
    queryKey: ["ballet-settings"],
    queryFn: fetchBalletSettings,
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
      setSelectedPackage(null);
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
      hasPackage: selectedPackage != null,
    });
  }, [step, selectedChild, selectedAppointment, selectedPackage]);

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
    if (step === "package" && !selectedPackage) {
      alert.show({ tone: "warning", title: "Select Package", message: "Choose a Ballet package." });
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

    // 2. validate child, appointment, package, and payment method (a fixed
    // canonical constant in this flow — never user-selected, so always
    // valid once reached).
    if (!canSubmitAssessment({
      hasUser: !!user,
      hasChild: !!selectedChild,
      hasAppointment: !!selectedAppointment,
      hasPackage: !!selectedPackage,
      isSubmitting: submitting,
      hasSubmittedSnapshot: submittedSnapshot != null,
    })) {
      return;
    }
    // Non-null by the guard above; narrowed for TypeScript.
    const user_ = user!;
    const selectedChild_ = selectedChild!;
    const selectedAppointment_ = selectedAppointment!;
    const selectedPackage_ = selectedPackage!;
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
      pkg: selectedPackage_,
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
          preferredPackageId: selectedPackage_.id,
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
        preferredPackageId: selectedPackage_.id,
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
          preferredPackageId: selectedPackage_.id,
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
        setSelectedPackage(null);
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

  function resetForAnotherChild() {
    setSubmittedApplicationId(null);
    setSubmittedSnapshot(null);
    setEditingApplicationId(null);
    setSelectedChild(null);
    setSelectedAppointment(null);
    setSelectedPackage(null);
    setStep("child");
    loadApplications();
  }

  function confirmCancel() {
    if (submittedApplicationId == null || !submittedSnapshot) return;
    const childName = submittedSnapshot.child.fullName;
    alert.show({
      tone: "destructive",
      title: `Cancel ${childName}'s Application?`,
      message: `This cancels only ${childName}'s submitted Ballet Assessment application. You can apply again afterwards.`,
      actions: [
        { label: "Keep Application", tone: "neutral" },
        {
          label: "Cancel Application",
          tone: "danger",
          onPress: () => {
            setCancelReason("");
            setCancelReasonOpen(true);
          },
        },
      ],
    });
  }

  async function submitCancelApplication() {
    if (submittedApplicationId == null || cancelReasonError) return;
    setCancelLoading(true);
    try {
      const latest = await fetchBalletApplicationDetail(submittedApplicationId);
      if (!["pending", "needsFollowUp", "accepted", "assignedToLevel"].includes(latest.application.status)) {
        alert.show({
          tone: "warning",
          title: "Cannot Cancel Here",
          message: latest.application.status === "active"
            ? "This application is now an active enrollment. Please use Request Ballet Cancellation from the application status screen."
            : "This application can no longer be cancelled from this screen.",
        });
        router.replace("/ballet/application-status" as any);
        return;
      }
      await cancelBalletApplication(submittedApplicationId, { reason: trimmedCancelReason });
      alert.show({ tone: "success", title: "Application Cancelled", message: "The application has been cancelled." });
      setCancelReasonOpen(false);
      resetForAnotherChild();
    } catch (err) {
      alert.show({ tone: "error", title: "Could Not Cancel", message: err instanceof Error ? err.message : "Please try again." });
    } finally {
      setCancelLoading(false);
    }
  }

  if (!user || !profileComplete || user.accountType !== "parent") {
    return <View style={[styles.container, { paddingTop: Platform.OS === "web" ? 67 : insets.top }]} />;
  }

  if (submittedApplicationId != null && submittedSnapshot) {
    return (
      <View style={[styles.container, { paddingTop: Platform.OS === "web" ? 67 : insets.top }]}>
        <LinearGradient colors={["#04161B", BA.ink900]} style={StyleSheet.absoluteFill} />
        <BalletAssessmentHeader onBack={goBack} homeAction={() => router.replace("/" as never)} />
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[styles.successScroll, { paddingTop: 20 }]}
        >
          <Animated.View style={[styles.successIcon, { transform: [{ scale: successScale }] }]}>
            <Svg width={38} height={38} viewBox="0 0 24 24" fill="none">
              <Path d="M20 6 9 17l-5-5" stroke={BA.ink900} strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round" />
            </Svg>
          </Animated.View>
          <Text style={styles.successTitle}>Application Submitted Successfully</Text>
          <BalletAssessmentSuccessSummaryCard
            childName={submittedSnapshot.child.fullName}
            assessmentDateLabel={formatDisplayDate(submittedSnapshot.appointment.date, true)}
            assessmentTimeLabel={submittedSnapshot.appointment.time}
            paymentLabel={submittedSnapshot.paymentLabel}
            statusLabel="Pending Review"
          />
        </ScrollView>
        <View style={[styles.footer, styles.successFooter, { paddingBottom: (Platform.OS === "web" ? 20 : insets.bottom) + 14 }]}>
          <BalletAssessmentSuccessActions
            onModify={() => {
              setEditingApplicationId(submittedApplicationId);
              setSelectedChild(submittedSnapshot.child);
              setSelectedAppointment(submittedSnapshot.appointment);
              setSelectedPackage(submittedSnapshot.pkg);
              setSubmittedApplicationId(null);
              setSubmittedSnapshot(null);
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
            {applicationsState === "ready" && visibleChildren.length === 0 ? (
              <View style={styles.emptyBox}>
                <Text style={styles.emptyTitle}>{routedEligibleChildIds == null ? "No children found" : "No eligible children found"}</Text>
                <Text style={styles.emptyText}>
                  {routedEligibleChildIds == null
                    ? "Add a child profile before starting the Ballet Assessment application."
                    : "Each selected child already has an open Ballet application."}
                </Text>
              </View>
            ) : null}
            {applicationsState === "ready" && visibleChildren.map((child) => {
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
                  locked={routedChildLocked}
                  unavailableLabel={label}
                  onPress={() => {
                    if (disabled || routedChildLocked) return;
                    Haptics.selectionAsync();
                    setSelectedChild(child);
                  }}
                />
              );
            })}
            <TouchableOpacity
              style={styles.addChildButton}
              onPress={() => {
                setAddChildErrors({});
                setAddChildOpen(true);
              }}
              activeOpacity={0.82}
            >
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
            {assessmentFeeEgp != null && assessmentFeeEgp > 0 ? (
              <View style={styles.infoBanner}>
                <Ionicons name="cash-outline" size={18} color={BA.cyan400} />
                <Text style={styles.infoText}>
                  Ballet Assessment Fee: {assessmentFeeEgp.toLocaleString("en-US")} EGP (Payable at studio during appointment)
                </Text>
              </View>
            ) : null}
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
              title="Select Preferred Package"
              subtitle="Package preference only. You are not paying for this package today. Package payment will be arranged after assessment approval."
            />
            <View style={styles.infoBanner}>
              <Ionicons name="information-circle-outline" size={18} color={BA.cyan400} />
              <Text style={styles.infoText}>
                This selection indicates your preferred subscription plan. No package payment is collected during assessment submission.
              </Text>
            </View>
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

        {step === "review" && reviewMissingStep == null && selectedChild && selectedAppointment && selectedPackage && (
          <View style={styles.section}>
            <ScreenTitle title="Review Application" subtitle="Confirm every detail before submitting." />
            <BalletAssessmentSummaryCard
              child={selectedChild}
              appointment={selectedAppointment}
              pkg={selectedPackage}
              paymentLabel={CANONICAL_PAYMENT_LABEL}
              assessmentFeeEgp={assessmentFeeEgp}
              onEdit={(section) => {
                const target: Step = section === "child" ? "child" : section === "appointment" ? "appointment" : "package";
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

      <View style={[styles.footer, { paddingBottom: (Platform.OS === "web" ? 20 : insets.bottom) + 14 }]}>
        {stepIndex > 0 ? (
          <TouchableOpacity style={[styles.footerButton, styles.secondaryButton]} onPress={goBack} activeOpacity={0.86}>
            <Text style={styles.secondaryButtonText}>Back</Text>
          </TouchableOpacity>
        ) : null}
        {step === "review" ? (
          <TouchableOpacity
            style={[styles.footerButton, styles.primaryButton, (submitting || reviewMissingStep != null) && { opacity: 0.6 }]}
            onPress={handleSubmit}
            disabled={submitting || reviewMissingStep != null}
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
  // The success screen's action stack is a single column of full-width
  // actions, not a row-paired Back/Continue pair — reusing `footer`
  // unmodified previously left its lone child sized to its own intrinsic
  // (shrink-to-fit) content width instead of the available screen width,
  // which is what made the buttons look clipped/cramped.
  successFooter: {
    flexDirection: "column",
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
  modalHelper: {
    color: BA.ink300,
    fontFamily: "Archivo_400Regular",
    fontSize: 13,
    lineHeight: 19,
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
    fontSize: 13,
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
    paddingBottom: 40,
    alignItems: "center",
  },
  successIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: BA.cyan500,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
    shadowColor: BA.cyan500,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 6,
  },
  successTitle: {
    color: BA.white,
    fontFamily: "Anton_400Regular",
    fontSize: 27,
    lineHeight: 30,
    textTransform: "uppercase",
    textAlign: "center",
    ...iosDisplayTextStyle(27, 30),
    marginBottom: 26,
    paddingHorizontal: 6,
  },
});
