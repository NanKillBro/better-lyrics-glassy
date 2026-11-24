import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { TAB_HEADER_CLASS } from "@constants";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true });
const { window } = dom;

let visibilityState: DocumentVisibilityState = "visible";
Object.defineProperty(window.document, "visibilityState", {
  configurable: true,
  get: () => visibilityState,
});

const stubMatchMedia = () => ({
  matches: false,
  media: "",
  onchange: null,
  addListener() {},
  removeListener() {},
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent: () => false,
});

class NoopResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

class NoopIntersectionObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

Object.defineProperty(window.document, "fonts", {
  configurable: true,
  value: { ready: Promise.resolve() },
});

Object.defineProperty(window.Element.prototype, "animate", {
  configurable: true,
  writable: true,
  value: () => ({
    cancel() {},
    pause() {},
    play() {},
    finish() {},
    currentTime: 0,
    startTime: 0,
    playbackRate: 1,
    playState: "running",
    effect: { getTiming: () => ({ duration: 1000, delay: 0 }) },
  }),
});

class SimpleDOMRect {
  x: number;
  y: number;
  width: number;
  height: number;
  top: number;
  left: number;
  right: number;
  bottom: number;
  constructor(x = 0, y = 0, width = 0, height = 0) {
    this.x = x;
    this.y = y;
    this.width = width;
    this.height = height;
    this.top = y;
    this.left = x;
    this.right = x + width;
    this.bottom = y + height;
  }
}

Object.assign(globalThis, {
  window,
  document: window.document,
  Element: window.Element,
  HTMLElement: window.HTMLElement,
  Node: window.Node,
  DOMRect: SimpleDOMRect,
  DocumentFragment: window.DocumentFragment,
  DOMParser: window.DOMParser,
  MutationObserver: window.MutationObserver,
  ResizeObserver: NoopResizeObserver,
  IntersectionObserver: NoopIntersectionObserver,
  Event: window.Event,
  CustomEvent: window.CustomEvent,
  getComputedStyle: window.getComputedStyle.bind(window),
  matchMedia: stubMatchMedia,
  chrome: {
    runtime: {
      getURL: (path: string) => path,
      getManifest: () => ({ version: "3.0.2.2" }),
    },
    storage: {
      local: {
        get: (_keys: unknown, cb?: (items: Record<string, unknown>) => void) => {
          cb?.({});
          return Promise.resolve({});
        },
        set: () => Promise.resolve(),
      },
      onChanged: {
        addListener: () => {},
        removeListener: () => {},
      },
    },
    i18n: {
      getMessage: (key: string) => key,
      getUILanguage: () => "en",
    },
  },
});
Object.assign(window, {
  matchMedia: stubMatchMedia,
  ResizeObserver: NoopResizeObserver,
  IntersectionObserver: NoopIntersectionObserver,
});

const { AppState } = await import("@core/appState");
const { ytmHost } = await import("@modules/ui/lyricsHost");
const {
  isLyricsTabSelected,
  shouldEnableMainLyricsTicking,
  shouldRunAnimationLoop,
  shouldTreatDocumentAsHidden,
} = await import("@modules/ui/idleTickSuspension");

const doc = window.document;

function buildPanelDom(): { playerPage: HTMLElement; tab0: HTMLElement; tab1: HTMLElement; tabRenderer: HTMLElement } {
  doc.body.replaceChildren();
  const appLayout = doc.createElement("ytmusic-app-layout");
  const playerPage = doc.createElement("div");
  playerPage.id = "player-page";
  playerPage.setAttribute("player-ui-state", "PLAYER_PAGE_OPEN");

  const tab0 = doc.createElement("tp-yt-paper-tab");
  tab0.className = TAB_HEADER_CLASS;
  const tab1 = doc.createElement("tp-yt-paper-tab");
  tab1.className = TAB_HEADER_CLASS;
  tab1.setAttribute("aria-selected", "true");

  const tabRenderer = doc.createElement("div");
  tabRenderer.id = "tab-renderer";
  Object.defineProperty(tabRenderer, "checkVisibility", {
    configurable: true,
    value: () => true,
  });

  playerPage.append(tab0, tab1, tabRenderer);
  appLayout.appendChild(playerPage);
  doc.body.appendChild(appLayout);
  return { playerPage, tab0, tab1, tabRenderer };
}

// 1. Default OFF preserves exact upstream behavior
{
  const { tab1 } = buildPanelDom();
  AppState.isIdleTickSuspensionEnabled = false;
  AppState.isPictureInPictureOpen = false;
  AppState.isVisibilityCacheEnabled = false;

  visibilityState = "hidden";
  assert.equal(shouldTreatDocumentAsHidden(doc), false);
  assert.equal(ytmHost.isViewVisible(), true, "toggle OFF keeps upstream visibility behavior when hidden");

  tab1.setAttribute("aria-selected", "false");
  assert.equal(isLyricsTabSelected(doc), false);
  assert.equal(shouldEnableMainLyricsTicking(tab1), true, "toggle OFF preserves upstream unconditional areLyricsTicking");
  assert.equal(
    shouldRunAnimationLoop({
      idleSuspensionEnabled: false,
      isPlaying: false,
      isDocumentVisible: false,
      isPictureInPictureOpen: false,
      areLyricsTicking: false,
      isKaraokeActive: false,
      isMainViewVisible: false,
    }),
    true,
    "toggle OFF keeps permanent 20ms loop"
  );
}

// 2. Toggle ON fixes all 3 upstream behaviors while respecting Document PiP opener quirk
{
  const { playerPage, tab1 } = buildPanelDom();
  AppState.isIdleTickSuspensionEnabled = true;
  AppState.isPictureInPictureOpen = false;
  AppState.isVisibilityCacheEnabled = false;

  // Fix 1: document.visibilityState === "hidden" makes ytmHost.isViewVisible() false unless Document PiP is open
  visibilityState = "visible";
  assert.equal(ytmHost.isViewVisible(), true);

  visibilityState = "hidden";
  assert.equal(shouldTreatDocumentAsHidden(doc), true);
  assert.equal(ytmHost.isViewVisible(), false, "toggle ON treats hidden main window as invisible");

  AppState.isPictureInPictureOpen = true;
  assert.equal(shouldTreatDocumentAsHidden(doc), false);
  assert.equal(ytmHost.isViewVisible(), true, "Document PiP opener reporting hidden stays visible");

  AppState.isPictureInPictureOpen = false;
  visibilityState = "visible";

  // Fix 2: off-tab song injection does not re-enable AppState.areLyricsTicking
  tab1.setAttribute("aria-selected", "false");
  assert.equal(shouldEnableMainLyricsTicking(tab1), false, "off-tab injection keeps areLyricsTicking false");
  tab1.setAttribute("aria-selected", "true");
  assert.equal(shouldEnableMainLyricsTicking(tab1), true, "on-tab injection enables areLyricsTicking");

  // Fix 3: loop suspends when paused, hidden, off-tab, or collapsed player page
  const baseActive = {
    idleSuspensionEnabled: true,
    isPlaying: true,
    isDocumentVisible: true,
    isPictureInPictureOpen: false,
    areLyricsTicking: true,
    isKaraokeActive: false,
    isMainViewVisible: true,
  };
  assert.equal(shouldRunAnimationLoop(baseActive), true, "runs when playing and visible on lyrics tab");
  assert.equal(shouldRunAnimationLoop({ ...baseActive, isPlaying: false }), false, "suspends when paused");
  assert.equal(shouldRunAnimationLoop({ ...baseActive, isDocumentVisible: false }), false, "suspends when hidden");
  assert.equal(
    shouldRunAnimationLoop({ ...baseActive, isDocumentVisible: false, isPictureInPictureOpen: true }),
    true,
    "keeps running when Document PiP opener reports hidden"
  );
  assert.equal(shouldRunAnimationLoop({ ...baseActive, areLyricsTicking: false }), false, "suspends off-tab");
  assert.equal(
    shouldRunAnimationLoop({ ...baseActive, isMainViewVisible: false }),
    false,
    "suspends when player page is collapsed"
  );
  assert.equal(
    shouldRunAnimationLoop({ ...baseActive, areLyricsTicking: false, isMainViewVisible: false, isKaraokeActive: true }),
    true,
    "runs when visible karaoke overlay is active"
  );
  assert.equal(
    shouldRunAnimationLoop({
      ...baseActive,
      isDocumentVisible: false,
      areLyricsTicking: false,
      isMainViewVisible: false,
      isKaraokeActive: true,
    }),
    false,
    "suspends karaoke loop when window is hidden"
  );

  // Collapsed player page still returns false from ytmHost.isViewVisible()
  playerPage.setAttribute("player-ui-state", "MINIPLAYER");
  assert.equal(ytmHost.isViewVisible(), false);
  playerPage.setAttribute("player-ui-state", "PLAYER_PAGE_OPEN");
  assert.equal(ytmHost.isViewVisible(), true);
}

// 3. End-to-end observer.ts timer suspension & wakeup checks
{
  const { playerPage, tab1, tabRenderer } = buildPanelDom();
  const { mainView } = await import("@modules/ui/mainLyricsView");
  const lyricsMount = doc.createElement("div");
  tabRenderer.appendChild(lyricsMount);
  mainView.setLyrics([{ startTimeMs: 1000, words: "Hello world", durationMs: 30000 }], { mount: lyricsMount });

  AppState.isIdleTickSuspensionEnabled = true;
  AppState.isPictureInPictureOpen = false;
  AppState.lastVideoId = "vid1";
  AppState.lastVideoDetails = "Song Artist";
  AppState.hasPreloadedNextSong = true;
  AppState.queueLyricInjection = false;
  AppState.queueSongDetailsInjection = false;
  AppState.areLyricsLoaded = true;
  AppState.areLyricsTicking = true;
  visibilityState = "visible";

  const activeTimers = new Map<number, { fn: () => void; ms: number }>();
  let nextTimerId = 1;
  const origSetTimeout = window.setTimeout;
  const origClearTimeout = window.clearTimeout;
  window.setTimeout = ((fn: TimerHandler, ms = 0) => {
    const id = nextTimerId++;
    if (typeof fn === "function") {
      activeTimers.set(id, { fn: fn as () => void, ms: Number(ms) });
    }
    return id;
  }) as unknown as typeof window.setTimeout;
  window.clearTimeout = ((id?: number) => {
    if (typeof id === "number") activeTimers.delete(id);
  }) as typeof window.clearTimeout;

  const countLoopTimers = (): number => [...activeTimers.values()].filter(t => t.ms === 20).length;

  try {
    const { enableLyricsTab, initializeLyrics, setUpVideoModeListener } = await import("@modules/ui/observer");
    initializeLyrics();
    enableLyricsTab();
    setUpVideoModeListener();

    // Initially paused -> 0 active 20ms timers
    assert.equal(countLoopTimers(), 0, "no 20ms timer while initially paused");

    // Start playing -> 1 active 20ms timer
    doc.dispatchEvent(
      new window.CustomEvent("blyrics-send-player-time", {
        detail: {
          currentTime: 10,
          videoId: "vid1",
          song: "Song",
          artist: "Artist",
          duration: "200",
          audioTrackData: null,
          browserTime: Date.now(),
          isPlaying: true,
          playing: true,
          playbackRate: 1,
          contentRect: { width: 800, height: 600 },
        },
      })
    );
    assert.equal(countLoopTimers(), 1, "starts 20ms timer when playing on visible lyrics tab");

    // Switching off the lyrics tab clears areLyricsTicking and stops the 20ms timer
    tab1.setAttribute("aria-selected", "false");
    await Promise.resolve();
    assert.equal(AppState.areLyricsTicking, false, "off-tab clears areLyricsTicking via lyricsTabObserver");
    assert.equal(countLoopTimers(), 0, "cancels 20ms timer when switching off lyrics tab");

    // Switching back onto the lyrics tab restores areLyricsTicking and resumes the 20ms timer
    tab1.setAttribute("aria-selected", "true");
    await Promise.resolve();
    for (const [id, entry] of [...activeTimers.entries()]) {
      if (entry.ms === 0) {
        activeTimers.delete(id);
        entry.fn();
      }
    }
    assert.equal(AppState.areLyricsTicking, true, "returning to lyrics tab re-enables areLyricsTicking");
    assert.equal(countLoopTimers(), 1, "resumes 20ms timer when returning to lyrics tab");

    // Hide main window -> 0 active 20ms timers
    visibilityState = "hidden";
    doc.dispatchEvent(new window.Event("visibilitychange"));
    assert.equal(countLoopTimers(), 0, "cancels 20ms timer when main window becomes hidden");

    // Show main window -> resumes 20ms timer
    visibilityState = "visible";
    doc.dispatchEvent(new window.Event("visibilitychange"));
    assert.equal(countLoopTimers(), 1, "resumes 20ms timer when main window becomes visible");

    // Collapse player page -> cancels 20ms timer via #player-page observer
    playerPage.setAttribute("player-ui-state", "MINIPLAYER");
    await Promise.resolve();
    assert.equal(countLoopTimers(), 0, "cancels 20ms timer when player page collapses");

    // Reopen player page -> resumes 20ms timer immediately
    playerPage.setAttribute("player-ui-state", "PLAYER_PAGE_OPEN");
    await Promise.resolve();
    assert.equal(countLoopTimers(), 1, "resumes 20ms timer when player page reopens");

    // Pause playback -> cancels 20ms timer
    doc.dispatchEvent(
      new window.CustomEvent("blyrics-send-player-time", {
        detail: {
          currentTime: 12,
          videoId: "vid1",
          song: "Song",
          artist: "Artist",
          duration: "200",
          audioTrackData: null,
          browserTime: Date.now(),
          isPlaying: false,
          playing: false,
          playbackRate: 1,
          contentRect: { width: 800, height: 600 },
        },
      })
    );
    assert.equal(countLoopTimers(), 0, "cancels 20ms timer when playback pauses");

    // Toggle OFF while paused -> restarts permanent upstream 20ms timer
    AppState.isIdleTickSuspensionEnabled = false;
    const { requestAnimationLoopSync } = await import("@modules/ui/idleTickSuspension");
    requestAnimationLoopSync();
    assert.equal(countLoopTimers(), 1, "toggling OFF restores permanent 20ms timer");
  } finally {
    mainView.clear();
    window.setTimeout = origSetTimeout;
    window.clearTimeout = origClearTimeout;
    AppState.isIdleTickSuspensionEnabled = false;
    dom.window.close();
  }
}

console.log("idleTickSuspension self-check passed");
