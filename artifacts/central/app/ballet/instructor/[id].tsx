import { Ionicons } from "@expo/vector-icons";
import { normalizeMediaUrl } from "@workspace/api-client-react";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Platform, StyleSheet, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import ErrorState from "@/components/ErrorState";
import CentralBackButton from "@/components/CentralBackButton";
import InstructorProfileView, { type InstructorScheduleCard } from "@/components/InstructorProfileView";
import { DetailSkeleton } from "@/components/SkeletonLoader";
import type { DanceClass, Instructor } from "@/data/mockData";
import {
  fetchBalletClasses,
  fetchBalletInstructor,
  type BalletClass,
  type BalletClassSchedule,
  type BalletInstructor,
} from "@/services/balletAssessmentService";
import { getNextCairoScheduleDate } from "@/utils/cairoDate";
import { scheduleLocationLabel } from "@/utils/scheduleLocation";

const CYAN = "#00B6D7";
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function formatTime(timeStr: string): string {
  const [hoursStr = "0", minsStr = "00"] = timeStr.split(":");
  const hours = Number(hoursStr);
  const ampm = hours >= 12 ? "PM" : "AM";
  return `${hours % 12 || 12}:${minsStr} ${ampm}`;
}

function initialsFromName(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || "?";
}

function toMobileInstructor(instructor: BalletInstructor): Instructor {
  return {
    id: `ballet-instructor-${instructor.id}`,
    name: instructor.name,
    title: "Ballet Instructor",
    bio: instructor.bio ?? "",
    danceStyles: instructor.specialties,
    rating: instructor.rating ?? 0,
    totalClasses: 0,
    photoColor: CYAN,
    initials: initialsFromName(instructor.name),
    photoUrl: normalizeMediaUrl(instructor.photoUrl, "image"),
  };
}

function toDanceClass(item: BalletClass, schedule: BalletClassSchedule): DanceClass {
  const dayOfWeek = DAY_NAMES[schedule.dayOfWeek] ?? "Weekly";
  const levelName = item.level?.name ?? "All Levels";
  const groupName = item.group?.name;
  return {
    id: `ballet-${item.id}`,
    scheduleId: schedule.id != null ? `ballet-schedule-${schedule.id}` : `ballet-class-${item.id}-${schedule.dayOfWeek}`,
    scheduleType: "weekly",
    scheduleStatus: "active",
    packageEligible: false,
    categoryId: "ballet",
    categoryName: "Ballet",
    instructorId: `ballet-instructor-${item.instructor.id}`,
    title: item.title,
    description: groupName ? `${levelName} · ${groupName}` : levelName,
    photoUrl: normalizeMediaUrl(item.classImageUrl, "image"),
    classVideoUrl: normalizeMediaUrl(item.classVideoUrl, "video"),
    date: getNextCairoScheduleDate(schedule.dayOfWeek, schedule.startTime),
    dayOfWeek,
    startTime: formatTime(schedule.startTime),
    endTime: formatTime(schedule.endTime),
    scheduleLabel: `${dayOfWeek} · ${formatTime(schedule.startTime)} - ${formatTime(schedule.endTime)}`,
    duration: `${schedule.durationMins} min`,
    location: scheduleLocationLabel({ branch: schedule.branch, room: schedule.room }) ?? "Central Studio",
    room: schedule.room?.name ?? "",
    price: 0,
    capacity: 0,
    bookedCount: 0,
    classCapacityEnabled: false,
    level: "All Levels",
    ageGroup: "Kids",
    status: "available",
    policy: "",
    featured: false,
    isBallet: true,
  };
}

export default function BalletInstructorDetailScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const insets = useSafeAreaInsets();
  const routeId = Array.isArray(id) ? id[0] : id;
  const instructorId = Number(routeId);
  const [instructor, setInstructor] = useState<BalletInstructor | null>(null);
  const [instructorClasses, setInstructorClasses] = useState<BalletClass[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal, refreshing = false) => {
    if (!Number.isInteger(instructorId) || instructorId <= 0) {
      setErrorMessage("Invalid instructor.");
      setIsLoading(false);
      return;
    }
    if (refreshing) setIsRefreshing(true);
    else setIsLoading(true);
    setErrorMessage(null);
    try {
      const [profile, classes] = await Promise.all([
        fetchBalletInstructor(instructorId, signal),
        fetchBalletClasses(signal),
      ]);
      if (signal?.aborted) return;
      setInstructor(profile);
      setInstructorClasses(classes.filter((item) => item.instructor?.id === instructorId));
    } catch (error) {
      if ((error as any)?.name === "AbortError") return;
      setInstructor(null);
      setInstructorClasses([]);
      setErrorMessage("Unable to load this instructor right now.");
    } finally {
      if (!signal?.aborted) {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    }
  }, [instructorId]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const mobileInstructor = useMemo(() => instructor ? toMobileInstructor(instructor) : undefined, [instructor]);
  const cards = useMemo<InstructorScheduleCard[]>(() => {
    if (!mobileInstructor) return [];
    return instructorClasses.flatMap((item) => item.schedules.map((schedule) => ({
      item: toDanceClass(item, schedule),
      instructor: mobileInstructor,
      styleIcon: { iconSvg: null, iconUrl: null, legacyIcon: null, color: CYAN },
    })));
  }, [instructorClasses, mobileInstructor]);

  if (isLoading) return <DetailSkeleton />;

  if (!instructor || errorMessage) {
    return (
      <View style={[styles.stateScreen, { paddingTop: (Platform.OS === "web" ? 18 : insets.top) + 12 }]}>
        <CentralBackButton style={styles.backButton} />
        <ErrorState title="Instructor unavailable" message={errorMessage ?? "Instructor not found."} onRetry={() => void load()} />
      </View>
    );
  }

  return (
    <InstructorProfileView
      profile={{
        name: instructor.name,
        bio: instructor.bio ?? "",
        photoUrl: normalizeMediaUrl(instructor.photoUrl, "image"),
        experienceYears: instructor.experienceYears,
        classCount: instructor.classCount ?? instructorClasses.length,
        studentCount: instructor.studentCount ?? "—",
        specialties: instructor.specialties,
        achievements: instructor.achievements,
        professionalExperience: instructor.professionalExperience,
      }}
      classes={cards}
      refreshing={isRefreshing}
      onRefresh={() => void load(undefined, true)}
      onSelectClass={() => router.push("/ballet/classes" as any)}
      onBookClass={() => router.push("/ballet/classes" as any)}
    />
  );
}

const styles = StyleSheet.create({
  stateScreen: { flex: 1, backgroundColor: "#000000" },
  backButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center", marginLeft: 10, zIndex: 4 },
});
