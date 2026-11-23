export const VIDEO_QUALITY_SETTINGS_EVENT = "blyrics-video-quality-settings";
export const VIDEO_QUALITY_BOOST_EVENT = "blyrics-video-quality-boost";
export const VIDEO_QUALITY_REQUEST_EVENT = "blyrics-request-video-quality-settings";

export const VIDEO_QUALITIES = {
  auto: 0,
  tiny: 144,
  small: 240,
  medium: 360,
  large: 480,
  hd720: 720,
  hd1080: 1080,
  hd1440: 1440,
  hd2160: 2160,
  hd4320: 4320,
} as const;

export type VideoQuality = keyof typeof VIDEO_QUALITIES;
export interface VideoQualitySettings {
  isHighResolutionVideoEnabled: boolean;
  isOptimizedVideoQualityEnabled: boolean;
  preferredVideoQuality: VideoQuality;
}

export const DEFAULT_VIDEO_QUALITY_SETTINGS: VideoQualitySettings = {
  isHighResolutionVideoEnabled: true,
  isOptimizedVideoQualityEnabled: false,
  preferredVideoQuality: "auto",
};

export function normalizeVideoQualitySettings(
  raw: Partial<Record<keyof VideoQualitySettings, unknown>>
): VideoQualitySettings {
  return {
    isHighResolutionVideoEnabled: raw.isHighResolutionVideoEnabled !== false,
    isOptimizedVideoQualityEnabled: raw.isOptimizedVideoQualityEnabled === true,
    preferredVideoQuality:
      typeof raw.preferredVideoQuality === "string" && Object.hasOwn(VIDEO_QUALITIES, raw.preferredVideoQuality)
        ? (raw.preferredVideoQuality as VideoQuality)
        : "auto",
  };
}

const BOOSTED_VIDEO_QUALITY: VideoQuality = "hd1080";

export function selectVideoQuality(
  settings: Pick<VideoQualitySettings, "isHighResolutionVideoEnabled" | "preferredVideoQuality">,
  available: string[],
  isBoosted = false
): VideoQuality {
  if (settings.preferredVideoQuality === "auto") {
    return isBoosted
      ? selectVideoQuality({ ...settings, preferredVideoQuality: BOOSTED_VIDEO_QUALITY }, available)
      : "auto";
  }
  const ceiling = Math.min(
    VIDEO_QUALITIES[settings.preferredVideoQuality],
    settings.isHighResolutionVideoEnabled ? Infinity : 1080
  );
  const choices = (Object.keys(VIDEO_QUALITIES) as VideoQuality[])
    .filter(
      quality =>
        quality !== "auto" &&
        available.includes(quality) &&
        (settings.isHighResolutionVideoEnabled || VIDEO_QUALITIES[quality] <= 1080)
    )
    .sort((a, b) => VIDEO_QUALITIES[b] - VIDEO_QUALITIES[a]);
  return choices.find(quality => VIDEO_QUALITIES[quality] <= ceiling) ?? choices.at(-1) ?? "auto";
}

export type VideoQualityBoostSource = "pip" | "fullscreen";

export interface VideoQualityBoostCoordinator {
  setSource(source: VideoQualityBoostSource, wanted: boolean): void;
  readonly isBoosted: boolean;
}

/** Keeps video quality boost active whenever at least one auxiliary view wants video/ad playback. */
export function createVideoQualityBoostCoordinator(
  dispatchBoost: (wanted: boolean) => void
): VideoQualityBoostCoordinator {
  const sources = new Set<VideoQualityBoostSource>();
  let boosted = false;
  return {
    get isBoosted() {
      return boosted;
    },
    setSource(source: VideoQualityBoostSource, wanted: boolean): void {
      if (wanted) sources.add(source);
      else sources.delete(source);
      const next = sources.size > 0;
      if (next === boosted) return;
      boosted = next;
      dispatchBoost(next);
    },
  };
}

let defaultBoostCoordinator: VideoQualityBoostCoordinator | null = null;

export function setVideoQualityBoost(source: VideoQualityBoostSource, wanted: boolean): void {
  if (!defaultBoostCoordinator) {
    defaultBoostCoordinator = createVideoQualityBoostCoordinator(next => {
      document.dispatchEvent(new CustomEvent(VIDEO_QUALITY_BOOST_EVENT, { detail: JSON.stringify(next) }));
    });
  }
  defaultBoostCoordinator.setSource(source, wanted);
}
