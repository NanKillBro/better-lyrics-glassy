import { CUSTOM_THEME_STYLE_ID } from "@braccato/core/constants";
import { PLAYER_TIME_EVENT, SEEK_EVENT } from "@constants";
import { AppState } from "@core/appState";
import { logCore } from "@core/logger";
import { ensureLetterWaveSetting } from "@modules/settings/letterWave";
import { setVideoQualityBoost } from "@modules/settings/videoQuality";
import {
  FULLSCREEN_WINDOW_CHANNEL,
  type FullscreenInbound,
  type FullscreenLoaderState,
  type FullscreenLyricsPayload,
  type FullscreenOutbound,
  type FullscreenPlaybackSnapshot,
  type FullscreenTrackInfo,
  type FullscreenVideoState,
} from "@modules/ui/fullscreenWindow/messages";
import { createVideoFrameSender } from "@modules/ui/fullscreenWindow/videoTransport";
import { buildTrackKey, readMainAlbumColors, readMainSongInfo } from "@modules/ui/fullscreenWindow/trackInfo";
import { onLyrics } from "@modules/ui/pictureInPicture/bridge";
import { getPlayerVideo, isAdPlaying, isVideoModeShown } from "@modules/ui/playerControls/playerBarControls";
import { COMPOSITE_LYRICS_ATTR, readRendererMode } from "@modules/ui/rendererMode";
import { currentViewLyrics } from "@modules/lyrics/viewLyrics";

/**
 * The fullscreen window's link to the page it mirrors. The window runs in its own renderer process,
 * so everything it draws has to cross: the lyrics a theme change rebuilds, the player snapshot it
 * interpolates between, the theme itself, the two URLs of the artwork, opaque `bls` shader state,
 * and decoded Music Video frames via Electron's `MessagePort`.
 *
 * Liveness is a heartbeat rather than a port: an extension page cannot hold a long-lived connection
 * to a content script, and a window that crashed must not leave the main window's lyric engine
 * parked forever.
 */
const HEARTBEAT_TIMEOUT_MS = 15_000;
const SNAPSHOT_MIN_INTERVAL_MS = 500;
const SEEK_TOLERANCE_S = 1.5;
const PORT_REQUEST_COOLDOWN_MS = 1_000;
const BLS_STATE_EVENT = "bls:fullscreen-state";
const BLS_REQUEST_STATE_EVENT = "bls:fullscreen-request-state";
const VIDEO_PORT_MSG_TYPE = "blfw-video-port";
const VIDEO_PORT_REQUEST_TYPE = "blfw-request-video-port";

let initialized = false;
let isAttached = false;
let lastPingAt = 0;
let heartbeatTimer: number | null = null;
let lastLyrics: FullscreenLyricsPayload | null = null;
let lastSnapshot: FullscreenPlaybackSnapshot | null = null;
let lastSnapshotSentAt = 0;
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
let unsubscribeLyrics: (() => void) | null = null;
let artworkObserver: MutationObserver | null = null;
let observedArtworkRoot: Element | null = null;
let barObserver: MutationObserver | null = null;
let observedBarRoot: Element | null = null;
let loaderObserver: MutationObserver | null = null;
let loaderTabObserver: MutationObserver | null = null;
let observedLoaderEl: Element | null = null;
let observedTabEl: Element | null = null;
let videoStateObserver: MutationObserver | null = null;

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
    if (url) return url;
  }
  return null;
}

function readAnimatedArtworkUrl(): string | null {
  const video = document.querySelector<HTMLVideoElement>("#bls-video");
  if (!video) return null;
  const url = video.currentSrc || video.getAttribute("src") || video.querySelector("source")?.getAttribute("src") || "";
  return url || null;
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
  return document.getElementById("force-nankill-skibidi-theme")?.textContent ?? "";
}

function readTheme(): string {
  return ensureLetterWaveSetting(document.getElementById(CUSTOM_THEME_STYLE_ID)?.textContent ?? "");
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

function ensureArtworkObserver(): void {
  const root =
    document.getElementById("main-panel") ?? document.querySelector("ytmusic-player") ?? document.getElementById("player");
  if (root && (root !== observedArtworkRoot || !observedArtworkRoot.isConnected)) {
    artworkObserver?.disconnect();
    observedArtworkRoot = root;
    artworkObserver = new MutationObserver(() => publishTrackIfChanged());
    artworkObserver.observe(root, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["src"],
    });
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

function publishSnapshot(next: FullscreenPlaybackSnapshot): void {
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

function publishMode(): void {
  if (!isAttached) return;
  send({ channel: FULLSCREEN_WINDOW_CHANNEL, type: "mode", payload: readRendererMode(document) });
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
  window.postMessage({ type: VIDEO_PORT_REQUEST_TYPE }, "*");
}

function bindPlayerVideoEvents(video: HTMLVideoElement | null): void {
  if (video === boundVideoEl) return;
  videoBindingAbort?.abort();
  videoBindingAbort = null;
  boundVideoEl = video;
  if (!video) return;
  const controller = new AbortController();
  videoBindingAbort = controller;
  const sync = (): void => syncVideoMirrorState();
  const captureNow = (): void => {
    syncVideoMirrorState();
    videoSender.captureOne();
  };
  for (const name of ["loadedmetadata", "loadeddata", "playing", "pause", "resize", "emptied"]) {
    video.addEventListener(name, captureNow, { signal: controller.signal });
  }
  video.addEventListener("seeked", captureNow, { signal: controller.signal });
  video.addEventListener("loadstart", sync, { signal: controller.signal });
}

function syncVideoMirrorState(): void {
  const video = findPlayerMainVideo();
  bindPlayerVideoEvents(video);

  const videoModeShown = isVideoModeShown(document);
  const adPlaying = isAdPlaying(document);
  setVideoQualityBoost("fullscreen", isAttached && (videoModeShown || adPlaying));

  const videoModeActive = videoModeShown && !adPlaying;
  const playable =
    isAttached &&
    videoModeActive &&
    video !== null &&
    video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
    video.videoWidth > 0 &&
    video.videoHeight > 0;
  const aspectRatio =
    playable && video && video.videoHeight > 0 ? video.videoWidth / video.videoHeight : 16 / 9;

  const nextState: FullscreenVideoState = { active: playable, aspectRatio };
  const nextKey = `${nextState.active ? "1" : "0"}:${aspectRatio.toFixed(4)}`;
  lastVideoState = nextState;

  if (playable) {
    requestVideoPortIfNeeded(false);
    videoSender.setActive(true, video);
  } else {
    videoSender.setActive(false, null);
  }

  if (nextKey !== lastVideoStateKey) {
    lastVideoStateKey = nextKey;
    if (isAttached) {
      send({ channel: FULLSCREEN_WINDOW_CHANNEL, type: "video-state", payload: nextState });
    }
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
  ensureLoaderObserver();
  const next = readLoaderState();
  const key = `${next.state}\0${next.text}\0${next.hidden ? "1" : "0"}`;
  if (key === lastLoaderKey) return;
  lastLoaderKey = key;
  if (!isAttached) return;
  send({ channel: FULLSCREEN_WINDOW_CHANNEL, type: "loader", payload: next });
}

function ensureLoaderObserver(): void {
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
    }
  }
}

function attach(): void {
  lastPingAt = Date.now();
  ensureArtworkObserver();
  ensureLoaderObserver();
  if (isAttached) return;
  isAttached = true;
  AppState.isFullscreenWindowOpen = true;

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

  syncVideoMirrorState();
  logCore("Fullscreen window attached");
}

/**
 * Sends the whole state. Sent on every `hello`, not only on attach: closing a window can race the
 * `bye` message, leaving this side believing a window is still open. The next window's `hello` must
 * still receive the theme and lyrics, or it renders with the default theme.
 */
function sendReady(): void {
  window.dispatchEvent(new CustomEvent(BLS_REQUEST_STATE_EVENT));
  ensureLoaderObserver();
  syncVideoMirrorState();
  const loader = readLoaderState();
  lastLoaderKey = `${loader.state}\0${loader.text}\0${loader.hidden ? "1" : "0"}`;
  const track = readTrackInfo();
  lastTrackKey = buildTrackKey(track);
  send({
    channel: FULLSCREEN_WINDOW_CHANNEL,
    type: "ready",
    track,
    snapshot: lastSnapshot,
    theme: readTheme(),
    mergeTheme: readMergeTheme(),
    composite: readRendererMode(document),
    lyrics: lastLyrics,
    loader,
    blsState: hasBlsState ? lastBlsState : undefined,
    video: lastVideoState,
  });
}

function detach(): void {
  if (!isAttached) return;
  isAttached = false;
  hasVideoPort = false;
  lastVideoStateKey = "";
  setVideoQualityBoost("fullscreen", false);
  videoSender.stop();
  AppState.isFullscreenWindowOpen = false;
  logCore("Fullscreen window detached");
}

/**
 * Starts forwarding page state to the fullscreen window whenever one announces itself.
 * Idempotent: the extension entry may be re-run when the page is re-initialised.
 */
export function setupFullscreenWindowBridge(): void {
  if (initialized) return;
  initialized = true;

  window.addEventListener(BLS_STATE_EVENT, (event: Event) => {
    const detail = (event as CustomEvent<unknown>).detail;
    lastBlsState = detail;
    hasBlsState = true;
    if (isAttached) {
      send({ channel: FULLSCREEN_WINDOW_CHANNEL, type: "bls-state", payload: detail });
    }
  });

  window.addEventListener("message", (event: MessageEvent<{ type?: string }>) => {
    if (event.source !== window || event.data?.type !== VIDEO_PORT_MSG_TYPE) return;
    const incomingPort = event.ports?.[0];
    if (!incomingPort) return;
    hasVideoPort = true;
    videoSender.attachPort(incomingPort);
    syncVideoMirrorState();
  });

  chrome.runtime.onMessage.addListener((message: FullscreenInbound, _sender, sendResponse) => {
    if (!message || message.channel !== FULLSCREEN_WINDOW_CHANNEL) return undefined;
    if (message.type === "hello") {
      // A newly opened fullscreen window gets its own renderer/MessagePort; drop stale port state.
      hasVideoPort = false;
      attach();
      sendReady();
      if (isVideoModeShown(document) && !isAdPlaying(document)) {
        requestVideoPortIfNeeded(true);
      }
      sendResponse({ ok: true });
      return undefined;
    }
    if (message.type === "ping") {
      attach();
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
    }
    return undefined;
  });

  unsubscribeLyrics = onLyrics(payload => publishLyrics(payload));

  document.addEventListener(PLAYER_TIME_EVENT, (event: Event) => {
    const detail = (event as CustomEvent<Parameters<typeof buildSnapshot>[0] & { videoId?: string }>).detail;
    if (!detail) return;
    publishSnapshot(buildSnapshot(detail));
    const currentVideoId = typeof detail.videoId === "string" ? detail.videoId : AppState.lastVideoId;
    if (currentVideoId !== lastSeenVideoId) {
      lastSeenVideoId = currentVideoId ?? null;
      queueMicrotask(() => {
        ensureArtworkObserver();
        publishTrackIfChanged();
      });
    }
  });

  const themeObserver = new MutationObserver(() => {
    publishTheme(readTheme());
    publishMergeTheme(readMergeTheme());
  });
  themeObserver.observe(document.head, { childList: true, subtree: true, characterData: true });

  const modeObserver = new MutationObserver(mutations => {
    let modeChanged = false;
    let styleChanged = false;
    for (const mutation of mutations) {
      if (mutation.attributeName === COMPOSITE_LYRICS_ATTR) modeChanged = true;
      else if (mutation.attributeName === "style") styleChanged = true;
    }
    if (modeChanged) publishMode();
    if (styleChanged) publishTrackIfChanged();
  });
  modeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: [COMPOSITE_LYRICS_ATTR, "style"],
  });

  videoStateObserver = new MutationObserver(() => syncVideoMirrorState());
  const playerPage = document.getElementById("player-page");
  if (playerPage) {
    videoStateObserver.observe(playerPage, {
      attributes: true,
      attributeFilter: ["video-mode", "blyrics-video-mode"],
    });
  }
  const playerBar = document.querySelector("ytmusic-player-bar");
  if (playerBar) {
    videoStateObserver.observe(playerBar, { attributes: true, attributeFilter: ["ad-playing"] });
  }
  const moviePlayer = document.getElementById("movie_player");
  if (moviePlayer) {
    videoStateObserver.observe(moviePlayer, { childList: true, subtree: true });
  }

  ensureArtworkObserver();
  ensureLoaderObserver();

  heartbeatTimer = window.setInterval(() => {
    if (isAttached && Date.now() - lastPingAt > HEARTBEAT_TIMEOUT_MS) detach();
  }, 5_000);

  window.addEventListener("pagehide", () => {
    unsubscribeLyrics?.();
    themeObserver.disconnect();
    modeObserver.disconnect();
    videoStateObserver?.disconnect();
    videoStateObserver = null;
    loaderObserver?.disconnect();
    loaderObserver = null;
    loaderTabObserver?.disconnect();
    loaderTabObserver = null;
    observedLoaderEl = null;
    observedTabEl = null;
    videoBindingAbort?.abort();
    videoBindingAbort = null;
    boundVideoEl = null;
    videoSender.destroy();
    artworkObserver?.disconnect();
    artworkObserver = null;
    observedArtworkRoot = null;
    barObserver?.disconnect();
    barObserver = null;
    observedBarRoot = null;
    if (heartbeatTimer !== null) window.clearInterval(heartbeatTimer);
    heartbeatTimer = null;
    detach();
  });
}
