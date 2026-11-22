import { CUSTOM_THEME_STYLE_ID } from "@braccato/core/constants";
import type { Lyric } from "@braccato/core";
import { applyLyricDecorations } from "@modules/lyrics/lyricDecorations";
import { hasSameRenderedLyrics } from "@modules/ui/fullscreenWindow/lyricsEquality";
import { SharpenMarker } from "@modules/ui/fullscreenWindow/sharpenMarker";
import { createVideoFrameReceiver, type VideoFrameReceiver } from "@modules/ui/fullscreenWindow/videoTransport";
import { initGlassyFlowBridge } from "@modules/ui/glassyFlowBridge";
import { createLyricsRenderer } from "@modules/ui/lyricsRenderer";
import {
  LEGACY_RENDERER_CSS_PATH,
  syncRendererModeStylesheets,
} from "@modules/ui/rendererMode";
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

const PING_INTERVAL_MS = 4_000;
const ARTWORK_CROSSFADE_MS = 600;
const ARTWORK_FORCE_VISIBLE_MS = 5_000;
const BG_UPDATE_CROSSFADE_DELAY_MS = 1_000;
const BLS_STATE_EVENT = "bls:fullscreen-state";
const BLS_MEDIA_EVENT = "bls:fullscreen-media";
const VIDEO_PORT_MSG_TYPE = "blfw-video-port";
const MERGE_THEME_STYLE_ID = "blfw-merge-theme";
const SCROLL_SCRIPTS: Record<string, string> = {
  glassyflow: "/glassyflow.js",
  "glassyflow-turbo": "/glassyflow-turbo.js",
  "glassyflow-super": "/glassyflow-super.js",
};
const searchParams = new URLSearchParams(window.location.search);
const scrollMode = searchParams.get("scroll") ?? "";
const usesGlassyFlow = scrollMode in SCROLL_SCRIPTS;
const debugEnabled = searchParams.get("debug") === "1";

declare global {
  interface Window {
    __blsLastState?: unknown;
  }
}

type Renderer = ReturnType<typeof createLyricsRenderer>;

interface Elements {
  readonly shell: HTMLElement;
  readonly layout: HTMLElement;
  readonly page: HTMLElement;
  readonly artImage: HTMLImageElement;
  readonly artNext: HTMLImageElement;
  readonly artVideo: HTMLVideoElement;
  readonly mvVideo: HTMLVideoElement;
  readonly title: HTMLElement;
  readonly artist: HTMLElement;
  readonly loader: HTMLElement;
  readonly mount: HTMLElement;
  readonly scroll: HTMLElement;
  readonly elapsed: HTMLElement;
  readonly remaining: HTMLElement;
  readonly progressFill: HTMLElement;
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
let appliedComposite: boolean | null = null;
let lastVideoId: string | null = null;
let artFront = 0;
let hasCommittedArt = false;
let artGeneration = 0;
let artCleanupTimer: number | null = null;
let artSafetyTimer: number | null = null;
let bgUpdateTimer: number | null = null;
let artUrl: string | null = null;
let animatedUrl: string | null = null;
let appliedArtistKey = "";
let scrollScriptInjected = false;
let flipInstalled = false;
let modeQueue: Promise<void> = Promise.resolve();
let forceSharpenImmediate = false;
let videoMirrorDesired = false;
let hasDecodedVideoFrame = false;
let videoAspectRatio = 16 / 9;
let videoReceiver: VideoFrameReceiver | null = null;
const sharpenMarker = new SharpenMarker();

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
    `composite=${String(appliedComposite)} sync=${payload?.syncType ?? "-"}`,
    `mergeStyle=${document.getElementById(MERGE_THEME_STYLE_ID)?.textContent?.length ?? 0}`,
    `scrollTop=${Math.round(elements.scroll.scrollTop)} scrollH=${Math.round(elements.scroll.scrollHeight)}`,
    `active=${elements.mount.querySelectorAll(".blyrics--active").length} activeY=${
      Math.round(elements.mount.querySelector<HTMLElement>(".blyrics--active")?.getBoundingClientRect().top ?? -1)
    }`,
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
    mvVideo: get("#blfw-mv-video"),
    title: get("#blyrics-title"),
    artist: get("#blyrics-artist"),
    loader: get("#blyrics-loader"),
    mount: get("#blyrics-wrapper"),
    scroll: get("#tab-renderer"),
    elapsed: get("#blfw-elapsed"),
    remaining: get("#blfw-remaining"),
    progressFill: get("#blfw-progress-fill"),
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

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "--:--";
  const total = Math.floor(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
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
    const escaped = url.replace(/"/g, '%22');
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

function applyArtworkCrossfade(nextUrl: string): void {
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
      artCleanupTimer = window.setTimeout(() => {
        if (gen !== artGeneration) return;
        artCleanupTimer = null;
        if (outgoing) {
          outgoing.classList.remove("is-visible", "blfw-art--outgoing", "blfw-art--incoming");
        }
        incoming.classList.remove("blfw-art--incoming");
      }, ARTWORK_CROSSFADE_MS + 50);
    } else {
      incoming.style.transition = "";
      incoming.style.opacity = "";
      incoming.classList.add("is-visible");
      layers[1 - incomingIndex].classList.remove("is-visible", "blfw-art--outgoing", "blfw-art--incoming");
    }
  };

  if (isCrossfade) {
    artSafetyTimer = window.setTimeout(() => {
      if (gen !== artGeneration) return;
      artSafetyTimer = null;
      incoming.onload = null;
      incoming.onerror = null;
      incoming.style.transition = "none";
      incoming.style.opacity = "1";
      incoming.classList.add("is-visible");
      if (outgoing) {
        outgoing.classList.remove("is-visible", "blfw-art--outgoing", "blfw-art--incoming");
      }
      hasCommittedArt = true;
      artFront = incomingIndex;
      setBackgroundImageDelayed(nextUrl, BG_UPDATE_CROSSFADE_DELAY_MS);
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

function applyMainAlbumColors(track: FullscreenTrackInfo): boolean {
  const root = document.documentElement.style;
  if (track.albumColor) root.setProperty("--ytmusic-album-color", track.albumColor);
  if (track.albumColorDark) root.setProperty("--ytmusic-album-color-dark", track.albumColorDark);
  if (track.albumColorRatio) root.setProperty("--ytmusic-album-color-ratio", track.albumColorRatio);
  return Boolean(track.albumColor || track.albumColorDark);
}

function applyTrack(next: FullscreenTrackInfo | null): void {
  if (!next) return;
  if (next.videoId !== lastVideoId) {
    lastVideoId = next.videoId;
    elements.artImage.classList.add("blfw-art--loading");
  }
  // Empty strings arrive while a new track is still resolving; keep the previous text instead.
  if (next.title && elements.title.textContent !== next.title) {
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

  if (!next.animatedArtworkUrl && (animatedUrl !== null || elements.shell.hasAttribute("data-animated-art"))) {
    animatedUrl = null;
    elements.shell.removeAttribute("data-animated-art");
    elements.artVideo.pause();
    elements.artVideo.removeAttribute("src");
    elements.artVideo.load();
  }

  const hasMainColors = applyMainAlbumColors(next);
  if (next.artworkUrl && next.artworkUrl !== artUrl) {
    artUrl = next.artworkUrl;
    elements.shell.setAttribute("data-blfw-artwork", next.artworkUrl);
    elements.shell.style.setProperty("--blfw-art", `url("${next.artworkUrl.replace(/"/g, '%22')}")`);
    elements.shell.setAttribute("data-has-art", "true");
    applyArtworkCrossfade(next.artworkUrl);
    if (!hasMainColors) applyArtworkColors(next.artworkUrl);
    window.dispatchEvent(new CustomEvent(BLS_MEDIA_EVENT, { detail: { artworkUrl: next.artworkUrl } }));
  }

  if (next.animatedArtworkUrl) {
    if (next.animatedArtworkUrl !== animatedUrl) {
      animatedUrl = next.animatedArtworkUrl;
      elements.shell.removeAttribute("data-animated-art");
      elements.artVideo.crossOrigin = "anonymous";
      elements.artVideo.muted = true;
      elements.artVideo.loop = true;
      elements.artVideo.playsInline = true;
      elements.artVideo.src = next.animatedArtworkUrl;
      elements.artVideo.load();
    }
    if (elements.artVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      elements.shell.setAttribute("data-animated-art", "true");
    }
    if (elements.artVideo.paused) {
      void elements.artVideo.play().catch(() => undefined);
    }
  }
}

function ensureMergeTheme(): void {
  let style = document.getElementById(MERGE_THEME_STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement("style");
    style.id = MERGE_THEME_STYLE_ID;
    document.head.appendChild(style);
  } else if (document.head.lastElementChild !== style) {
    // Keep the merge theme after `lyrics-legacy.css` / `#blyrics-custom-style`, matching the main window.
    document.head.appendChild(style);
  }
  if (style.textContent !== mergeThemeCss) style.textContent = mergeThemeCss;
}

function enforceGlassyFlowScrollVars(container: HTMLElement | null): void {
  if (!usesGlassyFlow) return;
  document.documentElement.style.setProperty("--blyrics-animate-scroll", "0", "important");
  document.documentElement.style.setProperty("--blyrics-lyric-scroll-duration", "0ms", "important");
  if (elements?.mount) {
    elements.mount.style.setProperty("--blyrics-animate-scroll", "0", "important");
    elements.mount.style.setProperty("--blyrics-lyric-scroll-duration", "0ms", "important");
  }
  if (container) {
    container.style.setProperty("--blyrics-animate-scroll", "0", "important");
    container.style.setProperty("--blyrics-lyric-scroll-duration", "0ms", "important");
  }
}

function ensureScrollScript(): void {
  if (scrollScriptInjected || !usesGlassyFlow) return;
  const src = SCROLL_SCRIPTS[scrollMode];
  /* GlassyFlow owns the scroll while it is injected, so the renderer's own scroll animation has to
     be switched off before the first theme cache / layout tick runs. */
  elements.shell.setAttribute("data-glassyflow", "true");
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
      const container = elements.mount.querySelector<HTMLElement>(".blyrics-container");
      const animateScroll = container
        ? getComputedStyle(container).getPropertyValue("--blyrics-animate-scroll").trim()
        : "";
      const previous = read.call(this);
      write.call(this, value);
      if (!container || animateScroll !== "0" || !container.classList.contains("blyrics--gf-managed")) {
        return;
      }
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
  enforceGlassyFlowScrollVars(null);
  renderer = createLyricsRenderer({
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
  initGlassyFlowBridge(renderer);
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
    !loaderShowing &&
    Boolean(payload?.lyrics && payload.lyrics.length > 0 && payload.noLyrics === true);
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
}

function currentTimeFrom(live: FullscreenPlaybackSnapshot): number {
  const elapsed = live.isPlaying
    ? (Math.max(0, Date.now() - live.wallTime) * live.playbackRate) / 1000
    : 0;
  return Math.min(live.currentTimeS + elapsed, live.durationS || Number.POSITIVE_INFINITY);
}

function updateProgress(time: number, duration: number): void {
  const ratio = duration > 0 ? Math.min(1, Math.max(0, time / duration)) : 0;
  elements.progressFill.style.transform = `scaleX(${ratio})`;
  elements.elapsed.textContent = formatTime(time);
  elements.remaining.textContent = duration > 0 ? `-${formatTime(Math.max(0, duration - time))}` : "--:--";
}

let lastTickAt = 0;

function tick(): void {
  const target = renderer;
  const live = snapshot;
  const now = performance.now();
  const due = now - lastTickAt >= 15;
  if (due) lastTickAt = now;
  if (due && target && live && payload?.lyrics) {
    if (elements.shell.scrollTop !== 0) elements.shell.scrollTop = 0;
    const time = currentTimeFrom(live);
    updateProgress(time, live.durationS);
    const suppressZero = time <= 0.05 && Date.now() < (payload.suppressZeroTimeUntil ?? 0);
    if (!suppressZero) {
      target.tick(time, {
        eventCreationTime: Date.now(),
        playbackRate: live.playbackRate,
        isPlaying: live.isPlaying,
        smoothScroll: true,
        globalLyricOffset: payload.globalLyricOffset,
        lyricOffset: payload.lyricOffset,
        richsyncOffsetTrim: payload.richsyncOffsetTrim,
        lineOffsetTrim: payload.lineOffsetTrim,
        passiveScrollEnabled: payload.passiveScrollEnabled,
      });
      sharpenMarker.sync(elements.mount, time, forceSharpenImmediate);
      forceSharpenImmediate = false;
    }
  }
  window.requestAnimationFrame(tick);
}

/**
 * The renderer picks its engine from `blyrics-composite-lyrics` and depends on the matching
 * stylesheet: the legacy engine gets its sweep from `lyrics-legacy.css`, which registers the
 * `--lyric-transition-amount-*` properties the WAAPI animation drives. Loading only the modern sheet
 * leaves the legacy engine animating properties nothing defines, which is why the sweep vanished.
 */
async function applyMode(composite: boolean, forceRebuild = false): Promise<void> {
  const modeChanged = appliedComposite !== composite;
  if (!modeChanged && !forceRebuild) return;
  if (modeChanged) {
    appliedComposite = composite;
    await syncRendererModeStylesheets(
      document,
      composite,
      chrome.runtime.getURL(LEGACY_RENDERER_CSS_PATH),
    );
    if (renderer) {
      renderer.destroy();
      renderer = null;
    }
  }
  applyTheme(false);
  buildLyrics();
}

function enqueueWork(task: () => Promise<void> | void): void {
  modeQueue = modeQueue
    .then(task)
    .catch((error) => console.error("[blfw] queue", error));
}

function handleMessage(message: FullscreenOutbound): void {
  if (!message || message.channel !== FULLSCREEN_WINDOW_CHANNEL) return;
  switch (message.type) {
    case "ready":
      hasReceivedReady = true;
      themeCss = message.theme;
      mergeThemeCss = message.mergeTheme;
      publishBlsState(message.blsState);
      applyVideoState(message.video);
      applyLoader(message.loader);
      applyTrack(message.track);
      if (message.snapshot) snapshot = message.snapshot;
      if (message.lyrics) payload = message.lyrics;
      enqueueWork(() => applyMode(message.composite, Boolean(message.lyrics)));
      hideStatus();
      break;
    case "loader":
      applyLoader(message.payload);
      break;
    case "lyrics":
      enqueueWork(() => {
        const previous = payload;
        payload = message.payload;
        if (
          previous &&
          renderer &&
          renderer.lines.length > 0 &&
          hasSameRenderedLyrics(previous, payload)
        ) {
          renderer.setLanguage(payload.language);
          applyLyricDecorations(renderer, payload.decorations);
          renderer.relayout();
          enforceGlassyFlowScrollVars(renderer.container);
          forceSharpenImmediate = true;
          return;
        }
        buildLyrics();
      });
      break;
    case "snapshot":
      snapshot = message.payload;
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
    case "theme":
      themeCss = message.payload;
      enqueueWork(() => applyTheme());
      break;
    case "merge-theme":
      mergeThemeCss = message.payload;
      ensureMergeTheme();
      break;
    case "mode":
      enqueueWork(() => applyMode(message.payload));
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
  const image = new Image();
  image.crossOrigin = "anonymous";
  image.onload = () => {
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
        `${Math.round(r * 0.58)}, ${Math.round(g * 0.58)}, ${Math.round(b * 0.58)}`,
      );
    } catch {
      // A tainted canvas just leaves the theme on its fallback colour.
    }
  };
  image.src = url;
}

function start(): void {
  elements = queryElements();
  applyBaseVariables();
  ensureScrollScript();
  videoReceiver = createVideoFrameReceiver(
    elements.mvVideo,
    (aspect) => {
      if (Number.isFinite(aspect) && aspect > 0) videoAspectRatio = aspect;
      hasDecodedVideoFrame = true;
      syncVideoModeUi();
    },
    () => {
      hasDecodedVideoFrame = false;
      syncVideoModeUi();
    },
  );
  window.addEventListener("message", (event: MessageEvent<{ type?: string }>) => {
    if (event.source !== window || event.data?.type !== VIDEO_PORT_MSG_TYPE) return;
    const incomingPort = event.ports?.[0];
    if (incomingPort) videoReceiver?.attachPort(incomingPort);
  });
  installGlassyFlowFlip();
  document.getElementById("blfw-close")?.addEventListener("click", () => window.close());
  elements.artImage.addEventListener("load", () => elements.artImage.classList.remove("blfw-art--loading"));
  elements.artImage.addEventListener("error", () => elements.artImage.classList.remove("blfw-art--loading"));

  const revealAnimatedVideo = (): void => {
    if (!animatedUrl) return;
    elements.shell.setAttribute("data-animated-art", "true");
  };
  elements.artVideo.addEventListener("canplay", revealAnimatedVideo);
  elements.artVideo.addEventListener("loadeddata", revealAnimatedVideo);
  elements.artVideo.addEventListener("error", () => {
    elements.shell.removeAttribute("data-animated-art");
  });

  if (debugEnabled) {
    document.documentElement.setAttribute("data-debug", "true");
    window.setInterval(reportDebug, 500);
  }

  ensureMergeTheme();

  chrome.runtime.onMessage.addListener((message: FullscreenOutbound) => {
    handleMessage(message);
    return undefined;
  });

  sendToContent({ channel: FULLSCREEN_WINDOW_CHANNEL, type: "hello" });
  window.setInterval(() => sendToContent({ channel: FULLSCREEN_WINDOW_CHANNEL, type: "ping" }), PING_INTERVAL_MS);

  window.setTimeout(() => {
    if (!payload && !snapshot) showStatus("Waiting for the player window...");
  }, 3_000);

  window.addEventListener("pagehide", () => {
    clearArtworkTimers();
    if (bgUpdateTimer !== null) {
      window.clearTimeout(bgUpdateTimer);
      bgUpdateTimer = null;
    }
    videoReceiver?.destroy();
    videoReceiver = null;
    sendToContent({ channel: FULLSCREEN_WINDOW_CHANNEL, type: "bye" });
  });

  window.addEventListener("keydown", event => {
    if (event.key === "Escape" && document.fullscreenElement) void document.exitFullscreen();
  });

  window.requestAnimationFrame(tick);
}

start();
