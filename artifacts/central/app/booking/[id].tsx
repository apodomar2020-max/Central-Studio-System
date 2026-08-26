import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Platform, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import BookingDetailsView from "@/components/BookingDetailsView";
import CentralBackButton from "@/components/CentralBackButton";
import { useAppContext } from "@/contexts/AppContext";
import { useCentralAlert } from "@/hooks/useCentralAlert";

const INK = "#050607";
const CYAN = "#00B6D7";

export default function BookingDetailsScreen() {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const bookingId = Array.isArray(params.id) ? params.id[0] : params.id;
  const { user, bookings, refreshBookings, cancelBooking } = useAppContext();
  const alert = useCentralAlert();
  const insets = useSafeAreaInsets();
  const refreshAttempted = useRef(false);
  const [refreshing, setRefreshing] = useState(false);

  const booking = useMemo(
    () => bookings.find((item) => String(item.id) === String(bookingId)),
    [bookingId, bookings],
  );

  useEffect(() => {
    if (booking || refreshAttempted.current || !bookingId || !refreshBookings) return;
    refreshAttempted.current = true;
    setRefreshing(true);
    void refreshBookings().finally(() => setRefreshing(false));
  }, [booking, bookingId, refreshBookings]);

  function confirmCancel() {
    if (!booking) return;
    alert.show({
      tone: "destructive",
      title: "Cancel booking?",
      message: `Cancel your booking for ${booking.className}? This frees up your seat.`,
      actions: [
        { label: "Keep booking", tone: "neutral" },
        {
          label: "Cancel booking",
          tone: "danger",
          onPress: async () => {
            try {
              await cancelBooking(booking.id);
              router.back();
            } catch (error) {
              alert.show({
                tone: "error",
                title: "Couldn't cancel",
                message: error instanceof Error ? error.message : "Please try again.",
              });
            }
          },
        },
      ],
    });
  }

  if (!booking) {
    const top = (Platform.OS === "web" ? 67 : insets.top) + 12;
    return (
      <View style={styles.stateScreen}>
        <CentralBackButton onPress={() => router.back()} style={[styles.stateBack, { top }]} />
        <View style={styles.stateContent}>
          {refreshing ? (
            <ActivityIndicator color={CYAN} size="large" />
          ) : (
            <>
              <Text style={styles.stateTitle}>Booking not found</Text>
              <Text style={styles.stateText}>This booking may no longer be available.</Text>
            </>
          )}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <BookingDetailsView
        booking={booking}
        participantImage={booking.participantType === "self" ? user?.avatarUrl : undefined}
        onClose={() => router.back()}
        onCancel={confirmCancel}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: INK },
  stateScreen: { flex: 1, backgroundColor: INK },
  stateBack: { position: "absolute", left: 16, zIndex: 2 },
  stateContent: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 28 },
  stateTitle: { color: "#FFFFFF", fontFamily: "Archivo_700Bold", fontSize: 20, textAlign: "center" },
  stateText: { marginTop: 8, color: "#AEB5BE", fontFamily: "Archivo_400Regular", fontSize: 14, textAlign: "center" },
});
