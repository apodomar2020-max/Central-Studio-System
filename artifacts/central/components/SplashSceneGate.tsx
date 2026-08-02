import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  AppState,
  BackHandler,
  Easing,
  Image,
  Platform,
  StyleSheet,
  View,
} from "react-native";
import { VideoView, useVideoPlayer } from "expo-video";
import * as SplashScreen from "expo-splash-screen";
import { useAppContext } from "@/contexts/AppContext";

/**
 * Process-level singleton flag ensuring SplashSceneGate runs exactly ONCE
 * per JS runtime launch (cold start). Re-mounting during internal navigation,
 * tab switches, background resume, or hot reloads will not replay the splash.
 */
let hasRunSplashInProcess = false;

interface SplashSceneGateProps {
  fontsLoaded: boolean;
  children: React.ReactNode;
}

export function SplashSceneGate({ fontsLoaded, children }: SplashSceneGateProps) {
  const { isLoading: isAppLoading } = useAppContext();

  // Component states
  const [isSplashComplete, setIsSplashComplete] = useState(hasRunSplashInProcess);
  const [timeNearEnd, setTimeNearEnd] = useState(false);
  const [videoFinished, setVideoFinished] = useState(false);
  const [videoError, setVideoError] = useState(false);
  const [isReduceMotion, setIsReduceMotion] = useState(false);
  const [hasHiddenNativeSplash, setHasHiddenNativeSplash] = useState(false);
  const [playbackStarted, setPlaybackStarted] = useState(false);

  const opacityAnim = useRef(new Animated.Value(1)).current;
  const isMountedRef = useRef(true);
  const isFadeStartedRef = useRef(false);

  // Playback state machine refs
  const hasRequestedPlayRef = useRef(false);
  const hasPlaybackStartedRef = useRef(false);
  const hasRetriedPlaybackRef = useRef(false);
  const hasReachedNearEndRef = useRef(false);

  // Timer refs
  const startupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const postRetryFallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playbackEndTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Assets
  const splashVideoSource = require("@/assets/videos/splash-scene.mp4");
  const splashFinalFrame = require("@/assets/images/splash-scene-final-frame.png");

  const player = useVideoPlayer(splashVideoSource, (p) => {
    p.loop = false;
    p.muted = true;
    p.timeUpdateEventInterval = 0.05; // Emit timeUpdate every 50ms (0.05s)
  });

  // Safe native splash hide helper
  const safeHideNativeSplash = useCallback(() => {
    if (!hasHiddenNativeSplash) {
      setHasHiddenNativeSplash(true);
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [hasHiddenNativeSplash]);

  // Timer cleanup helpers
  const clearStartupTimers = useCallback(() => {
    if (startupTimerRef.current) clearTimeout(startupTimerRef.current);
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    if (postRetryFallbackTimerRef.current) clearTimeout(postRetryFallbackTimerRef.current);
    startupTimerRef.current = null;
    retryTimerRef.current = null;
    postRetryFallbackTimerRef.current = null;
  }, []);

  const clearAllTimers = useCallback(() => {
    clearStartupTimers();
    if (playbackEndTimeoutRef.current) clearTimeout(playbackEndTimeoutRef.current);
    playbackEndTimeoutRef.current = null;
  }, [clearStartupTimers]);

  // Track component mount & unmount lifecycle
  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
      clearAllTimers();
    };
  }, [clearAllTimers]);

  // Check Reduced Motion setting
  useEffect(() => {
    let subscription: { remove: () => void } | undefined;
    AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (isMountedRef.current) {
        setIsReduceMotion(enabled);
      }
    });

    if (AccessibilityInfo.addEventListener) {
      subscription = AccessibilityInfo.addEventListener(
        "reduceMotionChanged",
        (enabled) => {
          if (isMountedRef.current) {
            setIsReduceMotion(enabled);
          }
        }
      );
    }

    return () => {
      subscription?.remove();
    };
  }, []);

  // Centralized Idempotent Playback Request Executor
  const requestInitialPlayback = useCallback((sourceTag: string) => {
    if (
      !isMountedRef.current ||
      hasPlaybackStartedRef.current ||
      hasRequestedPlayRef.current ||
      AppState.currentState !== "active"
    ) {
      return;
    }

    if (player.status === "readyToPlay") {
      hasRequestedPlayRef.current = true;
      player.play();

      // Schedule 700ms playback start retry check
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      retryTimerRef.current = setTimeout(() => {
        if (
          isMountedRef.current &&
          !hasPlaybackStartedRef.current &&
          !hasRetriedPlaybackRef.current &&
          AppState.currentState === "active"
        ) {
          hasRetriedPlaybackRef.current = true;
          if (__DEV__) {
            console.log("[SplashSceneGate] playback retry requested (700ms elapsed without isPlaying: true)");
          }
          player.play();

          // Additional 1.5s fallback check after retry
          if (postRetryFallbackTimerRef.current) clearTimeout(postRetryFallbackTimerRef.current);
          postRetryFallbackTimerRef.current = setTimeout(() => {
            if (
              isMountedRef.current &&
              !hasPlaybackStartedRef.current &&
              !isFadeStartedRef.current
            ) {
              if (__DEV__) {
                console.warn("[SplashSceneGate] startup fallback triggered: retry did not start playback");
              }
              setVideoFinished(true);
            }
          }, 1500);
        }
      }, 700);
    }
  }, [player]);

  // AppState Handling: Manage background / foreground transitions safely
  useEffect(() => {
    if (hasRunSplashInProcess || isReduceMotion) return;

    const subscription = AppState.addEventListener("change", (nextAppState) => {
      if (!isMountedRef.current || isSplashComplete) return;

      if (nextAppState === "active") {
        if (!hasPlaybackStartedRef.current) {
          hasRequestedPlayRef.current = false;
          requestInitialPlayback("appState active");

          if (!startupTimerRef.current && !hasPlaybackStartedRef.current) {
            startupTimerRef.current = setTimeout(() => {
              if (isMountedRef.current && !hasPlaybackStartedRef.current && !isFadeStartedRef.current) {
                if (__DEV__) {
                  console.warn("[SplashSceneGate] startup fallback triggered: 2.5s after app resume");
                }
                setVideoFinished(true);
              }
            }, 2500);
          }
        } else {
          // Playback already started: recalculate remaining video time watchdog
          const remainingSeconds = Math.max(0.5, (player.duration || 8.0) - player.currentTime);
          const timeoutMs = Math.round((remainingSeconds + 0.75) * 1000);
          if (playbackEndTimeoutRef.current) clearTimeout(playbackEndTimeoutRef.current);
          playbackEndTimeoutRef.current = setTimeout(() => {
            if (isMountedRef.current && !isFadeStartedRef.current) {
              if (__DEV__) {
                console.warn("[SplashSceneGate] Playback end watchdog triggered fallback after resume");
              }
              setTimeNearEnd(true);
              setVideoFinished(true);
            }
          }, timeoutMs);
        }
      } else {
        // App backgrounded: clear pending timers so they don't fire when inactive
        clearAllTimers();
      }
    });

    return () => {
      subscription.remove();
    };
  }, [player, isReduceMotion, isSplashComplete, requestInitialPlayback, clearAllTimers]);

  // Player Lifecycle & Event State Machine
  useEffect(() => {
    if (hasRunSplashInProcess || isReduceMotion) return;

    // 1. Immediate Status Snapshot Check (fixes ready-before-listener race)
    if (player.status === "readyToPlay") {
      requestInitialPlayback("initial status snapshot");
    }

    // 2. Start AppState-aware 2.5s startup watchdog
    if (AppState.currentState === "active" && !startupTimerRef.current && !hasPlaybackStartedRef.current) {
      startupTimerRef.current = setTimeout(() => {
        if (isMountedRef.current && !hasPlaybackStartedRef.current && !isFadeStartedRef.current) {
          if (__DEV__) {
            console.warn("[SplashSceneGate] startup fallback triggered: 2.5s elapsed without playback start");
          }
          setVideoFinished(true);
        }
      }, 2500);
    }

    const statusSub = player.addListener("statusChange", (payload) => {
      if (!isMountedRef.current) return;

      if (payload.status === "error") {
        if (__DEV__) {
          console.warn(`[SplashSceneGate] player status error: ${payload.error?.message || "unknown"}`);
        }
        setVideoError(true);
        setVideoFinished(true);
        return;
      }

      if (payload.status === "readyToPlay") {
        requestInitialPlayback("statusChange");
      }
    });

    const playingSub = player.addListener("playingChange", (payload) => {
      if (!isMountedRef.current) return;
      if (payload.isPlaying && !hasPlaybackStartedRef.current) {
        hasPlaybackStartedRef.current = true;
        setPlaybackStarted(true);

        // Cancel all startup timers
        clearStartupTimers();

        // Start Playback End Watchdog (remaining video time + 0.75s)
        const remainingSeconds = Math.max(0.5, (player.duration || 8.0) - player.currentTime);
        const timeoutMs = Math.round((remainingSeconds + 0.75) * 1000);
        if (playbackEndTimeoutRef.current) clearTimeout(playbackEndTimeoutRef.current);
        playbackEndTimeoutRef.current = setTimeout(() => {
          if (isMountedRef.current && !isFadeStartedRef.current) {
            if (__DEV__) {
              console.warn("[SplashSceneGate] Playback end watchdog triggered fallback");
            }
            setTimeNearEnd(true);
            setVideoFinished(true);
          }
        }, timeoutMs);
      }
    });

    const timeSub = player.addListener("timeUpdate", (payload) => {
      // Trigger near-end once at 7.35s (650ms before 8.00s video end)
      if (payload.currentTime >= 7.35 && !hasReachedNearEndRef.current && isMountedRef.current) {
        hasReachedNearEndRef.current = true;
        setTimeNearEnd(true);
      }
    });

    const endSub = player.addListener("playToEnd", () => {
      if (isMountedRef.current) {
        hasReachedNearEndRef.current = true;
        setTimeNearEnd(true);
        setVideoFinished(true);
      }
    });

    return () => {
      statusSub.remove();
      playingSub.remove();
      timeSub.remove();
      endSub.remove();
    };
  }, [player, isReduceMotion, requestInitialPlayback, clearStartupTimers]);

  // Pause video on terminal frame ONLY after confirmed video completion (never on timeNearEnd)
  useEffect(() => {
    if (playbackStarted && videoFinished && !isSplashComplete) {
      try {
        player.pause();
      } catch (_) {
        // Player may already be paused or stopped
      }
    }
  }, [playbackStarted, videoFinished, isSplashComplete, player]);

  // Native Splash Handoff: Hide native splash ONLY when fonts are loaded AND (playback started OR static fallback active)
  useEffect(() => {
    if (hasRunSplashInProcess) return;

    const isVisualReadyToPresent = playbackStarted || videoFinished || videoError || isReduceMotion;

    if (fontsLoaded && isVisualReadyToPresent) {
      safeHideNativeSplash();
    }
  }, [fontsLoaded, playbackStarted, videoFinished, videoError, isReduceMotion, safeHideNativeSplash]);

  // Block Android hardware Back button while splash overlay is active
  useEffect(() => {
    if (isSplashComplete) return;

    const backHandler = BackHandler.addEventListener(
      "hardwareBackPress",
      () => true // Consumes the back event
    );

    return () => backHandler.remove();
  }, [isSplashComplete]);

  // Smooth Crossfade Executor (650ms ease-in-out fade out)
  const startCrossfade = useCallback((durationMs = 650) => {
    if (isFadeStartedRef.current) return;
    isFadeStartedRef.current = true;
    hasRunSplashInProcess = true;
    clearAllTimers();
    safeHideNativeSplash();

    Animated.timing(opacityAnim, {
      toValue: 0,
      duration: durationMs,
      easing: isReduceMotion ? Easing.linear : Easing.inOut(Easing.ease),
      useNativeDriver: true,
    }).start(() => {
      if (isMountedRef.current) {
        setIsSplashComplete(true);
      }
    });
  }, [isReduceMotion, opacityAnim, safeHideNativeSplash, clearAllTimers]);

  // Dismissal Coordinator: Initiates crossfade ONLY when both readiness conditions are met:
  // 1) App bootstrap is ready (fonts loaded & !isAppLoading)
  // 2) Visual scene condition met (timeNearEnd || videoFinished || videoError || isReduceMotion)
  useEffect(() => {
    if (isSplashComplete || isFadeStartedRef.current) return;

    const isAppBootstrapReady = fontsLoaded && !isAppLoading;
    const isVisualSceneReady = isReduceMotion || timeNearEnd || videoFinished || videoError;

    if (isAppBootstrapReady && isVisualSceneReady) {
      startCrossfade(isReduceMotion ? 150 : 650);
    }
  }, [fontsLoaded, isAppLoading, timeNearEnd, videoFinished, videoError, isReduceMotion, isSplashComplete, startCrossfade]);

  const isFallbackState =
    isReduceMotion ||
    videoError ||
    (videoFinished && isAppLoading) ||
    (!playbackStarted && videoFinished);

  const renderOverlayMedia = () => {
    if (Platform.OS === "android") {
      // Android production path: NEVER render hardware bitmap PNG inside opacity-animated layer
      if (playbackStarted && !videoError && !isReduceMotion) {
        // Normal video playback completed or near-end: hold VideoView terminal frame
        return (
          <VideoView
            player={player}
            style={styles.media}
            nativeControls={false}
            contentFit="cover"
            surfaceType="textureView"
          />
        );
      }
      // Playback never started, error, or reduced motion: bitmap-free solid background
      return (
        <View style={styles.fallbackBackground}>
          {isAppLoading && <ActivityIndicator size="large" color="#00E5FF" />}
        </View>
      );
    }

    // iOS path: PNG bitmap fallback or VideoView
    if (isFallbackState) {
      return (
        <Image
          source={splashFinalFrame}
          style={styles.media}
          resizeMode="cover"
          onLoad={() => {
            if (fontsLoaded) safeHideNativeSplash();
          }}
        />
      );
    }

    return (
      <VideoView
        player={player}
        style={styles.media}
        nativeControls={false}
        contentFit="cover"
        surfaceType="textureView"
      />
    );
  };

  return (
    <View style={styles.container}>
      {children}
      {!isSplashComplete && (
        <Animated.View
          style={[styles.overlay, { opacity: opacityAnim }]}
          pointerEvents="auto"
          onTouchStart={(e) => e.stopPropagation()}
        >
          {renderOverlayMedia()}
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#060C10",
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#060C10",
    zIndex: 999999,
    justifyContent: "center",
    alignItems: "center",
  },
  media: {
    width: "100%",
    height: "100%",
  },
  fallbackBackground: {
    width: "100%",
    height: "100%",
    backgroundColor: "#060C10",
    justifyContent: "center",
    alignItems: "center",
  },
});
