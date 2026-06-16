/**
 * Skeleton loader components — animated pulsing placeholders shown while data is loading.
 * Use these instead of spinners when you know the shape of the content.
 */
import React, { useEffect, useRef } from "react";
import { Animated, View, ViewStyle } from "react-native";

// ─── Base skeleton box ────────────────────────────────────────────────────────

interface SkeletonBoxProps {
  width?: number | `${number}%` | "100%";
  height?: number;
  borderRadius?: number;
  style?: ViewStyle;
}

export function SkeletonBox({
  width = "100%",
  height = 16,
  borderRadius = 8,
  style,
}: SkeletonBoxProps) {
  const opacity = useRef(new Animated.Value(0.25)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.85, duration: 750, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.25, duration: 750, useNativeDriver: true }),
      ])
    );
    animation.start();
    return () => animation.stop();
  }, [opacity]);

  return (
    <Animated.View
      style={[{ width, height, borderRadius, backgroundColor: "#2A2A35" }, { opacity }, style]}
    />
  );
}

// ─── Instructor card skeleton (horizontal list) ───────────────────────────────

export function InstructorCardSkeleton() {
  return (
    <View style={{ width: 100, alignItems: "center", gap: 8 }}>
      <SkeletonBox width={80} height={80} borderRadius={40} />
      <SkeletonBox width={72} height={12} borderRadius={6} />
      <SkeletonBox width={52} height={10} borderRadius={5} />
    </View>
  );
}

// ─── Class list card skeleton (upcoming classes / home) ───────────────────────

export function ClassListCardSkeleton() {
  return (
    <View
      style={{
        borderRadius: 14,
        backgroundColor: "#0E1619",
        borderWidth: 1,
        borderColor: "#1E2E38",
        padding: 14,
        gap: 10,
        marginBottom: 2,
      }}
    >
      <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
        <SkeletonBox width={44} height={44} borderRadius={12} />
        <View style={{ flex: 1, gap: 7 }}>
          <SkeletonBox width="65%" height={14} borderRadius={7} />
          <SkeletonBox width="45%" height={11} borderRadius={5} />
        </View>
        <SkeletonBox width={56} height={26} borderRadius={13} />
      </View>
      <View style={{ flexDirection: "row", gap: 16 }}>
        <SkeletonBox width={72} height={10} borderRadius={5} />
        <SkeletonBox width={56} height={10} borderRadius={5} />
        <SkeletonBox width={64} height={10} borderRadius={5} />
      </View>
    </View>
  );
}

// ─── Full class card skeleton (classes tab grid) ──────────────────────────────

export function ClassCardSkeleton() {
  return (
    <View
      style={{
        borderRadius: 14,
        backgroundColor: "#0E1619",
        borderWidth: 1,
        borderColor: "#1E2E38",
        padding: 14,
        gap: 10,
        marginBottom: 10,
      }}
    >
      <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
        <SkeletonBox width={44} height={44} borderRadius={12} />
        <View style={{ flex: 1, gap: 7 }}>
          <SkeletonBox width="70%" height={14} borderRadius={7} />
          <SkeletonBox width="50%" height={11} borderRadius={5} />
        </View>
      </View>
      <SkeletonBox width="40%" height={10} borderRadius={5} />
    </View>
  );
}

// ─── Package card skeleton ────────────────────────────────────────────────────

export function PackageCardSkeleton() {
  return (
    <View
      style={{
        borderRadius: 16,
        backgroundColor: "#0E1619",
        borderWidth: 1,
        borderColor: "#1E2E38",
        padding: 16,
        gap: 12,
        marginBottom: 12,
      }}
    >
      <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
        <SkeletonBox width={48} height={48} borderRadius={14} />
        <View style={{ flex: 1, gap: 7 }}>
          <SkeletonBox width="60%" height={16} borderRadius={8} />
          <SkeletonBox width="40%" height={12} borderRadius={6} />
        </View>
      </View>
      <SkeletonBox width="80%" height={10} borderRadius={5} />
      <SkeletonBox width="50%" height={10} borderRadius={5} />
      <View style={{ flexDirection: "row", justifyContent: "flex-end" }}>
        <SkeletonBox width={100} height={36} borderRadius={10} />
      </View>
    </View>
  );
}

// ─── Notification row skeleton ────────────────────────────────────────────────

export function NotifCardSkeleton() {
  return (
    <View style={{ flexDirection: "row", gap: 12, paddingHorizontal: 20, paddingVertical: 12, alignItems: "flex-start" }}>
      <SkeletonBox width={40} height={40} borderRadius={20} />
      <View style={{ flex: 1, gap: 8 }}>
        <SkeletonBox width="65%" height={13} borderRadius={6} />
        <SkeletonBox width="85%" height={11} borderRadius={5} />
        <SkeletonBox width="30%" height={10} borderRadius={5} />
      </View>
    </View>
  );
}

// ─── Detail screen hero skeleton (class/instructor/booking detail) ────────────

export function DetailSkeleton() {
  return (
    <View style={{ flex: 1, backgroundColor: "#060C10" }}>
      {/* Hero area */}
      <SkeletonBox width="100%" height={280} borderRadius={0} />
      {/* Content */}
      <View style={{ padding: 20, gap: 16 }}>
        <SkeletonBox width="70%" height={24} borderRadius={10} />
        <SkeletonBox width="45%" height={16} borderRadius={8} />
        <View style={{ gap: 10, marginTop: 8 }}>
          <SkeletonBox width="100%" height={12} borderRadius={6} />
          <SkeletonBox width="90%" height={12} borderRadius={6} />
          <SkeletonBox width="75%" height={12} borderRadius={6} />
        </View>
        <View style={{ flexDirection: "row", gap: 12, marginTop: 8 }}>
          <SkeletonBox width={80} height={32} borderRadius={10} />
          <SkeletonBox width={80} height={32} borderRadius={10} />
        </View>
      </View>
    </View>
  );
}

// ─── Generic list skeleton — renders N generic rows ──────────────────────────

export function ListSkeleton({ count = 3 }: { count?: number }) {
  return (
    <View style={{ gap: 12, paddingHorizontal: 20, paddingTop: 8 }}>
      {Array.from({ length: count }).map((_, i) => (
        <ClassCardSkeleton key={i} />
      ))}
    </View>
  );
}
