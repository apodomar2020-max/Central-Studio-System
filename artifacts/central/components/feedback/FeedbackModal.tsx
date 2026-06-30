import Ionicons from "@expo/vector-icons/Ionicons";
import * as Haptics from "expo-haptics";
import { normalizeMediaUrl } from "@workspace/api-client-react";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import colors from "@/constants/colors";
import type { RequiredFeedbackItem } from "@/services/feedbackService";
import { formatApiDate, formatApiTime } from "@/utils/dateTime";

const RATING_LABELS: Record<number, string> = {
  0: "Tap a star to rate",
  1: "Very poor",
  2: "Poor",
  3: "Okay",
  4: "Great",
  5: "Excellent",
};

const TAGS = ["Late start", "Crowded", "Sound", "Cleanliness", "Trainer", "Other"];

type SubmitOutcome = "submitted" | "queued";

interface FeedbackModalProps {
  visible: boolean;
  item: RequiredFeedbackItem;
  queueIndex: number;
  queueTotal: number;
  onSubmit: (input: { rating: number; comment: string; tags: string[] }) => Promise<SubmitOutcome>;
  onComplete: () => void;
}

export default function FeedbackModal({
  visible,
  item,
  queueIndex,
  queueTotal,
  onSubmit,
  onComplete,
}: FeedbackModalProps) {
  const [stage, setStage] = useState<"rating" | "comment" | "submitting" | "success" | "offline" | "error">("rating");
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setStage("rating");
    setRating(0);
    setComment("");
    setTags([]);
    setError(null);
  }, [item?.attendanceId]);

  const commentRequired = rating > 0 && rating <= 2;
  const canSubmit = rating > 0 && (!commentRequired || comment.trim().length > 0);
  const hasMore = queueIndex < queueTotal;
  const instructorImage = useMemo(() => normalizeMediaUrl(item.instructorPhotoUrl, "image"), [item.instructorPhotoUrl]);

  function selectRating(next: number) {
    Haptics.selectionAsync();
    setRating(next);
  }

  function toggleTag(tag: string) {
    setTags((prev) => prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]);
  }

  async function submit() {
    if (!canSubmit) return;
    setStage("submitting");
    setError(null);
    try {
      const result = await onSubmit({ rating, comment: comment.trim(), tags });
      setStage(result === "queued" ? "offline" : "success");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't submit feedback.");
      setStage("error");
    }
  }

  function resetForBack() {
    setStage("rating");
    setError(null);
  }

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={() => {}}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.overlay}>
        <View style={styles.backdrop} />
        <View style={[styles.sheet, (stage === "success" || stage === "offline" || stage === "error") && styles.shortSheet]}>
          <View style={styles.grabber} />

          {stage === "rating" && (
            <View style={styles.fill}>
              <View style={styles.content}>
                <View style={styles.topRow}>
                  <PrivacyChip />
                  {queueTotal > 1 && <Text style={styles.queueChip}>{queueIndex} of {queueTotal} to review</Text>}
                </View>

                <Text style={styles.heroTitle}>How was{"\n"}your class?</Text>
                <Text style={styles.subtitle}>Help us keep every session world-class.</Text>
                <ClassCard item={item} instructorImage={instructorImage} />

                <View style={styles.starBlock}>
                  <StarRow value={rating} onChange={selectRating} />
                  <Text style={[styles.ratingLabel, rating === 0 ? styles.mutedLabel : rating <= 2 ? styles.warningLabel : styles.cyanLabel]}>
                    {RATING_LABELS[rating]}
                  </Text>
                </View>

                <Reassurance />
              </View>
              <FooterButton title="Continue" disabled={rating === 0} onPress={() => setStage("comment")} />
            </View>
          )}

          {stage === "comment" && (
            <View style={styles.fill}>
              <View style={styles.content}>
                <TouchableOpacity onPress={resetForBack} style={styles.backButton}>
                  <Ionicons name="arrow-back" size={18} color={colors.cyan} />
                  <Text style={styles.backText}>Back</Text>
                </TouchableOpacity>

                <View style={styles.recap}>
                  <MiniStars rating={rating} />
                  <Text style={[styles.recapLabel, rating <= 2 ? styles.warningLabel : styles.cyanLabel]}>{RATING_LABELS[rating]}</Text>
                </View>

                <Text style={styles.commentTitle}>
                  {commentRequired ? "What went\nwrong?" : "Glad you\nloved it!"}
                </Text>
                <Text style={styles.commentSubtitle}>
                  {commentRequired
                    ? "Tell us what happened so our Quality Team can review it."
                    : "Anything you loved or want us to know? (optional)"}
                </Text>

                {commentRequired && (
                  <View style={styles.tags}>
                    {TAGS.map((tag) => {
                      const active = tags.includes(tag);
                      return (
                        <TouchableOpacity key={tag} onPress={() => toggleTag(tag)} style={[styles.tag, active && styles.tagActive]}>
                          <Text style={[styles.tagText, active && styles.tagTextActive]}>{tag}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                )}

                <TextInput
                  value={comment}
                  onChangeText={setComment}
                  placeholder={commentRequired ? "Tell us more so we can make it right..." : "Share what made this class great..."}
                  placeholderTextColor={colors.ink[500]}
                  multiline
                  textAlignVertical="top"
                  style={[styles.textarea, commentRequired && styles.requiredTextarea]}
                />
                {commentRequired && comment.trim().length === 0 && (
                  <Text style={styles.requiredHint}>A short comment is required for 1-2 star ratings.</Text>
                )}
                <Reassurance />
              </View>
              <FooterButton title="Submit Feedback" disabled={!canSubmit} onPress={submit} />
            </View>
          )}

          {stage === "submitting" && (
            <CenteredState
              icon={<ActivityIndicator size="large" color={colors.cyan} />}
              title="Sending"
              body="Sending your feedback to the Quality Team..."
            />
          )}

          {stage === "success" && (
            <CenteredState
              icon={<SuccessMark />}
              title="Thank you"
              body="Your feedback went straight to our Quality Team. It helps us keep every class world-class."
              buttonTitle={hasMore ? "Rate next" : "Done"}
              onPress={onComplete}
            />
          )}

          {stage === "offline" && (
            <CenteredState
              icon={<OfflineMark />}
              title="Saved offline"
              body="We saved your rating and will retry automatically when you're back online."
              buttonTitle={hasMore ? "Continue" : "Done"}
              onPress={onComplete}
            />
          )}

          {stage === "error" && (
            <CenteredState
              icon={<OfflineMark />}
              title="Couldn't send"
              body={error ?? "Please try again."}
              buttonTitle="Retry Now"
              onPress={submit}
              scrollBody
            />
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function PrivacyChip() {
  return (
    <View style={styles.privacyChip}>
      <Ionicons name="lock-closed" size={12} color={colors.cyan} />
      <Text style={styles.privacyText}>Private · Quality Team Only</Text>
    </View>
  );
}

function ClassCard({ item, instructorImage }: { item: RequiredFeedbackItem; instructorImage?: string }) {
  const attended = item.scheduleLabel ?? [formatApiDate(item.checkedInAt), formatApiTime(item.checkedInAt)].filter(Boolean).join(" • ");
  return (
    <View style={styles.classCard}>
      <Text style={styles.classTitle} numberOfLines={2}>{item.classTitle}</Text>
      <View style={styles.classMeta}>
        {instructorImage ? (
          <Image source={{ uri: instructorImage }} style={styles.avatar} />
        ) : (
          <View style={styles.avatarFallback}><Text style={styles.avatarInitial}>{item.instructorName.slice(0, 1)}</Text></View>
        )}
        <View style={styles.classText}>
          <Text style={styles.instructor} numberOfLines={1}>{item.instructorName}</Text>
          <Text style={styles.styleText} numberOfLines={1}>{item.danceTypeName ?? "Class"} · Trainer</Text>
        </View>
        <View style={styles.datePill}>
          <Ionicons name="calendar-outline" size={13} color={colors.ink[500]} />
          <Text style={styles.dateText} numberOfLines={1}>{attended}</Text>
        </View>
      </View>
    </View>
  );
}

function StarRow({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  return (
    <View style={styles.stars}>
      {[1, 2, 3, 4, 5].map((n) => {
        const active = n <= value;
        return (
          <Pressable key={n} onPress={() => onChange(n)} hitSlop={8} style={styles.starButton}>
            <Ionicons name={active ? "star" : "star-outline"} size={42} color={active ? colors.cyan : "rgba(255,255,255,0.22)"} />
          </Pressable>
        );
      })}
    </View>
  );
}

function MiniStars({ rating }: { rating: number }) {
  return (
    <View style={styles.miniStars}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Ionicons key={n} name={n <= rating ? "star" : "star-outline"} size={18} color={n <= rating ? colors.cyan : "rgba(255,255,255,0.18)"} />
      ))}
    </View>
  );
}

function Reassurance() {
  return (
    <View style={styles.reassurance}>
      <Ionicons name="shield-checkmark-outline" size={16} color={colors.ink[400]} />
      <Text style={styles.reassuranceText}>
        Your feedback is private and reviewed only by the Central Studio Quality Team. It's never posted publicly or shown on a trainer's profile.
      </Text>
    </View>
  );
}

function FooterButton({ title, disabled, onPress }: { title: string; disabled?: boolean; onPress: () => void }) {
  return (
    <View style={styles.footer}>
      <TouchableOpacity disabled={disabled} onPress={onPress} style={[styles.primaryButton, disabled && styles.buttonDisabled]}>
        <Text style={[styles.primaryButtonText, disabled && styles.buttonDisabledText]}>{title}</Text>
      </TouchableOpacity>
    </View>
  );
}

function CenteredState({
  icon,
  title,
  body,
  buttonTitle,
  onPress,
  scrollBody,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  buttonTitle?: string;
  onPress?: () => void;
  scrollBody?: boolean;
}) {
  return (
    <View style={styles.centered}>
      {icon}
      <Text style={styles.stateTitle}>{title}</Text>
      {scrollBody ? (
        <ScrollView style={styles.stateBodyScroll} contentContainerStyle={styles.stateBodyScrollContent}>
          <Text style={styles.stateBody}>{body}</Text>
        </ScrollView>
      ) : (
        <Text style={styles.stateBody}>{body}</Text>
      )}
      {buttonTitle && onPress && (
        <TouchableOpacity onPress={onPress} style={styles.stateButton}>
          <Text style={styles.primaryButtonText}>{buttonTitle}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

function SuccessMark() {
  return (
    <View style={styles.successCircle}>
      <Ionicons name="checkmark" size={44} color={colors.ink[900]} />
    </View>
  );
}

function OfflineMark() {
  return (
    <View style={styles.offlineCircle}>
      <Ionicons name="cloud-offline-outline" size={36} color={colors.amber} />
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end" },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(4,5,7,0.68)" },
  sheet: {
    minHeight: "88%",
    maxHeight: "92%",
    backgroundColor: colors.ink[900],
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    borderTopWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    overflow: "hidden",
  },
  shortSheet: { minHeight: "70%" },
  grabber: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 3,
    backgroundColor: "rgba(255,255,255,0.20)",
    marginTop: 10,
  },
  fill: { flex: 1 },
  content: { flex: 1, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8 },
  topRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 16 },
  privacyChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 5,
    paddingHorizontal: 11,
    borderRadius: 999,
    backgroundColor: "rgba(0,182,215,0.10)",
    borderWidth: 1,
    borderColor: "rgba(0,182,215,0.30)",
  },
  privacyText: { fontFamily: "SpaceMono_700Bold", fontSize: 10, textTransform: "uppercase", color: colors.cyan },
  queueChip: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 999,
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    fontFamily: "Inter_700Bold",
    fontSize: 11,
    color: colors.ink[300],
  },
  heroTitle: { fontFamily: "Anton_400Regular", fontSize: 34, lineHeight: 34, textTransform: "uppercase", color: "#fff", marginBottom: 6 },
  subtitle: { fontFamily: "Inter_400Regular", fontSize: 13, color: colors.ink[400], marginBottom: 18 },
  classCard: { padding: 15, borderRadius: 16, backgroundColor: colors.ink[800], borderWidth: 1, borderColor: "rgba(255,255,255,0.08)" },
  classTitle: { fontFamily: "Anton_400Regular", fontSize: 26, lineHeight: 27, textTransform: "uppercase", color: "#fff" },
  classMeta: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 12 },
  avatar: { width: 34, height: 34, borderRadius: 17 },
  avatarFallback: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: colors.ink[700] },
  avatarInitial: { fontFamily: "Inter_700Bold", color: "#fff" },
  classText: { flex: 1, minWidth: 0 },
  instructor: { fontFamily: "Inter_700Bold", fontSize: 13.5, color: "#fff" },
  styleText: { fontFamily: "Inter_400Regular", fontSize: 11.5, color: colors.ink[400], marginTop: 2 },
  datePill: { maxWidth: 122, flexDirection: "row", alignItems: "center", gap: 6 },
  dateText: { flex: 1, fontFamily: "Inter_600SemiBold", fontSize: 12, color: colors.ink[300] },
  starBlock: { paddingTop: 30, paddingBottom: 4 },
  stars: { flexDirection: "row", justifyContent: "center", gap: 10 },
  starButton: { padding: 2 },
  ratingLabel: { minHeight: 22, textAlign: "center", marginTop: 16, fontFamily: "Archivo_800ExtraBold", fontSize: 17 },
  mutedLabel: { color: colors.ink[500] },
  warningLabel: { color: colors.amber },
  cyanLabel: { color: colors.cyan },
  reassurance: { flexDirection: "row", gap: 9, padding: 12, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.035)", borderWidth: 1, borderColor: "rgba(255,255,255,0.07)", marginTop: 14 },
  reassuranceText: { flex: 1, fontFamily: "Inter_400Regular", fontSize: 12, lineHeight: 18, color: colors.ink[400] },
  footer: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 22, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.06)" },
  primaryButton: { width: "100%", padding: 15, borderRadius: 12, alignItems: "center", backgroundColor: colors.cyan },
  primaryButtonText: { fontFamily: "Archivo_800ExtraBold", fontSize: 15, color: colors.ink[900] },
  buttonDisabled: { backgroundColor: "rgba(255,255,255,0.06)" },
  buttonDisabledText: { color: colors.ink[500] },
  backButton: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 14 },
  backText: { fontFamily: "Archivo_600SemiBold", fontSize: 13.5, color: colors.cyan },
  recap: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 18 },
  miniStars: { flexDirection: "row", gap: 3 },
  recapLabel: { fontFamily: "Archivo_800ExtraBold", fontSize: 14 },
  commentTitle: { fontFamily: "Anton_400Regular", fontSize: 28, lineHeight: 29, textTransform: "uppercase", color: "#fff", marginBottom: 8 },
  commentSubtitle: { fontFamily: "Inter_400Regular", fontSize: 13, color: colors.ink[300], marginBottom: 16 },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 16 },
  tag: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: "rgba(255,255,255,0.12)", backgroundColor: "rgba(255,255,255,0.04)" },
  tagActive: { backgroundColor: "rgba(255,176,46,0.16)", borderColor: colors.amber },
  tagText: { fontFamily: "Archivo_700Bold", fontSize: 12.5, color: colors.ink[300] },
  tagTextActive: { color: colors.amber },
  textarea: {
    width: "100%",
    minHeight: 124,
    padding: 14,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.12)",
    color: "#fff",
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    lineHeight: 20,
  },
  requiredTextarea: { minHeight: 110, backgroundColor: "rgba(255,176,46,0.06)", borderColor: "rgba(255,176,46,0.40)" },
  requiredHint: { marginTop: 8, fontFamily: "Inter_500Medium", fontSize: 12, color: colors.amber },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 28, paddingVertical: 30 },
  stateTitle: { marginTop: 24, fontFamily: "Anton_400Regular", fontSize: 46, lineHeight: 48, textTransform: "uppercase", color: "#fff", textAlign: "center" },
  stateBody: { marginTop: 12, maxWidth: 280, fontFamily: "Inter_400Regular", fontSize: 14.5, lineHeight: 22, color: colors.ink[300], textAlign: "center" },
  stateBodyScroll: { maxHeight: 220, width: "100%", marginTop: 12 },
  stateBodyScrollContent: { alignItems: "center", paddingBottom: 4 },
  stateButton: { marginTop: 30, width: "100%", padding: 15, borderRadius: 12, alignItems: "center", backgroundColor: colors.cyan },
  successCircle: { width: 84, height: 84, borderRadius: 42, alignItems: "center", justifyContent: "center", backgroundColor: colors.cyan },
  offlineCircle: { width: 78, height: 78, borderRadius: 39, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,176,46,0.12)", borderWidth: 2, borderColor: colors.amber },
});
