import { useEffect } from "react";
import { useAppContext } from "@/contexts/AppContext";
import { registerPushNotificationsForCurrentUser } from "@/services/pushNotifications";

export default function PushRegistrationGate() {
  const { user } = useAppContext();

  useEffect(() => {
    if (!user?.id || !user.emailVerified) return;
    registerPushNotificationsForCurrentUser().catch(() => {
      // Permission denial or Expo-token failures should never block app use.
    });
  }, [user?.emailVerified, user?.id]);

  return null;
}
