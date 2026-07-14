import type { AppStateStatus } from "react-native";

interface PlaybackMusicConfig {
  enabled: boolean;
  sourceUrl: string | null;
}

export function shouldPlayBackgroundMusic(input: {
  config: PlaybackMusicConfig | null;
  localEnabled: boolean;
  appState: AppStateStatus;
  pauseForInternalMedia: boolean;
}): boolean {
  return Boolean(
    input.config?.enabled &&
      input.config.sourceUrl &&
      input.localEnabled &&
      input.appState === "active" &&
      !input.pauseForInternalMedia,
  );
}
