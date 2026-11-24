import { CUSTOM_THEME_STYLE_ID } from "@braccato/core/constants";
import type { Lyric } from "@braccato/core";
import { applyLyricDecorations } from "@modules/lyrics/lyricDecorations";
import { hasSameRenderedLyrics } from "@modules/ui/fullscreenWindow/lyricsEquality";
import { SharpenMarker } from "@modules/ui/fullscreenWindow/sharpenMarker";
import { isUsableArtworkUrl } from "@modules/ui/fullscreenWindow/trackInfo";
import { createVideoFrameReceiver, type VideoFrameReceiver } from "@modules/ui/fullscreenWindow/videoTransport";
import { initGlassyFlowBridge } from "@modules/ui/glassyFlowBridge";
import { createLyricsView } from "@modules/ui/lyricsRenderer";
import { LEGACY_RENDERER_CSS_PATH, syncRendererModeStylesheets } from "@modules/ui/rendererMode";
import { loadWebglRenderer } from "@modules/ui/webglRendererWasm";
import {
  createFullscreenPlayerControls,
  type FullscreenPlayerControlsHandle,
} from "@modules/ui/fullscreenWindow/playerControls";
import { createProgressBar, type ProgressBarHandle } from "@modules/ui/playerControls/progressBar";
import {
  FULLSCREEN_WINDOW_CHANNEL,
  type FullscreenDisplayFlags,
  type FullscreenInbound,
  type FullscreenLoaderState,
  type FullscreenLyricsPayload,
  type FullscreenOutbound,
  type FullscreenPlaybackSnapshot,
  type FullscreenTrackInfo,
  type FullscreenVideoState,
} from "@modules/ui/fullscreenWindow/messages";

const PING_INTERVAL_MS = 4_000;
const ARTWORK_CROSSFADE_MS = 600;
const ARTWORK_FORCE_VISIBLE_MS = 5_000;
const BG_UPDATE_CROSSFADE_DELAY_MS = 1_000;
const BLS_STATE_EVENT = "bls:fullscreen-state";
const BLS_MEDIA_EVENT = "bls:fullscreen-media";
const BLS_VISIBILITY_EVENT = "bls:fullscreen-visibility";
const VIDEO_PORT_MSG_TYPE = "blfw-video-port";
const WINDOW_VISIBILITY_MSG_TYPE = "blfw-window-visibility";
const WINDOW_FULLSCREEN_STATE_MSG_TYPE = "blfw-window-fullscreen-state";
const WINDOW_OPTIONS_MSG_TYPE = "blfw-window-options";
const TEXT_ENTRY_TARGETS = "input, textarea, select, [contenteditable]";
const SEEK_BLOCKING_TARGETS = "input, textarea, select, [contenteditable], [role='slider'], .blyrics-volume";
function closestFromTarget(target: EventTarget | null, selector: string): boolean {
  return target instanceof Element && Boolean(target.closest(selector));
}
const MERGE_THEME_STYLE_ID = "blfw-merge-theme";
const LYRICS_BLUR_DISABLED_ATTR = "blyrics-disable-lyrics-blur";
const UNBLUR_UPCOMING_LYRICS_ATTR = "blyrics-unblur-upcoming";
const SCROLL_SCRIPTS: Record<string, string> = {
  "glassyflow-turbo": "/glassyflow-turbo.js",
  "glassyflow-super": "/glassyflow-super.js",
};
const searchParams = new URLSearchParams(window.location.search);
const scrollMode = searchParams.get("scroll") ?? "";
const hasGlassyFlowScroll = scrollMode in SCROLL_SCRIPTS;
const debugEnabled = searchParams.get("debug") === "1";

declare global {
  interface Window {
    __blsLastState?: unknown;
    blfwHost?: {
      toggleFullscreen?: () => void;
      setZoom?: (factor: number) => void;
    };
  }
}

type Renderer = ReturnType<typeof createLyricsView>;

interface Elements {
  readonly shell: HTMLElement;
  readonly layout: HTMLElement;
  readonly page: HTMLElement;
  readonly artImage: HTMLImageElement;
  readonly artNext: HTMLImageElement;
  readonly artVideo: HTMLVideoElement;
  readonly artVideoNext: HTMLVideoElement;
  readonly mvVideo: HTMLVideoElement;
  readonly title: HTMLElement;
  readonly artist: HTMLElement;
  readonly songInfo: HTMLElement;
  readonly fsColumn: HTMLElement;
  readonly loader: HTMLElement;
  readonly mount: HTMLElement;
  readonly scroll: HTMLElement;
  readonly progress: HTMLElement;
  readonly status: HTMLElement;
}

let elements: Elements;
let renderer: Renderer | null = null;
let payload: FullscreenLyricsPayload | null = null;
let loaderState: FullscreenLoaderState = { state: "hidden", text: "", hidden: true };
let hasReceivedReady = false;
let snapshot: FullscreenPlaybackSnapshot | null = null;
let themeCss = "";
let mergeThemeCss = "";
let webglMode = false;
let lastVideoId: string | null = null;
let artFront = 0;
let hasCommittedArt = false;
let artGeneration = 0;
let colorGeneration = 0;
let artCleanupTimer: number | null = null;
let artSafetyTimer: number | null = null;
let bgUpdateTimer: number | null = null;
let artUrl: string | null = null;
let animatedUrl: string | null = null;
let desiredAnimatedUrl: string | null = null;
let artVideoFront = 0;
let animatedArtGeneration = 0;
let animatedArtRemoveTimer: number | null = null;
let animatedArtSafetyTimer: number | null = null;
let appliedArtistKey = "";
let scrollScriptInjected = false;
let flipInstalled = false;
let modeQueue: Promise<void> = Promise.resolve();
let forceSharpenImmediate = false;
let videoMirrorDesired = false;
let hasDecodedVideoFrame = false;
let videoAspectRatio = 16 / 9;
let videoReceiver: VideoFrameReceiver | null = null;
let cursorIdleTimer: number | null = null;
let pingTimer: number | null = null;
let songInfoAnimation: Animation | null = null;
let isWindowVisible = document.visibilityState === "visible";
let rafId: number | null = null;
let progressBar: ProgressBarHandle | null = null;
let timelineEnabled = searchParams.get("timeline") === "1";
let playerControls: FullscreenPlayerControlsHandle | null = null;
const sharpenMarker = new SharpenMarker();

function isGlassyFlowActive(): boolean {
  return !webglMode && hasGlassyFlowScroll;
}

function reportDebug(): void {
  const box = document.getElementById("blfw-debug");
  if (!box) return;
  const lines = elements.mount.querySelectorAll(".blyrics--line").length;
  const first = elements.mount.querySelector<HTMLElement>(".blyrics--line");
  const rect = first?.getBoundingClientRect();
  box.textContent = [
    `theme=${themeCss.length} merge=${mergeThemeCss.length}`,
    `lyrics=${payload?.lyrics?.length ?? "none"} lines=${lines}`,
    `panel=${elements.scroll.getBoundingClientRect().width}x${elements.scroll.getBoundingClientRect().height}`,
    `mount=${elements.mount.getBoundingClientRect().width}x${elements.mount.getBoundingClientRect().height}`,
    `wrapper=${document.getElementById("blyrics-wrapper")?.getBoundingClientRect().height ?? "-"}`,
    `firstLine=${rect ? `${Math.round(rect.x)},${Math.round(rect.y)} ${Math.round(rect.width)}x${Math.round(rect.height)}` : "none"}`,
    `webgl=${Boolean(renderer?.renderer)} canvas=${Boolean(elements.mount.querySelector("canvas"))} sync=${payload?.syncType ?? "-"}`,
    `mergeStyle=${document.getElementById(MERGE_THEME_STYLE_ID)?.textContent?.length ?? 0}`,
    `scrollTop=${Math.round(elements.scroll.scrollTop)} scrollH=${Math.round(elements.scroll.scrollHeight)}`,
    `active=${elements.mount.querySelectorAll(".blyrics--active").length} activeY=${Math.round(
      elements.mount.querySelector<HTMLElement>(".blyrics--active")?.getBoundingClientRect().top ?? -1
    )}`,
  ].join("\n");
}

function queryElements(): Elements {
  const get = <T extends Element>(selector: string): T => {
    const element = document.querySelector<T>(selector);
    if (!element) throw new Error(`Fullscreen window is missing ${selector}`);
    return element;
  };
  return {
    shell: get("#blfw-shell"),
    layout: get("#layout"),
    page: get("#player-page"),
    artImage: get("#blfw-art-image"),
    artNext: get("#blfw-art-image-next"),
    artVideo: get("#blfw-art-video"),
    artVideoNext: get("#blfw-art-video-next"),
    mvVideo: get("#blfw-mv-video"),
    title: get("#blyrics-title"),
    artist: get("#blyrics-artist"),
    songInfo: get("#blyrics-song-info"),
    fsColumn: get("#blyrics-fs-column"),
    loader: get("#blyrics-loader"),
    mount: get("#blyrics-wrapper"),
    scroll: get("#tab-renderer"),
    progress: get("#blfw-progress"),
    status: get("#blfw-status"),
  };
}

function sendToContent(message: FullscreenInbound): void {
  void (async () => {
    try {
      const tabs = await chrome.tabs.query({ url: "*://music.youtube.com/*" });
      if (tabs.length === 0) {
        showStatus("Open the player window to feed this one.");
        return;
      }
      await Promise.all(
        tabs.map(tab => (tab.id === undefined ? Promise.resolve() : chrome.tabs.sendMessage(tab.id, message)))
      );
      hideStatus();
    } catch {
      showStatus("Better Lyrics is not reachable from the player window.");
    }
  })();
}

function showStatus(text: string): void {
  if (!elements) return;
  elements.status.textContent = text;
  elements.status.hidden = false;
}

function hideStatus(): void {
  if (!elements) return;
  elements.status.hidden = true;
}

function publishBlsState(detail: unknown): void {
  if (detail === undefined) return;
  window.__blsLastState = detail;
  window.dispatchEvent(new CustomEvent(BLS_STATE_EVENT, { detail }));
}

function syncVideoModeUi(): void {
  if (!elements) return;
  const showVideo = videoMirrorDesired && hasDecodedVideoFrame;
  document.documentElement.style.setProperty("--blyrics-video-aspect-ratio", String(videoAspectRatio));
  elements.page.toggleAttribute("video-mode", showVideo);
  elements.page.toggleAttribute("blyrics-video-mode", showVideo);
  elements.layout.toggleAttribute("blyrics-video-mode", showVideo);
}

function applyVideoState(state?: FullscreenVideoState): void {
  if (!state) return;
  videoMirrorDesired = state.active;
  if (Number.isFinite(state.aspectRatio) && state.aspectRatio > 0) {
    videoAspectRatio = state.aspectRatio;
  }
  if (!state.active) {
    hasDecodedVideoFrame = false;
    videoReceiver?.clear();
  }
  syncVideoModeUi();
}

function setBackgroundImageDelayed(url: string, delayMs: number): void {
  if (bgUpdateTimer !== null) {
    window.clearTimeout(bgUpdateTimer);
    bgUpdateTimer = null;
  }
  const apply = (): void => {
    const escaped = url.replace(/"/g, "%22");
    elements.layout.style.setProperty("--blyrics-background-img", `url("${escaped}")`);
  };
  if (delayMs <= 0) {
    apply();
  } else {
    bgUpdateTimer = window.setTimeout(() => {
      bgUpdateTimer = null;
      apply();
    }, delayMs);
  }
}

function clearArtworkTimers(): void {
  if (artCleanupTimer !== null) {
    window.clearTimeout(artCleanupTimer);
    artCleanupTimer = null;
  }
  if (artSafetyTimer !== null) {
    window.clearTimeout(artSafetyTimer);
    artSafetyTimer = null;
  }
}

function applyArtworkCrossfade(nextUrl: string, onApplied?: () => void): void {
  if (!isUsableArtworkUrl(nextUrl)) {
    return;
  }

  const gen = ++artGeneration;
  clearArtworkTimers();

  const layers = [elements.artImage, elements.artNext];
  const current = layers[artFront];
  const isCrossfade = hasCommittedArt && Boolean(current.src);

  const incomingIndex = isCrossfade ? 1 - artFront : artFront;
  const incoming = layers[incomingIndex];
  const outgoing = isCrossfade ? current : null;

  incoming.onload = null;
  incoming.onerror = null;

  if (outgoing) {
    outgoing.classList.remove("blfw-art--incoming", "is-visible");
    outgoing.classList.add("blfw-art--outgoing");
  }

  incoming.classList.remove("blfw-art--outgoing", "is-visible");
  incoming.style.transition = "none";
  incoming.style.opacity = isCrossfade ? "0" : "1";
  incoming.classList.toggle("blfw-art--incoming", isCrossfade);

  const finalizeSwap = (): void => {
    if (gen !== artGeneration) return;
    clearArtworkTimers();
    hasCommittedArt = true;
    artFront = incomingIndex;
    elements.artImage.classList.remove("blfw-art--loading");
    elements.artNext.classList.remove("blfw-art--loading");
    setBackgroundImageDelayed(nextUrl, isCrossfade ? BG_UPDATE_CROSSFADE_DELAY_MS : 0);

    if (isCrossfade) {
      incoming.style.transition = "";
      void window.getComputedStyle(incoming).opacity;
      incoming.style.opacity = "";
      incoming.classList.add("is-visible");
      onApplied?.();
      artCleanupTimer = window.setTimeout(() => {
        if (gen !== artGeneration) return;
        artCleanupTimer = null;
        if (outgoing) {
          outgoing.style.transition = "";
          outgoing.style.opacity = "";
          outgoing.classList.remove("is-visible", "blfw-art--outgoing", "blfw-art--incoming");
        }
        incoming.classList.remove("blfw-art--incoming");
      }, ARTWORK_CROSSFADE_MS + 50);
    } else {
      incoming.style.transition = "";
      incoming.style.opacity = "";
      incoming.classList.add("is-visible");
      const other = layers[1 - incomingIndex];
      other.style.transition = "";
      other.style.opacity = "";
      other.classList.remove("is-visible", "blfw-art--outgoing", "blfw-art--incoming");
      onApplied?.();
    }
  };

  if (isCrossfade) {
    artSafetyTimer = window.setTimeout(() => {
      if (gen !== artGeneration) return;
      artSafetyTimer = null;
      incoming.onload = null;
      incoming.onerror = null;
      incoming.style.transition = "";
      incoming.style.opacity = "";
      incoming.classList.add("is-visible");
      incoming.classList.remove("blfw-art--incoming");
      if (outgoing) {
        outgoing.style.transition = "";
        outgoing.style.opacity = "";
        outgoing.classList.remove("is-visible", "blfw-art--outgoing", "blfw-art--incoming");
      }
      hasCommittedArt = true;
      artFront = incomingIndex;
      setBackgroundImageDelayed(nextUrl, BG_UPDATE_CROSSFADE_DELAY_MS);
      onApplied?.();
    }, ARTWORK_FORCE_VISIBLE_MS);
  }

  incoming.onload = () => {
    incoming.onload = null;
    incoming.onerror = null;
    finalizeSwap();
  };
  incoming.onerror = () => {
    incoming.onload = null;
    incoming.onerror = null;
    if (gen !== artGeneration) return;
    incoming.classList.remove("blfw-art--loading");
  };

  incoming.src = nextUrl;
  if (incoming.complete && incoming.naturalWidth > 0) {
    incoming.onload = null;
    incoming.onerror = null;
    finalizeSwap();
  }
}

function animateSongInfo(): void {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  songInfoAnimation?.cancel();
  songInfoAnimation = elements.songInfo.animate(
    [
      { transform: "translateY(64px)", opacity: 0 },
      { transform: "translateY(0)", opacity: 1 },
    ],
    {
      duration: 500,
      easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
      fill: "both",
    }
  );
}

function applyMainAlbumColors(track: FullscreenTrackInfo): boolean {
  const root = document.documentElement.style;
  if (track.albumColor) root.setProperty("--ytmusic-album-color", track.albumColor);
  if (track.albumColorDark) root.setProperty("--ytmusic-album-color-dark", track.albumColorDark);
  if (track.albumColorRatio) root.setProperty("--ytmusic-album-color-ratio", track.albumColorRatio);
  return Boolean(track.albumColor || track.albumColorDark);
}

function artVideoAt(index: number): HTMLVideoElement {
  return index === 0 ? elements.artVideo : elements.artVideoNext;
}

function clearArtVideo(video: HTMLVideoElement): void {
  video.oncanplay = null;
  video.onerror = null;
  video.classList.remove("is-visible");
  video.pause();
  video.removeAttribute("src");
  video.load();
}

function stopAnimatedArtwork(): void {
  animatedUrl = null;
  animatedArtGeneration += 1;
  if (animatedArtRemoveTimer !== null) {
    window.clearTimeout(animatedArtRemoveTimer);
    animatedArtRemoveTimer = null;
  }
  if (animatedArtSafetyTimer !== null) {
    window.clearTimeout(animatedArtSafetyTimer);
    animatedArtSafetyTimer = null;
  }
  const front = artVideoAt(artVideoFront);
  clearArtVideo(artVideoAt(1 - artVideoFront));
  front.classList.remove("is-visible");
  animatedArtRemoveTimer = window.setTimeout(() => {
    animatedArtRemoveTimer = null;
    elements.shell.removeAttribute("data-animated-art");
    clearArtVideo(front);
  }, 650);
}

function startAnimatedArtwork(url: string): void {
  animatedUrl = url;
  const generation = ++animatedArtGeneration;
  if (animatedArtRemoveTimer !== null) {
    window.clearTimeout(animatedArtRemoveTimer);
    animatedArtRemoveTimer = null;
  }
  if (animatedArtSafetyTimer !== null) {
    window.clearTimeout(animatedArtSafetyTimer);
    animatedArtSafetyTimer = null;
  }

  const frontIndex = artVideoFront;
  const incomingIndex = 1 - frontIndex;
  const front = artVideoAt(frontIndex);
  const incoming = artVideoAt(incomingIndex);

  incoming.style.transition = "none";
  clearArtVideo(incoming);
  void incoming.offsetWidth;
  incoming.style.transition = "";
  incoming.muted = true;
  incoming.loop = true;
  incoming.playsInline = true;
  incoming.crossOrigin = "anonymous";
  incoming.onerror = () => {
    if (generation !== animatedArtGeneration) return;
    stopAnimatedArtwork();
  };
  incoming.oncanplay = () => {
    if (generation !== animatedArtGeneration) return;
    incoming.oncanplay = null;
    incoming.onerror = null;
    if (animatedArtSafetyTimer !== null) {
      window.clearTimeout(animatedArtSafetyTimer);
      animatedArtSafetyTimer = null;
    }
    front.id = "blfw-art-video-next";
    incoming.id = "blfw-art-video";
    artVideoFront = incomingIndex;
    incoming.classList.add("is-visible");
    front.classList.remove("is-visible");
    elements.shell.setAttribute("data-animated-art", "true");
    void incoming.play().catch(() => undefined);
    animatedArtRemoveTimer = window.setTimeout(() => {
      animatedArtRemoveTimer = null;
      if (generation !== animatedArtGeneration) return;
      clearArtVideo(front);
    }, 650);
  };
  incoming.src = url;
  incoming.load();
  void incoming.play().catch(() => undefined);
  animatedArtSafetyTimer = window.setTimeout(() => {
    animatedArtSafetyTimer = null;
    if (generation === animatedArtGeneration) stopAnimatedArtwork();
  }, 6000);
}

function applyTrack(next: FullscreenTrackInfo | null): void {
  if (!next) return;
  const previousVideoId = lastVideoId;
  const titleChanged = Boolean(next.title) && next.title !== elements.title.textContent;
  if (next.videoId !== lastVideoId) {
    lastVideoId = next.videoId;
    elements.artImage.classList.add("blfw-art--loading");
  }
  // Empty strings arrive while a new track is still resolving; keep the previous text instead.
  if (titleChanged) {
    elements.title.textContent = next.title;
  }
  if (next.artist || next.album) {
    const nextArtistKey = `${next.artist}\0${next.album}`;
    if (nextArtistKey !== appliedArtistKey) {
      appliedArtistKey = nextArtistKey;
      elements.artist.replaceChildren();
      if (next.artist) {
        elements.artist.append(document.createTextNode(next.artist));
      }
      if (next.album) {
        const albumEl = document.createElement("span");
        albumEl.id = "blyrics-album";
        albumEl.textContent = next.artist ? ` · ${next.album}` : next.album;
        elements.artist.appendChild(albumEl);
      }
    }
  } else if (next.videoId === null && appliedArtistKey !== "") {
    appliedArtistKey = "";
    elements.artist.replaceChildren();
  }

  const nextArtworkUrl = isUsableArtworkUrl(next.artworkUrl) ? next.artworkUrl : null;
  const artworkChanged = Boolean(nextArtworkUrl) && nextArtworkUrl !== artUrl;
  desiredAnimatedUrl = next.animatedArtworkUrl;

  const hasMainColors = applyMainAlbumColors(next);
  if (hasMainColors) {
    colorGeneration += 1;
  }
  const applyArtworkSideEffects = (url: string): void => {
    elements.shell.setAttribute("data-blfw-artwork", url);
    elements.shell.style.setProperty("--blfw-art", `url("${url.replace(/"/g, "%22")}")`);
    elements.shell.setAttribute("data-has-art", "true");
    if (!hasMainColors) applyArtworkColors(url);
    window.dispatchEvent(new CustomEvent(BLS_MEDIA_EVENT, { detail: { artworkUrl: url } }));
    if (!desiredAnimatedUrl && animatedUrl !== null) stopAnimatedArtwork();
  };

  if (artworkChanged && nextArtworkUrl) {
    artUrl = nextArtworkUrl;
    applyArtworkCrossfade(nextArtworkUrl, () => applyArtworkSideEffects(nextArtworkUrl));
  } else if (!desiredAnimatedUrl && animatedUrl !== null) {
    stopAnimatedArtwork();
  }

  if (next.animatedArtworkUrl) {
    if (next.animatedArtworkUrl !== animatedUrl) startAnimatedArtwork(next.animatedArtworkUrl);
  }

  if (previousVideoId !== null && titleChanged) {
    animateSongInfo();
  }
}

function applyTimelineEnabled(enabled: boolean): void {
  timelineEnabled = enabled;
  if (enabled) {
    document.documentElement.setAttribute("data-blfw-timeline", "true");
  } else {
    document.documentElement.removeAttribute("data-blfw-timeline");
  }
  if (!elements) return;
  if (!enabled) {
    progressBar?.destroy();
    progressBar = null;
    elements.progress.replaceChildren();
    return;
  }
  if (progressBar) return;
  progressBar = createProgressBar({
    doc: document,
    getSnapshot: () => snapshot,
    onSeek: seconds => sendToContent({ channel: FULLSCREEN_WINDOW_CHANNEL, type: "seek", time: seconds }),
  });
  elements.progress.replaceChildren(progressBar.element);
}

function ensureMergeTheme(): void {
  let style = document.getElementById(MERGE_THEME_STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement("style");
    style.id = MERGE_THEME_STYLE_ID;
    document.head.appendChild(style);
  } else if (document.head.lastElementChild !== style) {
    // Keep the merge theme after `#blyrics-custom-style`, matching the main window.
    document.head.appendChild(style);
  }
  if (style.textContent !== mergeThemeCss) {
    style.textContent = mergeThemeCss;
    if (webglMode) renderer?.relayout();
  }
}

function applyDisplayFlags(flags?: FullscreenDisplayFlags): void {
  if (!flags) return;
  const root = document.documentElement;
  const blurChanged = root.hasAttribute(LYRICS_BLUR_DISABLED_ATTR) !== flags.lyricsBlurDisabled;
  const upcomingChanged = root.hasAttribute(UNBLUR_UPCOMING_LYRICS_ATTR) !== flags.unblurUpcoming;
  root.toggleAttribute(LYRICS_BLUR_DISABLED_ATTR, flags.lyricsBlurDisabled);
  root.toggleAttribute(UNBLUR_UPCOMING_LYRICS_ATTR, flags.unblurUpcoming);
  if ((blurChanged || upcomingChanged) && webglMode) {
    renderer?.relayout();
  }
}

function enforceGlassyFlowScrollVars(container: HTMLElement | null): void {
  const active = isGlassyFlowActive();
  if (elements?.shell) {
    elements.shell.toggleAttribute("data-glassyflow", active);
  }
  if (active) {
    document.documentElement.style.setProperty("--blyrics-animate-scroll", "0", "important");
    document.documentElement.style.setProperty("--blyrics-lyric-scroll-duration", "0ms", "important");
    if (elements?.mount) {
      elements.mount.style.setProperty("--blyrics-animate-scroll", "0", "important");
      elements.mount.style.setProperty("--blyrics-lyric-scroll-duration", "0ms", "important");
    }
    if (container && !container.classList.contains("brs-layout")) {
      container.style.setProperty("--blyrics-animate-scroll", "0", "important");
      container.style.setProperty("--blyrics-lyric-scroll-duration", "0ms", "important");
    }
    return;
  }
  document.documentElement.style.removeProperty("--blyrics-animate-scroll");
  document.documentElement.style.removeProperty("--blyrics-lyric-scroll-duration");
  if (elements?.mount) {
    elements.mount.style.removeProperty("--blyrics-animate-scroll");
    elements.mount.style.removeProperty("--blyrics-lyric-scroll-duration");
  }
  if (container) {
    container.style.removeProperty("--blyrics-animate-scroll");
    container.style.removeProperty("--blyrics-lyric-scroll-duration");
  }
}

async function applyMode(nextWebgl: boolean): Promise<void> {
  webglMode = nextWebgl;
  await syncRendererModeStylesheets(document, webglMode, chrome.runtime.getURL(LEGACY_RENDERER_CSS_PATH), {
    anchorHref: "/css/blyrics/index.css",
    beforeId: MERGE_THEME_STYLE_ID,
  });
  enforceGlassyFlowScrollVars(renderer?.container ?? null);
}

function ensureScrollScript(): void {
  if (scrollScriptInjected || !isGlassyFlowActive()) return;
  const src = SCROLL_SCRIPTS[scrollMode];
  /* GlassyFlow owns the scroll while it is injected, so the renderer's own scroll animation has to
     be switched off before the first theme cache / layout tick runs. */
  enforceGlassyFlowScrollVars(null);
  scrollScriptInjected = true;
  const script = document.createElement("script");
  script.src = src;
  script.defer = true;
  document.head.appendChild(script);
}

/**
 * GlassyFlow does not read `scrollTop`; it reads the counter-transform BL writes on the container in
 * the same assignment, then zeroes it and takes over the motion. This mirrors `lyricsHost.ts:342-373`.
 */
function installGlassyFlowFlip(): void {
  if (flipInstalled) return;
  flipInstalled = true;
  const scroller = elements.scroll;
  const descriptor =
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(scroller), "scrollTop") ??
    Object.getOwnPropertyDescriptor(Element.prototype, "scrollTop");
  if (!descriptor?.get || !descriptor.set) return;
  const read = descriptor.get;
  const write = descriptor.set;

  Object.defineProperty(scroller, "scrollTop", {
    configurable: true,
    enumerable: descriptor.enumerable ?? true,
    get(this: HTMLElement) {
      return read.call(this);
    },
    set(this: HTMLElement, value: number) {
      const previous = read.call(this);
      if (value === previous || (value <= 0 && previous === 0)) return;
      const container = elements.mount.querySelector<HTMLElement>(".blyrics-container");
      write.call(this, value);
      if (!isGlassyFlowActive() || !container || container.classList.contains("brs-layout") || !container.classList.contains("blyrics--gf-managed")) {
        return;
      }
      const inlineAnimate = container.style.getPropertyValue("--blyrics-animate-scroll").trim();
      const animateScroll =
        inlineAnimate ||
        (isGlassyFlowActive() ? "0" : getComputedStyle(container).getPropertyValue("--blyrics-animate-scroll").trim());
      if (animateScroll !== "0") return;
      const delta = read.call(this) - previous;
      if (delta === 0) return;
      container.style.transition = "none";
      container.style.transform = `translate(0px, ${delta}px)`;
    },
  });
}

function ensureRenderer(): Renderer | null {
  if (renderer) return renderer;
  if (!elements?.mount) return null;
  loadWebglRenderer();
  enforceGlassyFlowScrollVars(null);
  renderer = createLyricsView({
    document,
    window,
    mount: elements.mount,
    host: {
      isViewVisible: () => true,
      isLoaderActive: () => false,
      syncAdState: () => false,
      getScrollElement: () => elements.scroll,
      setResumeAffordanceVisible: () => undefined,
      seek(timeS: number) {
        sendToContent({ channel: FULLSCREEN_WINDOW_CHANNEL, type: "seek", time: timeS });
      },
      log: (...args: unknown[]) => console.log("[blfw]", ...args),
    },
  });
  initGlassyFlowBridge(renderer, { isViewVisible: () => isWindowVisible });
  return renderer;
}

function applyTheme(rebuildOnChange = true): void {
  const target = ensureRenderer();
  if (!target) {
    ensureMergeTheme();
    return;
  }
  enforceGlassyFlowScrollVars(target.container);
  const rebuilt = target.setTheme(themeCss);
  ensureMergeTheme();
  enforceGlassyFlowScrollVars(target.container);
  if (rebuilt && rebuildOnChange) buildLyrics();
}

function isLoaderVisible(state: FullscreenLoaderState = loaderState): boolean {
  return !state.hidden && state.state !== "hidden";
}

function syncNoLyricsAttribute(): void {
  if (!elements) return;
  const loaderShowing = isLoaderVisible();
  const isNoLyrics =
    !loaderShowing && Boolean(payload?.lyrics && payload.lyrics.length > 0 && payload.noLyrics === true);
  elements.page.toggleAttribute("blyrics-no-lyrics", isNoLyrics);
}

function applyLoader(next?: FullscreenLoaderState): void {
  if (!next || !elements) return;
  const wasHidden = elements.loader.hidden || elements.loader.getAttribute("state") === "hidden";
  loaderState = next;
  if (next.text) {
    elements.loader.style.setProperty("--blyrics-loader-text", next.text);
  } else {
    elements.loader.style.removeProperty("--blyrics-loader-text");
  }
  const showing = isLoaderVisible(next);
  if (showing && wasHidden) {
    elements.loader.setAttribute("state", "hidden");
    void elements.loader.offsetWidth;
    elements.loader.hidden = false;
  }
  elements.loader.setAttribute("state", next.state || "hidden");
  elements.loader.hidden = !showing;
  if (showing) elements.status.hidden = true;
  syncNoLyricsAttribute();
}

function buildLyrics(): void {
  const target = ensureRenderer();
  const current = payload;
  if (!target) return;
  sharpenMarker.reset();
  forceSharpenImmediate = true;
  const loaderShowing = isLoaderVisible();
  syncNoLyricsAttribute();
  const lyrics: Lyric[] | null = current?.lyrics ? [...current.lyrics] : null;
  if (!lyrics || lyrics.length === 0) {
    target.clear();
    syncTickLoop();
    if (loaderShowing || !hasReceivedReady || !current) {
      elements.status.hidden = true;
    } else {
      elements.status.textContent = "No lyrics for this track";
      elements.status.hidden = false;
    }
    return;
  }
  elements.status.hidden = true;
  target.setLyrics(lyrics, {
    loaderVisible: loaderShowing,
    noLyrics: current?.noLyrics === true,
    language: current?.language,
    songwriters: current?.songwriters,
  });
  if (current) applyLyricDecorations(target, current.decorations);
  target.relayout();
  enforceGlassyFlowScrollVars(target.container);
  ensureScrollScript();
  runSingleTick();
  syncTickLoop();
}

function currentTimeFrom(live: FullscreenPlaybackSnapshot): number {
  const elapsed = live.isPlaying ? (Math.max(0, Date.now() - live.wallTime) * live.playbackRate) / 1000 : 0;
  return Math.min(live.currentTimeS + elapsed, live.durationS || Number.POSITIVE_INFINITY);
}

let lastTickAt = 0;

function runSingleTick(now = performance.now()): void {
  const target = renderer;
  const live = snapshot;
  if (!isWindowVisible || !target || !live || !payload?.lyrics) return;
  lastTickAt = now;
  const time = currentTimeFrom(live);
  const suppressZero = time <= 0.05 && Date.now() < (payload.suppressZeroTimeUntil ?? 0);
  if (!suppressZero) {
    target.tick(time, {
      eventCreationTime: Date.now(),
      playbackRate: live.playbackRate,
      isPlaying: live.isPlaying,
      smoothScroll: !isGlassyFlowActive(),
      globalLyricOffset: payload.globalLyricOffset,
      lyricOffset: payload.lyricOffset,
      richsyncOffsetTrim: payload.richsyncOffsetTrim,
      lineOffsetTrim: payload.lineOffsetTrim,
      passiveScrollEnabled: payload.passiveScrollEnabled,
    });
    if (!webglMode) {
      sharpenMarker.sync(elements.mount, time, forceSharpenImmediate);
    }
    forceSharpenImmediate = false;
  }
}

function syncTickLoop(): void {
  const wantLoop = isWindowVisible && Boolean(renderer && snapshot && payload?.lyrics && snapshot.isPlaying);
  if (wantLoop) {
    if (rafId === null) {
      rafId = window.requestAnimationFrame(tick);
    }
  } else if (rafId !== null) {
    window.cancelAnimationFrame(rafId);
    rafId = null;
  }
}

function tick(): void {
  rafId = null;
  if (!isWindowVisible || !renderer || !snapshot || !payload?.lyrics || !snapshot.isPlaying) {
    return;
  }
  const now = performance.now();
  if (now - lastTickAt >= 15) {
    runSingleTick(now);
  }
  rafId = window.requestAnimationFrame(tick);
}

function enqueueWork(task: () => Promise<void> | void): void {
  modeQueue = modeQueue.then(task).catch(error => console.error("[blfw] queue", error));
}

function handleMessage(message: FullscreenOutbound): void {
  if (!message || message.channel !== FULLSCREEN_WINDOW_CHANNEL) return;
  switch (message.type) {
    case "ready":
      hasReceivedReady = true;
      themeCss = message.theme;
      mergeThemeCss = message.mergeTheme;
      applyDisplayFlags(message.displayFlags);
      publishBlsState(message.blsState);
      applyVideoState(message.video);
      applyLoader(message.loader);
      applyTrack(message.track);
      if (message.snapshot) {
        snapshot = message.snapshot;
        playerControls?.setPlaying(message.snapshot.isPlaying);
      }
      playerControls?.setVolume(message.volume ?? null);
      playerControls?.setRating(message.rating ?? null);
      if (message.lyrics) payload = message.lyrics;
      enqueueWork(async () => {
        await applyMode(Boolean(message.webgl));
        applyTheme(false);
        if (message.lyrics) buildLyrics();
      });
      hideStatus();
      break;
    case "loader":
      applyLoader(message.payload);
      break;
    case "lyrics":
      enqueueWork(() => {
        const previous = payload;
        payload = message.payload;
        if (previous && renderer && renderer.lines.length > 0 && hasSameRenderedLyrics(previous, payload)) {
          renderer.setLanguage(payload.language);
          applyLyricDecorations(renderer, payload.decorations);
          renderer.relayout();
          enforceGlassyFlowScrollVars(renderer.container);
          forceSharpenImmediate = true;
          runSingleTick();
          syncTickLoop();
          return;
        }
        buildLyrics();
      });
      break;
    case "snapshot":
      snapshot = message.payload;
      playerControls?.setPlaying(message.payload.isPlaying);
      runSingleTick();
      syncTickLoop();
      break;
    case "track":
      applyTrack(message.payload);
      break;
    case "bls-state":
      publishBlsState(message.payload);
      break;
    case "video-state":
      applyVideoState(message.payload);
      break;
    case "volume":
      playerControls?.setVolume(message.payload);
      break;
    case "rating":
      playerControls?.setRating(message.payload);
      break;
    case "theme":
      themeCss = message.payload;
      enqueueWork(() => applyTheme());
      break;
    case "merge-theme":
      mergeThemeCss = message.payload;
      ensureMergeTheme();
      break;
    case "mode":
      enqueueWork(async () => {
        await applyMode(message.webgl);
        applyTheme(false);
        if (payload) buildLyrics();
      });
      break;
    case "display-flags":
      applyDisplayFlags(message.payload);
      break;
    case "unavailable":
      showStatus(message.reason);
      break;
  }
}

/** YTM sets these itself on its html element; the theme reads them for offsets and card tint. */
function applyBaseVariables(): void {
  const root = document.documentElement.style;
  root.setProperty("--menu-bar-height", "32px");
  root.setProperty("--ytmusic-nav-bar-height", "64px");
  root.setProperty("--ytmusic-player-page-vertical-padding", "64px");
  enforceGlassyFlowScrollVars(null);
}

/** A 8x8 downscale is a cheap average, and gives the theme the artwork tint it expects. */
function applyArtworkColors(url: string): void {
  const gen = ++colorGeneration;
  const image = new Image();
  image.crossOrigin = "anonymous";
  image.onload = () => {
    if (gen !== colorGeneration) return;
    try {
      const canvas = document.createElement("canvas");
      canvas.width = 8;
      canvas.height = 8;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) return;
      context.drawImage(image, 0, 0, 8, 8);
      const data = context.getImageData(0, 0, 8, 8).data;
      let r = 0;
      let g = 0;
      let b = 0;
      const pixels = data.length / 4;
      for (let i = 0; i < data.length; i += 4) {
        r += data[i];
        g += data[i + 1];
        b += data[i + 2];
      }
      r = Math.round(r / pixels);
      g = Math.round(g / pixels);
      b = Math.round(b / pixels);
      const root = document.documentElement.style;
      root.setProperty("--ytmusic-album-color", `${r}, ${g}, ${b}`);
      root.setProperty(
        "--ytmusic-album-color-dark",
        `${Math.round(r * 0.58)}, ${Math.round(g * 0.58)}, ${Math.round(b * 0.58)}`
      );
    } catch {
      // A tainted canvas just leaves the theme on its fallback colour.
    }
  };
  image.src = url;
}

const CURSOR_IDLE_MS = 1500;
let windowFullscreenBtn: HTMLButtonElement | null = null;
let hasWindowFullscreenBridge = false;
let isPointerInside = false;
let isCursorIdle = false;

function setPointerInside(inside: boolean): void {
  if (isPointerInside === inside) return;
  isPointerInside = inside;
  if (inside) {
    document.documentElement.setAttribute("data-pointer-inside", "true");
  } else {
    document.documentElement.removeAttribute("data-pointer-inside");
  }
}

function setCursorIdle(idle: boolean): void {
  if (isCursorIdle === idle) return;
  isCursorIdle = idle;
  if (idle) {
    document.documentElement.setAttribute("data-cursor-idle", "true");
  } else {
    document.documentElement.removeAttribute("data-cursor-idle");
  }
}

function resetCursorIdle(markInside = true): void {
  if (markInside) setPointerInside(true);
  setCursorIdle(false);
  if (cursorIdleTimer !== null) window.clearTimeout(cursorIdleTimer);
  cursorIdleTimer = window.setTimeout(() => {
    cursorIdleTimer = null;
    setCursorIdle(true);
  }, CURSOR_IDLE_MS);
}

function clearPointerPresence(): void {
  setPointerInside(false);
  setCursorIdle(false);
  if (cursorIdleTimer !== null) {
    window.clearTimeout(cursorIdleTimer);
    cursorIdleTimer = null;
  }
}

function syncFullscreenButtonState(fullscreen: boolean): void {
  document.documentElement.toggleAttribute("data-window-fullscreen", fullscreen);
  if (!windowFullscreenBtn) return;
  const label = fullscreen ? "Exit fullscreen" : "Enter fullscreen";
  windowFullscreenBtn.title = fullscreen ? "Exit fullscreen (F11 / Esc)" : "Enter fullscreen (F11)";
  windowFullscreenBtn.setAttribute("aria-label", label);
  windowFullscreenBtn.setAttribute("aria-pressed", fullscreen ? "true" : "false");
}

function toggleWindowFullscreen(): void {
  if (typeof window.blfwHost?.toggleFullscreen === "function") {
    window.blfwHost.toggleFullscreen();
    return;
  }
  if (document.fullscreenElement) {
    void document.exitFullscreen();
  } else {
    void document.documentElement.requestFullscreen?.();
  }
}

const ZOOM_STORAGE_KEY = "blfw-zoom";
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2;
const ZOOM_STEP = 0.1;

function readStoredZoom(): number {
  try {
    const raw = window.localStorage.getItem(ZOOM_STORAGE_KEY);
    const parsed = raw === null ? Number.NaN : Number.parseFloat(raw);
    return Number.isFinite(parsed) ? parsed : 1;
  } catch {
    return 1;
  }
}

function clampZoom(value: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(value * 100) / 100));
}

function setupZoomControls(): void {
  const reset = document.getElementById("blfw-zoom-reset") as HTMLButtonElement | null;
  const zoomOut = document.getElementById("blfw-zoom-out") as HTMLButtonElement | null;
  const zoomIn = document.getElementById("blfw-zoom-in") as HTMLButtonElement | null;
  if (!reset || !zoomOut || !zoomIn) return;

  let factor = clampZoom(readStoredZoom());

  const apply = (next: number, persist = true): void => {
    factor = clampZoom(next);
    if (typeof window.blfwHost?.setZoom === "function") {
      window.blfwHost.setZoom(factor);
    } else {
      document.documentElement.style.setProperty("zoom", String(factor));
    }
    const label = `Reset zoom to 100% (currently ${Math.round(factor * 100)}%)`;
    reset.title = label;
    reset.setAttribute("aria-label", label);
    if (!persist) return;
    try {
      window.localStorage.setItem(ZOOM_STORAGE_KEY, String(factor));
    } catch {
      /* Storage is unavailable in an opaque origin; the factor still applies for this session. */
    }
  };

  zoomOut.addEventListener("click", event => {
    apply(factor - ZOOM_STEP);
    if (event.detail > 0) zoomOut.blur();
  });
  zoomIn.addEventListener("click", event => {
    apply(factor + ZOOM_STEP);
    if (event.detail > 0) zoomIn.blur();
  });
  reset.addEventListener("click", event => {
    apply(1);
    if (event.detail > 0) reset.blur();
  });

  apply(factor, false);
}

function start(): void {
  loadWebglRenderer();
  elements = queryElements();
  applyBaseVariables();
  ensureScrollScript();
  const controlsHost = document.getElementById("blfw-player-controls");
  if (controlsHost) {
    playerControls = createFullscreenPlayerControls({
      container: controlsHost,
      send: sendToContent,
      labels: {
        previous: "Previous",
        play: "Play",
        pause: "Pause",
        next: "Next",
        like: "Like",
        volume: "Volume",
        mute: "Mute",
      },
    });
  }
  applyTimelineEnabled(timelineEnabled);
  videoReceiver = createVideoFrameReceiver(
    elements.mvVideo,
    aspect => {
      if (Number.isFinite(aspect) && aspect > 0) videoAspectRatio = aspect;
      hasDecodedVideoFrame = true;
      syncVideoModeUi();
    },
    () => {
      hasDecodedVideoFrame = false;
      syncVideoModeUi();
    }
  );
  const applyWindowVisibility = (visible: boolean): void => {
    if (isWindowVisible === visible) return;
    isWindowVisible = visible;
    window.dispatchEvent(new CustomEvent(BLS_VISIBILITY_EVENT, { detail: { visible } }));
    if (visible) {
      forceSharpenImmediate = true;
      runSingleTick();
    }
    syncTickLoop();
  };

  window.addEventListener(
    "message",
    (
      event: MessageEvent<{
        type?: string;
        visible?: boolean;
        fullscreen?: boolean;
        showTimeline?: boolean;
      }>
    ) => {
      if (event.source !== window || !event.data?.type) return;
      if (event.data.type === VIDEO_PORT_MSG_TYPE) {
        const incomingPort = event.ports?.[0];
        if (incomingPort) videoReceiver?.attachPort(incomingPort);
        return;
      }
      if (event.data.type === WINDOW_VISIBILITY_MSG_TYPE && typeof event.data.visible === "boolean") {
        applyWindowVisibility(event.data.visible);
        return;
      }
      if (event.data.type === WINDOW_FULLSCREEN_STATE_MSG_TYPE && typeof event.data.fullscreen === "boolean") {
        hasWindowFullscreenBridge = true;
        syncFullscreenButtonState(event.data.fullscreen);
        return;
      }
      if (event.data.type === WINDOW_OPTIONS_MSG_TYPE && typeof event.data.showTimeline === "boolean") {
        applyTimelineEnabled(event.data.showTimeline);
      }
    }
  );
  document.addEventListener("visibilitychange", () => {
    applyWindowVisibility(document.visibilityState === "visible");
  });
  document.addEventListener("fullscreenchange", () => {
    if (!hasWindowFullscreenBridge) {
      syncFullscreenButtonState(Boolean(document.fullscreenElement));
    }
  });
  installGlassyFlowFlip();

  const onPointerActive = (): void => resetCursorIdle(true);
  if (document.documentElement.matches(":hover")) {
    resetCursorIdle(true);
  }
  document.documentElement.addEventListener("mouseenter", onPointerActive, { passive: true });
  document.getElementById("blfw-drag")?.addEventListener("mouseenter", onPointerActive, { passive: true });
  document.documentElement.addEventListener("mouseleave", clearPointerPresence, { passive: true });
  window.addEventListener("blur", clearPointerPresence);
  window.addEventListener("pointermove", onPointerActive, { passive: true });
  window.addEventListener("pointerdown", onPointerActive, { passive: true });
  window.addEventListener("wheel", onPointerActive, { passive: true });

  windowFullscreenBtn = document.getElementById("blfw-fullscreen") as HTMLButtonElement | null;
  windowFullscreenBtn?.addEventListener("click", event => {
    toggleWindowFullscreen();
    if (event.detail > 0) windowFullscreenBtn?.blur();
  });
  document.getElementById("blfw-close")?.addEventListener("click", () => window.close());
  setupZoomControls();
  elements.artImage.addEventListener("load", () => elements.artImage.classList.remove("blfw-art--loading"));
  elements.artImage.addEventListener("error", () => elements.artImage.classList.remove("blfw-art--loading"));

  if (debugEnabled) {
    document.documentElement.setAttribute("data-debug", "true");
    window.setInterval(reportDebug, 500);
  }

  ensureMergeTheme();
  enqueueWork(() => applyMode(webglMode));

  chrome.runtime.onMessage.addListener((message: FullscreenOutbound) => {
    handleMessage(message);
    return undefined;
  });

  sendToContent({ channel: FULLSCREEN_WINDOW_CHANNEL, type: "hello" });
  pingTimer = window.setInterval(
    () => sendToContent({ channel: FULLSCREEN_WINDOW_CHANNEL, type: "ping" }),
    PING_INTERVAL_MS
  );

  window.setTimeout(() => {
    if (!payload && !snapshot) showStatus("Waiting for the player window...");
  }, 3_000);

  window.addEventListener("pagehide", () => {
    clearArtworkTimers();
    playerControls?.destroy();
    playerControls = null;
    progressBar?.destroy();
    progressBar = null;
    if (rafId !== null) {
      window.cancelAnimationFrame(rafId);
      rafId = null;
    }
    if (pingTimer !== null) {
      window.clearInterval(pingTimer);
      pingTimer = null;
    }
    if (bgUpdateTimer !== null) {
      window.clearTimeout(bgUpdateTimer);
      bgUpdateTimer = null;
    }
    if (cursorIdleTimer !== null) {
      window.clearTimeout(cursorIdleTimer);
      cursorIdleTimer = null;
    }
    if (animatedArtRemoveTimer !== null) {
      window.clearTimeout(animatedArtRemoveTimer);
      animatedArtRemoveTimer = null;
    }
    if (animatedArtSafetyTimer !== null) {
      window.clearTimeout(animatedArtSafetyTimer);
      animatedArtSafetyTimer = null;
    }
    document.documentElement.removeAttribute("data-cursor-idle");
    document.documentElement.removeAttribute("data-pointer-inside");
    document.documentElement.removeAttribute("data-window-fullscreen");
    clearArtVideo(elements.artVideo);
    clearArtVideo(elements.artVideoNext);
    videoReceiver?.destroy();
    videoReceiver = null;
    sendToContent({ channel: FULLSCREEN_WINDOW_CHANNEL, type: "bye" });
  });

  window.addEventListener("keydown", event => {
    if (event.key === "Escape" && document.fullscreenElement) {
      void document.exitFullscreen();
      return;
    }
    if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }

    if (event.code === "Space") {
      if (event.repeat || closestFromTarget(event.target, TEXT_ENTRY_TARGETS)) return;
      event.preventDefault();
      sendToContent({ channel: FULLSCREEN_WINDOW_CHANNEL, type: "transport", action: "play-pause" });
      return;
    }

    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      if (closestFromTarget(event.target, SEEK_BLOCKING_TARGETS)) return;
      const live = snapshot;
      if (!live || !Number.isFinite(live.durationS) || live.durationS <= 0) return;
      event.preventDefault();
      const step = event.shiftKey ? 30 : 5;
      const target = Math.min(
        live.durationS,
        Math.max(0, currentTimeFrom(live) + (event.key === "ArrowLeft" ? -step : step))
      );
      sendToContent({ channel: FULLSCREEN_WINDOW_CHANNEL, type: "seek", time: target });
    }
  });

  syncTickLoop();
}

start();
