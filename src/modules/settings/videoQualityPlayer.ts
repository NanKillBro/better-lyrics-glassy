import { warnCore } from "@core/logger";
import {
  normalizeVideoQualitySettings,
  selectVideoQuality,
  VIDEO_QUALITY_BOOST_EVENT,
  VIDEO_QUALITY_REQUEST_EVENT,
  VIDEO_QUALITY_SETTINGS_EVENT,
  type VideoQualitySettings,
} from "@modules/settings/videoQuality";

type PlayerVars = Record<string, unknown>;
type PlayerMethod = (vars: PlayerVars, ...args: unknown[]) => unknown;
export interface VideoQualityPlayer {
  [key: string]: unknown;
  getVideoData?: () => { video_id?: string; isLive?: boolean };
  getAvailableQualityLevels?: () => string[];
  setPlaybackQualityRange?: (min: string, max: string) => void;
  getPlayerState?: () => number;
  getAdState?: () => number;
  getCurrentTime?: () => number;
  playVideo?: () => void;
  seekTo?: (seconds: number, allowSeekAhead?: boolean) => void;
  getPlayerResponse?: () => { streamingData?: { adaptiveFormats?: { height?: number }[] } };
  updateVideoData?: (vars: PlayerVars, refresh: boolean) => void;
}

const LOAD_METHODS = [
  "loadVideoByPlayerVars",
  "cueVideoByPlayerVars",
  "preloadVideoByPlayerVars",
  "queueNextVideo",
  "enqueueVideoByPlayerVars",
] as const;

export function patchVideoQualityPlayer(
  api: VideoQualityPlayer,
  settings: () => VideoQualitySettings | null,
  onPlaybackLoad: () => void = () => {}
): () => void {
  const hooks: { name: string; original: PlayerMethod; wrapped: PlayerMethod }[] = [];
  for (const name of LOAD_METHODS) {
    const original = api[name];
    if (typeof original !== "function") continue;
    const wrapped: PlayerMethod = function (this: unknown, vars, ...args) {
      const audioOnly = [true, 1, "1", "True"].includes(vars?.audio_only as never);
      const isVideo = typeof (vars?.video_id ?? vars?.videoId) === "string" && !audioOnly;
      const override = settings()?.isHighResolutionVideoEnabled && isVideo;
      if (name === "loadVideoByPlayerVars" || name === "cueVideoByPlayerVars") onPlaybackLoad();
      return Reflect.apply(original, this, [override ? { ...vars, prefer_gapless: false } : vars, ...args]);
    };
    try {
      api[name] = wrapped;
      hooks.push({ name, original: original as PlayerMethod, wrapped });
    } catch (error) {
      warnCore(`Failed to wrap ${name}`, error);
    }
  }
  return () => {
    for (const { name, original, wrapped } of hooks) {
      try {
        if (api[name] === wrapped) api[name] = original;
      } catch (error) {
        warnCore(`Failed to restore ${name}`, error);
      }
    }
  };
}

export function startVideoQualityPlayer(doc: Document = document, win: Window = window): () => void {
  let settings: VideoQualitySettings | null = null;
  let isBoosted = false;
  let disposed = false;
  let api: VideoQualityPlayer | null = null;
  let unpatch: (() => void) | undefined;
  let pending = false;
  let lastQualityKey = "";
  let initialRefreshKey = "";
  let cachedPlayerHost: (HTMLElement & { getPlayer?: () => unknown }) | null = null;
  let cachedMoviePlayer: Element | null = null;
  let cachedPlayerBar: Element | null = null;
  let checkedPlayerBar = false;
  let cachedVideo: HTMLVideoElement | null = null;
  let loadStartedAt = 0;
  let recoveryAttempts = 0;
  let lastRecoveryTime: number | null = null;
  let frozenRecoveryPolls = 0;

  const reportedFailures = new Set<string>();
  const reportFailure = (context: string, error: unknown): void => {
    if (disposed || reportedFailures.has(context)) return;
    reportedFailures.add(context);
    warnCore(context, error);
  };
  const resetPlayback = (): void => {
    lastQualityKey = "";
    initialRefreshKey = "";
    loadStartedAt = Date.now();
    recoveryAttempts = 0;
    lastRecoveryTime = null;
    frozenRecoveryPolls = 0;
  };
  const getPlayerHost = (): (HTMLElement & { getPlayer?: () => unknown }) | null => {
    if (settings?.isOptimizedVideoQualityEnabled) {
      if (!cachedPlayerHost?.isConnected) {
        cachedPlayerHost = doc.querySelector("ytmusic-player") as (HTMLElement & { getPlayer?: () => unknown }) | null;
      }
      return cachedPlayerHost;
    }
    return doc.querySelector("ytmusic-player") as (HTMLElement & { getPlayer?: () => unknown }) | null;
  };
  const isAdShowing = (): boolean => {
    if (api?.getAdState?.() === 1) return true;
    if (!settings?.isOptimizedVideoQualityEnabled) {
      return Boolean(doc.querySelector(".ad-showing, ytmusic-player-bar[is-advertisement]"));
    }
    if (getPlayerHost()?.classList.contains("ad-showing")) return true;
    if (!cachedMoviePlayer?.isConnected && typeof doc.getElementById === "function") {
      cachedMoviePlayer = doc.getElementById("movie_player");
    }
    if (cachedMoviePlayer?.classList.contains("ad-showing")) return true;
    if (cachedPlayerBar && !cachedPlayerBar.isConnected) {
      cachedPlayerBar = null;
      checkedPlayerBar = false;
    }
    if (!cachedPlayerBar && !checkedPlayerBar) {
      checkedPlayerBar = true;
      cachedPlayerBar = doc.querySelector("ytmusic-player-bar");
    }
    return cachedPlayerBar?.hasAttribute("is-advertisement") === true;
  };

  const applyQuality = (): void => {
    if (!api || !settings) return;
    try {
      if (isAdShowing()) return;
      const data = api.getVideoData?.();
      const state = api.getPlayerState?.();
      if (!data?.video_id || data.isLive || state === -1) return;
      const available = api.getAvailableQualityLevels?.() ?? [];
      if (!available.some(quality => quality !== "auto")) {
        lastQualityKey = "";
        return;
      }
      if (
        settings.isHighResolutionVideoEnabled &&
        initialRefreshKey !== data.video_id &&
        !available.some(quality => ["hd1440", "hd2160", "hd2880", "hd4320", "highres"].includes(quality)) &&
        api.getPlayerResponse?.().streamingData?.adaptiveFormats?.some(format => (format.height ?? 0) > 1080) &&
        typeof api.updateVideoData === "function"
      ) {
        initialRefreshKey = data.video_id;
        api.updateVideoData({ prefer_gapless: false }, true);
        return;
      }
      const quality = selectVideoQuality(settings, available, isBoosted);
      const key = `${data.video_id}:${available.join(",")}:${quality}`;
      if (key === lastQualityKey || typeof api.setPlaybackQualityRange !== "function") return;
      api.setPlaybackQualityRange(quality, quality);
      lastQualityKey = key;
    } catch (error) {
      reportFailure("Failed to apply playback quality", error);
    }
  };

  const recoverStalledStart = (): void => {
    if (disposed || !api || !settings?.isHighResolutionVideoEnabled || !settings.isVideoQualityStallRecoveryEnabled)
      return;
    if (recoveryAttempts > 0 || !loadStartedAt) return;
    const elapsed = Date.now() - loadStartedAt;
    if (elapsed < 2000 || elapsed > 10000) return;
    try {
      if (isAdShowing()) return;
      const state = api.getPlayerState?.();
      const time = api.getCurrentTime?.() ?? cachedVideo?.currentTime;
      if (typeof time !== "number" || time > 2) {
        lastRecoveryTime = typeof time === "number" ? time : null;
        frozenRecoveryPolls = 0;
        return;
      }
      if (lastRecoveryTime !== null && Math.abs(time - lastRecoveryTime) < 0.05) frozenRecoveryPolls++;
      else frozenRecoveryPolls = 0;
      lastRecoveryTime = time;
      if (frozenRecoveryPolls < 2) return;
      if (state !== 1 && state !== -1 && state !== 3 && state !== 5) return;
      recoveryAttempts++;
      if (typeof api.seekTo === "function") api.seekTo(0, true);
      else if (cachedVideo) cachedVideo.currentTime = 0;
      if (typeof api.playVideo === "function") api.playVideo();
      else cachedVideo?.play().catch(error => reportFailure("Failed to resume stalled video", error));
    } catch (error) {
      reportFailure("Failed to recover stalled video", error);
    }
  };

  const connect = (fromPoll = false): void => {
    if (disposed || pending || !settings) return;
    if (fromPoll && settings.isOptimizedVideoQualityEnabled && api && cachedPlayerHost?.isConnected) {
      return;
    }
    checkedPlayerBar = false;
    const host = getPlayerHost();
    if (typeof host?.getPlayer !== "function") return;
    pending = true;
    try {
      Promise.resolve(host.getPlayer())
        .then(value => {
          if (disposed || !host.isConnected || !value || typeof value !== "object") return;
          const next = value as VideoQualityPlayer;
          if (typeof next.loadVideoByPlayerVars !== "function") return;
          if (next !== api) {
            unpatch?.();
            api = next;
            unpatch = patchVideoQualityPlayer(api, () => settings, resetPlayback);
            resetPlayback();
          }
          observer.disconnect();
          applyQuality();
        })
        .catch(error => reportFailure("Failed to connect to Music player", error))
        .finally(() => {
          pending = false;
        });
    } catch (error) {
      reportFailure("Failed to connect to Music player", error);
      pending = false;
    }
  };

  const receive = (event: Event): void => {
    try {
      const raw: unknown = JSON.parse((event as CustomEvent<string>).detail);
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
      const next = normalizeVideoQualitySettings(raw);
      if (next.isHighResolutionVideoEnabled !== settings?.isHighResolutionVideoEnabled) initialRefreshKey = "";
      if (!next.isOptimizedVideoQualityEnabled) {
        cachedPlayerHost = null;
        cachedMoviePlayer = null;
        cachedPlayerBar = null;
        checkedPlayerBar = false;
      }
      settings = next;
      lastQualityKey = "";
      connect(false);
    } catch (error) {
      reportFailure("Failed to read video quality settings", error);
    }
  };
  const receiveBoost = (event: Event): void => {
    try {
      const raw: unknown = JSON.parse((event as CustomEvent<string>).detail);
      if (typeof raw !== "boolean") throw new TypeError(`Expected a boolean, got ${typeof raw}`);
      if (raw === isBoosted) return;
      isBoosted = raw;
      lastQualityKey = "";
      connect(false);
    } catch (error) {
      reportFailure("Failed to read video quality boost", error);
    }
  };
  const onLoadedMetadata = (event: Event): void => {
    const target = event.target as Element | null;
    if (target?.tagName !== "VIDEO") return;
    if (settings?.isOptimizedVideoQualityEnabled) {
      const host = getPlayerHost();
      if (!host?.contains(target)) return;
    } else if (!target.closest("ytmusic-player")) {
      return;
    }
    cachedVideo = target as HTMLVideoElement;
    lastQualityKey = "";
    applyQuality();
  };
  const onNavigateFinish = (): void => {
    connect(false);
  };
  const onPoll = (): void => {
    if (!pending && settings?.isOptimizedVideoQualityEnabled && api && cachedPlayerHost?.isConnected) {
      applyQuality();
      recoverStalledStart();
      return;
    }
    connect(true);
    recoverStalledStart();
  };
  doc.addEventListener(VIDEO_QUALITY_SETTINGS_EVENT, receive);
  doc.addEventListener(VIDEO_QUALITY_BOOST_EVENT, receiveBoost);
  doc.addEventListener("yt-navigate-finish", onNavigateFinish);
  doc.addEventListener("loadedmetadata", onLoadedMetadata, true);
  const observer = new MutationObserver(() => connect(false));
  observer.observe(doc, { childList: true, subtree: true });
  const interval = win.setInterval(onPoll, 1000);
  doc.dispatchEvent(new Event(VIDEO_QUALITY_REQUEST_EVENT));
  return () => {
    disposed = true;
    observer.disconnect();
    win.clearInterval(interval);
    unpatch?.();
    cachedPlayerHost = null;
    cachedMoviePlayer = null;
    cachedPlayerBar = null;
    cachedVideo = null;
    doc.removeEventListener(VIDEO_QUALITY_SETTINGS_EVENT, receive);
    doc.removeEventListener(VIDEO_QUALITY_BOOST_EVENT, receiveBoost);
    doc.removeEventListener("yt-navigate-finish", onNavigateFinish);
    doc.removeEventListener("loadedmetadata", onLoadedMetadata, true);
  };
}
