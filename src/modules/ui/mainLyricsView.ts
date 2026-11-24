import { AppState } from "@core/appState";
import { invalidateScrollHostMetrics, ytmHost } from "@modules/ui/lyricsHost";
import type { LyricsRenderer, LyricsRendererHost, TickOptions } from "@braccato/core";
import { requestAnimationLoopSync } from "@modules/ui/idleTickSuspension";
import { createLyricsView } from "@modules/ui/lyricsRenderer";
import { readRendererMode } from "@modules/ui/rendererMode";

function invalidateAfter<Args extends unknown[], Result>(
  fn: (...args: Args) => Result
): (...args: Args) => Result {
  return function (this: unknown, ...args: Args): Result {
    try {
      return fn.apply(this, args);
    } finally {
      invalidateScrollHostMetrics();
    }
  };
}

// -- The side panel's view --------------------------

/**
 * The side panel's lyrics view. Created at import time, long before YouTube Music has rendered a
 * lyrics tab, so it is given no mount: the injection names one once it has built the wrapper.
 *
 * Handed out without `destroy`, because destruction is final and there is no path back: this view
 * lives for as long as the tab does, and seven modules can reach it.
 */
const GLASSYFLOW_ENABLED_ATTR = "data-glassyflow-enabled";

export function isGlassyFlowScrollEnabled(doc: Document | null | undefined = document): boolean {
  return !readRendererMode(doc) && doc?.documentElement?.getAttribute(GLASSYFLOW_ENABLED_ATTR) === "true";
}

export function resolveMainViewTickOptions(options: TickOptions, doc: Document | null | undefined = document): TickOptions {
  if (!isGlassyFlowScrollEnabled(doc) || options.smoothScroll === false) {
    return options;
  }
  return { ...options, smoothScroll: false };
}

let scopedVisibilityDepth = 0;
let scopedTickVisibility: boolean | null = null;

export function runWithScopedMainViewVisibility<T>(fn: () => T): T {
  if (scopedVisibilityDepth === 0) {
    scopedTickVisibility = null;
  }
  scopedVisibilityDepth += 1;
  try {
    return fn();
  } finally {
    scopedVisibilityDepth -= 1;
    if (scopedVisibilityDepth === 0) {
      scopedTickVisibility = null;
    }
  }
}

export function readScopedMainViewVisibility(): boolean {
  if (scopedVisibilityDepth > 0) {
    if (scopedTickVisibility === null) {
      scopedTickVisibility = ytmHost.isViewVisible();
    }
    return scopedTickVisibility;
  }
  return ytmHost.isViewVisible();
}

const mainViewHost: LyricsRendererHost = {
  isViewVisible: readScopedMainViewVisibility,
  isLoaderActive: () => ytmHost.isLoaderActive(),
  syncAdState: () => ytmHost.syncAdState(),
  setResumeAffordanceVisible: visible => ytmHost.setResumeAffordanceVisible(visible),
  getScrollElement: () => ytmHost.getScrollElement(),
  seek: timeS => ytmHost.seek(timeS),
  get log() {
    return ytmHost.log;
  },
  debug: ytmHost.debug,
};

export const mainView: Omit<LyricsRenderer, "destroy"> = createLyricsView({ document, window, host: mainViewHost });
const baseMainTick = mainView.tick;
mainView.tick = (currentTimeS, options) => baseMainTick(currentTimeS, resolveMainViewTickOptions(options));
const baseMainRetick = mainView.retickFromPlaybackClock;
mainView.retickFromPlaybackClock = (buildOptions) =>
  baseMainRetick((eventCreationTime, isPlaying) => resolveMainViewTickOptions(buildOptions(eventCreationTime, isPlaying)));
mainView.setLyrics = invalidateAfter(mainView.setLyrics);
mainView.setLanguage = invalidateAfter(mainView.setLanguage);
mainView.setTheme = invalidateAfter(mainView.setTheme);
mainView.relayout = invalidateAfter(mainView.relayout);
mainView.clear = invalidateAfter(mainView.clear);
mainView.clearOnScreenLyrics = invalidateAfter(mainView.clearOnScreenLyrics);

// -- Tick options --------------------------

/**
 * Reads the settings and player state the main window's view renders against. The engine holds none
 * of this itself: a second view in a second document would resolve its own.
 */
export function currentTickOptions(eventCreationTime: number, isPlaying: boolean, smoothScroll = true): TickOptions {
  return {
    eventCreationTime,
    isPlaying,
    smoothScroll,
    globalLyricOffset: AppState.globalLyricOffset,
    lyricOffset: AppState.lyricOffset,
    richsyncOffsetTrim: AppState.richsyncOffsetTrim,
    lineOffsetTrim: AppState.lineOffsetTrim,
    passiveScrollEnabled: AppState.isPassiveScrollEnabled,
    playbackRate: AppState.playbackRate,
  };
}

// -- Re-sync on layout change --------------------------

/**
 * Renders the side panel again against the last player snapshot, without smooth scrolling. Used
 * whenever something other than the clock moved the lyrics: an offset change, a line arriving.
 */
export function retickMainView(): void {
  if (!AppState.areLyricsTicking) return;

  const status = mainView.retickFromPlaybackClock((eventCreationTime, isPlaying) =>
    currentTickOptions(eventCreationTime, isPlaying, false)
  );
  if (status === "lyrics-missing") {
    AppState.areLyricsTicking = false;
    requestAnimationLoopSync();
  }
}

import { initGlassyFlowBridge } from "@modules/ui/glassyFlowBridge";

/**
 * Re-measures the lines and re-ticks after something was added to the lyrics DOM.
 */
export function lyricsElementAdded(): void {
  if (!AppState.areLyricsTicking) return;

  mainView.scheduleLyricPositionUpdate(() => AppState.areLyricsTicking, retickMainView);
}

initGlassyFlowBridge(mainView, { isViewVisible: readScopedMainViewVisibility });

const bridgedMainTick = mainView.tick;
mainView.tick = (currentTimeS, options) =>
  runWithScopedMainViewVisibility(() => bridgedMainTick(currentTimeS, options));
const bridgedMainRetick = mainView.retickFromPlaybackClock;
mainView.retickFromPlaybackClock = buildOptions =>
  runWithScopedMainViewVisibility(() => bridgedMainRetick(buildOptions));
