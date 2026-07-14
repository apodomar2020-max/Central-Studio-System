import AsyncStorage from "@react-native-async-storage/async-storage";
import { createAudioPlayer, setAudioModeAsync, setIsAudioActiveAsync, type AudioPlayer } from "expo-audio";
import { usePathname } from "expo-router";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";
import {
  fetchBackgroundMusicConfig,
  getCachedMusicUri,
  type BackgroundMusicConfig,
} from "@/services/backgroundMusic";
import { shouldPlayBackgroundMusic } from "@/services/backgroundMusicRules";

const PREF_KEY = "backgroundMusic:enabled";
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const RETRY_INTERVAL_MS = 60 * 1000;

interface BackgroundMusicContextValue {
  localEnabled: boolean;
  setLocalEnabled: (enabled: boolean) => Promise<void>;
  remoteConfig: BackgroundMusicConfig | null;
}

const BackgroundMusicContext = createContext<BackgroundMusicContextValue | null>(null);

function clampVolume(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0.25));
}

export function BackgroundMusicProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [localEnabled, setLocalEnabledState] = useState(true);
  const [remoteConfig, setRemoteConfig] = useState<BackgroundMusicConfig | null>(null);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const playerRef = useRef<AudioPlayer | null>(null);
  const sourceKeyRef = useRef<string | null>(null);
  const operationRef = useRef(0);
  const lastRefreshRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const shouldPauseForInternalMedia = pathname.startsWith("/class/");

  const stopPlayer = useCallback(() => {
    const player = playerRef.current;
    if (player) {
      try {
        player.pause();
        player.remove();
      } catch {
        // Native audio cleanup is best-effort.
      }
    }
    playerRef.current = null;
    sourceKeyRef.current = null;
  }, []);

  const refreshConfig = useCallback(async (force = false) => {
    const now = Date.now();
    if (!force && now - lastRefreshRef.current < REFRESH_INTERVAL_MS) return;
    lastRefreshRef.current = now;
    try {
      const config = await fetchBackgroundMusicConfig();
      setRemoteConfig(config);
    } catch {
      if (!retryTimerRef.current) {
        retryTimerRef.current = setTimeout(() => {
          retryTimerRef.current = null;
          void refreshConfig(true);
        }, RETRY_INTERVAL_MS);
      }
    }
  }, []);

  const reconcilePlayback = useCallback(async () => {
    const op = operationRef.current + 1;
    operationRef.current = op;
    const config = remoteConfig;
    const canPlay = shouldPlayBackgroundMusic({
      config,
      localEnabled,
      appState: appStateRef.current,
      pauseForInternalMedia: shouldPauseForInternalMedia,
    });

    if (!canPlay || !config) {
      if (playerRef.current) {
        try {
          playerRef.current.pause();
        } catch {
          stopPlayer();
        }
      }
      return;
    }

    const cached = await getCachedMusicUri(config);
    if (operationRef.current !== op) return;
    if (!cached) {
      stopPlayer();
      return;
    }

    const sourceKey = `${config.version}:${cached.uri}`;
    if (!playerRef.current || sourceKeyRef.current !== sourceKey) {
      stopPlayer();
      const player = createAudioPlayer({ uri: cached.uri }, { updateInterval: 1000, keepAudioSessionActive: false });
      player.loop = config.loop;
      player.volume = clampVolume(config.volume);
      playerRef.current = player;
      sourceKeyRef.current = sourceKey;
    } else {
      playerRef.current.loop = config.loop;
      playerRef.current.volume = clampVolume(config.volume);
    }

    try {
      await setIsAudioActiveAsync(true);
      playerRef.current?.play();
    } catch {
      stopPlayer();
    }
  }, [localEnabled, remoteConfig, shouldPauseForInternalMedia, stopPlayer]);

  useEffect(() => {
    void AsyncStorage.getItem(PREF_KEY)
      .then((value) => setLocalEnabledState(value !== "false"))
      .catch(() => setLocalEnabledState(true));
    void setAudioModeAsync({
      playsInSilentMode: false,
      shouldPlayInBackground: false,
      interruptionMode: "duckOthers",
    }).catch(() => {});
    void refreshConfig(true);
  }, [refreshConfig]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      const wasActive = appStateRef.current === "active";
      appStateRef.current = state;
      if (state !== "active") {
        try {
          playerRef.current?.pause();
          void setIsAudioActiveAsync(false);
        } catch {
          // No-op; app is leaving active state.
        }
        return;
      }
      if (!wasActive) void refreshConfig(false);
      void reconcilePlayback();
    });
    return () => sub.remove();
  }, [reconcilePlayback, refreshConfig]);

  useEffect(() => {
    void reconcilePlayback();
  }, [reconcilePlayback]);

  useEffect(() => {
    return () => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      stopPlayer();
    };
  }, [stopPlayer]);

  const setLocalEnabled = useCallback(async (enabled: boolean) => {
    setLocalEnabledState(enabled);
    await AsyncStorage.setItem(PREF_KEY, enabled ? "true" : "false");
    if (!enabled) {
      try {
        playerRef.current?.pause();
      } catch {
        stopPlayer();
      }
    }
  }, [stopPlayer]);

  const value = useMemo(
    () => ({ localEnabled, setLocalEnabled, remoteConfig }),
    [localEnabled, setLocalEnabled, remoteConfig],
  );

  return (
    <BackgroundMusicContext.Provider value={value}>
      {children}
    </BackgroundMusicContext.Provider>
  );
}

export function useBackgroundMusic() {
  const ctx = useContext(BackgroundMusicContext);
  if (!ctx) throw new Error("useBackgroundMusic must be used inside BackgroundMusicProvider");
  return ctx;
}
