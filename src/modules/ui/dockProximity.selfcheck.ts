import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createDockProximityTracker, type DockProximityMode } from "@modules/ui/dockProximity";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true });
const { window: win } = dom;
const doc = win.document;

let fakeNow = 0;
Object.defineProperty(win, "performance", {
  configurable: true,
  value: { now: () => fakeNow },
});

const pendingRafs = new Map<number, FrameRequestCallback>();
let nextRafId = 1;
win.requestAnimationFrame = (cb: FrameRequestCallback): number => {
  const id = nextRafId++;
  pendingRafs.set(id, cb);
  return id;
};
win.cancelAnimationFrame = (id: number): void => {
  pendingRafs.delete(id);
};

function flushRaf(): void {
  const entries = Array.from(pendingRafs.entries());
  pendingRafs.clear();
  for (const [, cb] of entries) cb(fakeNow);
}

let activeResizeObservers = 0;
const resizeCallbacks = new Set<ResizeObserverCallback>();
class TrackedResizeObserver {
  private cb: ResizeObserverCallback;
  private active = false;
  constructor(cb: ResizeObserverCallback) {
    this.cb = cb;
  }
  observe(): void {
    if (!this.active) {
      this.active = true;
      activeResizeObservers++;
      resizeCallbacks.add(this.cb);
    }
  }
  unobserve(): void {}
  disconnect(): void {
    if (this.active) {
      this.active = false;
      activeResizeObservers--;
      resizeCallbacks.delete(this.cb);
    }
  }
}
(win as unknown as { ResizeObserver: unknown }).ResizeObserver = TrackedResizeObserver;

Object.defineProperty(win, "innerHeight", { configurable: true, value: 1000 });

const layout = doc.createElement("div");
layout.id = "layout";
layout.setAttribute("player-ui-state", "PLAYER_PAGE_OPEN");
doc.body.appendChild(layout);

const playerBar = doc.createElement("div");
playerBar.className = "player-bar";
doc.body.appendChild(playerBar);

const sidePanel = doc.createElement("div");
sidePanel.id = "side-panel";
const dock = doc.createElement("div");
dock.className = "blyrics-dock";
dock.dataset.position = "bottom-right";
const inner = doc.createElement("div");
inner.className = "blyrics-dock__inner";
dock.appendChild(inner);
sidePanel.appendChild(dock);
doc.body.appendChild(sidePanel);

let dockRect: DOMRect = {
  left: 800,
  right: 980,
  top: 860,
  bottom: 920,
  width: 180,
  height: 60,
  x: 800,
  y: 860,
  toJSON: () => ({}),
};
let playerBarRect: DOMRect = {
  left: 0,
  right: 1000,
  top: 930,
  bottom: 1000,
  width: 1000,
  height: 70,
  x: 0,
  y: 930,
  toJSON: () => ({}),
};
let dockTransform = "none";

let innerGbcrCalls = 0;
let barGbcrCalls = 0;
let getComputedStyleCalls = 0;

inner.getBoundingClientRect = (): DOMRect => {
  innerGbcrCalls++;
  return dockRect;
};
playerBar.getBoundingClientRect = (): DOMRect => {
  barGbcrCalls++;
  return playerBarRect;
};

const origGetComputedStyle = win.getComputedStyle.bind(win);
win.getComputedStyle = ((el: Element, pseudo?: string | null): CSSStyleDeclaration => {
  if (el === dock) {
    getComputedStyleCalls++;
    return { transform: dockTransform } as CSSStyleDeclaration;
  }
  return origGetComputedStyle(el, pseudo);
}) as typeof win.getComputedStyle;

let lastDockNear: boolean | null = null;
let lastBarShown: boolean | null = null;
let currentMode: DockProximityMode = "legacy";

const tracker = createDockProximityTracker({
  dockClass: "blyrics-dock",
  playerBarSelector: ".player-bar",
  mode: () => currentMode,
  cacheMaxAgeMs: 500,
  doc,
  win: win as unknown as Window & typeof globalThis,
  onDockNear: (_el, near) => {
    lastDockNear = near;
  },
  onPlayerBarShown: shown => {
    lastBarShown = shown;
  },
});

function move(clientX: number, clientY: number): void {
  const ev = new win.MouseEvent("mousemove", { clientX, clientY });
  doc.dispatchEvent(ev);
  flushRaf();
}

// 1. Legacy mode measures on every mousemove frame.
fakeNow = 10;
move(850, 800); // within 104px above bottom-right dock (top=860 -> 756)
assert.equal(lastDockNear, true);
assert.equal(lastBarShown, true);
move(100, 100);
assert.equal(lastDockNear, false);
assert.equal(lastBarShown, false);
assert.equal(innerGbcrCalls, 2, "legacy mode reads dock rect every frame");
assert.equal(getComputedStyleCalls, 2, "legacy mode reads dock transform every frame");

// 2. Switch to cached mode: measures once, reuses cached geometry across subsequent moves.
currentMode = "cached";
tracker.syncMode();
innerGbcrCalls = 0;
getComputedStyleCalls = 0;
barGbcrCalls = 0;

fakeNow = 100;
move(850, 800);
assert.equal(lastDockNear, true);
assert.equal(innerGbcrCalls, 1, "cached mode reads once on cold cache");
assert.equal(getComputedStyleCalls, 1, "cached mode reads transform once on cold cache");

fakeNow = 150;
move(100, 100);
assert.equal(lastDockNear, false);
fakeNow = 200;
move(720, 880); // left=800 - 104 = 696
assert.equal(lastDockNear, true);
assert.equal(innerGbcrCalls, 1, "cached mode performs zero extra rect reads while fresh");
assert.equal(getComputedStyleCalls, 1, "cached mode performs zero extra computed-style reads while fresh");

// 3. Bottom dock translateY shift extends bottom edge downward (matches legacy).
dockTransform = "matrix(1, 0, 0, 1, 0, -40)"; // shifted up 40px -> bottom extends by +40 (920 -> 960)
tracker.invalidate();
fakeNow = 220;
move(850, 950);
assert.equal(lastDockNear, true, "bottom shiftY extends bottom proximity edge");
assert.equal(innerGbcrCalls, 2);

// 4. Max-age expiry refreshes cache after 500ms.
fakeNow = 750;
move(850, 950);
assert.equal(innerGbcrCalls, 3, "cache refreshes after cacheMaxAgeMs");

// 5. Collapsed player page (MINIPLAYER / INACTIVE) performs ZERO layout/style reads.
layout.setAttribute("player-ui-state", "MINIPLAYER");
tracker.invalidate();
innerGbcrCalls = 0;
getComputedStyleCalls = 0;
lastDockNear = null;
fakeNow = 800;
move(850, 880);
assert.equal(lastDockNear, null, "collapsed player page treats dock as inactive");
assert.equal(lastBarShown, false);
assert.equal(innerGbcrCalls, 0, "collapsed player page skips inner.getBoundingClientRect()");
assert.equal(getComputedStyleCalls, 0, "collapsed player page skips getComputedStyle()");

// Even after max-age expires on homepage, still zero geometry reads.
fakeNow = 1400;
move(500, 500);
assert.equal(innerGbcrCalls, 0, "homepage refresh still skips inner.getBoundingClientRect()");
assert.equal(getComputedStyleCalls, 0, "homepage refresh still skips getComputedStyle()");

// 6. Hidden dock classes also skip geometry reads.
layout.setAttribute("player-ui-state", "PLAYER_PAGE_OPEN");
dock.classList.add("blyrics-dock--off-page");
tracker.invalidate();
fakeNow = 1500;
move(850, 880);
assert.equal(innerGbcrCalls, 0, "off-page dock skips inner.getBoundingClientRect()");
assert.equal(getComputedStyleCalls, 0);
dock.classList.remove("blyrics-dock--off-page");

// 7. Fullscreen bottom reveal + open menu bridge.
layout.setAttribute("player-fullscreened", "");
layout.setAttribute("show-fullscreen-controls", "");
tracker.invalidate();
fakeNow = 1600;
move(50, 935); // playerBar top is 930 -> barNear=true even far from dock
assert.equal(lastBarShown, true, "fullscreen bottom reveal works in cached mode");
assert.equal(barGbcrCalls, 1);

const menu = doc.createElement("div");
menu.className = "blyrics-dock__menu blyrics-dock__menu--open";
let menuGbcrCalls = 0;
menu.getBoundingClientRect = (): DOMRect => {
  menuGbcrCalls++;
  return {
    left: 200,
    right: 320,
    top: 200,
    bottom: 300,
    width: 120,
    height: 100,
    x: 200,
    y: 200,
    toJSON: () => ({}),
  };
};
doc.body.appendChild(menu);
tracker.invalidate();
fakeNow = 1650;
move(250, 250);
assert.equal(lastDockNear, true, "open menu bounds keep dock near");
fakeNow = 1660;
move(255, 255);
assert.equal(lastDockNear, true);
assert.equal(menuGbcrCalls, 1, "open menu rect is cached across pointer moves");

// 8. Switching back to legacy tears down cached observers.
assert.equal(activeResizeObservers, 1, "cached mode attached ResizeObserver");
currentMode = "legacy";
tracker.syncMode();
assert.equal(activeResizeObservers, 0, "switching to legacy disconnects cached observers");

// 9. Destroy removes mousemove listener.
innerGbcrCalls = 0;
tracker.destroy();
move(850, 880);
assert.equal(innerGbcrCalls, 0, "destroy detaches mousemove listener");

console.log("dockProximity self-check passed");
