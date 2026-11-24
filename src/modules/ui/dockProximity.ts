export type DockProximityMode = "legacy" | "cached";

export interface DockProximityHooks {
  onDockNear(inner: HTMLElement, near: boolean): void;
  onPlayerBarShown(shown: boolean): void;
}

type DockProximityWindow = Window & {
  MutationObserver?: typeof MutationObserver;
  ResizeObserver?: typeof ResizeObserver;
  DOMMatrixReadOnly?: typeof DOMMatrixReadOnly;
};

export interface DockProximityOptions extends DockProximityHooks {
  dockClass: string;
  playerBarSelector: string;
  mode: () => DockProximityMode;
  cacheMaxAgeMs?: number;
  doc?: Document;
  win?: DockProximityWindow;
}

export interface DockProximityTracker {
  handlePointerMove(event: MouseEvent): void;
  invalidate(): void;
  syncMode(): void;
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

function parseTranslateY(transform: string, win: DockProximityWindow): number {
  if (!transform || transform === "none") return 0;
  const MatrixCtor = win.DOMMatrixReadOnly;
  if (typeof MatrixCtor === "function") {
    return new MatrixCtor(transform).m42;
  }
  const m2d = transform.match(/^matrix\(([^)]+)\)$/);
  if (m2d) {
    const parts = m2d[1].split(",").map(Number);
    return Number.isFinite(parts[5]) ? parts[5] : 0;
  }
  const m3d = transform.match(/^matrix3d\(([^)]+)\)$/);
  if (m3d) {
    const parts = m3d[1].split(",").map(Number);
    return Number.isFinite(parts[13]) ? parts[13] : 0;
  }
  return 0;
}

function isPlayerStateAllowingDock(layout: HTMLElement | null, fullscreen: boolean): boolean {
  if (fullscreen) return true;
  const playerState = layout?.getAttribute("player-ui-state");
  return (
    !playerState ||
    playerState === "PLAYER_PAGE_OPEN" ||
    playerState === "FULLSCREEN" ||
    playerState === "MINIPLAYER_IN_PLAYER_PAGE"
  );
}

/**
 * Caches dock, player-bar, and open-menu bounds between pointer frames when in `"cached"` mode,
 * invalidating on mutations, resizes, transitions, and `cacheMaxAgeMs`.
 */
export function createDockProximityTracker(options: DockProximityOptions): DockProximityTracker {
  const { dockClass, playerBarSelector, mode, onDockNear, onPlayerBarShown } = options;
  const doc = options.doc ?? document;
  const win: DockProximityWindow = options.win ?? (window as DockProximityWindow);
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

  const nowMs = (): number => win.performance?.now?.() ?? performance.now();

  const invalidate = (): void => {
    dirty = true;
  };

  function isDockHidden(dock: HTMLElement | null): boolean {
    return !!dock && hiddenClasses.some(className => dock.classList.contains(className));
  }

  function readState(): CachedDockState {
    const layout = doc.getElementById("layout");
    const fullscreen = layout?.hasAttribute("player-fullscreened") ?? false;
    const showFullscreenControls = layout?.hasAttribute("show-fullscreen-controls") ?? false;
    let playerBarTop: number | null = null;
    if (fullscreen && showFullscreenControls) {
      const bar = doc.querySelector(playerBarSelector)?.getBoundingClientRect();
      if (bar && bar.height > 0) playerBarTop = bar.top;
    }

    const inner = doc.getElementsByClassName(innerClass)[0] as HTMLElement | undefined;
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

    if (!isPlayerStateAllowingDock(layout, fullscreen) || !inner || isDockHidden(dock)) {
      transitionDepth = 0;
      return next;
    }

    const rect = snapshotRect(inner.getBoundingClientRect());
    next.rect = rect;
    next.dockActive = rect.width > 0;
    if (next.dockActive && !next.position.startsWith("top")) {
      const transform = dock ? win.getComputedStyle(dock).transform : "none";
      next.shiftY = parseTranslateY(transform, win);
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

  function observeMenu(menu: HTMLElement | null): void {
    if (menu === observedMenu) return;
    menuObserver?.disconnect();
    menuObserver = null;
    observedMenu = menu;
    const MutationObs = win.MutationObserver;
    if (!menu || typeof MutationObs !== "function") return;
    const observer = new MutationObs(() => {
      if (state) state.menuUnknown = true;
    });
    observer.observe(menu, { attributes: true, attributeFilter: ["class", "style"] });
    menuObserver = observer;
  }

  function getMenuRect(): RectSnapshot | null {
    if (!state) return null;
    if (!state.menuUnknown) {
      if (!state.menu) return null;
      if (state.menu.isConnected) return state.menuRect;
    }
    const menu = doc.querySelector<HTMLElement>(`.${menuOpenClass}`);
    state.menu = menu;
    state.menuUnknown = false;
    state.menuRect = menu ? snapshotRect(menu.getBoundingClientRect()) : null;
    observeMenu(menu);
    return state.menuRect;
  }

  function refresh(): void {
    state = readState();
    measuredAt = nowMs();
    dirty = false;
    syncObservers();
  }

  function unbindDockObservers(): void {
    dockObserver?.disconnect();
    dockObserver = null;
    resizeObserver?.disconnect();
    resizeObserver = null;
    observedInner = null;
    transitionDepth = 0;
    if (observedDock) {
      observedDock.removeEventListener("transitionrun", onTransitionRun);
      observedDock.removeEventListener("transitionend", onTransitionEnd);
      observedDock.removeEventListener("transitioncancel", onTransitionEnd);
    }
    observedDock = null;
  }

  function teardownCachedObservers(): void {
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
    dirty = true;
  }

  function syncObservers(): void {
    const MutationObs = win.MutationObserver;
    const ResizeObs = win.ResizeObserver;

    if (!bodyObserver && doc.body && typeof MutationObs === "function") {
      const observer = new MutationObs((records: MutationRecord[]) => {
        for (const record of records) {
          for (const node of Array.from(record.addedNodes)) {
            if (node.nodeType === 1 && (node as Element).classList.contains(menuClass)) {
              if (state) {
                state.menu = null;
                state.menuRect = null;
                state.menuUnknown = true;
              }
              observeMenu(node as HTMLElement);
            }
          }
          for (const node of Array.from(record.removedNodes)) {
            if (node.nodeType === 1 && (node as Element).classList.contains(menuClass)) {
              forgetMenu();
            }
          }
        }
      });
      observer.observe(doc.body, { childList: true });
      bodyObserver = observer;
    }

    const dock = state?.dock ?? null;
    if (dock !== observedDock) {
      unbindDockObservers();
      observedDock = dock;
      if (dock) {
        if (typeof MutationObs === "function") {
          const observer = new MutationObs(invalidate);
          observer.observe(dock, {
            attributes: true,
            attributeFilter: ["class", "style", "data-position"],
            subtree: true,
          });
          dockObserver = observer;
        }
        if (typeof ResizeObs === "function") {
          const observer = new ResizeObs(invalidate);
          observer.observe(dock);
          if (state?.inner) {
            observer.observe(state.inner);
            observedInner = state.inner;
          }
          if (dock.parentElement) observer.observe(dock.parentElement);
          resizeObserver = observer;
        }
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
      if (layout && typeof MutationObs === "function") {
        const observer = new MutationObs(invalidate);
        observer.observe(layout, {
          attributes: true,
          attributeFilter: ["player-fullscreened", "show-fullscreen-controls", "player-ui-state"],
        });
        layoutObserver = observer;
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
    const layout = doc.getElementById("layout");
    if (!layout?.hasAttribute("player-fullscreened")) return false;
    let threshold = win.innerHeight - BOTTOM_REVEAL_ZONE;
    if (layout.hasAttribute("show-fullscreen-controls")) {
      const bar = doc.querySelector(playerBarSelector)?.getBoundingClientRect();
      if (bar && bar.height > 0) threshold = Math.min(threshold, bar.top);
    }
    return event.clientY >= threshold;
  }

  function evaluateLegacy(event: MouseEvent): void {
    const barNear = isCursorNearBottomLegacy(event);
    const inner = doc.getElementsByClassName(innerClass)[0] as HTMLElement | undefined;
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
      const transform = dock ? win.getComputedStyle(dock).transform : "none";
      const shiftY = parseTranslateY(transform, win);
      bottom -= shiftY;
    }

    let dockNear = event.clientX >= left && event.clientX <= right && event.clientY >= top && event.clientY <= bottom;

    if (!dockNear) {
      const menu = doc.querySelector(`.${menuOpenClass}`);
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
    if (!state || dirty || transitionDepth > 0 || nowMs() - measuredAt >= maxAgeMs) {
      refresh();
    }

    const current = state;
    if (!current) return;

    if ((current.inner && !current.inner.isConnected) || (current.dock && !current.dock.isConnected)) {
      refresh();
    }
    const cached = state;
    if (!cached) return;

    const barNear = cached.fullscreen
      ? event.clientY >= Math.min(win.innerHeight - BOTTOM_REVEAL_ZONE, cached.playerBarTop ?? Infinity)
      : false;

    if (!cached.inner || !cached.dockActive || !cached.rect) {
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

  function syncMode(): void {
    const currentMode = mode();
    if (currentMode === lastMode) return;
    lastMode = currentMode;
    if (currentMode === "legacy") {
      teardownCachedObservers();
    } else {
      invalidate();
    }
  }

  function run(event: MouseEvent): void {
    syncMode();
    if (lastMode === "cached") evaluateCached(event);
    else evaluateLegacy(event);
  }

  const listener = (event: MouseEvent): void => {
    pendingEvent = event;
    if (rafId !== null) return;
    rafId = win.requestAnimationFrame(() => {
      rafId = null;
      const eventToProcess = pendingEvent;
      pendingEvent = null;
      if (eventToProcess) run(eventToProcess);
    });
  };

  doc.addEventListener("mousemove", listener, { passive: true });
  win.addEventListener("resize", invalidate, { passive: true });

  return {
    handlePointerMove: (event: MouseEvent): void => {
      listener(event);
    },
    invalidate,
    syncMode,
    destroy: (): void => {
      doc.removeEventListener("mousemove", listener);
      win.removeEventListener("resize", invalidate);
      if (rafId !== null) win.cancelAnimationFrame(rafId);
      rafId = null;
      pendingEvent = null;
      teardownCachedObservers();
      lastMode = null;
    },
  };
}
