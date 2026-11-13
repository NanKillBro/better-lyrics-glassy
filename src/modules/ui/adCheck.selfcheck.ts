import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { AD_PLAYING_ATTR, LYRICS_AD_OVERLAY_ID, PLAYER_BAR_SELECTOR, TAB_RENDERER_SELECTOR } from "@constants";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true });
const { window } = dom;
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

Object.assign(globalThis, {
  window,
  document: window.document,
  Element: window.Element,
  HTMLElement: window.HTMLElement,
  Node: window.Node,
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
const { disposeAdObserver, isAdPlaying, setupAdObserver, syncAdCheckState } = await import("@modules/ui/dom");
const { ytmHost } = await import("@modules/ui/lyricsHost");

const doc = window.document;

function buildAdFixture(withAdAttr: boolean): { playerBar: HTMLElement; tabRenderer: HTMLElement } {
  doc.body.replaceChildren();
  const appLayout = doc.createElement("ytmusic-app-layout");
  const playerPage = doc.createElement("div");
  playerPage.id = "player-page";

  const tabRenderer = doc.createElement(TAB_RENDERER_SELECTOR.startsWith("#") ? "div" : TAB_RENDERER_SELECTOR);
  if (TAB_RENDERER_SELECTOR.startsWith("#")) tabRenderer.id = TAB_RENDERER_SELECTOR.slice(1);
  else if (TAB_RENDERER_SELECTOR.startsWith(".")) tabRenderer.className = TAB_RENDERER_SELECTOR.slice(1);

  const playerBarTag = PLAYER_BAR_SELECTOR.replace(/^[#.]/, "");
  const playerBar = doc.createElement(PLAYER_BAR_SELECTOR.startsWith("#") || PLAYER_BAR_SELECTOR.startsWith(".") ? "div" : playerBarTag);
  if (PLAYER_BAR_SELECTOR.startsWith("#")) playerBar.id = playerBarTag;
  else if (PLAYER_BAR_SELECTOR.startsWith(".")) playerBar.className = playerBarTag;
  if (withAdAttr) playerBar.setAttribute(AD_PLAYING_ATTR, "");

  playerPage.append(tabRenderer);
  appLayout.append(playerPage);
  doc.body.append(appLayout, playerBar);
  return { playerBar, tabRenderer };
}

const flushMicrotasks = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));

// -- Default is false --------------------------
assert.equal(AppState.isAdCheckEnabled, false, "isAdCheckEnabled defaults to false");

// -- OFF skips querySelector, getElementById, and hideAdOverlay completely --------------------------
{
  buildAdFixture(true);
  AppState.isAdCheckEnabled = false;
  disposeAdObserver();

  setupAdObserver();
  assert.equal(doc.getElementById(LYRICS_AD_OVERLAY_ID), null, "setupAdObserver skips creating ad overlay when disabled");

  let queryCount = 0;
  let byIdCount = 0;
  const origQuerySelector = doc.querySelector.bind(doc);
  const origGetElementById = doc.getElementById.bind(doc);
  doc.querySelector = ((sel: string) => {
    queryCount += 1;
    return origQuerySelector(sel);
  }) as Document["querySelector"];
  doc.getElementById = ((id: string) => {
    byIdCount += 1;
    return origGetElementById(id);
  }) as Document["getElementById"];

  try {
    assert.equal(isAdPlaying(), false, "isAdPlaying returns false even if is-advertisement exists while disabled");
    assert.equal(ytmHost.syncAdState(), false, "syncAdState returns false when disabled");
    assert.equal(queryCount, 0, "disabled ad check performs zero document.querySelector calls");
    assert.equal(byIdCount, 0, "disabled ad check performs zero hideAdOverlay getElementById calls");
  } finally {
    doc.querySelector = origQuerySelector;
    doc.getElementById = origGetElementById;
  }
}

// -- Enabling shows overlay and tracks mutations; disabling cleans overlay & stops observer --------------------------
{
  const { playerBar } = buildAdFixture(true);
  AppState.isAdCheckEnabled = true;
  syncAdCheckState();

  const overlay = doc.getElementById(LYRICS_AD_OVERLAY_ID);
  assert.ok(overlay, "overlay is created once enabled");
  assert.equal(overlay.hasAttribute("active"), true, "overlay activates when ad attribute is present");
  assert.equal(isAdPlaying(), true);
  assert.equal(ytmHost.syncAdState(), true);

  playerBar.removeAttribute(AD_PLAYING_ATTR);
  await flushMicrotasks();
  assert.equal(overlay.hasAttribute("active"), false, "observer clears overlay when ad ends");
  assert.equal(ytmHost.syncAdState(), false);

  playerBar.setAttribute(AD_PLAYING_ATTR, "");
  await flushMicrotasks();
  assert.equal(overlay.hasAttribute("active"), true, "observer re-activates overlay when next ad starts");

  AppState.isAdCheckEnabled = false;
  syncAdCheckState();
  assert.equal(overlay.hasAttribute("active"), false, "disabling live clears active overlay immediately");
  assert.equal(isAdPlaying(), false);
  assert.equal(ytmHost.syncAdState(), false);

  // Subsequent mutations while OFF must not re-activate overlay.
  playerBar.removeAttribute(AD_PLAYING_ATTR);
  playerBar.setAttribute(AD_PLAYING_ATTR, "");
  await flushMicrotasks();
  assert.equal(overlay.hasAttribute("active"), false, "ad observer was disconnected on disable");
  disposeAdObserver();
}
