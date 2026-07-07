import { useEffect } from "react";
import { useAppContext } from "@/contexts/AppContext";
import { isExpoGo, registerPushNotificationsForCurrentUser } from "@/services/pushNotifications";

export default function PushRegistrationGate() {
  const { user } = useAppContext();

  useEffect(() => {
    if (__DEV__) {
      console.log("[PUSH_DIAG] gate mounted", {
        userExists: Boolean(user?.id),
        emailVerified: Boolean(user?.emailVerified),
        isExpoGo: isExpoGo(),
      });
    }
    if (isExpoGo()) return;
    if (!user?.id || !user.emailVerified) return;
    registerPushNotificationsForCurrentUser().catch(() => {
      // Permission denial or Expo-token failures should never block app use.
    });
  }, [user?.emailVerified, user?.id]);

  return null;
}
