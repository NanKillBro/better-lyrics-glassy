import { TAB_HEADER_CLASS, TAB_RENDERER_SELECTOR, LYRICS_WRAPPER_ID } from "@constants";
import { AppState } from "@core/appState";
import { isKaraokeLayout } from "@modules/karaoke/state";
import { seekPlayer } from "@modules/lyrics/lyrics";
import { hideAdOverlay, isAdPlaying, isLoaderActive, showAdOverlay } from "@modules/ui/dom";
import { getResumeScrollElement } from "@modules/ui/resumeScrollButton";
import { shouldTreatDocumentAsHidden } from "@modules/ui/idleTickSuspension";
import { getCachedViewVisibility } from "@modules/ui/visibilityCache";
import { readRendererMode } from "@modules/ui/rendererMode";
import { observeResize, type ObserverHandle } from "@modules/ui/layout/layoutWidth";
import type { LyricsRendererHost } from "@braccato/core";
import { resetDebugRender, resizeCanvas } from "./animationEngineDebug";
import { type LogSink, logCore } from "@core/logger";

const PLAYER_PAGE_ID = "player-page";
const PLAYER_UI_STATE_ATTRIBUTE = "player-ui-state";

let cachedTabRenderer: HTMLElement | null = null;
let observedLyricsElement: HTMLElement | null = null;
let animateScrollObserver: MutationObserver | null = null;
let cachedAnimateScroll: string | null = null;

let activeScrollElement: HTMLElement | null = null;
let observedScrollElement: HTMLElement | null = null;
let observedScrollWrapper: HTMLElement | null = null;
let observedScrollContainer: HTMLElement | null = null;
let scrollHostResizeHandle: ObserverHandle | null = null;
let scrollHostAttrObserver: MutationObserver | null = null;
let scrollHostWrapperObserver: MutationObserver | null = null;
let cachedScrollTop: number | null = null;
let cachedScrollHeight: number | null = null;
let cachedClientHeight: number | null = null;
let cachedScrollBehavior: string | null = null;
let hasPendingProgrammaticScroll = false;
let programmaticScrollTimer: ReturnType<typeof setTimeout> | null = null;

const PROGRAMMATIC_SCROLL_GRACE_MS = 100;

function disarmProgrammaticScroll(): void {
  hasPendingProgrammaticScroll = false;
  if (programmaticScrollTimer !== null) {
    clearTimeout(programmaticScrollTimer);
    programmaticScrollTimer = null;
  }
}

function armProgrammaticScroll(): void {
  disarmProgrammaticScroll();
  hasPendingProgrammaticScroll = true;
  programmaticScrollTimer = setTimeout(() => {
    programmaticScrollTimer = null;
    hasPendingProgrammaticScroll = false;
  }, PROGRAMMATIC_SCROLL_GRACE_MS);
}

function invalidateScrollHostTop(): void {
  cachedScrollTop = null;
  disarmProgrammaticScroll();
}

export function invalidateScrollHostMetrics(): void {
  invalidateScrollHostTop();
  cachedScrollHeight = null;
  cachedClientHeight = null;
  cachedScrollBehavior = null;
}

function onScrollHostScroll(): void {
  if (hasPendingProgrammaticScroll) {
    disarmProgrammaticScroll();
    return;
  }
  cachedScrollTop = null;
}

function onUserScrollIntent(): void {
  invalidateScrollHostTop();
}

function getCachedScrollBehavior(el: HTMLElement): string {
  if (cachedScrollBehavior === null) {
    cachedScrollBehavior = getComputedStyle(el).scrollBehavior;
  }
  return cachedScrollBehavior;
}

function rebuildScrollHostResizeObserver(): void {
  scrollHostResizeHandle?.destroy();
  scrollHostResizeHandle = null;
  if (!observedScrollElement) return;
  const targets: Element[] = [observedScrollElement];
  if (observedScrollWrapper) targets.push(observedScrollWrapper);
  if (observedScrollContainer) targets.push(observedScrollContainer);
  scrollHostResizeHandle = observeResize(targets, invalidateScrollHostMetrics);
}

function syncWrapperResizeObservation(wrapper: HTMLElement | null): void {
  const nextContainer = (wrapper?.firstElementChild as HTMLElement | null) ?? null;
  let targetsChanged = false;
  if (wrapper !== observedScrollWrapper) {
    scrollHostWrapperObserver?.disconnect();
    scrollHostWrapperObserver = null;
    observedScrollWrapper = wrapper;
    targetsChanged = true;
    if (wrapper && typeof MutationObserver !== "undefined") {
      scrollHostWrapperObserver = new MutationObserver(() => {
        invalidateScrollHostMetrics();
        syncWrapperResizeObservation(observedScrollWrapper);
      });
      scrollHostWrapperObserver.observe(wrapper, { childList: true });
    }
  }
  if (nextContainer !== observedScrollContainer) {
    observedScrollContainer = nextContainer;
    targetsChanged = true;
  }
  if (targetsChanged || !scrollHostResizeHandle) {
    rebuildScrollHostResizeObserver();
  }
}

function teardownScrollHostObservers(): void {
  if (observedScrollElement) {
    observedScrollElement.removeEventListener("scroll", onScrollHostScroll);
    observedScrollElement.removeEventListener("wheel", onUserScrollIntent);
    observedScrollElement.removeEventListener("touchstart", onUserScrollIntent);
    observedScrollElement.removeEventListener("pointerdown", onUserScrollIntent);
  }
  scrollHostResizeHandle?.destroy();
  scrollHostResizeHandle = null;
  scrollHostAttrObserver?.disconnect();
  scrollHostAttrObserver = null;
  scrollHostWrapperObserver?.disconnect();
  scrollHostWrapperObserver = null;
  observedScrollElement = null;
  observedScrollWrapper = null;
  observedScrollContainer = null;
  invalidateScrollHostMetrics();
}

function ensureScrollHostObservers(el: HTMLElement): void {
  if (observedScrollElement === el) {
    const wrapper = document.getElementById(LYRICS_WRAPPER_ID);
    if (wrapper !== observedScrollWrapper || (wrapper?.firstElementChild as HTMLElement | null) !== observedScrollContainer) {
      syncWrapperResizeObservation(wrapper);
    }
    return;
  }

  teardownScrollHostObservers();
  observedScrollElement = el;

  el.addEventListener("scroll", onScrollHostScroll, { passive: true });
  el.addEventListener("wheel", onUserScrollIntent, { passive: true });
  el.addEventListener("touchstart", onUserScrollIntent, { passive: true });
  el.addEventListener("pointerdown", onUserScrollIntent, { passive: true });

  if (typeof MutationObserver !== "undefined") {
    scrollHostAttrObserver = new MutationObserver(() => {
      invalidateScrollHostMetrics();
    });
    scrollHostAttrObserver.observe(el, {
      attributes: true,
      attributeFilter: ["style", "class", "hidden", "selected"],
    });
    if (el.ownerDocument?.documentElement) {
      scrollHostAttrObserver.observe(el.ownerDocument.documentElement, {
        attributes: true,
        attributeFilter: ["style", "class"],
      });
    }
  }

  syncWrapperResizeObservation(document.getElementById(LYRICS_WRAPPER_ID));
}

function applyGlassyFlowFlip(scrollDeltaPx: number, optimized: boolean): void {
  if (scrollDeltaPx === 0 || readRendererMode(document)) return;
  const lyricsElement = document.getElementById(LYRICS_WRAPPER_ID)?.firstElementChild as HTMLElement | null;
  if (!lyricsElement || lyricsElement.classList.contains("brs-layout")) return;

  const animateScroll = optimized
    ? getCachedAnimateScroll(lyricsElement)
    : getComputedStyle(lyricsElement).getPropertyValue("--blyrics-animate-scroll").trim();
  if (animateScroll !== "0") return;

  lyricsElement.style.transition = "none";
  lyricsElement.style.transform = `translate(0px, ${scrollDeltaPx}px)`;
  if (!optimized) {
    lyricsElement.getBoundingClientRect(); // force reflow
  }
}

function patchReadonlyMetric(
  el: HTMLElement,
  prop: "scrollHeight" | "clientHeight",
  getCached: () => number | null,
  setCached: (val: number) => void
): void {
  const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, prop);
  if (!descriptor?.get) return;
  const originalGet = descriptor.get;
  Object.defineProperty(el, prop, {
    get() {
      if (this !== activeScrollElement || !AppState.isOptimizedScrollHostEnabled) {
        return originalGet.call(this);
      }
      ensureScrollHostObservers(el);
      const cached = getCached();
      if (cached !== null) return cached;
      const measured = originalGet.call(this);
      setCached(measured);
      return measured;
    },
    configurable: true,
    enumerable: descriptor.enumerable ?? true,
  });
}

function getCachedAnimateScroll(lyricsElement: HTMLElement): string {
  if (observedLyricsElement !== lyricsElement || !animateScrollObserver) {
    observedLyricsElement = lyricsElement;
    cachedAnimateScroll = null;
    animateScrollObserver?.disconnect();
    animateScrollObserver = new MutationObserver(() => {
      cachedAnimateScroll = null;
    });
    animateScrollObserver.observe(lyricsElement, {
      attributes: true,
      attributeFilter: ["style", "class"],
    });
    if (lyricsElement.ownerDocument?.documentElement) {
      animateScrollObserver.observe(lyricsElement.ownerDocument.documentElement, {
        attributes: true,
        attributeFilter: ["style", "class"],
      });
    }
  }
  if (cachedAnimateScroll === null) {
    cachedAnimateScroll = getComputedStyle(lyricsElement).getPropertyValue("--blyrics-animate-scroll").trim();
  }
  return cachedAnimateScroll;
}

export function resetScrollHostCache(): void {
  cachedTabRenderer = null;
  activeScrollElement = null;
  observedLyricsElement = null;
  cachedAnimateScroll = null;
  animateScrollObserver?.disconnect();
  animateScrollObserver = null;
  teardownScrollHostObservers();
}

function computeViewVisibility(): boolean {
  if (shouldTreatDocumentAsHidden()) return false;
  if (isKaraokeLayout()) return false;

  const tabSelector = document.getElementsByClassName(TAB_HEADER_CLASS)[1];
  if (!tabSelector || tabSelector.getAttribute("aria-selected") !== "true") {
    return false;
  }

  // A missing state is the pre-navigation case: the panel is up but YouTube Music has not written
  // the attribute yet, and treating that as closed would drop the first lyrics of the song.
  const playerState = document.getElementById(PLAYER_PAGE_ID)?.getAttribute(PLAYER_UI_STATE_ATTRIBUTE);
  const stateAllowsLyrics =
    !playerState ||
    playerState === "PLAYER_PAGE_OPEN" ||
    playerState === "FULLSCREEN" ||
    playerState === "MINIPLAYER_IN_PLAYER_PAGE";
  if (!stateAllowsLyrics) return false;

  const tabRenderer = document.querySelector(TAB_RENDERER_SELECTOR);
  return !tabRenderer || tabRenderer.checkVisibility({ visibilityProperty: true });
}

/**
 * The side panel's answers to what a lyrics view cannot work out on its own. Every lookup runs on
 * demand: this is built at import time, long before YouTube Music has rendered a player page.
 */
export const ytmHost: LyricsRendererHost = {
  isViewVisible(): boolean {
    return AppState.isVisibilityCacheEnabled ? getCachedViewVisibility(computeViewVisibility) : computeViewVisibility();
  },
  isLoaderActive,
  syncAdState(): boolean {
    if (!AppState.isAdCheckEnabled) return false;
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
    let el: HTMLElement | null = null;
    if (AppState.isOptimizedScrollHostEnabled) {
      if (!cachedTabRenderer || !cachedTabRenderer.isConnected) {
        cachedTabRenderer = document.querySelector<HTMLElement>(TAB_RENDERER_SELECTOR);
      }
      el = cachedTabRenderer;
    } else {
      el = document.querySelector<HTMLElement>(TAB_RENDERER_SELECTOR);
    }
    if (!el) return null;

    activeScrollElement = el;
    if (AppState.isOptimizedScrollHostEnabled) {
      ensureScrollHostObservers(el);
    }

    // Only apply the patch once per element instance
    if ((el as any).__blyrics_scroll_patched) {
      return el;
    }

    const originalDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, "scrollTop");
    if (originalDescriptor && originalDescriptor.set && originalDescriptor.get) {
      Object.defineProperty(el, "scrollTop", {
        get() {
          if (this !== activeScrollElement || !AppState.isOptimizedScrollHostEnabled) {
            return originalDescriptor.get!.call(this);
          }
          ensureScrollHostObservers(this as HTMLElement);
          if (cachedScrollTop !== null) {
            return cachedScrollTop;
          }
          cachedScrollTop = originalDescriptor.get!.call(this);
          return cachedScrollTop;
        },
        set(value: number) {
          if (this !== activeScrollElement || !AppState.isOptimizedScrollHostEnabled) {
            const currentScrollTop = originalDescriptor.get!.call(this);
            const scrollDeltaPx = value - currentScrollTop;
            applyGlassyFlowFlip(scrollDeltaPx, false);
            return originalDescriptor.set!.call(this, value);
          }
          ensureScrollHostObservers(this as HTMLElement);
          const numericValue = Number(value);
          if (
            Number.isFinite(numericValue) &&
            cachedScrollTop !== null &&
            (numericValue === cachedScrollTop || (numericValue <= 0 && cachedScrollTop === 0))
          ) {
            return;
          }
          const currentScrollTop =
            cachedScrollTop !== null ? cachedScrollTop : originalDescriptor.get!.call(this);
          const scrollDeltaPx = value - currentScrollTop;
          const result = originalDescriptor.set!.call(this, value);
          if (getCachedScrollBehavior(this as HTMLElement) === "smooth") {
            invalidateScrollHostTop();
          } else {
            const actualScrollTop = originalDescriptor.get!.call(this);
            cachedScrollTop = actualScrollTop;
            if (actualScrollTop !== currentScrollTop) {
              armProgrammaticScroll();
            }
          }
          applyGlassyFlowFlip(scrollDeltaPx, true);
          return result;
        },
        configurable: true,
        enumerable: true,
      });
      patchReadonlyMetric(
        el,
        "scrollHeight",
        () => cachedScrollHeight,
        value => {
          cachedScrollHeight = value;
        }
      );
      patchReadonlyMetric(
        el,
        "clientHeight",
        () => cachedClientHeight,
        value => {
          cachedClientHeight = value;
        }
      );
      (el as any).__blyrics_scroll_patched = true;
    }

    return el;
  },
  seek: seekPlayer,
  get log(): LogSink {
    return logCore;
  },
  debug: {
    beginFrame: resetDebugRender,
    resize() {
      resizeCanvas();
      invalidateScrollHostMetrics();
    },
  },
};
