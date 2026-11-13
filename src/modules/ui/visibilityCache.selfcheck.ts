import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { KARAOKE_ACTIVE_ATTR, TAB_HEADER_CLASS, TAB_RENDERER_SELECTOR } from "@constants";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true });
const { window } = dom;

class StubResizeObserver {
  static instances: StubResizeObserver[] = [];
  observed: Element[] = [];
  disconnected = false;
  constructor(private readonly cb: ResizeObserverCallback) {
    StubResizeObserver.instances.push(this);
  }
  observe(target: Element): void {
    this.observed.push(target);
  }
  unobserve(): void {}
  disconnect(): void {
    this.disconnected = true;
  }
  trigger(): void {
    this.cb([], this as unknown as ResizeObserver);
  }
}

class NoopIntersectionObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

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

Object.defineProperty(window.document, "fonts", {
  configurable: true,
  value: { ready: Promise.resolve() },
});

Object.assign(globalThis, {
  window,
  document: window.document,
  Element: window.Element,
  HTMLElement: window.HTMLElement,
  Node: window.Node,
  DocumentFragment: window.DocumentFragment,
  DOMParser: window.DOMParser,
  MutationObserver: window.MutationObserver,
  ResizeObserver: StubResizeObserver,
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
  ResizeObserver: StubResizeObserver,
  IntersectionObserver: NoopIntersectionObserver,
  matchMedia: stubMatchMedia,
});

const { AppState } = await import("@core/appState");
const { ytmHost } = await import("@modules/ui/lyricsHost");
const { createVisibilityCache, disposeVisibilityCache, invalidateViewVisibilityCache } = await import(
  "@modules/ui/visibilityCache"
);

const doc = window.document;

function buildYtmFixture(): {
  appLayout: HTMLElement;
  tabList: HTMLElement;
  tab0: HTMLElement;
  tab1: HTMLElement;
  playerPage: HTMLElement;
  tabRenderer: HTMLElement;
  getCheckCount: () => number;
  resetCheckCount: () => void;
  setCheckVisible: (val: boolean) => void;
} {
  doc.body.replaceChildren();
  const appLayout = doc.createElement("ytmusic-app-layout");
  appLayout.id = "layout";

  const playerPage = doc.createElement("div");
  playerPage.id = "player-page";
  playerPage.setAttribute("player-ui-state", "PLAYER_PAGE_OPEN");

  const tabList = doc.createElement("div");
  const tab0 = doc.createElement("tp-yt-paper-tab");
  tab0.className = TAB_HEADER_CLASS;
  const tab1 = doc.createElement("tp-yt-paper-tab");
  tab1.className = TAB_HEADER_CLASS;
  tab1.setAttribute("aria-selected", "true");
  tabList.append(tab0, tab1);

  const rendererTag = TAB_RENDERER_SELECTOR.replace(/^[#.]/, "");
  const tabRenderer = doc.createElement(TAB_RENDERER_SELECTOR.startsWith("#") ? "div" : rendererTag);
  if (TAB_RENDERER_SELECTOR.startsWith("#")) tabRenderer.id = rendererTag;
  else if (TAB_RENDERER_SELECTOR.startsWith(".")) tabRenderer.className = rendererTag;

  let checkVisible = true;
  let checkCount = 0;
  Object.defineProperty(tabRenderer, "checkVisibility", {
    configurable: true,
    value: () => {
      checkCount += 1;
      return checkVisible;
    },
  });

  playerPage.append(tabList, tabRenderer);
  appLayout.append(playerPage);
  doc.body.append(appLayout);

  return {
    appLayout,
    tabList,
    tab0,
    tab1,
    playerPage,
    tabRenderer,
    getCheckCount: () => checkCount,
    resetCheckCount: () => {
      checkCount = 0;
    },
    setCheckVisible: val => {
      checkVisible = val;
    },
  };
}

const flushMicrotasks = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));

// -- Defaults --------------------------
assert.equal(AppState.isVisibilityCacheEnabled, false, "visibility cache defaults to false");

// -- Opt-in OFF keeps exact legacy per-call evaluation --------------------------
{
  const fixture = buildYtmFixture();
  AppState.isVisibilityCacheEnabled = false;
  assert.equal(ytmHost.isViewVisible(), true);
  assert.equal(ytmHost.isViewVisible(), true);
  assert.equal(ytmHost.isViewVisible(), true);
  assert.equal(fixture.getCheckCount(), 3, "when OFF, every call evaluates directly without caching");
}

// -- Opt-in ON caches and avoids repeat checkVisibility --------------------------
{
  const fixture = buildYtmFixture();
  StubResizeObserver.instances = [];
  AppState.isVisibilityCacheEnabled = true;
  disposeVisibilityCache();

  assert.equal(ytmHost.isViewVisible(), true);
  assert.equal(ytmHost.isViewVisible(), true);
  assert.equal(ytmHost.isViewVisible(), true);
  assert.equal(fixture.getCheckCount(), 1, "when ON, steady playback hits cache after first evaluation");

  // Unrelated cursor/fullscreen-controls attributes on #layout must NOT invalidate the cache.
  fixture.appLayout.setAttribute("cursor-hidden", "");
  fixture.appLayout.setAttribute("show-fullscreen-controls", "");
  await flushMicrotasks();
  assert.equal(ytmHost.isViewVisible(), true);
  assert.equal(fixture.getCheckCount(), 1, "unrelated #layout attributes do not invalidate cache");

  // Tab switch (aria-selected) invalidates cleanly.
  fixture.tab1.setAttribute("aria-selected", "false");
  await flushMicrotasks();
  assert.equal(ytmHost.isViewVisible(), false);
  fixture.tab1.setAttribute("aria-selected", "true");
  await flushMicrotasks();
  assert.equal(ytmHost.isViewVisible(), true);
  assert.equal(fixture.getCheckCount(), 2, "aria-selected toggle invalidates and re-evaluates on next visible tab");

  // Player state transitions invalidate cleanly.
  fixture.playerPage.setAttribute("player-ui-state", "MINIPLAYER");
  await flushMicrotasks();
  assert.equal(ytmHost.isViewVisible(), false);
  fixture.playerPage.setAttribute("player-ui-state", "FULLSCREEN");
  await flushMicrotasks();
  assert.equal(ytmHost.isViewVisible(), true);
  assert.equal(fixture.getCheckCount(), 3);

  // Karaoke attribute invalidates cleanly.
  fixture.appLayout.setAttribute(KARAOKE_ACTIVE_ATTR, "");
  await flushMicrotasks();
  assert.equal(ytmHost.isViewVisible(), false);
  fixture.appLayout.removeAttribute(KARAOKE_ACTIVE_ATTR);
  await flushMicrotasks();
  assert.equal(ytmHost.isViewVisible(), true);
  assert.equal(fixture.getCheckCount(), 4);

  // ResizeObserver triggers invalidation cleanly.
  fixture.setCheckVisible(false);
  StubResizeObserver.instances[0].trigger();
  assert.equal(ytmHost.isViewVisible(), false);
  assert.equal(fixture.getCheckCount(), 5);

  fixture.setCheckVisible(true);
  invalidateViewVisibilityCache();
  assert.equal(ytmHost.isViewVisible(), true);
  assert.equal(fixture.getCheckCount(), 6);

  // window resize & document fullscreenchange invalidate cleanly.
  window.dispatchEvent(new window.Event("resize"));
  assert.equal(ytmHost.isViewVisible(), true);
  assert.equal(fixture.getCheckCount(), 7);

  doc.dispatchEvent(new window.Event("fullscreenchange"));
  assert.equal(ytmHost.isViewVisible(), true);
  assert.equal(fixture.getCheckCount(), 8);

  // Disconnecting #tab-renderer self-heals instead of returning stale cache.
  fixture.tabRenderer.remove();
  assert.equal(ytmHost.isViewVisible(), true, "missing tabRenderer in compute returns true without freezing incomplete cache");
  const replacement = doc.createElement(TAB_RENDERER_SELECTOR.startsWith("#") ? "div" : TAB_RENDERER_SELECTOR);
  if (TAB_RENDERER_SELECTOR.startsWith("#")) replacement.id = TAB_RENDERER_SELECTOR.slice(1);
  else if (TAB_RENDERER_SELECTOR.startsWith(".")) replacement.className = TAB_RENDERER_SELECTOR.slice(1);
  let replacementChecks = 0;
  Object.defineProperty(replacement, "checkVisibility", {
    configurable: true,
    value: () => {
      replacementChecks += 1;
      return false;
    },
  });
  fixture.playerPage.append(replacement);
  assert.equal(ytmHost.isViewVisible(), false, "replacement tabRenderer re-evaluates immediately");
  assert.equal(ytmHost.isViewVisible(), false);
  assert.equal(replacementChecks, 1, "replacement tabRenderer attaches observers and caches");

  // Toggling OFF disposes observers and immediately resumes live checks.
  AppState.isVisibilityCacheEnabled = false;
  disposeVisibilityCache();
  assert.equal(StubResizeObserver.instances.every(ro => ro.disconnected), true, "dispose disconnects ResizeObserver");
  assert.equal(ytmHost.isViewVisible(), false);
  assert.equal(ytmHost.isViewVisible(), false);
  assert.equal(replacementChecks, 3, "reverts immediately to uncached calls when turned OFF");
}

// -- Incomplete DOM never freezes partial cache --------------------------
{
  doc.body.replaceChildren();
  const cache = createVisibilityCache({ doc, win: window as unknown as Window, MutationObserverCtor: window.MutationObserver });
  let calls = 0;
  assert.equal(cache.get(() => (++calls, true)), true);
  assert.equal(cache.get(() => (++calls, false)), false);
  assert.equal(calls, 2, "incomplete anchors bypass cache instead of freezing stale value");
  cache.dispose();
}
