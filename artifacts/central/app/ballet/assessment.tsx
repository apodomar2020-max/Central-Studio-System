import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import React, { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import { useAppContext } from "@/contexts/AppContext";
import {
  BALLET_LEVELS,
  BALLET_PRICING,
  AssessmentSlot,
  fetchAssessmentSlots,
  submitBalletApplication,
  isOfflineError,
} from "@/services/balletAssessmentService";
import { probeConnectivity } from "@/services/connectivity";
import colors from "@/constants/colors";
import AppButton from "@/components/AppButton";
import StepIndicator from "@/components/StepIndicator";
import OfflineState from "@/components/OfflineState";
import ErrorState from "@/components/ErrorState";

const BALLET_COLOR = "#A78BFA";
const STEPS = ["About You", "Child Info", "Experience", "Select Slot", "Review"];

type FormData = {
  parentName: string;
  parentPhone: string;
  parentEmail: string;
  childName: string;
  childBirthday: string;
  childAge: string;
  childGender: "male" | "female";
  previousExperience: boolean | null;
  experienceDetails: string;
  medicalNotes: string;
  selectedSlot: AssessmentSlot | null;
  emergencyContactName: string;
  emergencyContactPhone: string;
  notes: string;
};

const INITIAL_FORM: FormData = {
  parentName: "",
  parentPhone: "",
  parentEmail: "",
  childName: "",
  childBirthday: "",
  childAge: "",
  childGender: "female",
  previousExperience: null,
  experienceDetails: "",
  medicalNotes: "",
  selectedSlot: null,
  emergencyContactName: "",
  emergencyContactPhone: "",
  notes: "",
};

function Field({
  label,
  value,
  onChange,
  placeholder,
  keyboardType,
  multiline,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  keyboardType?: "default" | "email-address" | "phone-pad" | "numeric";
  multiline?: boolean;
  required?: boolean;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>
        {label}
        {required && <Text style={{ color: BALLET_COLOR }}> *</Text>}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor="#4B5563"
        style={[styles.input, multiline && { minHeight: 72 }]}
        keyboardType={keyboardType ?? "default"}
        multiline={multiline}
        autoCapitalize={keyboardType === "email-address" ? "none" : "words"}
      />
    </View>
  );
}

export default function BalletAssessmentScreen() {
  const { user, baletApplications } = useAppContext();
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<FormData>(INITIAL_FORM);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // ── Connectivity gate ──────────────────────────────────────────────────────
  // We probe connectivity on mount so offline users see OfflineState immediately
  // rather than navigating into the form and hitting an error at step 3.
  const [connectivity, setConnectivity] = useState<"checking" | "online" | "offline">("checking");

  // ── Slot data state ────────────────────────────────────────────────────────
  const [slots, setSlots] = useState<AssessmentSlot[]>([]);
  const [slotsState, setSlotsState] = useState<"idle" | "loading" | "success" | "empty" | "error" | "offline">("idle");

  const loadSlots = useCallback(async (signal?: AbortSignal) => {
    setSlotsState("loading");
    try {
      const data = await fetchAssessmentSlots(signal);
      setSlots(data);
      setSlotsState(data.length === 0 ? "empty" : "success");
    } catch (e) {
      if ((e as any)?.name === "AbortError") return;
      setSlotsState(isOfflineError(e) ? "offline" : "error");
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    // 1. Probe connectivity first.
    probeConnectivity(controller.signal)
      .then((status) => {
        if (controller.signal.aborted) return;
        setConnectivity(status);
        // 2. Only fetch slots if we're online.
        if (status === "online") {
          loadSlots(controller.signal);
        }
      })
      .catch(() => {
        // AbortError from navigation — ignore.
      });

    return () => controller.abort();
  }, [loadSlots]);

  const existing = baletApplications[0];

  function update<K extends keyof FormData>(key: K, value: FormData[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function validateStep(): string | null {
    if (step === 0) {
      if (!form.parentName.trim()) return "Parent full name is required.";
      if (!form.parentPhone.trim()) return "Parent phone is required.";
      if (!form.parentEmail.trim()) return "Parent email is required.";
      if (!form.emergencyContactName.trim()) return "Emergency contact name is required.";
      if (!form.emergencyContactPhone.trim()) return "Emergency contact phone is required.";
    }
    if (step === 1) {
      if (!form.childName.trim()) return "Child's full name is required.";
      if (!form.childAge.trim() || isNaN(Number(form.childAge))) return "A valid age is required.";
    }
    if (step === 2) {
      if (form.previousExperience === null) return "Please indicate previous dance experience.";
    }
    if (step === 3) {
      if (!form.selectedSlot) return "Please select an assessment appointment slot.";
    }
    return null;
  }

  function handleNext() {
    const err = validateStep();
    if (err) { Alert.alert("Required", err); return; }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  function handleBack() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setStep((s) => Math.max(s - 1, 0));
  }

  async function handleSubmit() {
    if (!form.selectedSlot || submitting) return;

    const slotId = parseInt(form.selectedSlot.id, 10);
    if (isNaN(slotId)) {
      Alert.alert("Error", "Invalid slot selection. Please go back and select a slot again.");
      return;
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    setSubmitting(true);

    try {
      await submitBalletApplication({
        parentName:             form.parentName.trim(),
        parentPhone:            form.parentPhone.trim(),
        parentEmail:            form.parentEmail.trim(),
        childName:              form.childName.trim(),
        childBirthday:          form.childBirthday.trim() || undefined,
        childAge:               form.childAge.trim() ? parseInt(form.childAge, 10) : undefined,
        childGender:            form.childGender,
        previousExperience:     form.previousExperience ?? false,
        experienceDetails:      form.experienceDetails.trim() || undefined,
        medicalNotes:           form.medicalNotes.trim() || undefined,
        emergencyContactName:   form.emergencyContactName.trim() || undefined,
        emergencyContactPhone:  form.emergencyContactPhone.trim() || undefined,
        notes:                  form.notes.trim() || undefined,
        slotId,
      });
      setSubmitted(true);
    } catch (err) {
      if (isOfflineError(err)) {
        Alert.alert(
          "No Connection",
          "Unable to submit your application — please check your internet connection and try again."
        );
      } else {
        // Surface server-provided error messages when available (409 full, 404 not found, etc.)
        const serverMsg =
          (err as any)?.data?.error ??
          (err as any)?.message ??
          "Something went wrong. Please try again.";
        Alert.alert("Submission Failed", serverMsg);
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <View style={[styles.container, { paddingTop: Platform.OS === "web" ? 67 : insets.top }]}>
        <View style={styles.successHeader}>
          <TouchableOpacity
            onPress={() => router.replace("/(tabs)/" as any)}
            style={styles.successHeaderBtn}
          >
            <Ionicons name="home-outline" size={20} color="#FFFFFF" />
          </TouchableOpacity>
          <Text style={styles.successHeaderTitle}>Application Submitted</Text>
          <TouchableOpacity
            onPress={() => router.replace("/(tabs)/" as any)}
            style={styles.successHeaderBtn}
          >
            <Ionicons name="close" size={20} color="#9CA3AF" />
          </TouchableOpacity>
        </View>
        <View style={styles.successWrap}>
          <LinearGradient
            colors={[`${BALLET_COLOR}20`, colors.studio.card]}
            style={styles.successCard}
          >
            <View style={[styles.successIcon, { backgroundColor: BALLET_COLOR + "20" }]}>
              <Ionicons name="checkmark-circle" size={56} color={BALLET_COLOR} />
            </View>
            <Text style={styles.successTitle}>Application Submitted</Text>
            <Text style={styles.successDesc}>
              Your assessment request has been received.{"\n\n"}
              Our team will review your submission and contact you regarding the assessment date and next steps.
            </Text>

            <View style={[styles.successInfo, { borderColor: BALLET_COLOR + "30" }]}>
              <Text style={styles.successInfoTitle}>What happens next?</Text>
              {[
                "Our team contacts you to confirm the appointment",
                "Attend the assessment session with your child",
                "Receive the result within 48 hours",
                "If accepted, your child is assigned to a Ballet level",
              ].map((step, i) => (
                <View key={i} style={styles.successStep}>
                  <View style={[styles.successStepNum, { backgroundColor: BALLET_COLOR + "20" }]}>
                    <Text style={[styles.successStepNumText, { color: BALLET_COLOR }]}>{i + 1}</Text>
                  </View>
                  <Text style={styles.successStepText}>{step}</Text>
                </View>
              ))}
            </View>

            <View style={styles.pricingBox}>
              <Text style={styles.pricingTitle}>Ballet Pricing</Text>
              {BALLET_PRICING.map((p) => (
                <View key={p.level} style={styles.pricingRow}>
                  <View>
                    <Text style={styles.pricingLevel}>{p.level}</Text>
                    <Text style={styles.pricingHours}>{p.hours}</Text>
                  </View>
                  <Text style={[styles.pricingAmount, { color: BALLET_COLOR }]}>EGP {p.price.toLocaleString()}</Text>
                </View>
              ))}
            </View>

            <AppButton title="Back to Home" onPress={() => router.replace("/(tabs)/")} fullWidth />
          </LinearGradient>
        </View>
      </View>
    );
  }

  if (existing && !submitted) {
    return (
      <View style={[styles.container, { paddingTop: Platform.OS === "web" ? 67 : insets.top }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color="#FFFFFF" />
        </TouchableOpacity>
        <View style={styles.successWrap}>
          <View style={[styles.existingCard, { borderColor: BALLET_COLOR + "40" }]}>
            <View style={[styles.successIcon, { backgroundColor: BALLET_COLOR + "20" }]}>
              <Ionicons name="diamond" size={40} color={BALLET_COLOR} />
            </View>
            <Text style={styles.successTitle}>Application Already Submitted</Text>
            <Text style={styles.successDesc}>
              You already have a ballet application on file for {existing.childName}.
            </Text>
            <View style={[styles.statusRow, { backgroundColor: BALLET_COLOR + "15", borderColor: BALLET_COLOR + "30" }]}>
              <Text style={[styles.statusLabel, { color: BALLET_COLOR }]}>
                Status: {existing.status.replace(/([A-Z])/g, " $1").trim()}
              </Text>
            </View>
            <AppButton title="Go Back" variant="ghost" onPress={() => router.back()} fullWidth />
          </View>
        </View>
      </View>
    );
  }

  // Show offline gate while checking, or if offline
  if (connectivity !== "online") {
    const handleConnectivityRetry = () => {
      setConnectivity("checking");
      const controller = new AbortController();
      probeConnectivity(controller.signal)
        .then((status) => {
          setConnectivity(status);
          if (status === "online") loadSlots();
        })
        .catch(() => {});
    };

    return (
      <View style={[styles.container, { paddingTop: Platform.OS === "web" ? 67 : insets.top }]}>
        <View style={styles.topBar}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={22} color="#FFFFFF" />
          </TouchableOpacity>
          <View style={styles.topBarCenter}>
            <Text style={styles.topBarTitle}>Ballet Assessment</Text>
          </View>
          <View style={{ width: 40 }} />
        </View>
        {connectivity === "offline" ? (
          <OfflineState onRetry={handleConnectivityRetry} />
        ) : (
          // "checking" state — blank while we probe
          <View style={{ flex: 1 }} />
        )}
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: Platform.OS === "web" ? 67 : insets.top }]}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={step === 0 ? () => router.back() : handleBack} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color="#FFFFFF" />
        </TouchableOpacity>
        <View style={styles.topBarCenter}>
          <Text style={styles.topBarTitle}>Ballet Assessment</Text>
          <Text style={styles.topBarSub}>Step {step + 1} of {STEPS.length}</Text>
        </View>
        <View style={{ width: 40 }} />
      </View>

      <StepIndicator current={step + 1} total={STEPS.length} labels={STEPS} />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingBottom: 120 }]}
        keyboardShouldPersistTaps="handled"
      >
        {step === 0 && (
          <View style={styles.stepWrap}>
            <View style={styles.stepHeader}>
              <Text style={styles.stepTitle}>Parent / Guardian Information</Text>
              <Text style={styles.stepDesc}>As most applications are submitted by parents, please fill in your details.</Text>
            </View>
            <Field label="Parent Full Name" value={form.parentName} onChange={(v) => update("parentName", v)} placeholder="Your full name" required />
            <Field label="Phone Number" value={form.parentPhone} onChange={(v) => update("parentPhone", v)} placeholder="+20 1XX XXX XXXX" keyboardType="phone-pad" required />
            <Field label="Email Address" value={form.parentEmail} onChange={(v) => update("parentEmail", v)} placeholder="your@email.com" keyboardType="email-address" required />
            <View style={styles.divider} />
            <Text style={styles.subSectionLabel}>Emergency Contact</Text>
            <Field label="Emergency Contact Name" value={form.emergencyContactName} onChange={(v) => update("emergencyContactName", v)} placeholder="Full name" required />
            <Field label="Emergency Contact Phone" value={form.emergencyContactPhone} onChange={(v) => update("emergencyContactPhone", v)} placeholder="+20 1XX XXX XXXX" keyboardType="phone-pad" required />
          </View>
        )}

        {step === 1 && (
          <View style={styles.stepWrap}>
            <View style={styles.stepHeader}>
              <Text style={styles.stepTitle}>Child Information</Text>
              <Text style={styles.stepDesc}>Tell us about the child applying for the ballet assessment.</Text>
            </View>
            <Field label="Child Full Name" value={form.childName} onChange={(v) => update("childName", v)} placeholder="Child's full name" required />
            <View style={styles.rowFields}>
              <View style={{ flex: 1 }}>
                <Field label="Date of Birth" value={form.childBirthday} onChange={(v) => update("childBirthday", v)} placeholder="YYYY-MM-DD" />
              </View>
              <View style={{ flex: 1 }}>
                <Field label="Age" value={form.childAge} onChange={(v) => update("childAge", v)} placeholder="Age" keyboardType="numeric" required />
              </View>
            </View>
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Gender</Text>
              <View style={styles.genderRow}>
                {(["female", "male"] as const).map((g) => (
                  <TouchableOpacity
                    key={g}
                    onPress={() => update("childGender", g)}
                    style={[styles.genderBtn, form.childGender === g && { borderColor: BALLET_COLOR, backgroundColor: BALLET_COLOR + "15" }]}
                  >
                    <Text style={[styles.genderBtnText, form.childGender === g && { color: BALLET_COLOR }]}>
                      {g === "female" ? "Girl" : "Boy"}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            <Field label="Medical Notes or Injuries" value={form.medicalNotes} onChange={(v) => update("medicalNotes", v)} placeholder="Any conditions, injuries, or medical info the instructor should know..." multiline />
          </View>
        )}

        {step === 2 && (
          <View style={styles.stepWrap}>
            <View style={styles.stepHeader}>
              <Text style={styles.stepTitle}>Dance Experience</Text>
              <Text style={styles.stepDesc}>This helps us understand your child's starting level.</Text>
            </View>

            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Previous ballet or dance experience?</Text>
              <View style={styles.yesNoRow}>
                {[true, false].map((val) => (
                  <TouchableOpacity
                    key={String(val)}
                    onPress={() => update("previousExperience", val)}
                    style={[
                      styles.yesNoBtn,
                      form.previousExperience === val && { borderColor: BALLET_COLOR, backgroundColor: BALLET_COLOR + "15" },
                    ]}
                  >
                    <Ionicons
                      name={val ? "checkmark-circle" : "close-circle"}
                      size={20}
                      color={form.previousExperience === val ? BALLET_COLOR : "#4B5563"}
                    />
                    <Text style={[styles.yesNoBtnText, form.previousExperience === val && { color: BALLET_COLOR }]}>
                      {val ? "Yes" : "No"}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {form.previousExperience && (
              <Field
                label="Describe the experience"
                value={form.experienceDetails}
                onChange={(v) => update("experienceDetails", v)}
                placeholder="School name, years of experience, styles studied..."
                multiline
              />
            )}

            <Field
              label="Additional Notes"
              value={form.notes}
              onChange={(v) => update("notes", v)}
              placeholder="Anything else you'd like us to know..."
              multiline
            />

            <View style={styles.levelsInfo}>
              <Text style={styles.levelsInfoTitle}>Ballet Levels</Text>
              <View style={styles.levelsList}>
                {BALLET_LEVELS.map((level, i) => (
                  <View key={level} style={styles.levelItem}>
                    <View style={[styles.levelDot, { backgroundColor: BALLET_COLOR }]} />
                    <Text style={styles.levelText}>{level}</Text>
                  </View>
                ))}
              </View>
            </View>
          </View>
        )}

        {step === 3 && (
          <View style={styles.stepWrap}>
            <View style={styles.stepHeader}>
              <Text style={styles.stepTitle}>Choose Assessment Slot</Text>
              <Text style={styles.stepDesc}>Select your preferred assessment appointment. Each session is 30 minutes.</Text>
            </View>

            {/* Loading state */}
            {slotsState === "loading" && (
              <View style={styles.slotsPlaceholder}>
                <Ionicons name="time-outline" size={28} color={BALLET_COLOR} />
                <Text style={styles.slotsPlaceholderText}>Loading available slots…</Text>
              </View>
            )}

            {/* Offline state (detected while loading slots) */}
            {slotsState === "offline" && (
              <OfflineState
                variant="compact"
                onRetry={() => loadSlots()}
              />
            )}

            {/* Server/endpoint error — endpoint not ready yet */}
            {slotsState === "error" && (
              <ErrorState
                variant="compact"
                title="Slots Unavailable"
                message="Assessment slot booking is not yet available online. Please contact the studio to schedule your assessment."
                onRetry={() => loadSlots()}
              />
            )}

            {/* Empty — no future slots */}
            {slotsState === "empty" && (
              <View style={styles.slotsPlaceholder}>
                <Ionicons name="calendar-outline" size={28} color="#6B7280" />
                <Text style={[styles.slotsPlaceholderText, { color: "#9CA3AF" }]}>
                  No assessment slots are currently available. Please check back soon or contact the studio.
                </Text>
              </View>
            )}

            {/* Success — render live slots from backend */}
            {slotsState === "success" && slots.map((slot) => {
              const isSelected = form.selectedSlot?.id === slot.id;
              const isFull = slot.status === "full";
              return (
                <TouchableOpacity
                  key={slot.id}
                  onPress={() => {
                    if (!isFull) {
                      Haptics.selectionAsync();
                      update("selectedSlot", slot);
                    }
                  }}
                  disabled={isFull}
                  style={[
                    styles.slotCard,
                    isSelected && { borderColor: BALLET_COLOR, backgroundColor: BALLET_COLOR + "10" },
                    isFull && { opacity: 0.4 },
                  ]}
                  activeOpacity={0.8}
                >
                  <View style={styles.slotLeft}>
                    <Text style={styles.slotDay}>{slot.dayOfWeek}</Text>
                    <Text style={styles.slotDate}>{slot.date}</Text>
                    <Text style={styles.slotTime}>{slot.startTime} – {slot.endTime}</Text>
                  </View>
                  <View style={styles.slotRight}>
                    <View style={[
                      styles.slotStatusBadge,
                      {
                        backgroundColor:
                          slot.status === "available" ? "#22C55E20" :
                          slot.status === "fewSeats" ? "#F59E0B20" : "#EF444420",
                      },
                    ]}>
                      <Text style={[
                        styles.slotStatusText,
                        {
                          color:
                            slot.status === "available" ? "#22C55E" :
                            slot.status === "fewSeats" ? "#F59E0B" : "#EF4444",
                        },
                      ]}>
                        {isFull ? "Full" : slot.status === "fewSeats" ? `${slot.availableSeats} left` : "Available"}
                      </Text>
                    </View>
                    {isSelected && <Ionicons name="checkmark-circle" size={22} color={BALLET_COLOR} />}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {step === 4 && (
          <View style={styles.stepWrap}>
            <View style={styles.stepHeader}>
              <Text style={styles.stepTitle}>Review & Submit</Text>
              <Text style={styles.stepDesc}>Please review your information before submitting.</Text>
            </View>

            {[
              { label: "Parent Name", value: form.parentName },
              { label: "Parent Phone", value: form.parentPhone },
              { label: "Parent Email", value: form.parentEmail },
              { label: "Emergency Contact", value: `${form.emergencyContactName} · ${form.emergencyContactPhone}` },
            ].map((item) => (
              <View key={item.label} style={styles.reviewRow}>
                <Text style={styles.reviewLabel}>{item.label}</Text>
                <Text style={styles.reviewValue}>{item.value || "—"}</Text>
              </View>
            ))}

            <View style={styles.divider} />

            {[
              { label: "Child Name", value: form.childName },
              { label: "Child Age", value: `${form.childAge} years old` },
              { label: "Child Gender", value: form.childGender === "female" ? "Girl" : "Boy" },
              { label: "Date of Birth", value: form.childBirthday || "Not provided" },
              { label: "Experience", value: form.previousExperience ? "Yes" : form.previousExperience === false ? "No" : "—" },
              { label: "Medical Notes", value: form.medicalNotes || "None" },
            ].map((item) => (
              <View key={item.label} style={styles.reviewRow}>
                <Text style={styles.reviewLabel}>{item.label}</Text>
                <Text style={styles.reviewValue}>{item.value}</Text>
              </View>
            ))}

            <View style={styles.divider} />

            <View style={[styles.slotReview, { borderColor: BALLET_COLOR + "40" }]}>
              <Ionicons name="calendar" size={18} color={BALLET_COLOR} />
              <View>
                <Text style={styles.slotReviewLabel}>Assessment Appointment</Text>
                <Text style={[styles.slotReviewValue, { color: BALLET_COLOR }]}>
                  {form.selectedSlot?.dayOfWeek} {form.selectedSlot?.date}
                </Text>
                <Text style={styles.slotReviewTime}>
                  {form.selectedSlot?.startTime} – {form.selectedSlot?.endTime}
                </Text>
              </View>
            </View>

            <View style={styles.pricingBox}>
              <Text style={styles.pricingTitle}>Ballet Pricing (if accepted)</Text>
              {BALLET_PRICING.map((p) => (
                <View key={p.level} style={styles.pricingRow}>
                  <View>
                    <Text style={styles.pricingLevel}>{p.level}</Text>
                    <Text style={styles.pricingHours}>{p.hours}</Text>
                  </View>
                  <Text style={[styles.pricingAmount, { color: BALLET_COLOR }]}>EGP {p.price.toLocaleString()}</Text>
                </View>
              ))}
            </View>
          </View>
        )}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: Platform.OS === "web" ? 24 : (insets.bottom || 16) + 8 }]}>
        {step > 0 && (
          <AppButton title="Back" variant="ghost" onPress={handleBack} style={{ flex: 1 }} />
        )}
        {step < STEPS.length - 1 ? (
          <AppButton title="Continue" onPress={handleNext} style={{ flex: 2 }} />
        ) : (
          <AppButton
            title={submitting ? "Submitting…" : "Submit Application"}
            onPress={handleSubmit}
            disabled={submitting}
            style={{ flex: 2, backgroundColor: BALLET_COLOR, opacity: submitting ? 0.7 : 1 }}
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.studio.background },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#1E1E26",
    alignItems: "center",
    justifyContent: "center",
  },
  topBarCenter: { flex: 1, alignItems: "center" },
  topBarTitle: { fontSize: 16, fontFamily: "Inter_700Bold", color: "#FFFFFF" },
  topBarSub: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
  scroll: { paddingHorizontal: 20 },
  stepWrap: { gap: 14 },
  stepHeader: { gap: 6, marginBottom: 4 },
  stepTitle: { fontSize: 22, fontFamily: "Inter_700Bold", color: "#FFFFFF" },
  stepDesc: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#9CA3AF", lineHeight: 18 },
  field: { gap: 6 },
  fieldLabel: { fontSize: 13, fontFamily: "Inter_500Medium", color: "#9CA3AF" },
  input: {
    backgroundColor: "#1E1E26",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: "#FFFFFF",
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    borderWidth: 1,
    borderColor: "#2A2A35",
  },
  rowFields: { flexDirection: "row", gap: 10 },
  genderRow: { flexDirection: "row", gap: 10 },
  genderBtn: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#2A2A35",
    backgroundColor: "#1E1E26",
  },
  genderBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#6B7280" },
  yesNoRow: { flexDirection: "row", gap: 10 },
  yesNoBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#2A2A35",
    backgroundColor: "#1E1E26",
  },
  yesNoBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#6B7280" },
  subSectionLabel: { fontSize: 13, fontFamily: "Inter_700Bold", color: "#FFFFFF", marginBottom: -4 },
  divider: { height: 1, backgroundColor: "#1E2E38", marginVertical: 4 },
  slotsPlaceholder: {
    alignItems: "center",
    gap: 10,
    paddingVertical: 32,
    paddingHorizontal: 16,
  },
  slotsPlaceholderText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: BALLET_COLOR,
    textAlign: "center",
    lineHeight: 18,
  },
  slotCard: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#1E2E38",
    backgroundColor: colors.studio.card,
  },
  slotLeft: { gap: 3 },
  slotDay: { fontSize: 15, fontFamily: "Inter_700Bold", color: "#FFFFFF" },
  slotDate: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
  slotTime: { fontSize: 12, fontFamily: "Inter_500Medium", color: "#9CA3AF" },
  slotRight: { alignItems: "flex-end", gap: 8 },
  slotStatusBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  slotStatusText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  levelsInfo: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#A78BFA30",
    padding: 14,
    backgroundColor: "#1A0D2D",
    gap: 10,
    marginTop: 4,
  },
  levelsInfoTitle: { fontSize: 13, fontFamily: "Inter_700Bold", color: "#A78BFA" },
  levelsList: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  levelItem: { flexDirection: "row", alignItems: "center", gap: 5, width: "47%" },
  levelDot: { width: 6, height: 6, borderRadius: 3 },
  levelText: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
  reviewRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#1E2E38",
    gap: 16,
  },
  reviewLabel: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#9CA3AF", flex: 1 },
  reviewValue: { fontSize: 13, fontFamily: "Inter_500Medium", color: "#FFFFFF", flex: 2, textAlign: "right" },
  slotReview: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    backgroundColor: "#1A0D2D",
  },
  slotReviewLabel: { fontSize: 11, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
  slotReviewValue: { fontSize: 15, fontFamily: "Inter_700Bold" },
  slotReviewTime: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
  pricingBox: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#1E2E38",
    padding: 14,
    gap: 10,
    backgroundColor: colors.studio.card,
  },
  pricingTitle: { fontSize: 13, fontFamily: "Inter_700Bold", color: "#9CA3AF" },
  pricingRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  pricingLevel: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#FFFFFF" },
  pricingHours: { fontSize: 11, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
  pricingAmount: { fontSize: 16, fontFamily: "Inter_700Bold" },
  footer: {
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 20,
    paddingTop: 12,
    backgroundColor: colors.studio.background,
    borderTopWidth: 1,
    borderTopColor: "#1E2E38",
  },
  successHeader: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 20, paddingBottom: 14,
  },
  successHeaderBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: "#1E1E26", alignItems: "center", justifyContent: "center",
  },
  successHeaderTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: "#FFFFFF" },
  successWrap: { flex: 1, padding: 20 },
  successCard: { borderRadius: 24, padding: 24, gap: 16, alignItems: "center" },
  successIcon: { width: 88, height: 88, borderRadius: 44, alignItems: "center", justifyContent: "center" },
  successTitle: { fontSize: 22, fontFamily: "Inter_700Bold", color: "#FFFFFF", textAlign: "center" },
  successDesc: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#9CA3AF", textAlign: "center", lineHeight: 19 },
  successInfo: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    gap: 10,
    width: "100%",
    backgroundColor: "#0A1014",
  },
  successInfoTitle: { fontSize: 13, fontFamily: "Inter_700Bold", color: "#FFFFFF", marginBottom: 4 },
  successStep: { flexDirection: "row", alignItems: "center", gap: 10 },
  successStepNum: { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  successStepNumText: { fontSize: 12, fontFamily: "Inter_700Bold" },
  successStepText: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#9CA3AF", flex: 1 },
  existingCard: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 24,
    gap: 14,
    alignItems: "center",
    backgroundColor: colors.studio.card,
  },
  statusRow: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, borderWidth: 1, width: "100%", alignItems: "center" },
  statusLabel: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
});
