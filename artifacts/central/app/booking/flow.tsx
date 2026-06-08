import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useGetClass, useGetInstructor, useCreateBooking } from "@workspace/api-client-react";

import { useAppContext, type Booking } from "@/contexts/AppContext";
import { mapApiClassToMobile, mapApiInstructorToMobile } from "@/data/apiAdapters";
import colors from "@/constants/colors";
import StepIndicator from "@/components/StepIndicator";
import AppButton from "@/components/AppButton";

type PaymentMethod = "online" | "cash";

const NEW_MEMBER_OFFER_TITLE = "New Member Welcome";

export default function BookingFlowScreen() {
  const { classId } = useLocalSearchParams<{ classId: string }>();
  const { user, addBooking, children, bookings } = useAppContext();
  const insets = useSafeAreaInsets();

  // ── Fetch class and instructor from the live API ──
  const numericClassId = Number(classId);
  const classQuery = useGetClass(numericClassId, {
    query: { enabled: !!classId && !isNaN(numericClassId) },
  });
  const cls = classQuery.data ? mapApiClassToMobile(classQuery.data) : null;

  const instructorQuery = useGetInstructor(classQuery.data?.instructorId ?? 0, {
    query: { enabled: !!classQuery.data?.instructorId },
  });
  const instructor = instructorQuery.data
    ? mapApiInstructorToMobile(instructorQuery.data)
    : null;

  // ── Create booking mutation ──
  const { mutateAsync: createBookingAsync } = useCreateBooking();

  const isFirstBooking = bookings.length === 0;
  const finalPrice = isFirstBooking ? 0 : (cls?.price ?? 0);

  const [step, setStep] = useState(1);
  const [participantType, setParticipantType] = useState<"self" | "child">("self");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("online");
  const [loading, setLoading] = useState(false);
  const [refCodeInput, setRefCodeInput] = useState("");
  const [appliedCode, setAppliedCode] = useState<string | null>(null);
  const [refCodeState, setRefCodeState] = useState<"idle" | "valid" | "invalid">("idle");

  function handleApplyRefCode() {
    const code = refCodeInput.trim().toUpperCase();
    if (!code) return;
    const valid = /^[A-Z]{2,4}-[A-Z0-9]{4}$/.test(code);
    if (valid) {
      setAppliedCode(code);
      setRefCodeState("valid");
    } else {
      setRefCodeState("invalid");
    }
  }

  // ── Guard: must be signed in ──
  if (!user) {
    return (
      <View style={[styles.container, styles.centered]}>
        <Ionicons name="lock-closed-outline" size={48} color="#6B7280" />
        <Text style={styles.centeredTitle}>Sign in required</Text>
        <Text style={styles.centeredDesc}>Please sign in to book a class</Text>
        <AppButton title="Sign In" onPress={() => router.replace("/auth/login")} />
      </View>
    );
  }

  // ── Loading ──
  if (classQuery.isLoading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color={colors.studio.primary} />
      </View>
    );
  }

  // ── Error / not found ──
  if (classQuery.isError || !cls) {
    return (
      <View style={[styles.container, styles.centered]}>
        <Ionicons name="alert-circle-outline" size={48} color="#6B7280" />
        <Text style={styles.centeredTitle}>Class not found</Text>
        <AppButton title="Go back" onPress={() => router.back()} variant="ghost" />
      </View>
    );
  }

  // ── Confirm booking — POST to API then update local state ──
  async function handleConfirm() {
    if (!cls || !user) return;
    setLoading(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);

    try {
      // 1. Create booking in the database
      const apiBooking = await createBookingAsync({
        studentName:
          participantType === "self"
            ? user.fullName
            : children[0]?.fullName ?? user.fullName,
        studentEmail: user.email,
        studentPhone: user.phone,
        classId: numericClassId,
        status:
          finalPrice === 0 || paymentMethod === "online"
            ? "confirmed"
            : "pendingPayment",
        notes: appliedCode ? `Referral code: ${appliedCode}` : undefined,
      });

      // 2. Mirror booking in local AppContext so the Bookings tab reflects it immediately
      const bookingNumber = "CS" + String(apiBooking.id).padStart(6, "0");
      const localBooking: Booking = {
        id: String(apiBooking.id),
        classId: cls.id,
        className: cls.title,
        danceType: cls.categoryName,
        instructorName: instructor?.name ?? "Instructor",
        date: cls.date,
        time: cls.startTime,
        duration: cls.duration,
        location: cls.location,
        price: finalPrice,
        participantType,
        participantName:
          participantType === "self"
            ? user.fullName
            : children[0]?.fullName ?? "Child",
        paymentMethod: finalPrice === 0 ? "online" : paymentMethod,
        paymentStatus:
          finalPrice === 0 || paymentMethod === "online" ? "paid" : "unpaid",
        bookingStatus:
          finalPrice === 0 || paymentMethod === "online"
            ? "confirmed"
            : "pendingPayment",
        bookingType: "single",
        attendanceStatus: "booked",
        bookingNumber,
        createdAt: apiBooking.createdAt ?? new Date().toISOString(),
      };
      await addBooking(localBooking);

      setLoading(false);
      router.replace({
        pathname: "/booking/confirmation",
        params: { bookingNumber, classId: cls.id },
      });
    } catch (err) {
      setLoading(false);
      Alert.alert(
        "Booking Failed",
        "We couldn't complete your booking. Please check your connection and try again.",
        [{ text: "OK" }],
      );
    }
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: (Platform.OS === "web" ? 67 : insets.top) + 12 }]}>
        <TouchableOpacity
          onPress={() => {
            if (step > 1) setStep(step - 1);
            else router.back();
          }}
          style={styles.backBtn}
        >
          <Ionicons name="arrow-back" size={20} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Book Class</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.stepIndicatorWrap}>
        <StepIndicator current={step} total={3} labels={["Participant", "Details", "Payment"]} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingBottom: 100 }]}
      >
        {/* ── Step 1: Participant ── */}
        {step === 1 && (
          <View style={styles.stepContent}>
            <Text style={styles.stepTitle}>Who are you booking for?</Text>

            <TouchableOpacity
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setParticipantType("self"); }}
              style={[
                styles.participantCard,
                participantType === "self" && { borderColor: colors.studio.primary, backgroundColor: colors.studio.primary + "15" },
              ]}
            >
              <View style={[styles.participantIcon, { backgroundColor: "#1E1E26" }]}>
                <Ionicons name="person" size={24} color={participantType === "self" ? colors.studio.primary : "#6B7280"} />
              </View>
              <View style={styles.participantText}>
                <Text style={[styles.participantLabel, { color: participantType === "self" ? "#FFFFFF" : "#9CA3AF" }]}>
                  Myself
                </Text>
                <Text style={styles.participantSub}>{user.fullName}</Text>
              </View>
              {participantType === "self" && (
                <View style={[styles.checkCircle, { backgroundColor: colors.studio.primary }]}>
                  <Ionicons name="checkmark" size={14} color="#000" />
                </View>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setParticipantType("child"); }}
              style={[
                styles.participantCard,
                participantType === "child" && { borderColor: colors.studio.primary, backgroundColor: colors.studio.primary + "15" },
              ]}
            >
              <View style={[styles.participantIcon, { backgroundColor: "#1E1E26" }]}>
                <Ionicons name="people" size={24} color={participantType === "child" ? colors.studio.primary : "#6B7280"} />
              </View>
              <View style={styles.participantText}>
                <Text style={[styles.participantLabel, { color: participantType === "child" ? "#FFFFFF" : "#9CA3AF" }]}>
                  My Child
                </Text>
                <Text style={styles.participantSub}>
                  {children.length > 0 ? children[0].fullName : "Add child profile"}
                </Text>
              </View>
              {participantType === "child" && (
                <View style={[styles.checkCircle, { backgroundColor: colors.studio.primary }]}>
                  <Ionicons name="checkmark" size={14} color="#000" />
                </View>
              )}
            </TouchableOpacity>

            <View style={[styles.refCodeSection, { borderColor: "#1E2E38", backgroundColor: "#0E1619" }]}>
              <Text style={styles.refCodeLabel}>
                <Ionicons name="gift-outline" size={13} color={colors.studio.primary} /> Have a referral code?
              </Text>
              {refCodeState === "valid" ? (
                <View style={[styles.refCodeSuccess, { backgroundColor: "#22C55E15", borderColor: "#22C55E40" }]}>
                  <Ionicons name="checkmark-circle" size={18} color="#22C55E" />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.refCodeSuccessTitle, { color: "#22C55E" }]}>Referral Applied!</Text>
                    <Text style={styles.refCodeSuccessDesc}>
                      Code {appliedCode ?? refCodeInput.toUpperCase()} — your referrer earns EGP 100 credit.
                    </Text>
                  </View>
                </View>
              ) : (
                <View style={styles.refCodeRow}>
                  <TextInput
                    value={refCodeInput}
                    onChangeText={(t) => { setRefCodeInput(t.toUpperCase()); setRefCodeState("idle"); }}
                    placeholder="e.g. SARA-XK7F"
                    placeholderTextColor="#6B7280"
                    autoCapitalize="characters"
                    style={[
                      styles.refCodeInput,
                      { borderColor: refCodeState === "invalid" ? "#EF4444" : "#1E2E38", color: "#FFFFFF", backgroundColor: "#14141A" },
                    ]}
                  />
                  <TouchableOpacity
                    onPress={handleApplyRefCode}
                    disabled={!refCodeInput.trim()}
                    style={[styles.refCodeBtn, { backgroundColor: refCodeInput.trim() ? colors.studio.primary : "#1E2E38" }]}
                  >
                    <Text style={[styles.refCodeBtnText, { color: refCodeInput.trim() ? "#000" : "#6B7280" }]}>Apply</Text>
                  </TouchableOpacity>
                </View>
              )}
              {refCodeState === "invalid" && (
                <Text style={styles.refCodeError}>Invalid code. Check the format (e.g. SARA-XK7F) and try again.</Text>
              )}
            </View>
          </View>
        )}

        {/* ── Step 2: Details ── */}
        {step === 2 && (
          <View style={styles.stepContent}>
            <Text style={styles.stepTitle}>Confirm Booking Details</Text>

            <View style={[styles.summaryCard, { backgroundColor: "#14141A", borderColor: "#2A2A35" }]}>
              {[
                { label: "Class", value: cls.title },
                { label: "Day & Time", value: cls.dayOfWeek && cls.startTime ? `${cls.dayOfWeek} · ${cls.startTime}` : "Schedule TBC" },
                { label: "Duration", value: cls.duration },
                { label: "Location", value: cls.location },
                { label: "Participant", value: participantType === "self" ? user.fullName : "Child" },
              ].map((row, i, arr) => (
                <React.Fragment key={row.label}>
                  <View style={styles.summaryRow}>
                    <Text style={styles.summaryLabel}>{row.label}</Text>
                    <Text style={styles.summaryValue}>{row.value}</Text>
                  </View>
                  {i < arr.length - 1 && <View style={[styles.divider, { backgroundColor: "#2A2A35" }]} />}
                </React.Fragment>
              ))}

              {isFirstBooking && (
                <>
                  <View style={[styles.divider, { backgroundColor: "#2A2A35" }]} />
                  <View style={[styles.summaryRow, { backgroundColor: "#00B6D715" }]}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Ionicons name="pricetag" size={13} color={colors.studio.primary} />
                      <Text style={[styles.summaryLabel, { color: colors.studio.primary }]}>
                        {NEW_MEMBER_OFFER_TITLE}
                      </Text>
                    </View>
                    <Text style={[styles.summaryValue, { color: colors.studio.primary }]}>-100%</Text>
                  </View>
                </>
              )}

              <View style={[styles.divider, { backgroundColor: "#2A2A35" }]} />
              <View style={styles.summaryRow}>
                <Text style={[styles.summaryLabel, { color: colors.studio.primary }]}>Total Price</Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  {isFirstBooking && cls.price > 0 && (
                    <Text style={{ fontSize: 13, fontFamily: "Inter_400Regular", color: "#6B7280", textDecorationLine: "line-through" }}>
                      EGP {cls.price}
                    </Text>
                  )}
                  <Text style={[styles.summaryValue, { color: colors.studio.primary, fontSize: 18, fontFamily: "Inter_700Bold" }]}>
                    {isFirstBooking ? "FREE" : `EGP ${cls.price}`}
                  </Text>
                </View>
              </View>
            </View>
          </View>
        )}

        {/* ── Step 3: Payment ── */}
        {step === 3 && (
          <View style={styles.stepContent}>
            <Text style={styles.stepTitle}>
              {isFirstBooking ? "Confirm Free Class" : "Choose Payment Method"}
            </Text>

            {isFirstBooking ? (
              <LinearGradient
                colors={["#003A47", "#001E28"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={[styles.freeCard, { borderColor: colors.studio.primary + "50" }]}
              >
                <View style={[styles.freeIconCircle, { backgroundColor: colors.studio.primary + "20" }]}>
                  <Ionicons name="gift-outline" size={32} color={colors.studio.primary} />
                </View>
                <Text style={[styles.freeTitle, { color: colors.studio.primary }]}>
                  Your First Class Is FREE 🎉
                </Text>
                <Text style={styles.freeDesc}>
                  The <Text style={{ color: "#FFFFFF" }}>New Member Welcome</Text> offer has been automatically applied. No payment needed — just show up and dance!
                </Text>
              </LinearGradient>
            ) : (
              <>
                <TouchableOpacity
                  onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setPaymentMethod("online"); }}
                  style={[
                    styles.paymentCard,
                    paymentMethod === "online" && { borderColor: colors.studio.primary, backgroundColor: colors.studio.primary + "10" },
                  ]}
                  activeOpacity={0.8}
                >
                  <LinearGradient
                    colors={paymentMethod === "online" ? [colors.studio.primary + "20", colors.studio.primary + "05"] : ["#1A1A22", "#14141A"]}
                    style={styles.paymentGradient}
                  >
                    <View style={styles.paymentTop}>
                      <View style={[styles.paymentIconCircle, { backgroundColor: colors.studio.primary + "20" }]}>
                        <Ionicons name="card-outline" size={24} color={colors.studio.primary} />
                      </View>
                      <View style={[styles.recommendedBadge, { backgroundColor: colors.studio.primary }]}>
                        <Text style={styles.recommendedText}>RECOMMENDED</Text>
                      </View>
                    </View>
                    <Text style={styles.paymentTitle}>Pay Now</Text>
                    <Text style={styles.paymentDesc}>Secure your seat immediately. Pay online with card.</Text>
                    <Text style={[styles.paymentAmount, { color: colors.studio.primary }]}>EGP {cls.price}</Text>
                  </LinearGradient>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setPaymentMethod("cash"); }}
                  style={[
                    styles.paymentCard,
                    paymentMethod === "cash" && { borderColor: "#6B7280", backgroundColor: "#1E1E26" },
                  ]}
                  activeOpacity={0.8}
                >
                  <LinearGradient
                    colors={["#14141A", "#0F0F14"]}
                    style={styles.paymentGradient}
                  >
                    <View style={[styles.paymentIconCircle, { backgroundColor: "#2A2A35" }]}>
                      <Ionicons name="business-outline" size={24} color="#9CA3AF" />
                    </View>
                    <Text style={[styles.paymentTitle, { color: "#9CA3AF" }]}>Pay at Studio</Text>
                    <Text style={styles.paymentDesc}>Pay in cash when you arrive at the studio.</Text>
                  </LinearGradient>
                </TouchableOpacity>

                {paymentMethod === "cash" && (
                  <View style={[styles.warningBanner, { backgroundColor: colors.warning + "15", borderColor: colors.warning + "40" }]}>
                    <Ionicons name="warning-outline" size={16} color={colors.warning} />
                    <Text style={[styles.warningText, { color: colors.warning }]}>
                      Your seat is not guaranteed until payment is completed at the studio.
                    </Text>
                  </View>
                )}
              </>
            )}
          </View>
        )}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: (Platform.OS === "web" ? 34 : insets.bottom) + 12 }]}>
        {step < 3 ? (
          <AppButton
            title="Continue"
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setStep(step + 1); }}
            fullWidth
            size="lg"
          />
        ) : (
          <AppButton
            title={paymentMethod === "online" ? "Pay & Confirm Booking" : "Confirm Booking"}
            onPress={handleConfirm}
            loading={loading}
            fullWidth
            size="lg"
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0B0B0F" },
  centered: { justifyContent: "center", alignItems: "center", gap: 12, padding: 24 },
  centeredTitle: { fontSize: 20, fontFamily: "Inter_600SemiBold", color: "#FFFFFF" },
  centeredDesc: { fontSize: 14, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 20, paddingBottom: 8,
  },
  backBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: "#1E1E26", alignItems: "center", justifyContent: "center",
  },
  headerTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: "#FFFFFF" },
  stepIndicatorWrap: { paddingHorizontal: 20, paddingBottom: 12 },
  scroll: { paddingHorizontal: 20 },
  stepContent: { gap: 14 },
  stepTitle: { fontSize: 22, fontFamily: "Inter_700Bold", color: "#FFFFFF", marginBottom: 4 },
  participantCard: {
    flexDirection: "row", alignItems: "center", gap: 14,
    padding: 16, borderRadius: 14, borderWidth: 1.5, borderColor: "#2A2A35", backgroundColor: "#14141A",
  },
  participantIcon: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" },
  participantText: { flex: 1 },
  participantLabel: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  participantSub: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#6B7280", marginTop: 2 },
  checkCircle: { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  summaryCard: { borderRadius: 14, borderWidth: 1, overflow: "hidden" },
  summaryRow: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingHorizontal: 16, paddingVertical: 13,
  },
  summaryLabel: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
  summaryValue: { fontSize: 13, fontFamily: "Inter_500Medium", color: "#FFFFFF", textAlign: "right", flex: 1, paddingLeft: 12 },
  divider: { height: 1 },
  paymentCard: { borderRadius: 16, borderWidth: 1.5, borderColor: "#2A2A35", overflow: "hidden" },
  paymentGradient: { padding: 18, gap: 8 },
  paymentTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  paymentIconCircle: { width: 48, height: 48, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  recommendedBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  recommendedText: { fontSize: 9, fontFamily: "Inter_700Bold", color: "#000", letterSpacing: 0.8 },
  paymentTitle: { fontSize: 18, fontFamily: "Inter_700Bold", color: "#FFFFFF" },
  paymentDesc: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#9CA3AF", lineHeight: 18 },
  paymentAmount: { fontSize: 22, fontFamily: "Inter_700Bold" },
  warningBanner: { flexDirection: "row", gap: 10, padding: 14, borderRadius: 12, borderWidth: 1, alignItems: "flex-start" },
  warningText: { fontSize: 13, fontFamily: "Inter_500Medium", flex: 1, lineHeight: 18 },
  refCodeSection: { borderRadius: 14, borderWidth: 1, padding: 14, gap: 10 },
  refCodeLabel: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#FFFFFF" },
  refCodeRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  refCodeInput: {
    flex: 1, height: 44, borderRadius: 10, borderWidth: 1,
    paddingHorizontal: 12, fontFamily: "Inter_600SemiBold", fontSize: 14, letterSpacing: 1,
  },
  refCodeBtn: { height: 44, paddingHorizontal: 16, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  refCodeBtnText: { fontSize: 13, fontFamily: "Inter_700Bold" },
  refCodeSuccess: { flexDirection: "row", alignItems: "flex-start", gap: 10, padding: 12, borderRadius: 10, borderWidth: 1 },
  refCodeSuccessTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  refCodeSuccessDesc: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#9CA3AF", marginTop: 2, lineHeight: 16 },
  refCodeError: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#EF4444", lineHeight: 16 },
  freeCard: { borderRadius: 18, borderWidth: 1, padding: 22, alignItems: "center", gap: 14 },
  freeIconCircle: { width: 68, height: 68, borderRadius: 34, alignItems: "center", justifyContent: "center" },
  freeTitle: { fontSize: 20, fontFamily: "Inter_700Bold", textAlign: "center" },
  freeDesc: { fontSize: 14, fontFamily: "Inter_400Regular", color: "#9CA3AF", textAlign: "center", lineHeight: 20 },
  footer: {
    paddingHorizontal: 20, paddingTop: 12,
    borderTopWidth: 1, borderTopColor: "#2A2A35", backgroundColor: "#0B0B0F",
  },
});
