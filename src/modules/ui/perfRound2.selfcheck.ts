import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { ANIMATING_CLASS } from "@braccato/core/constants";
import { LYRICS_WRAPPER_ID } from "@constants";
import type { GlassyFlowBridgeTarget } from "@modules/ui/glassyFlowBridge";

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

let lastIntersectionCallback: ((entries: IntersectionObserverEntry[]) => void) | null = null;
class FakeIntersectionObserver {
  constructor(cb: (entries: IntersectionObserverEntry[]) => void) {
    lastIntersectionCallback = cb;
  }
  observe(target: Element): void {
    lastIntersectionCallback?.([{ isIntersecting: true, target } as unknown as IntersectionObserverEntry]);
  }
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
  IntersectionObserver: FakeIntersectionObserver,
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
  IntersectionObserver: FakeIntersectionObserver,
});

const { AppState } = await import("@core/appState");
const { mainView } = await import("@modules/ui/mainLyricsView");
const { initGlassyFlowBridge } = await import("@modules/ui/glassyFlowBridge");
const { resetScrollHostCache, ytmHost } = await import("@modules/ui/lyricsHost");
const { createProgressBar, syncProgressBarOptimizationState } = await import("@modules/ui/playerControls/progressBar");

const doc = window.document;

// 1. Test glassyFlowBridge.ts (already installed on mainView.tick at import time)
{
  initGlassyFlowBridge();

  const container = doc.createElement("div");
  container.style.setProperty("--blyrics-richsync-timing-offset", "100ms");
  doc.body.appendChild(container);

  const lineEl = doc.createElement("div");
  const partEl = doc.createElement("span");
  lineEl.appendChild(partEl);
  container.appendChild(lineEl);

  let lineWriteCount = 0;
  let partWriteCount = 0;
  const origLineSetProp = lineEl.style.setProperty.bind(lineEl.style);
  lineEl.style.setProperty = ((prop: string, val: string | null, priority?: string) => {
    if (prop === "--blyrics-swipe-delay" || prop === "--blyrics-anim-delay") lineWriteCount++;
    return origLineSetProp(prop, val, priority);
  }) as typeof lineEl.style.setProperty;

  const origPartSetProp = partEl.style.setProperty.bind(partEl.style);
  partEl.style.setProperty = ((prop: string, val: string | null, priority?: string) => {
    if (prop === "--blyrics-swipe-delay" || prop === "--blyrics-anim-delay") partWriteCount++;
    return origPartSetProp(prop, val, priority);
  }) as typeof partEl.style.setProperty;

  let gcsCalls = 0;
  const realGcs = globalThis.getComputedStyle;
  globalThis.getComputedStyle = ((el: Element) => {
    if (el === container) gcsCalls++;
    return realGcs(el);
  }) as typeof globalThis.getComputedStyle;

  Object.defineProperties(mainView, {
    container: { value: container, configurable: true, writable: true },
    syncType: { value: "richsync", configurable: true, writable: true },
    lines: {
      value: [
        {
          time: 10,
          duration: 3,
          lyricElement: lineEl,
          parts: [{ time: 10, duration: 1, lyricElement: partEl }],
        },
      ],
      configurable: true,
      writable: true,
    },
  });

  // At t = 6.5s (3.4s before line.time=10s), outside the 2s lookahead -> 0 style writes, 1 cached getComputedStyle
  mainView.tick(6.5, { isPlaying: true } as any);
  assert.equal(gcsCalls, 1, "first tick reads computed style once");
  assert.equal(lineWriteCount, 0, "no style writes when line is >2s ahead");
  assert.equal(partWriteCount, 0, "no part style writes ever");

  // At t = 7.0s (still >2s ahead) -> 0 style writes, 0 new getComputedStyle calls
  mainView.tick(7.0, { isPlaying: true } as any);
  assert.equal(gcsCalls, 1, "second tick uses cached timing offset");
  assert.equal(lineWriteCount, 0, "still no style writes at >2s ahead");

  // At t = 7.78s (actualTime = 7.88s -> timeToLine = 2.12s, inside skew buffer) -> pre-arms once
  mainView.tick(7.78, { isPlaying: true } as any);
  assert.equal(lineWriteCount, 1, "pre-arms --blyrics-anim-delay once on line inside clock-skew buffer");
  assert.equal(partWriteCount, 0, "does not write delay vars onto word parts");
  assert.equal(lineEl.style.getPropertyValue("--blyrics-swipe-delay"), "", "does not write dead --blyrics-swipe-delay");
  assert.ok(parseFloat(lineEl.style.getPropertyValue("--blyrics-anim-delay")) > 2.0, "buffer delay > 2s");

  // Consecutive buffer tick at 7.80s -> 0 additional writes
  mainView.tick(7.8, { isPlaying: true } as any);
  assert.equal(lineWriteCount, 1, "does not re-write delays within clock-skew buffer");

  // At t = 8.0s (actualTime = 8.1s, within 2s of line.time=10s) -> refreshes exact delay once (stage 2)
  mainView.tick(8.0, { isPlaying: true } as any);
  assert.equal(lineWriteCount, 2, "refreshes delay once when entering exact 2s animating window");
  assert.ok(Math.abs(parseFloat(lineEl.style.getPropertyValue("--blyrics-anim-delay")) - 1.9) < 0.001, "exact delay set");

  // Subsequent ticks at 8.02s, 8.04s -> 0 additional writes even before ANIMATING_CLASS is added
  mainView.tick(8.02, { isPlaying: true } as any);
  mainView.tick(8.04, { isPlaying: true } as any);
  assert.equal(lineWriteCount, 2, "does not re-write delays on consecutive ticks in lookahead window");

  // Seek jump to 8.5s (>0.25s jump) while not yet animating -> re-applies delays once
  mainView.tick(8.5, { isPlaying: true } as any);
  assert.equal(lineWriteCount, 3, "re-writes delay after seek jump > 0.25s");

  // Once ANIMATING_CLASS is present, even a seek does not write
  lineEl.classList.add(ANIMATING_CLASS);
  mainView.tick(9.5, { isPlaying: true } as any);
  assert.equal(lineWriteCount, 3, "no writes once ANIMATING_CLASS is present");

  // Removing ANIMATING_CLASS (e.g. pause) and resuming re-applies cleanly
  lineEl.classList.remove(ANIMATING_CLASS);
  mainView.tick(8.5, { isPlaying: false } as any);
  mainView.tick(8.5, { isPlaying: true } as any);
  assert.equal(lineWriteCount, 4, "re-applies delay after ANIMATING_CLASS cleared on pause/resume");
  assert.equal(partWriteCount, 0, "word parts receive zero delay writes across all transitions");

  // Ordering invariant: core tick & retickFromPlaybackClock run before style writes
  const events: string[] = [];
  const orderLineEl = doc.createElement("div");
  container.appendChild(orderLineEl);
  const origOrderSetProp = orderLineEl.style.setProperty.bind(orderLineEl.style);
  orderLineEl.style.setProperty = ((prop: string, val: string | null, priority?: string) => {
    events.push(`setProperty:${prop}`);
    return origOrderSetProp(prop, val, priority);
  }) as typeof orderLineEl.style.setProperty;

  const mockView: GlassyFlowBridgeTarget = {
    container,
    syncType: "richsync" as const,
    lines: [{ time: 30, duration: 3, lyricElement: orderLineEl }],
    tick(currentTimeS: number, _options) {
      events.push(`tick:${currentTimeS}`);
      if (currentTimeS >= 29) {
        orderLineEl.classList.add(ANIMATING_CLASS);
      }
      return "ok";
    },
    retickFromPlaybackClock(buildOptions) {
      events.push("retick");
      buildOptions(Date.now() - 40, true);
      return "ok";
    },
  };

  initGlassyFlowBridge(mockView);
  mockView.tick(28.5, { isPlaying: true } as any);
  assert.deepEqual(events, ["tick:28.5", "setProperty:--blyrics-anim-delay"], "tick runs before writing delay var");

  events.length = 0;
  mockView.tick(29.0, { isPlaying: true } as any);
  assert.deepEqual(events, ["tick:29", "setProperty:--blyrics-anim-delay"], "seek activation sets initial delay after tick");

  events.length = 0;
  mockView.tick(29.4, { isPlaying: true } as any);
  assert.deepEqual(events, ["tick:29.4"], "skips writes when line was already animating before tick");

  orderLineEl.classList.remove(ANIMATING_CLASS);
  events.length = 0;
  mockView.retickFromPlaybackClock?.((_evt, _playing) => ({ isPlaying: true, globalLyricOffset: 0.5 }) as any);
  assert.deepEqual(events, ["retick", "setProperty:--blyrics-anim-delay"], "retick runs before writing delay var");

  // EventCreationTime clock-skew + retickFromPlaybackClock regression test (line 2 at t=20s)
  const line2El = doc.createElement("div");
  const part2El = doc.createElement("span");
  line2El.appendChild(part2El);
  container.appendChild(line2El);
  Object.defineProperty(mainView, "lines", {
    value: [
      {
        time: 20,
        duration: 3,
        lyricElement: line2El,
        parts: [{ time: 20, duration: 1, lyricElement: part2El }],
      },
    ],
    configurable: true,
    writable: true,
  });

  // t=17.74 + 0.1s offset = 17.84s (timeToLine = 2.16s > 2.15s) -> not armed yet
  mainView.tick(17.74, { isPlaying: true, eventCreationTime: Date.now() } as any);
  assert.equal(line2El.style.getPropertyValue("--blyrics-anim-delay"), "", "line 2 not armed before skew buffer");

  // retickFromPlaybackClock with 40ms elapsed eventCreationTime skew -> actualTime=17.88s (timeToLine=2.12s) -> armed!
  mainView.retickFromPlaybackClock(
    (_evt, isPlaying) => ({ isPlaying: true, eventCreationTime: Date.now() - 40 }) as any
  );
  const retickDelay = parseFloat(line2El.style.getPropertyValue("--blyrics-anim-delay"));
  assert.ok(Number.isFinite(retickDelay) && retickDelay > 2.0 && retickDelay <= 2.15, "retick arms buffer with elapsed skew");

  // Head <style> insertion invalidates cached timing offset
  const themeStyle = doc.createElement("style");
  themeStyle.textContent = ":root { --blyrics-richsync-timing-offset: 200ms; }";
  doc.head.appendChild(themeStyle);
  await Promise.resolve();
  mainView.tick(17.74, { isPlaying: true, eventCreationTime: Date.now() } as any);
  assert.ok(gcsCalls >= 2, "head <style> mutation invalidates cached timing offset");
  themeStyle.remove();
  await Promise.resolve();

  globalThis.getComputedStyle = realGcs;
}

// 2. Test lyricsHost.ts (isOptimizedScrollHostEnabled)
{
  doc.body.replaceChildren();
  resetScrollHostCache();

  const tabRenderer = doc.createElement("div");
  tabRenderer.id = "tab-renderer";
  const wrapper = doc.createElement("div");
  wrapper.id = LYRICS_WRAPPER_ID;
  const lyricsContainer = doc.createElement("div");
  lyricsContainer.className = "blyrics-container";
  lyricsContainer.style.setProperty("--blyrics-animate-scroll", "0");
  wrapper.appendChild(lyricsContainer);
  tabRenderer.appendChild(wrapper);
  doc.body.appendChild(tabRenderer);

  let gbcrCalls = 0;
  const origGbcr = lyricsContainer.getBoundingClientRect.bind(lyricsContainer);
  lyricsContainer.getBoundingClientRect = () => {
    gbcrCalls++;
    return origGbcr();
  };

  let queryCalls = 0;
  const origQuery = doc.querySelector.bind(doc);
  doc.querySelector = ((sel: string) => {
    if (sel === "#tab-renderer") queryCalls++;
    return origQuery(sel);
  }) as typeof doc.querySelector;

  AppState.isOptimizedScrollHostEnabled = false;
  const el1 = ytmHost.getScrollElement()!;
  const el2 = ytmHost.getScrollElement()!;
  assert.equal(el1, tabRenderer);
  assert.equal(el2, tabRenderer);
  assert.equal(queryCalls, 2, "legacy mode queries #tab-renderer on every call");

  el1.scrollTop = 50;
  assert.equal(gbcrCalls, 1, "legacy mode forces reflow via getBoundingClientRect()");

  // Switch to optimized mode
  AppState.isOptimizedScrollHostEnabled = true;
  queryCalls = 0;
  gbcrCalls = 0;

  ytmHost.getScrollElement();
  ytmHost.getScrollElement();
  ytmHost.getScrollElement();
  assert.equal(queryCalls, 1, "optimized mode caches #tab-renderer across calls");

  el1.scrollTop = 100;
  el1.scrollTop = 150;
  assert.equal(gbcrCalls, 0, "optimized mode skips getBoundingClientRect() forced reflow");
  assert.equal(lyricsContainer.style.transform, "translate(0px, 50px)");

  doc.querySelector = origQuery;
  AppState.isOptimizedScrollHostEnabled = false;
  resetScrollHostCache();
}

// 3. Test progressBar.ts (isOptimizedProgressBarEnabled)
{
  doc.body.replaceChildren();
  const layout = doc.createElement("div");
  layout.id = "layout";
  layout.setAttribute("player-fullscreened", "");
  doc.body.appendChild(layout);

  AppState.isOptimizedProgressBarEnabled = false;
  const handle = createProgressBar({
    doc,
    getSnapshot: () => ({ currentTimeS: 10, durationS: 100, wallTime: window.Date.now(), isPlaying: true, playbackRate: 1 }),
    onSeek: () => {},
  });
  doc.body.appendChild(handle.element);

  assert.equal(handle.element.style.contain, "", "legacy progress bar has no CSS containment");

  AppState.isOptimizedProgressBarEnabled = true;
  syncProgressBarOptimizationState(true);
  assert.equal(handle.element.style.contain, "layout style paint", "optimized progress bar sets CSS containment");

  AppState.isOptimizedProgressBarEnabled = false;
  syncProgressBarOptimizationState(false);
  assert.equal(handle.element.style.contain, "", "disabling optimization removes CSS containment");

  handle.destroy();
}

console.log("perfRound2 self-check passed");
