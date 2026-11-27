import { CUSTOM_THEME_STYLE_ID } from "@braccato/core/constants";
import { PLAYER_CONTROL_EVENT, PLAYER_TIME_EVENT, SEEK_EVENT } from "@constants";
import { AppState } from "@core/appState";
import { logCore } from "@core/logger";
import { ensureLetterWaveSetting } from "@modules/settings/letterWave";
import { setVideoQualityBoost } from "@modules/settings/videoQuality";
import {
  FULLSCREEN_WINDOW_CHANNEL,
  type FullscreenDisplayFlags,
  type FullscreenInbound,
  type FullscreenLoaderState,
  type FullscreenLyricsPayload,
  type FullscreenOutbound,
  type FullscreenPlaybackSnapshot,
  type FullscreenRatingState,
  type FullscreenTrackInfo,
  type FullscreenVideoState,
} from "@modules/ui/fullscreenWindow/messages";
import { createVideoFrameSender } from "@modules/ui/fullscreenWindow/videoTransport";
import {
  buildTrackKey,
  isUsableArtworkUrl,
  readMainAlbumColors,
  readMainSongInfo,
} from "@modules/ui/fullscreenWindow/trackInfo";
import { onLyrics } from "@modules/ui/pictureInPicture/bridge";
import {
  getPlayerVideo,
  getRatingState,
  getVolume,
  isAdPlaying,
  isVideoModeShown,
  setVolume,
  toggleLike,
  toggleMute,
} from "@modules/ui/playerControls/playerBarControls";
import { currentViewLyrics } from "@modules/lyrics/viewLyrics";
import { INSTRUMENTAL_STYLE_ATTR, readInstrumentalStyle } from "@modules/settings/instrumentalStyle";
import { AUTO_HIDE_INSTRUMENTAL_BG_ATTR } from "@modules/ui/activeReveal";
import { readRendererMode, WEBGL_LYRICS_ATTR } from "@modules/ui/rendererMode";

/**
 * The fullscreen window's link to the page it mirrors. The window runs in its own renderer process,
 * so everything it draws has to cross: the lyrics a theme change rebuilds, the player snapshot it
 * interpolates between, the theme itself, the two URLs of the artwork, opaque `bls` shader state,
 * and decoded Music Video frames via Electron's `MessagePort`.
 *
 * DOM observers, video event listeners, and the heartbeat timer are only active while a fullscreen
 * window is attached so the main YTM renderer pays zero idle overhead when the window is closed.
 */
const HEARTBEAT_TIMEOUT_MS = 15_000;
const SNAPSHOT_MIN_INTERVAL_MS = 500;
const SEEK_TOLERANCE_S = 1.5;
const PORT_REQUEST_COOLDOWN_MS = 1_000;
const BLS_STATE_EVENT = "bls:fullscreen-state";
const BLS_REQUEST_STATE_EVENT = "bls:fullscreen-request-state";
const VIDEO_PORT_MSG_TYPE = "blfw-video-port";
const VIDEO_PORT_REQUEST_TYPE = "blfw-request-video-port";
const WINDOW_CLOSED_MSG_TYPE = "blfw-window-closed";
const WINDOW_VISIBILITY_MSG_TYPE = "blfw-window-visibility";
const MERGE_THEME_STYLE_ID = "force-nankill-skibidi-theme";
const LYRICS_BLUR_DISABLED_ATTR = "blyrics-disable-lyrics-blur";
const UNBLUR_UPCOMING_LYRICS_ATTR = "blyrics-unblur-upcoming";

let initialized = false;
let disposeBridge: (() => void) | null = null;
let isAttached = false;
let isFullscreenWindowVisible = true;
let lastPingAt = 0;
let heartbeatTimer: number | null = null;
let lastLyrics: FullscreenLyricsPayload | null = null;
let lastSnapshot: FullscreenPlaybackSnapshot | null = null;
let lastSnapshotSentAt = 0;
let lastVolume: number | null | undefined;
let lastRating: FullscreenRatingState | undefined;
let hasRawTime = false;
let rawTimeS = 0;
let rawDurationS = 0;
let rawIsPlaying = false;
let rawWallTime = 0;
let lastTheme = "";
let lastMergeTheme = "";
let lastTrackKey = "";
let lastSeenVideoId: string | null = null;
let lastLoaderKey = "";
let lastBlsState: unknown = undefined;
let hasBlsState = false;
let hasVideoPort = false;
let lastVideoPortRequestAt = 0;
let lastVideoState: FullscreenVideoState = { active: false, aspectRatio: 16 / 9 };
let lastVideoStateKey = "";
let boundVideoEl: HTMLVideoElement | null = null;
let videoBindingAbort: AbortController | null = null;
const videoSender = createVideoFrameSender();

let themeObserver: MutationObserver | null = null;
let modeObserver: MutationObserver | null = null;
let artworkObserver: MutationObserver | null = null;
let observedArtworkTargets = new Set<Element>();
let barObserver: MutationObserver | null = null;
let observedBarRoot: Element | null = null;
let loaderObserver: MutationObserver | null = null;
let loaderTabObserver: MutationObserver | null = null;
let observedLoaderEl: Element | null = null;
let observedTabEl: Element | null = null;
let videoStateObserver: MutationObserver | null = null;
let observedVideoStateTargets = new Set<Element>();

function send(message: FullscreenOutbound): void {
  try {
    const result = chrome.runtime.sendMessage(message) as Promise<unknown> | undefined;
    void result?.catch(() => undefined);
  } catch {
    // No listener means the window is gone; the heartbeat handles the rest.
  }
}

function readArtworkUrl(): string | null {
  for (const selector of ["#song-image img", "#thumbnail img"]) {
    const image = document.querySelector<HTMLImageElement>(selector);
    const url = image?.currentSrc || image?.src || "";
    if (isUsableArtworkUrl(url)) return url;
  }
  return null;
}

function readAnimatedArtworkUrl(): string | null {
  const video = document.querySelector<HTMLVideoElement>("#bls-video");
  if (!video) return null;
  const url = video.currentSrc || video.getAttribute("src") || video.querySelector("source")?.getAttribute("src") || "";
  return isUsableArtworkUrl(url) ? url : null;
}

function readTrackInfo(): FullscreenTrackInfo {
  const { title, artist, album } = readMainSongInfo(document);
  const { albumColor, albumColorDark, albumColorRatio } = readMainAlbumColors(document);
  return {
    videoId: AppState.lastVideoId ?? AppState.lastLoadedVideoId,
    title,
    artist,
    album,
    artworkUrl: readArtworkUrl(),
    animatedArtworkUrl: readAnimatedArtworkUrl(),
    albumColor,
    albumColorDark,
    albumColorRatio,
  };
}

function readMergeTheme(): string {
  return document.getElementById(MERGE_THEME_STYLE_ID)?.textContent ?? "";
}

function readTheme(): string {
  return ensureLetterWaveSetting(document.getElementById(CUSTOM_THEME_STYLE_ID)?.textContent ?? "");
}

function buildSnapshotFromRaw(): FullscreenPlaybackSnapshot | null {
  if (!hasRawTime) return lastSnapshot;
  return {
    currentTimeS: rawTimeS,
    durationS: rawDurationS,
    playbackRate: AppState.playbackRate || 1,
    isPlaying: rawIsPlaying,
    wallTime: rawWallTime,
  };
}

function buildSnapshot(detail: {
  currentTime?: number | string;
  duration?: number | string;
  playing?: boolean;
  browserTime?: number;
}): FullscreenPlaybackSnapshot {
  return {
    currentTimeS: Number(detail.currentTime) || 0,
    durationS: Number(detail.duration) || 0,
    playbackRate: AppState.playbackRate || 1,
    isPlaying: detail.playing === true,
    wallTime: typeof detail.browserTime === "number" ? detail.browserTime : Date.now(),
  };
}

function publishTrackIfChanged(): void {
  if (!isAttached) return;
  const track = readTrackInfo();
  const key = buildTrackKey(track);
  if (key === lastTrackKey) return;
  lastTrackKey = key;
  send({ channel: FULLSCREEN_WINDOW_CHANNEL, type: "track", payload: track });
}

function isRelevantThemeMutation(mutations: MutationRecord[]): boolean {
  for (const mutation of mutations) {
    if (mutation.type === "characterData") {
      const parent = mutation.target.parentElement;
      if (parent && (parent.id === CUSTOM_THEME_STYLE_ID || parent.id === MERGE_THEME_STYLE_ID)) return true;
      continue;
    }
    if (mutation.target instanceof HTMLElement) {
      if (mutation.target.id === CUSTOM_THEME_STYLE_ID || mutation.target.id === MERGE_THEME_STYLE_ID) return true;
    }
    for (const node of mutation.addedNodes) {
      if (
        node instanceof HTMLElement &&
        (node.id === CUSTOM_THEME_STYLE_ID || node.id === MERGE_THEME_STYLE_ID || node.nodeName === "STYLE")
      ) {
        return true;
      }
    }
    for (const node of mutation.removedNodes) {
      if (
        node instanceof HTMLElement &&
        (node.id === CUSTOM_THEME_STYLE_ID || node.id === MERGE_THEME_STYLE_ID || node.nodeName === "STYLE")
      ) {
        return true;
      }
    }
  }
  return false;
}

function ensureThemeObserver(): void {
  if (!isAttached || themeObserver || !document.head) return;
  themeObserver = new MutationObserver(mutations => {
    if (!isAttached || !isRelevantThemeMutation(mutations)) return;
    publishTheme(readTheme());
    publishMergeTheme(readMergeTheme());
  });
  themeObserver.observe(document.head, { childList: true, subtree: true, characterData: true });
}

function readDisplayFlags(): FullscreenDisplayFlags {
  const root = document.documentElement;
  return {
    lyricsBlurDisabled: root?.hasAttribute(LYRICS_BLUR_DISABLED_ATTR) === true,
    unblurUpcoming: root?.hasAttribute(UNBLUR_UPCOMING_LYRICS_ATTR) === true,
    autoHideInstrumentalBg: root?.hasAttribute(AUTO_HIDE_INSTRUMENTAL_BG_ATTR) === true,
    instrumentalStyle: readInstrumentalStyle(document),
  };
}

function ensureModeObserver(): void {
  if (!isAttached || modeObserver || !document.documentElement) return;
  modeObserver = new MutationObserver(mutations => {
    if (!isAttached) return;
    let modeChanged = false;
    let flagsChanged = false;
    let styleChanged = false;
    for (const mutation of mutations) {
      if (mutation.attributeName === WEBGL_LYRICS_ATTR) {
        modeChanged = true;
      } else if (
        mutation.attributeName === LYRICS_BLUR_DISABLED_ATTR ||
        mutation.attributeName === UNBLUR_UPCOMING_LYRICS_ATTR ||
        mutation.attributeName === AUTO_HIDE_INSTRUMENTAL_BG_ATTR ||
        mutation.attributeName === INSTRUMENTAL_STYLE_ATTR
      ) {
        flagsChanged = true;
      } else if (mutation.attributeName === "style") {
        styleChanged = true;
      }
    }
    if (modeChanged) send({ channel: FULLSCREEN_WINDOW_CHANNEL, type: "mode", webgl: readRendererMode(document) });
    if (flagsChanged) publishDisplayFlags();
    if (styleChanged) publishTrackIfChanged();
  });
  modeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: [
      WEBGL_LYRICS_ATTR,
      LYRICS_BLUR_DISABLED_ATTR,
      UNBLUR_UPCOMING_LYRICS_ATTR,
      AUTO_HIDE_INSTRUMENTAL_BG_ATTR,
      INSTRUMENTAL_STYLE_ATTR,
      "style",
    ],
  });
}

function ensureArtworkObserver(): void {
  if (!isAttached) return;

  const songImage = document.getElementById("song-image");
  const blsVideo = document.getElementById("bls-video");
  const songInfo = document.getElementById("blyrics-song-info");
  const fsInfoRow = document.getElementById("blyrics-fs-info-row");
  const fsColumn = document.getElementById("blyrics-fs-column");
  const player = document.querySelector("ytmusic-player") ?? document.getElementById("player");
  const mainPanel = document.getElementById("main-panel");

  const nextTargets: Array<{ el: Element; options: MutationObserverInit }> = [];
  if (songImage) {
    nextTargets.push({
      el: songImage,
      options: { childList: true, subtree: true, attributes: true, attributeFilter: ["src"] },
    });
  }
  if (blsVideo) {
    nextTargets.push({
      el: blsVideo,
      options: { childList: true, attributes: true, attributeFilter: ["src"] },
    });
  }
  if (songInfo) {
    nextTargets.push({
      el: songInfo,
      options: { childList: true, subtree: true, characterData: true },
    });
  }
  // Observe direct child additions on ancestor shells so newly mounted `#bls-video`, `#song-image`,
  // or `#blyrics-song-info` nodes are picked up without observing `#movie_player` or `#blyrics-fs-controls`.
  for (const shell of [fsInfoRow, fsColumn, player, mainPanel]) {
    if (shell) nextTargets.push({ el: shell, options: { childList: true } });
  }

  let needsRebind = nextTargets.length !== observedArtworkTargets.size;
  if (!needsRebind) {
    for (const { el } of nextTargets) {
      if (!observedArtworkTargets.has(el) || !el.isConnected) {
        needsRebind = true;
        break;
      }
    }
  }
  if (needsRebind) {
    artworkObserver?.disconnect();
    observedArtworkTargets = new Set<Element>();
    if (nextTargets.length > 0) {
      artworkObserver = new MutationObserver(() => {
        ensureArtworkObserver();
        publishTrackIfChanged();
      });
      for (const { el, options } of nextTargets) {
        artworkObserver.observe(el, options);
        observedArtworkTargets.add(el);
      }
    } else {
      artworkObserver = null;
    }
  }

  const barRoot =
    document.querySelector("ytmusic-player-bar .content-info-wrapper") ??
    document.querySelector("ytmusic-player-bar .middle-controls");
  if (barRoot && (barRoot !== observedBarRoot || !observedBarRoot.isConnected)) {
    barObserver?.disconnect();
    observedBarRoot = barRoot;
    barObserver = new MutationObserver(() => publishTrackIfChanged());
    barObserver.observe(barRoot, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["src"],
    });
  }
}

function ensureVideoStateObserver(): void {
  if (!isAttached) return;
  const playerPage = document.getElementById("player-page");
  const playerBar = document.querySelector("ytmusic-player-bar");
  const moviePlayer = document.getElementById("movie_player");
  const videoContainer = moviePlayer?.querySelector(".html5-video-container") ?? null;

  const nextTargets: Array<{ el: Element; options: MutationObserverInit }> = [];
  if (playerPage) {
    nextTargets.push({
      el: playerPage,
      options: { attributes: true, attributeFilter: ["video-mode", "blyrics-video-mode"] },
    });
  }
  if (playerBar) {
    nextTargets.push({
      el: playerBar,
      options: { attributes: true, attributeFilter: ["ad-playing"] },
    });
  }
  if (moviePlayer) {
    nextTargets.push({ el: moviePlayer, options: { childList: true } });
  }
  if (videoContainer) {
    nextTargets.push({ el: videoContainer, options: { childList: true } });
  }

  let needsRebind = nextTargets.length !== observedVideoStateTargets.size;
  if (!needsRebind) {
    for (const { el } of nextTargets) {
      if (!observedVideoStateTargets.has(el) || !el.isConnected) {
        needsRebind = true;
        break;
      }
    }
  }
  if (!needsRebind) return;

  videoStateObserver?.disconnect();
  observedVideoStateTargets = new Set<Element>();
  if (nextTargets.length === 0) {
    videoStateObserver = null;
    return;
  }
  videoStateObserver = new MutationObserver(() => {
    ensureVideoStateObserver();
    syncVideoMirrorState();
  });
  for (const { el, options } of nextTargets) {
    videoStateObserver.observe(el, options);
    observedVideoStateTargets.add(el);
  }
}

function publishPlayerState(): void {
  if (!isAttached) return;
  const volume = getVolume(document);
  if (volume !== lastVolume) {
    lastVolume = volume;
    send({ channel: FULLSCREEN_WINDOW_CHANNEL, type: "volume", payload: volume });
  }
  const rating = getRatingState(document);
  if (rating !== lastRating) {
    lastRating = rating;
    send({ channel: FULLSCREEN_WINDOW_CHANNEL, type: "rating", payload: rating });
  }
}

function publishSnapshot(next: FullscreenPlaybackSnapshot): void {
  publishPlayerState();
  const previous = lastSnapshot;
  lastSnapshot = next;

  const isStateChange =
    previous === null ||
    previous.isPlaying !== next.isPlaying ||
    Math.abs(previous.currentTimeS - next.currentTimeS) > SEEK_TOLERANCE_S;
  const now = Date.now();
  if (!isStateChange && now - lastSnapshotSentAt < SNAPSHOT_MIN_INTERVAL_MS) return;

  lastSnapshotSentAt = now;
  if (!isAttached) return;
  send({ channel: FULLSCREEN_WINDOW_CHANNEL, type: "snapshot", payload: next });
}

function publishLyrics(payload: FullscreenLyricsPayload): void {
  lastLyrics = payload;
  if (!isAttached) return;
  send({ channel: FULLSCREEN_WINDOW_CHANNEL, type: "lyrics", payload });
}

function publishTheme(css: string): void {
  if (css === lastTheme) return;
  lastTheme = css;
  if (!isAttached) return;
  send({ channel: FULLSCREEN_WINDOW_CHANNEL, type: "theme", payload: css });
}

function publishMergeTheme(css: string): void {
  if (css === lastMergeTheme) return;
  lastMergeTheme = css;
  if (!isAttached) return;
  send({ channel: FULLSCREEN_WINDOW_CHANNEL, type: "merge-theme", payload: css });
}

function publishDisplayFlags(): void {
  if (!isAttached) return;
  send({ channel: FULLSCREEN_WINDOW_CHANNEL, type: "display-flags", payload: readDisplayFlags() });
}

function findPlayerMainVideo(): HTMLVideoElement | null {
  const video = getPlayerVideo(document);
  return video && video.id !== "bls-video" ? video : null;
}

function requestVideoPortIfNeeded(force = false): void {
  if (!isAttached) return;
  if (!force && hasVideoPort) return;
  const now = Date.now();
  if (!force && now - lastVideoPortRequestAt < PORT_REQUEST_COOLDOWN_MS) return;
  lastVideoPortRequestAt = now;
  window.postMessage({ type: VIDEO_PORT_REQUEST_TYPE }, window.location.origin);
}

function unbindPlayerVideoEvents(): void {
  videoBindingAbort?.abort();
  videoBindingAbort = null;
  boundVideoEl = null;
}

function bindPlayerVideoEvents(video: HTMLVideoElement | null): void {
  if (!isAttached) {
    unbindPlayerVideoEvents();
    return;
  }
  if (video === boundVideoEl) return;
  unbindPlayerVideoEvents();
  boundVideoEl = video;
  if (!video) return;
  const controller = new AbortController();
  videoBindingAbort = controller;
  const sync = (): void => syncVideoMirrorState();
  const captureNow = (): void => {
    syncVideoMirrorState();
    if (isFullscreenWindowVisible) {
      videoSender.captureOne();
    }
  };
  for (const name of ["loadedmetadata", "loadeddata", "playing", "pause", "resize", "emptied", "seeked"]) {
    video.addEventListener(name, captureNow, { signal: controller.signal });
  }
  video.addEventListener("loadstart", sync, { signal: controller.signal });
}

function syncVideoMirrorState(): void {
  if (!isAttached) return;
  const video = findPlayerMainVideo();
  bindPlayerVideoEvents(video);

  const videoModeShown = isVideoModeShown(document);
  const adPlaying = isAdPlaying(document);
  setVideoQualityBoost("fullscreen", isAttached && (videoModeShown || adPlaying));

  const videoModeActive = videoModeShown && !adPlaying;
  const playable =
    videoModeActive &&
    video !== null &&
    video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
    video.videoWidth > 0 &&
    video.videoHeight > 0;
  const aspectRatio = playable && video && video.videoHeight > 0 ? video.videoWidth / video.videoHeight : 16 / 9;

  const nextState: FullscreenVideoState = { active: playable, aspectRatio };
  const nextKey = `${nextState.active ? "1" : "0"}:${aspectRatio.toFixed(4)}`;
  lastVideoState = nextState;

  if (playable) {
    if (isFullscreenWindowVisible) {
      requestVideoPortIfNeeded(false);
      videoSender.setActive(true, video);
    } else {
      videoSender.pause();
    }
  } else {
    videoSender.setActive(false, null);
  }

  if (nextKey !== lastVideoStateKey) {
    lastVideoStateKey = nextKey;
    send({ channel: FULLSCREEN_WINDOW_CHANNEL, type: "video-state", payload: nextState });
  }
}

function readLoaderState(): FullscreenLoaderState {
  const loader = document.getElementById("blyrics-loader");
  if (!loader) return { state: "hidden", text: "", hidden: true };
  const state = loader.getAttribute("state") ?? "hidden";
  const text = loader.style.getPropertyValue("--blyrics-loader-text").trim();
  const hidden = Boolean(loader.hidden) || state === "hidden";
  return { state, text, hidden };
}

function publishLoaderIfChanged(): void {
  if (!isAttached) return;
  ensureLoaderObserver();
  const next = readLoaderState();
  const key = `${next.state}\0${next.text}\0${next.hidden ? "1" : "0"}`;
  if (key === lastLoaderKey) return;
  lastLoaderKey = key;
  send({ channel: FULLSCREEN_WINDOW_CHANNEL, type: "loader", payload: next });
}

function ensureLoaderObserver(): void {
  if (!isAttached) return;
  const tab = document.querySelector("#side-panel #tab-renderer") ?? document.getElementById("tab-renderer");
  if (tab !== observedTabEl || (observedTabEl && !observedTabEl.isConnected)) {
    loaderTabObserver?.disconnect();
    observedTabEl = tab && tab.isConnected ? tab : null;
    if (observedTabEl) {
      loaderTabObserver = new MutationObserver(() => {
        ensureLoaderObserver();
        publishLoaderIfChanged();
      });
      loaderTabObserver.observe(observedTabEl, { childList: true });
    } else {
      loaderTabObserver = null;
    }
  }
  const loader = document.getElementById("blyrics-loader");
  if (loader !== observedLoaderEl || (observedLoaderEl && !observedLoaderEl.isConnected)) {
    loaderObserver?.disconnect();
    observedLoaderEl = loader && loader.isConnected ? loader : null;
    if (observedLoaderEl) {
      loaderObserver = new MutationObserver(() => publishLoaderIfChanged());
      loaderObserver.observe(observedLoaderEl, {
        attributes: true,
        attributeFilter: ["state", "style", "hidden"],
      });
    } else {
      loaderObserver = null;
    }
  }
}

function startAttachedObservers(): void {
  ensureThemeObserver();
  ensureModeObserver();
  ensureVideoStateObserver();
  ensureArtworkObserver();
  ensureLoaderObserver();
  if (heartbeatTimer === null) {
    heartbeatTimer = window.setInterval(() => {
      if (isAttached && Date.now() - lastPingAt > HEARTBEAT_TIMEOUT_MS) detach();
    }, 5_000);
  }
}

function stopAttachedObservers(): void {
  themeObserver?.disconnect();
  themeObserver = null;
  modeObserver?.disconnect();
  modeObserver = null;
  videoStateObserver?.disconnect();
  videoStateObserver = null;
  observedVideoStateTargets.clear();
  loaderObserver?.disconnect();
  loaderObserver = null;
  loaderTabObserver?.disconnect();
  loaderTabObserver = null;
  observedLoaderEl = null;
  observedTabEl = null;
  artworkObserver?.disconnect();
  artworkObserver = null;
  observedArtworkTargets.clear();
  barObserver?.disconnect();
  barObserver = null;
  observedBarRoot = null;
  unbindPlayerVideoEvents();
  if (heartbeatTimer !== null) {
    window.clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

function attach(): void {
  lastPingAt = Date.now();
  if (isAttached) {
    startAttachedObservers();
    return;
  }
  isAttached = true;
  AppState.isFullscreenWindowOpen = true;
  lastSnapshot = buildSnapshotFromRaw();

  lastTheme = readTheme();
  lastMergeTheme = readMergeTheme();
  const initialTrack = readTrackInfo();
  lastTrackKey = buildTrackKey(initialTrack);
  lastSeenVideoId = initialTrack.videoId;
  const loader = readLoaderState();
  lastLoaderKey = `${loader.state}\0${loader.text}\0${loader.hidden ? "1" : "0"}`;
  window.dispatchEvent(new CustomEvent(BLS_REQUEST_STATE_EVENT));

  const payload = currentViewLyrics();
  lastLyrics = payload.lyrics
    ? ({
        ...payload,
        syncType: AppState.lyricData?.syncType ?? "none",
        title: AppState.lyricData?.song ?? "",
        artist: AppState.lyricData?.artist ?? "",
        providerKey: AppState.currentProviderKey,
        globalLyricOffset: AppState.globalLyricOffset,
        lyricOffset: AppState.lyricOffset,
        richsyncOffsetTrim: AppState.richsyncOffsetTrim,
        lineOffsetTrim: AppState.lineOffsetTrim,
        passiveScrollEnabled: AppState.isPassiveScrollEnabled,
        suppressZeroTimeUntil: AppState.suppressZeroTime,
      } satisfies FullscreenLyricsPayload)
    : null;

  startAttachedObservers();
  syncVideoMirrorState();
  logCore("Fullscreen window attached");
}

/**
 * Sends the whole state. Sent on every `hello` (and on reconnect `ping` after main-window reload),
 * because closing a window can race `bye` or a reload can reset `isAttached`.
 */
function sendReady(): void {
  window.dispatchEvent(new CustomEvent(BLS_REQUEST_STATE_EVENT));
  startAttachedObservers();
  syncVideoMirrorState();
  const loader = readLoaderState();
  lastLoaderKey = `${loader.state}\0${loader.text}\0${loader.hidden ? "1" : "0"}`;
  const track = readTrackInfo();
  lastTrackKey = buildTrackKey(track);
  const volume = getVolume(document);
  const rating = getRatingState(document);
  lastVolume = volume;
  lastRating = rating;
  send({
    channel: FULLSCREEN_WINDOW_CHANNEL,
    type: "ready",
    track,
    snapshot: buildSnapshotFromRaw(),
    theme: readTheme(),
    mergeTheme: readMergeTheme(),
    webgl: readRendererMode(document),
    displayFlags: readDisplayFlags(),
    lyrics: lastLyrics,
    loader,
    blsState: hasBlsState ? lastBlsState : undefined,
    video: lastVideoState,
    volume,
    rating,
  });
}

function detach(): void {
  if (!isAttached) return;
  isAttached = false;
  isFullscreenWindowVisible = true;
  hasVideoPort = false;
  lastVideoStateKey = "";
  stopAttachedObservers();
  setVideoQualityBoost("fullscreen", false);
  videoSender.stop();
  AppState.isFullscreenWindowOpen = false;
  logCore("Fullscreen window detached");
}

/**
 * Starts forwarding page state to the fullscreen window whenever one announces itself.
 * Idempotent: returns a cleanup disposer for extension teardown / reinjection.
 */
export function setupFullscreenWindowBridge(): () => void {
  if (initialized && disposeBridge) return disposeBridge;
  initialized = true;

  const onBlsState = (event: Event): void => {
    const detail = (event as CustomEvent<unknown>).detail;
    lastBlsState = detail;
    hasBlsState = true;
    if (isAttached) {
      send({ channel: FULLSCREEN_WINDOW_CHANNEL, type: "bls-state", payload: detail });
    }
  };
  window.addEventListener(BLS_STATE_EVENT, onBlsState);

  const onWindowMessage = (event: MessageEvent<{ type?: string; visible?: boolean }>): void => {
    if (event.source !== window || !event.data?.type) return;
    if (event.data.type === VIDEO_PORT_MSG_TYPE) {
      const incomingPort = event.ports?.[0];
      if (!incomingPort) return;
      hasVideoPort = true;
      videoSender.attachPort(incomingPort);
      syncVideoMirrorState();
      return;
    }
    if (event.data.type === WINDOW_CLOSED_MSG_TYPE) {
      detach();
      return;
    }
    if (event.data.type === WINDOW_VISIBILITY_MSG_TYPE) {
      const nextVisible = event.data.visible !== false;
      if (isFullscreenWindowVisible === nextVisible) return;
      isFullscreenWindowVisible = nextVisible;
      if (isAttached) {
        syncVideoMirrorState();
      }
    }
  };
  window.addEventListener("message", onWindowMessage);

  const onRuntimeMessage = (
    message: FullscreenInbound,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void
  ): undefined => {
    if (!message || message.channel !== FULLSCREEN_WINDOW_CHANNEL) return undefined;
    if (message.type === "hello") {
      // A newly opened fullscreen window gets its own renderer/MessagePort; drop stale port state.
      hasVideoPort = false;
      isFullscreenWindowVisible = true;
      attach();
      sendReady();
      if (isVideoModeShown(document) && !isAdPlaying(document)) {
        requestVideoPortIfNeeded(true);
      }
      sendResponse({ ok: true });
      return undefined;
    }
    if (message.type === "ping") {
      const wasAttached = isAttached;
      attach();
      if (!wasAttached) {
        sendReady();
        if (isVideoModeShown(document) && !isAdPlaying(document)) {
          requestVideoPortIfNeeded(true);
        }
      }
      sendResponse({ ok: true });
      return undefined;
    }
    if (message.type === "bye") {
      detach();
      sendResponse({ ok: true });
      return undefined;
    }
    if (message.type === "seek" && Number.isFinite(message.time)) {
      document.dispatchEvent(new CustomEvent(SEEK_EVENT, { detail: message.time }));
      sendResponse({ ok: true });
      return undefined;
    }
    if (message.type === "transport") {
      document.dispatchEvent(new CustomEvent(PLAYER_CONTROL_EVENT, { detail: message.action }));
      sendResponse({ ok: true });
      return undefined;
    }
    if (message.type === "volume" && Number.isFinite(message.level)) {
      setVolume(document, message.level);
      sendResponse({ ok: true });
      return undefined;
    }
    if (message.type === "mute") {
      toggleMute(document);
      sendResponse({ ok: true });
      return undefined;
    }
    if (message.type === "like") {
      toggleLike(document);
      sendResponse({ ok: true });
      return undefined;
    }
    return undefined;
  };
  chrome.runtime.onMessage.addListener(onRuntimeMessage);

  const unsubscribeLyrics = onLyrics(payload => publishLyrics(payload));

  const onPlayerTime = (event: Event): void => {
    const detail = (event as CustomEvent<Parameters<typeof buildSnapshot>[0] & { videoId?: string }>).detail;
    if (!detail) return;
    rawTimeS = Number(detail.currentTime) || 0;
    rawDurationS = Number(detail.duration) || 0;
    rawIsPlaying = detail.playing === true;
    rawWallTime = typeof detail.browserTime === "number" ? detail.browserTime : Date.now();
    hasRawTime = true;
    if (!isAttached) return;

    publishSnapshot(buildSnapshot(detail));
    const currentVideoId = typeof detail.videoId === "string" ? detail.videoId : AppState.lastVideoId;
    if (currentVideoId !== lastSeenVideoId) {
      lastSeenVideoId = currentVideoId ?? null;
      queueMicrotask(() => {
        ensureArtworkObserver();
        ensureVideoStateObserver();
        publishTrackIfChanged();
      });
    }
  };
  document.addEventListener(PLAYER_TIME_EVENT, onPlayerTime);

  let cleanedUp = false;
  const cleanup = (): void => {
    if (cleanedUp) return;
    cleanedUp = true;
    initialized = false;
    disposeBridge = null;
    window.removeEventListener(BLS_STATE_EVENT, onBlsState);
    window.removeEventListener("message", onWindowMessage);
    window.removeEventListener("pagehide", cleanup);
    document.removeEventListener(PLAYER_TIME_EVENT, onPlayerTime);
    chrome.runtime.onMessage.removeListener(onRuntimeMessage);
    unsubscribeLyrics();
    detach();
    videoSender.destroy();
  };

  window.addEventListener("pagehide", cleanup);
  disposeBridge = cleanup;
  return cleanup;
}
