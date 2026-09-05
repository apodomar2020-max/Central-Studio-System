import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import {
  customFetch,
  useGetInstructor,
  useListClasses,
  useListDanceTypes,
  useListSchedules,
} from "@workspace/api-client-react";
import { router, useLocalSearchParams } from "expo-router";
import { pushOnce } from "@/utils/navigation";
import React, { useMemo } from "react";
import { Platform, StyleSheet, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import ErrorState from "@/components/ErrorState";
import CentralBackButton from "@/components/CentralBackButton";
import InstructorProfileView, { type InstructorScheduleCard } from "@/components/InstructorProfileView";
import OfflineState from "@/components/OfflineState";
import { DetailSkeleton } from "@/components/SkeletonLoader";
import { useAppContext } from "@/contexts/AppContext";
import {
  compareSchedulesByNextOccurrence,
  isMobileVisibleSchedule,
  mapApiClassWithScheduleToMobile,
  mapApiInstructorToMobile,
} from "@/data/apiAdapters";
import type { DanceClass } from "@/data/mockData";
import { DEFAULT_CLASS_CAPACITY_ENABLED, fetchClassCapacitySettings } from "@/services/classCapacityService";
import { fetchClassPricing } from "@/services/classPricingService";
import { isOfflineError } from "@/services/connectivity";
import { showAuthRequiredPrompt } from "@/utils/authRequired";

const CYAN = "#00B6D7";

function norm(value: string) {
  return value.trim().toLowerCase().replace(/[\s\-_]+/g, "");
}

export default function InstructorDetailScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const insets = useSafeAreaInsets();
  const { user } = useAppContext();
  const routeId = Array.isArray(id) ? id[0] : id;
  const instructorId = Number(routeId);

  const instructorQuery = useGetInstructor(instructorId, {
    // @ts-ignore generated client supports the standard query enabled option
    query: { enabled: Number.isInteger(instructorId) && instructorId > 0 },
  });
  const classesQuery = useListClasses();
  const schedulesQuery = useListSchedules();
  const danceTypesQuery = useListDanceTypes();
  const pricingQuery = useQuery({ queryKey: ["class-pricing"], queryFn: fetchClassPricing, staleTime: 5 * 60 * 1000 });
  const capacityQuery = useQuery({ queryKey: ["class-capacity"], queryFn: fetchClassCapacitySettings, staleTime: 60 * 1000 });
  const studentCountQuery = useQuery({
    queryKey: ["instructor-student-count", instructorId],
    queryFn: () => customFetch<{ studentCount: number }>(`/api/instructors/${instructorId}/student-count`),
    enabled: Number.isInteger(instructorId) && instructorId > 0,
    staleTime: 5 * 60 * 1000,
  });

  const instructor = instructorQuery.data ? mapApiInstructorToMobile(instructorQuery.data) : null;
  const capacityEnabled = capacityQuery.data?.classCapacityEnabled ?? DEFAULT_CLASS_CAPACITY_ENABLED;
  const activeClassCount = useMemo(
    () => (classesQuery.data ?? []).filter((item) => item.isActive && item.instructorId === instructorId).length,
    [classesQuery.data, instructorId],
  );

  const instructorClasses = useMemo(() => {
    const apiClasses = (classesQuery.data ?? []).filter((item) => item.isActive && item.instructorId === instructorId);
    const schedulesByClass = new Map<number, NonNullable<typeof schedulesQuery.data>[number]>();
    [...(schedulesQuery.data ?? [])]
      .filter(isMobileVisibleSchedule)
      .sort(compareSchedulesByNextOccurrence)
      .forEach((schedule) => {
        if (!schedulesByClass.has(schedule.classId)) schedulesByClass.set(schedule.classId, schedule);
      });

    return apiClasses
      .map((item) => ({ item, schedule: schedulesByClass.get(item.id) }))
      .filter((entry) => entry.schedule != null)
      .map(({ item, schedule }) => mapApiClassWithScheduleToMobile(item, schedule, pricingQuery.data, capacityEnabled));
  }, [classesQuery.data, schedulesQuery.data, instructorId, pricingQuery.data, capacityEnabled]);

  const cards = useMemo<InstructorScheduleCard[]>(() => {
    if (!instructor) return [];
    const danceTypes = danceTypesQuery.data ?? [];
    return instructorClasses.map((item) => {
      const danceType = danceTypes.find((type) =>
        (item.danceTypeId != null && type.id === item.danceTypeId)
        || norm(type.name) === norm(item.categoryName)
        || norm(type.slug) === norm(item.categoryName));
      return {
        item,
        instructor,
        styleIcon: danceType ? {
          iconSvg: danceType.iconSvg ?? null,
          iconUrl: danceType.iconUrl ?? null,
          legacyIcon: null,
          color: danceType.color || CYAN,
        } : undefined,
      };
    });
  }, [instructor, instructorClasses, danceTypesQuery.data]);

  const refreshing = instructorQuery.isRefetching || classesQuery.isRefetching || schedulesQuery.isRefetching;
  const refresh = () => {
    void instructorQuery.refetch();
    void classesQuery.refetch();
    void schedulesQuery.refetch();
    void danceTypesQuery.refetch();
    void studentCountQuery.refetch();
    void pricingQuery.refetch();
    void capacityQuery.refetch();
  };

  const selectClass = (item: DanceClass) => {
    pushOnce({ pathname: "/class/[id]", params: { id: item.id, scheduleId: item.scheduleId } });
  };

  const bookClass = (item: DanceClass) => {
    if (item.status === "full" || item.status === "cancelled" || item.status === "unavailable") return;
    if (!user) {
      showAuthRequiredPrompt();
      return;
    }
    pushOnce({ pathname: "/booking/flow", params: { classId: item.id, scheduleId: item.scheduleId } } as any);
  };

  if (instructorQuery.isLoading || classesQuery.isLoading || schedulesQuery.isLoading) return <DetailSkeleton />;

  if (instructorQuery.isError && isOfflineError(instructorQuery.error)) {
    return (
      <View style={[styles.stateScreen, { paddingTop: (Platform.OS === "web" ? 18 : insets.top) + 12 }]}>
        <CentralBackButton style={styles.backButton} />
        <OfflineState onRetry={refresh} />
      </View>
    );
  }

  if (instructorQuery.isError || !instructor || !instructorQuery.data) {
    return (
      <View style={[styles.stateScreen, { paddingTop: (Platform.OS === "web" ? 18 : insets.top) + 12 }]}>
        <CentralBackButton style={styles.backButton} />
        <ErrorState
          title={instructorQuery.isError ? "Instructor unavailable" : "Instructor not found"}
          message={instructorQuery.isError ? "Couldn't load instructor details." : "This instructor may no longer be available."}
          onRetry={instructorQuery.isError ? refresh : () => router.back()}
        />
      </View>
    );
  }

  const apiInstructor = instructorQuery.data;
  return (
    <InstructorProfileView
      profile={{
        name: apiInstructor.name,
        bio: apiInstructor.bio ?? "",
        photoUrl: instructor.photoUrl,
        experienceYears: apiInstructor.experienceYears,
        classCount: activeClassCount,
        studentCount: studentCountQuery.data?.studentCount ?? "—",
        specialties: apiInstructor.specialties ?? [],
        achievements: apiInstructor.achievements ?? [],
        professionalExperience: apiInstructor.professionalExperience ?? [],
      }}
      classes={cards}
      refreshing={refreshing}
      onRefresh={refresh}
      onSelectClass={selectClass}
      onBookClass={bookClass}
    />
  );
}

const styles = StyleSheet.create({
  stateScreen: { flex: 1, backgroundColor: "#000000" },
  backButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center", marginLeft: 10, zIndex: 4 },
});
