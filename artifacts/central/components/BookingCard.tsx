import React from "react";
import { Image, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";

import { Booking } from "@/contexts/AppContext";
import SBI from "@/components/SbIcon";
import { isBookingSelfCancellableClientSide } from "@/utils/bookingCancellationEligibility";

interface BookingCardProps {
  item: Booking;
  onPress?: () => void;
  onCancel?: () => void;
  onPayNow?: () => void;
  pkgInfo?: { name: string; credits: number; total: number };
}

const TYPE_CFG: Record<string, { label: string; color: string; rgb: string }> = {
  class: { label: "Class", color: "#00B6D7", rgb: "45,205,236" },
  assessment: { label: "Assessment", color: "#00B6D7", rgb: "167,139,250" },
  private: { label: "Private", color: "#FFB81C", rgb: "255,184,28" },
  workshop: { label: "Workshop", color: "#FFB02E", rgb: "255,176,46" },
  package: { label: "Package", color: "#00B6D7", rgb: "45,205,236" },
  masterclass: { label: "Masterclass", color: "#FF2E7E", rgb: "255,46,126" },
};

export function bookingStatusConfig(status: Booking["bookingStatus"]) {
  switch (status) {
    case "pending":   return { label: "Pending",   c: "#FFB02E", bg: "rgba(255,176,46,0.16)" };
    case "confirmed": return { label: "Confirmed", c: "#1FB871", bg: "rgba(31,184,113,0.16)" };
    case "rejected":  return { label: "Rejected",  c: "#FF3B47", bg: "rgba(192,57,43,0.14)" };
    case "cancelled": return { label: "Cancelled", c: "#FF3B47", bg: "rgba(255,59,71,0.12)" };
    case "attended":  return { label: "Attended",  c: "#00B6D7", bg: "rgba(0,182,215,0.14)" };
    case "completed": return { label: "Completed", c: "#00B6D7", bg: "rgba(0,182,215,0.14)" };
    case "noShow":    return { label: "No Show",   c: "#6B747F", bg: "rgba(255,255,255,0.06)" };
    // F-08: neutral by design — no business meaning (attended, cancelled,
    // refunded, etc.) is inferred for a status the client doesn't
    // recognize. Same neutral grey the default branch below already used
    // for this exact purpose, just with a readable label.
    case "unknown":   return { label: "Unknown",   c: "#6B747F", bg: "rgba(255,255,255,0.06)" };
    default:          return { label: status,      c: "#6B747F", bg: "rgba(255,255,255,0.06)" };
  }
}

export function paymentStatusConfig(status: Booking["paymentStatus"]) {
  switch (status) {
    case "not_required":    return { label: "Package Credit", c: "#00B6D7", ic: "P" };
    case "pending_payment": return { label: "Pending Payment", c: "#FFB02E", ic: "!" };
    case "paid":            return { label: "Paid",           c: "#1FB871", ic: "✓" };
    case "refunded":        return { label: "Refunded",       c: "#00B6D7", ic: "↩" };
    case "failed":          return { label: "Failed",         c: "#FF3B47", ic: "X" };
    default:                return { label: status,           c: "#8E97A2", ic: "$" };
  }
}

function PackageMeter({ pkg }: { pkg: { name: string; credits: number; total: number } }) {
  const pct = Math.round((pkg.credits / pkg.total) * 100);
  return (
    <View style={styles.pkgMeterCont}>
      <View style={styles.pkgRow}>
        <Text style={styles.pkgName}>{pkg.name}</Text>
        <Text style={styles.pkgCredits}>{pkg.credits} credits left</Text>
      </View>
      <View style={styles.pkgBarBg}>
        <LinearGradient
          colors={["#00B6D7", "#00B6D7"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={[styles.pkgBarFill, { width: `${pct}%` }]}
        />
      </View>
    </View>
  );
}

function ActionBtn({ label, icon, primary, danger, disabled, onPress }: any) {
  const bg = disabled ? "rgba(255,255,255,0.04)" : primary ? "#00B6D7" : danger ? "rgba(255,59,71,0.12)" : "rgba(255,255,255,0.07)";
  const color = disabled ? "#6B747F" : primary ? "#0A0B0D" : danger ? "#FF3B47" : "#B6BDC6";

  return (
    <TouchableOpacity
      activeOpacity={disabled ? 1 : 0.8}
      onPress={disabled ? undefined : onPress}
      style={[styles.actionBtn, { backgroundColor: bg }]}
    >
      {icon && <SBI name={icon} size={14} stroke={2.4} color={color} />}
      <Text style={[styles.actionBtnText, { color }]}>{label}</Text>
    </TouchableOpacity>
  );
}

export default function BookingCard({ item, onPress, onCancel, onPayNow, pkgInfo }: BookingCardProps) {
  // F-08: an unrecognized backend status (surfaced here as "unknown", e.g.
  // attendance_reversed) is treated as non-actionable/past — never as an
  // active upcoming booking — so it can never render a live Cancel button
  // or be counted as Confirmed/Upcoming. See utils/bookingStatus.ts.
  const isPast = item.bookingStatus === "attended" || item.bookingStatus === "completed" || item.bookingStatus === "noShow" || item.bookingStatus === "unknown";
  const isCanceled = item.bookingStatus === "cancelled" || item.bookingStatus === "rejected";
  const opacity = isPast || isCanceled ? 0.6 : 1;

  const tc = TYPE_CFG[item.bookingType] || TYPE_CFG.class;
  const bs = bookingStatusConfig(item.bookingStatus);
  const ps = paymentStatusConfig(item.paymentStatus);

  const instructorInitials = item.instructorName
    .split(/\s+/)
    .filter(Boolean)
    .map((part: string) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase() || "?";

  const childInitials = item.participantName
    .split(/\s+/)
    .filter(Boolean)
    .map((part: string) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase() || "?";

  const timeLabel = item.time ? `${item.time} (${item.duration})` : item.duration;

  // Phase logic
  const phase = isCanceled ? "cancelled" : isPast ? "past" : "upcoming";

  return (
    <View style={[styles.card, { opacity }]}>
      <View style={[styles.accent, { backgroundColor: tc.color }]} />

      <View style={styles.body}>
        {/* Header row */}
        <View style={styles.headerRow}>
          <View style={[styles.typeBadge, { backgroundColor: `rgba(${tc.rgb},0.16)` }]}>
            <Text style={[styles.typeText, { color: tc.color }]}>{tc.label}</Text>
          </View>
          <View style={[styles.statusBadge, { backgroundColor: bs.bg }]}>
            <View style={[styles.statusDot, { backgroundColor: bs.c }]} />
            <Text style={[styles.statusText, { color: bs.c }]}>{bs.label}</Text>
          </View>
        </View>

        {/* Title */}
        <Text style={styles.className} numberOfLines={2}>{item.className}</Text>
        {item.sourceUnavailable && (
          <View style={styles.warningBox}>
            <SBI name="alert" size={15} stroke={2.4} color="#FFB02E" />
            <Text style={styles.warningText}>
              This historical booking references a class or schedule that is no longer available.
            </Text>
          </View>
        )}

        {/* Meta Grid */}
        <View style={styles.metaWrap}>
          <View style={styles.metaItem}>
            <SBI name="cal" size={14} stroke={2} color="#00B6D7" />
            <Text style={styles.metaText}>{item.date || "TBD"}</Text>
          </View>
          <View style={styles.metaItem}>
            <SBI name="clock" size={13} stroke={2} color="#6B747F" />
            <Text style={styles.metaText}>{timeLabel}</Text>
          </View>
          <View style={styles.metaItem}>
            <SBI name="pin" size={13} stroke={2} color="#6B747F" />
            <Text style={styles.metaText}>{item.location}</Text>
          </View>
        </View>

        {/* Slots row */}
        <View style={styles.slotsRow}>
          {item.participantType === "child" && (
            <View style={styles.slot}>
              <View style={styles.slotAvatar}>
                <Text style={styles.slotInitials}>{childInitials}</Text>
              </View>
              <View>
                <Text style={styles.slotLabel}>Student</Text>
                <Text style={styles.slotName} numberOfLines={1}>{item.participantName}</Text>
              </View>
            </View>
          )}

          {!item.sourceUnavailable && <View style={styles.slot}>
            <View style={styles.slotAvatar}>
              {item.instructorImage ? (
                <Image source={{ uri: item.instructorImage }} style={styles.slotImage} />
              ) : (
                <Text style={styles.slotInitials}>{instructorInitials}</Text>
              )}
            </View>
            <View>
              <Text style={styles.slotLabel}>Instructor</Text>
              <Text style={styles.slotName} numberOfLines={1}>{item.instructorName}</Text>
            </View>
          </View>}
        </View>

        {/* Payment Pill */}
        <View style={styles.payWrapper}>
          <View style={styles.payStatus}>
            <View style={styles.payIconWrap}>
              <Text style={styles.payIconText}>{ps.ic}</Text>
            </View>
            <Text style={[styles.payStatusText, { color: ps.c }]}>{ps.label}</Text>
          </View>
        </View>

        {/* Package Meter */}
        {pkgInfo && <PackageMeter pkg={pkgInfo} />}

        {/* Warning if any */}
        {item.paymentStatus === "pending_payment" && (
          <View style={styles.warningBox}>
            <SBI name="alert" size={15} stroke={2.4} color="#FFB02E" />
            <Text style={styles.warningText}>Seat not guaranteed until payment is completed.</Text>
          </View>
        )}

        {/* Actions — dynamic-width buttons that fill the card row (no empty space).
            Set depends on booking type/state:
              • Package (upcoming):       View Details + Cancel
              • Regular awaiting payment: Cancel + Pay Now
              • Regular settled:          View Details + Cancel
              • Past / cancelled:         View Details (full width) */}
        {(() => {
          const isPackage = item.bookingType === "package" || item.paymentMethod === "packageCredit";
          const isUpcomingActive =
            !item.sourceUnavailable
            && phase === "upcoming"
            && item.bookingStatus !== "cancelled"
            && item.bookingStatus !== "rejected";
          // Wave 3 (F-20): mirrors the server's 2-hour self-cancellation
          // cutoff so Cancel is never offered as working once the server
          // would reject it — the server remains authoritative for any
          // boundary/race case (see bookingCancellationEligibility.ts).
          // Only gates the Cancel action itself: View Details / Pay Now stay
          // available past the cutoff, since neither is a cancellation.
          const canSelfCancel = isUpcomingActive && isBookingSelfCancellableClientSide({
            occurrenceDate: item.occurrenceDate ?? null,
            startTime: item.scheduleStartTime ?? null,
          });

          const viewBtn = <ActionBtn key="view" label="View Details" icon="eye" onPress={onPress} />;
          const cancelBtn = <ActionBtn key="cancel" label="Cancel" icon="cancel" danger onPress={onCancel} />;
          const payBtn = <ActionBtn key="pay" label="Pay Now" primary onPress={onPayNow} />;

          let buttons: React.ReactNode[];
          if (!isUpcomingActive) {
            buttons = [viewBtn];
          } else if (isPackage) {
            buttons = canSelfCancel ? [viewBtn, cancelBtn] : [viewBtn];
          } else if (item.paymentStatus === "pending_payment") {
            buttons = canSelfCancel ? [cancelBtn, payBtn] : [payBtn];
          } else {
            buttons = canSelfCancel ? [viewBtn, cancelBtn] : [viewBtn];
          }
          return <View style={styles.actionsRow}>{buttons}</View>;
        })()}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#15171B",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    marginBottom: 12,
    position: "relative",
    overflow: "hidden",
  },
  accent: {
    position: "absolute",
    top: 0,
    left: 0,
    bottom: 0,
    width: 4,
  },
  body: {
    paddingTop: 14,
    paddingRight: 14,
    paddingBottom: 16,
    paddingLeft: 18,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 9,
  },
  typeBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
  },
  typeText: {
    fontFamily: "Archivo_800ExtraBold",
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: 0.7,
  },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusText: {
    fontFamily: "Archivo_700Bold",
    fontSize: 11,
  },
  className: {
    fontFamily: "Archivo_800ExtraBold",
    fontSize: 18,
    color: "#FFFFFF",
    marginBottom: 10,
    lineHeight: 21,
  },
  metaWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 10,
  },
  metaItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  metaText: {
    fontFamily: "Archivo_600SemiBold",
    fontSize: 13,
    color: "#8E97A2",
  },
  slotsRow: {
    flexDirection: "row",
    gap: 18,
    marginBottom: 10,
  },
  slot: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  slotAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.06)",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  slotImage: {
    width: "100%",
    height: "100%",
  },
  slotInitials: {
    fontFamily: "Archivo_700Bold",
    fontSize: 11,
    color: "#FFFFFF",
  },
  slotLabel: {
    fontFamily: "SpaceMono_700Bold",
    fontSize: 11,
    letterSpacing: 0.6,
    textTransform: "uppercase",
    color: "#6B747F",
  },
  slotName: {
    fontFamily: "Archivo_700Bold",
    fontSize: 13.5,
    color: "#FFFFFF",
  },
  payWrapper: {
    marginBottom: 10,
  },
  payStatus: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  payIconWrap: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "rgba(255,255,255,0.07)",
    alignItems: "center",
    justifyContent: "center",
  },
  payIconText: {
    fontFamily: "Archivo_800ExtraBold",
    fontSize: 10,
    color: "#FFFFFF",
  },
  payStatusText: {
    fontFamily: "Archivo_700Bold",
    fontSize: 11.5,
  },
  pkgMeterCont: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: "rgba(0,182,215,0.07)",
    borderWidth: 1,
    borderColor: "rgba(0,182,215,0.22)",
    marginBottom: 10,
  },
  pkgRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 7,
  },
  pkgName: {
    fontFamily: "Archivo_700Bold",
    fontSize: 12.5,
    color: "#00B6D7",
  },
  pkgCredits: {
    fontFamily: "Archivo_600SemiBold",
    fontSize: 12,
    color: "#8E97A2",
  },
  pkgBarBg: {
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.07)",
    overflow: "hidden",
  },
  pkgBarFill: {
    height: "100%",
    borderRadius: 2,
  },
  warningBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    padding: 10,
    borderRadius: 8,
    backgroundColor: "rgba(255,176,46,0.10)",
    borderWidth: 1,
    borderColor: "rgba(255,176,46,0.28)",
    marginBottom: 10,
  },
  warningText: {
    fontFamily: "Archivo_400Regular",
    fontSize: 12,
    color: "#FFB02E",
    flex: 1,
    lineHeight: 17,
  },
  // Buttons fill the row equally (flex:1) and auto-resize by count — no gaps.
  actionsRow: {
    flexDirection: "row",
    gap: 10,
    paddingTop: 8,
    paddingBottom: 2,
  },
  actionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingHorizontal: 13,
    paddingVertical: 9,
    borderRadius: 8,
    minHeight: 40,
  },
  actionBtnText: {
    fontFamily: "Archivo_700Bold",
    fontSize: 12.5,
  },
});
