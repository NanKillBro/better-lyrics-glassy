import { LOG_PREFIX, TAB_HEADER_CLASS, TAB_RENDERER_SELECTOR, LYRICS_WRAPPER_ID } from "@constants";
import { seekPlayer } from "@modules/lyrics/lyrics";
import { hideAdOverlay, isAdPlaying, isLoaderActive, showAdOverlay } from "@modules/ui/dom";
import { getResumeScrollElement } from "@modules/ui/resumeScrollButton";
import type { LyricsRendererHost } from "@braccato/core";
import { log } from "@utils";
import { resetDebugRender, resizeCanvas } from "./animationEngineDebug";

const PLAYER_PAGE_ID = "player-page";
const PLAYER_UI_STATE_ATTRIBUTE = "player-ui-state";

/**
 * The side panel's answers to what a lyrics view cannot work out on its own. Every lookup runs on
 * demand: this is built at import time, long before YouTube Music has rendered a player page.
 */
export const ytmHost: LyricsRendererHost = {
  isViewVisible(): boolean {
    const tabSelector = document.getElementsByClassName(TAB_HEADER_CLASS)[1];
    if (!tabSelector || tabSelector.getAttribute("aria-selected") !== "true") {
      return false;
    }

    // A missing state is the pre-navigation case: the panel is up but YouTube Music has not written
    // the attribute yet, and treating that as closed would drop the first lyrics of the song.
    const playerState = document.getElementById(PLAYER_PAGE_ID)?.getAttribute(PLAYER_UI_STATE_ATTRIBUTE);
    return (
      !playerState ||
      playerState === "PLAYER_PAGE_OPEN" ||
      playerState === "FULLSCREEN" ||
      playerState === "MINIPLAYER_IN_PLAYER_PAGE"
    );
  },
  isLoaderActive,
  syncAdState(): boolean {
    if (!isAdPlaying()) {
      hideAdOverlay();
      return false;
    }
    showAdOverlay();
    return true;
  },
  setResumeAffordanceVisible(visible: boolean): void {
    const resumeButton = getResumeScrollElement();
    if (visible) {
      resumeButton.removeAttribute("autoscroll-hidden");
    } else {
      resumeButton.setAttribute("autoscroll-hidden", "true");
    }
  },
  /**
   * Resolved per call rather than once at creation: the view is built at import time, long before
   * the tab renderer is mounted, and YouTube Music swaps the node out often enough that the tick
   * compares it against the node it observes and reinstalls its ResizeObserver whenever it changed.
   */
  getScrollElement(): HTMLElement | null {
    const el = document.querySelector<HTMLElement>(TAB_RENDERER_SELECTOR);
    if (!el) return null;

    // Only apply the patch once per element instance
    if ((el as any).__blyrics_scroll_patched) {
      return el;
    }

    const originalDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, "scrollTop");
    if (originalDescriptor && originalDescriptor.set && originalDescriptor.get) {
      Object.defineProperty(el, "scrollTop", {
        get() {
          return originalDescriptor.get!.call(this);
        },
        set(value: number) {
          const currentScrollTop = originalDescriptor.get!.call(this);
          const scrollDeltaPx = value - currentScrollTop;
          if (scrollDeltaPx !== 0) {
            // GlassyFlow FLIP scroll hack interception
            const lyricsElement = document.getElementById(LYRICS_WRAPPER_ID)?.firstElementChild as HTMLElement;
            if (lyricsElement) {
              const animateScroll = getComputedStyle(lyricsElement).getPropertyValue("--blyrics-animate-scroll").trim();
              if (animateScroll === "0") {
                lyricsElement.style.transition = "none";
                lyricsElement.style.transform = `translate(0px, ${scrollDeltaPx}px)`;
                lyricsElement.getBoundingClientRect(); // force reflow
              }
            }
          }
          return originalDescriptor.set!.call(this, value);
        },
        configurable: true,
        enumerable: true
      });
      (el as any).__blyrics_scroll_patched = true;
    }

    return el;
  },
  seek: seekPlayer,
  /**
   * Resolved per call rather than bound once: `log` is reassigned when the logging setting loads.
   */
  log(...args: unknown[]): void {
    log(LOG_PREFIX, ...args);
  },
  debug: { beginFrame: resetDebugRender, resize: resizeCanvas },
};
