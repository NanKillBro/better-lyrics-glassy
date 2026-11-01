export type DockProximityMode = "legacy" | "cached";

export interface DockProximityHooks {
  onDockNear(inner: HTMLElement, near: boolean): void;
  onPlayerBarShown(shown: boolean): void;
}

export interface DockProximityOptions extends DockProximityHooks {
  dockClass: string;
  playerBarSelector: string;
  mode: () => DockProximityMode;
  cacheMaxAgeMs?: number;
}

export interface DockProximityTracker {
  handlePointerMove(event: MouseEvent): void;
  destroy(): void;
}

interface RectSnapshot {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
}

interface CachedDockState {
  inner: HTMLElement | null;
  dock: HTMLElement | null;
  dockActive: boolean;
  position: string;
  rect: RectSnapshot | null;
  shiftY: number;
  layout: HTMLElement | null;
  fullscreen: boolean;
  showFullscreenControls: boolean;
  playerBarTop: number | null;
  menu: HTMLElement | null;
  menuRect: RectSnapshot | null;
  menuUnknown: boolean;
}

const DOCK_PROXIMITY = 104;
const BOTTOM_REVEAL_ZONE = 100;
const MENU_BRIDGE_PADDING = 32;
const DEFAULT_CACHE_MAX_AGE_MS = 500;

function snapshotRect(rect: DOMRect): RectSnapshot {
  return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width };
}

/**
 * Caches the dock, player bar and open-menu geometry between pointer frames.
 *
 * The legacy path measured the DOM on every animation frame while the pointer moved, which
 * forced style/layout on a continuously dirty page. The cached path refreshes once per
 * invalidation (resize, dock/layout mutations, CSS transitions) and otherwise does arithmetic
 * only; a max-age revalidation bounds staleness for layout shifts no observer reports.
 */
export function createDockProximityTracker(options: DockProximityOptions): DockProximityTracker {
  const { dockClass, playerBarSelector, mode, onDockNear, onPlayerBarShown } = options;
  const innerClass = `${dockClass}__inner`;
  const menuClass = `${dockClass}__menu`;
  const menuOpenClass = `${dockClass}__menu--open`;
  const hiddenClasses = [`${dockClass}--hidden`, `${dockClass}--idle-hidden`, `${dockClass}--off-page`];
  const maxAgeMs = options.cacheMaxAgeMs ?? DEFAULT_CACHE_MAX_AGE_MS;

  let state: CachedDockState | null = null;
  let measuredAt = 0;
  let dirty = true;
  let lastMode: DockProximityMode | null = null;
  let transitionDepth = 0;
  let rafId: number | null = null;
  let pendingEvent: MouseEvent | null = null;

  let bodyObserver: MutationObserver | null = null;
  let dockObserver: MutationObserver | null = null;
  let layoutObserver: MutationObserver | null = null;
  let menuObserver: MutationObserver | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let observedDock: HTMLElement | null = null;
  let observedInner: HTMLElement | null = null;
  let observedLayout: HTMLElement | null = null;
  let observedMenu: HTMLElement | null = null;

  const invalidate = (): void => {
    dirty = true;
  };

  function isDockHidden(dock: HTMLElement | null): boolean {
    return !!dock && hiddenClasses.some(className => dock.classList.contains(className));
  }

  function readState(): CachedDockState {
    const layout = document.getElementById("layout");
    const fullscreen = layout?.hasAttribute("player-fullscreened") ?? false;
    const showFullscreenControls = layout?.hasAttribute("show-fullscreen-controls") ?? false;
    let playerBarTop: number | null = null;
    if (fullscreen && showFullscreenControls) {
      const bar = document.querySelector(playerBarSelector)?.getBoundingClientRect();
      if (bar && bar.height > 0) playerBarTop = bar.top;
    }

    const inner = document.getElementsByClassName(innerClass)[0] as HTMLElement | undefined;
    const dock = (inner?.parentElement as HTMLElement | null) ?? null;
    const next: CachedDockState = {
      inner: inner ?? null,
      dock,
      dockActive: false,
      position: dock?.dataset.position ?? "",
      rect: null,
      shiftY: 0,
      layout,
      fullscreen,
      showFullscreenControls,
      playerBarTop,
      menu: null,
      menuRect: null,
      menuUnknown: true,
    };

    if (!inner || isDockHidden(dock)) return next;

    const rect = snapshotRect(inner.getBoundingClientRect());
    next.rect = rect;
    next.dockActive = rect.width > 0;
    if (next.dockActive && !next.position.startsWith("top")) {
      const transform = dock ? getComputedStyle(dock).transform : "none";
      next.shiftY = transform === "none" ? 0 : new DOMMatrixReadOnly(transform).m42;
    }
    return next;
  }

  function forgetMenu(): void {
    if (!state) return;
    state.menu = null;
    state.menuRect = null;
    state.menuUnknown = true;
    observeMenu(null);
  }

  function markMenuUnknown(): void {
    forgetMenu();
  }

  function observeMenu(menu: HTMLElement | null): void {
    if (menu === observedMenu) return;
    menuObserver?.disconnect();
    observedMenu = menu;
    if (!menu) return;
    menuObserver = new MutationObserver(() => {
      if (state) state.menuUnknown = true;
    });
    menuObserver.observe(menu, { attributes: true, attributeFilter: ["class", "style"] });
  }

  function getMenuRect(): RectSnapshot | null {
    if (!state) return null;
    if (!state.menuUnknown) {
      if (!state.menu) return null;
      if (state.menu.isConnected) return state.menuRect;
    }
    const menu = document.querySelector<HTMLElement>(`.${menuOpenClass}`);
    state.menu = menu;
    state.menuUnknown = false;
    state.menuRect = menu ? snapshotRect(menu.getBoundingClientRect()) : null;
    observeMenu(menu);
    return state.menuRect;
  }

  function refresh(): void {
    const previous = state;
    state = readState();
    measuredAt = performance.now();
    dirty = false;

    if (previous) {
      state.menu = previous.menu;
      state.menuRect = previous.menuRect;
      state.menuUnknown = previous.menuUnknown;
      if (previous.dock !== state.dock) {
        state.menu = null;
        state.menuRect = null;
        state.menuUnknown = true;
      }
    }
    syncObservers();
  }

  function unbindDockObservers(): void {
    dockObserver?.disconnect();
    dockObserver = null;
    resizeObserver?.disconnect();
    resizeObserver = null;
    observedInner = null;
    if (observedDock) {
      observedDock.removeEventListener("transitionrun", onTransitionRun);
      observedDock.removeEventListener("transitionend", onTransitionEnd);
      observedDock.removeEventListener("transitioncancel", onTransitionEnd);
    }
    observedDock = null;
  }

  function syncObservers(): void {
    if (!bodyObserver && document.body) {
      bodyObserver = new MutationObserver(records => {
        for (const record of records) {
          for (const node of record.addedNodes) {
            if (node instanceof Element && node.classList.contains(menuClass)) {
              if (state) {
                state.menu = null;
                state.menuRect = null;
                state.menuUnknown = true;
              }
              observeMenu(node as HTMLElement);
            }
          }
          for (const node of record.removedNodes) {
            if (node instanceof Element && node.classList.contains(menuClass)) markMenuUnknown();
          }
        }
      });
      bodyObserver.observe(document.body, { childList: true });
    }

    const dock = state?.dock ?? null;
    if (dock !== observedDock) {
      unbindDockObservers();
      observedDock = dock;
      if (dock) {
        dockObserver = new MutationObserver(invalidate);
        dockObserver.observe(dock, {
          attributes: true,
          attributeFilter: ["class", "style", "data-position"],
          subtree: true,
        });
        resizeObserver = new ResizeObserver(invalidate);
        resizeObserver.observe(dock);
        if (state?.inner) {
          resizeObserver.observe(state.inner);
          observedInner = state.inner;
        }
        if (dock.parentElement) resizeObserver.observe(dock.parentElement);
        dock.addEventListener("transitionrun", onTransitionRun);
        dock.addEventListener("transitionend", onTransitionEnd);
        dock.addEventListener("transitioncancel", onTransitionEnd);
      }
    } else if (dock && resizeObserver && state?.inner && state.inner !== observedInner) {
      if (observedInner) resizeObserver.unobserve(observedInner);
      resizeObserver.observe(state.inner);
      observedInner = state.inner;
    }

    const layout = state?.layout ?? null;
    if (layout !== observedLayout) {
      layoutObserver?.disconnect();
      layoutObserver = null;
      observedLayout = layout;
      if (layout) {
        layoutObserver = new MutationObserver(invalidate);
        layoutObserver.observe(layout, {
          attributes: true,
          attributeFilter: ["player-fullscreened", "show-fullscreen-controls"],
        });
      }
    }
  }

  function onTransitionRun(): void {
    transitionDepth++;
    invalidate();
  }

  function onTransitionEnd(): void {
    transitionDepth = Math.max(0, transitionDepth - 1);
    invalidate();
  }

  function isCursorNearBottomLegacy(event: MouseEvent): boolean {
    const layout = document.getElementById("layout");
    if (!layout?.hasAttribute("player-fullscreened")) return false;
    let threshold = window.innerHeight - BOTTOM_REVEAL_ZONE;
    if (layout.hasAttribute("show-fullscreen-controls")) {
      const bar = document.querySelector(playerBarSelector)?.getBoundingClientRect();
      if (bar && bar.height > 0) threshold = Math.min(threshold, bar.top);
    }
    return event.clientY >= threshold;
  }

  function evaluateLegacy(event: MouseEvent): void {
    const barNear = isCursorNearBottomLegacy(event);
    const inner = document.getElementsByClassName(innerClass)[0] as HTMLElement | undefined;
    if (!inner) {
      onPlayerBarShown(barNear);
      return;
    }

    const rect = inner.getBoundingClientRect();
    const dock = inner.parentElement as HTMLElement | null;
    const dockActive =
      rect.width > 0 &&
      !dock?.classList.contains(`${dockClass}--hidden`) &&
      !dock?.classList.contains(`${dockClass}--idle-hidden`);

    if (!dockActive) {
      onPlayerBarShown(barNear);
      return;
    }

    const position = dock?.dataset.position ?? "";
    let { left, right, top, bottom } = rect;
    if (position.includes("right")) left -= DOCK_PROXIMITY;
    if (position.includes("left")) right += DOCK_PROXIMITY;
    if (position.startsWith("top")) {
      bottom += DOCK_PROXIMITY;
    } else {
      top -= DOCK_PROXIMITY;
      const transform = dock ? getComputedStyle(dock).transform : "none";
      const shiftY = transform === "none" ? 0 : new DOMMatrixReadOnly(transform).m42;
      bottom -= shiftY;
    }

    let dockNear = event.clientX >= left && event.clientX <= right && event.clientY >= top && event.clientY <= bottom;

    if (!dockNear) {
      const menu = document.querySelector(`.${menuOpenClass}`);
      if (menu) {
        const m = menu.getBoundingClientRect();
        dockNear =
          event.clientX >= m.left - MENU_BRIDGE_PADDING &&
          event.clientX <= m.right + MENU_BRIDGE_PADDING &&
          event.clientY >= m.top - MENU_BRIDGE_PADDING &&
          event.clientY <= m.bottom + MENU_BRIDGE_PADDING;
      }
    }

    onDockNear(inner, dockNear);
    onPlayerBarShown(dockNear || barNear);
  }

  function evaluateCached(event: MouseEvent): void {
    if (!state || dirty || transitionDepth > 0 || performance.now() - measuredAt >= maxAgeMs) refresh();

    const current = state;
    if (!current) return;

    if ((current.inner && !current.inner.isConnected) || (current.dock && !current.dock.isConnected)) {
      refresh();
      const refreshed = state;
      if (!refreshed) return;
    }
    const cached = state;
    if (!cached) return;

    const barNear = cached.fullscreen
      ? event.clientY >= Math.min(window.innerHeight - BOTTOM_REVEAL_ZONE, cached.playerBarTop ?? Infinity)
      : false;

    if (!cached.inner) {
      onPlayerBarShown(barNear);
      return;
    }
    if (!cached.dockActive || !cached.rect) {
      onPlayerBarShown(barNear);
      return;
    }

    let { left, right, top, bottom } = cached.rect;
    if (cached.position.includes("right")) left -= DOCK_PROXIMITY;
    if (cached.position.includes("left")) right += DOCK_PROXIMITY;
    if (cached.position.startsWith("top")) {
      bottom += DOCK_PROXIMITY;
    } else {
      top -= DOCK_PROXIMITY;
      bottom -= cached.shiftY;
    }

    let dockNear = event.clientX >= left && event.clientX <= right && event.clientY >= top && event.clientY <= bottom;

    if (!dockNear) {
      const menuRect = getMenuRect();
      if (menuRect) {
        dockNear =
          event.clientX >= menuRect.left - MENU_BRIDGE_PADDING &&
          event.clientX <= menuRect.right + MENU_BRIDGE_PADDING &&
          event.clientY >= menuRect.top - MENU_BRIDGE_PADDING &&
          event.clientY <= menuRect.bottom + MENU_BRIDGE_PADDING;
      }
    }

    onDockNear(cached.inner, dockNear);
    onPlayerBarShown(dockNear || barNear);
  }

  function run(event: MouseEvent): void {
    const currentMode = mode();
    if (currentMode !== lastMode) {
      lastMode = currentMode;
      invalidate();
    }
    if (currentMode === "cached") evaluateCached(event);
    else evaluateLegacy(event);
  }

  const listener = (event: MouseEvent): void => {
    pendingEvent = event;
    if (rafId !== null) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => {
      rafId = null;
      const eventToProcess = pendingEvent;
      pendingEvent = null;
      if (eventToProcess) run(eventToProcess);
    });
  };

  document.addEventListener("mousemove", listener, { passive: true });
  window.addEventListener("resize", invalidate, { passive: true });

  return {
    handlePointerMove: (event: MouseEvent): void => {
      listener(event);
    },
    destroy: (): void => {
      document.removeEventListener("mousemove", listener);
      window.removeEventListener("resize", invalidate);
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = null;
      pendingEvent = null;
      bodyObserver?.disconnect();
      bodyObserver = null;
      unbindDockObservers();
      layoutObserver?.disconnect();
      layoutObserver = null;
      menuObserver?.disconnect();
      menuObserver = null;
      observedLayout = null;
      observedMenu = null;
      state = null;
    },
  };
}
