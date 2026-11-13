import { KARAOKE_ACTIVE_ATTR, LYRICS_DISABLED_ATTR, TAB_HEADER_CLASS, TAB_RENDERER_SELECTOR } from "@constants";

const PLAYER_PAGE_ID = "player-page";
const APP_LAYOUT_TAG = "ytmusic-app-layout";

const APP_LAYOUT_ATTRS = [
  KARAOKE_ACTIVE_ATTR,
  LYRICS_DISABLED_ATTR,
  "player-fullscreened",
  "blyrics-video-mode",
] as const;

const TAB_SELECTOR_ATTRS = ["aria-selected", "disabled", "hidden", "style", "class"] as const;

const PLAYER_PAGE_ATTRS = [
  "player-ui-state",
  "player-fullscreened",
  "blyrics-dfs",
  "blyrics-video-mode",
  KARAOKE_ACTIVE_ATTR,
  LYRICS_DISABLED_ATTR,
  "hidden",
  "style",
  "class",
] as const;

const ANCESTOR_ATTRS = ["style", "hidden", "class", "selected", "aria-hidden", "disabled"] as const;

type MutationObserverCtor = typeof MutationObserver;
type ResizeObserverCtor = typeof ResizeObserver;

export interface VisibilityCacheDeps {
  doc?: Document;
  win?: Window | null;
  MutationObserverCtor?: MutationObserverCtor;
  ResizeObserverCtor?: ResizeObserverCtor;
}

export interface VisibilityCache {
  get(compute: () => boolean): boolean;
  invalidate(): void;
  dispose(): void;
}

interface WatchSpec {
  childList: boolean;
  attrs: Set<string>;
}

function sameElements(a: readonly (Element | null)[], b: readonly (Element | null)[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function areConnected(nodes: readonly Element[]): boolean {
  for (let i = 0; i < nodes.length; i++) {
    if (!nodes[i].isConnected) return false;
  }
  return true;
}

function addWatch(
  map: Map<Element, WatchSpec>,
  el: Element,
  attrs: readonly string[],
  childList = false
): void {
  let spec = map.get(el);
  if (!spec) {
    spec = { childList: false, attrs: new Set() };
    map.set(el, spec);
  }
  if (childList) spec.childList = true;
  for (let i = 0; i < attrs.length; i++) {
    spec.attrs.add(attrs[i]);
  }
}

export function createVisibilityCache(deps: VisibilityCacheDeps = {}): VisibilityCache {
  let cachedValue = false;
  let hasValue = false;
  let dirty = true;

  let mutationObserver: MutationObserver | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let docListenersAttached = false;
  let winListenersAttached = false;
  let signatureNodes: (Element | null)[] = [];
  let trackedNodes: Element[] = [];

  const getDoc = (): Document | null => deps.doc ?? (typeof document !== "undefined" ? document : null);
  const getWin = (doc: Document): Window | null =>
    deps.win !== undefined ? deps.win : (doc.defaultView ?? (typeof window !== "undefined" ? window : null));

  const invalidate = (): void => {
    dirty = true;
  };

  const detachObservers = (): void => {
    if (mutationObserver) {
      mutationObserver.disconnect();
      mutationObserver = null;
    }
    if (resizeObserver) {
      resizeObserver.disconnect();
      resizeObserver = null;
    }
    const doc = getDoc();
    if (doc && docListenersAttached) {
      doc.removeEventListener("visibilitychange", invalidate);
      doc.removeEventListener("fullscreenchange", invalidate);
      docListenersAttached = false;
    }
    const win = doc ? getWin(doc) : (deps.win ?? null);
    if (win && winListenersAttached) {
      win.removeEventListener("resize", invalidate);
      winListenersAttached = false;
    }
    signatureNodes = [];
    trackedNodes = [];
  };

  const attachObservers = (doc: Document): boolean => {
    const win = getWin(doc);
    const MutationCtor =
      deps.MutationObserverCtor ??
      (win as { MutationObserver?: MutationObserverCtor } | null)?.MutationObserver ??
      (typeof MutationObserver === "function" ? MutationObserver : undefined);
    if (!MutationCtor) return false;

    const appLayout = doc.querySelector(APP_LAYOUT_TAG);
    const tabSelector = doc.getElementsByClassName(TAB_HEADER_CLASS)[1] ?? null;
    const playerPage = doc.getElementById(PLAYER_PAGE_ID);
    const tabRenderer = doc.querySelector(TAB_RENDERER_SELECTOR);

    if (
      !appLayout ||
      !tabSelector ||
      !playerPage ||
      !tabRenderer ||
      !appLayout.isConnected ||
      !tabSelector.isConnected ||
      !playerPage.isConnected ||
      !tabRenderer.isConnected
    ) {
      detachObservers();
      return false;
    }

    const tabListParent = tabSelector.parentElement;
    const ancestors: Element[] = [];
    let cur: Element | null = tabRenderer;
    while (cur) {
      ancestors.push(cur);
      cur = cur.parentElement;
    }

    const nextSignature: (Element | null)[] = [appLayout, tabSelector, playerPage, tabRenderer, tabListParent, ...ancestors];
    if (mutationObserver && sameElements(signatureNodes, nextSignature)) {
      return true;
    }

    detachObservers();

    const watches = new Map<Element, WatchSpec>();
    addWatch(watches, appLayout, APP_LAYOUT_ATTRS);
    addWatch(watches, tabSelector, TAB_SELECTOR_ATTRS);
    addWatch(watches, playerPage, PLAYER_PAGE_ATTRS);
    if (tabListParent) {
      addWatch(watches, tabListParent, [], true);
    }
    for (let i = 0; i < ancestors.length; i++) {
      addWatch(watches, ancestors[i], ANCESTOR_ATTRS);
    }

    mutationObserver = new MutationCtor(invalidate);
    for (const [el, spec] of watches) {
      const options: MutationObserverInit = {};
      if (spec.childList) options.childList = true;
      if (spec.attrs.size > 0) {
        options.attributes = true;
        options.attributeFilter = [...spec.attrs];
      }
      mutationObserver.observe(el, options);
    }

    const ResizeCtor =
      deps.ResizeObserverCtor ??
      (win as { ResizeObserver?: ResizeObserverCtor } | null)?.ResizeObserver ??
      (typeof ResizeObserver === "function" ? ResizeObserver : undefined);
    if (ResizeCtor) {
      resizeObserver = new ResizeCtor(invalidate);
      resizeObserver.observe(tabRenderer);
    }

    doc.addEventListener("visibilitychange", invalidate);
    doc.addEventListener("fullscreenchange", invalidate);
    docListenersAttached = true;

    if (win) {
      win.addEventListener("resize", invalidate, { passive: true });
      winListenersAttached = true;
    }

    signatureNodes = nextSignature;
    trackedNodes = [...watches.keys()];
    return true;
  };

  const get = (compute: () => boolean): boolean => {
    if (!dirty && hasValue && trackedNodes.length > 0 && areConnected(trackedNodes)) {
      return cachedValue;
    }

    const value = compute();
    const doc = getDoc();
    if (doc && attachObservers(doc)) {
      cachedValue = value;
      hasValue = true;
      dirty = false;
    } else {
      hasValue = false;
      dirty = true;
    }
    return value;
  };

  const dispose = (): void => {
    detachObservers();
    hasValue = false;
    dirty = true;
  };

  return { get, invalidate, dispose };
}

const defaultVisibilityCache = createVisibilityCache();

export function getCachedViewVisibility(compute: () => boolean): boolean {
  return defaultVisibilityCache.get(compute);
}

export function invalidateViewVisibilityCache(): void {
  defaultVisibilityCache.invalidate();
}

export function disposeVisibilityCache(): void {
  defaultVisibilityCache.dispose();
}
