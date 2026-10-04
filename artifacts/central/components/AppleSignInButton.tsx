import * as Apple from "expo-apple-authentication";
import { useEffect, useState } from "react";
import { Platform, View, ActivityIndicator } from "react-native";

export default function AppleSignInButton({ onPress, loading = false, disabled = false }: {
  onPress: () => void; loading?: boolean; disabled?: boolean;
}) {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    let alive = true;
    if (Platform.OS === "ios") void Apple.isAvailableAsync().then(v => { if (alive) setAvailable(v); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  if (!available) return null;
  return <View pointerEvents={disabled || loading ? "none" : "auto"} style={{ width: "100%", opacity: disabled || loading ? 0.6 : 1 }}>
    <Apple.AppleAuthenticationButton buttonType={Apple.AppleAuthenticationButtonType.CONTINUE}
      buttonStyle={Apple.AppleAuthenticationButtonStyle.BLACK} cornerRadius={12}
      style={{ width: "100%", height: 50 }} onPress={onPress} />
    {loading && <ActivityIndicator style={{ position: "absolute", right: 12, top: 15 }} color="#fff" />}
  </View>;
}
