import { AppState } from "@core/appState";
import { invalidateScrollHostMetrics, ytmHost } from "@modules/ui/lyricsHost";
import type { LyricsRenderer, TickOptions } from "@braccato/core";
import { createLyricsRenderer } from "@modules/ui/lyricsRenderer";

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
export const mainView: Omit<LyricsRenderer, "destroy"> = createLyricsRenderer({ document, window, host: ytmHost });
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

initGlassyFlowBridge();
