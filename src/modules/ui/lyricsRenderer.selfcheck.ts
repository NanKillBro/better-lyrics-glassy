import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createLyricsRenderer as createLegacyCoreRenderer } from "@braccato/core-legacy";
import {
  BIDI_SENSITIVE_CLASS,
  LONG_WORD_GROUP_CLASS,
  ROMANIZED_LYRICS_CLASS,
  RTL_CLASS,
  SWEEP_CELL_CLASS,
  TRANSLATED_LYRICS_CLASS,
  WORD_CLASS,
  WORD_GROUP_CLASS,
} from "@braccato/core/constants";
import {
  parseThemeConfig as parseLegacyThemeConfig,
  setThemeSettings as setLegacyThemeSettings,
} from "@braccato/core-legacy/themeSettings";
import {
  parseThemeConfig as parseWebglThemeConfig,
  setThemeSettings as setWebglThemeSettings,
} from "@braccato/core/themeSettings";
import {
  injectRomanization,
  injectTranslation,
  installWordWobblePatch,
  lyricBuildSettingsKey,
  normalizeWordWobbleAnimateArgs,
  registerThemeSetting,
  retargetPerWordWobble,
  type LineData,
  type WobbleLineData,
} from "@modules/ui/lyricsRenderer";
import { readRendererMode, WEBGL_LYRICS_ATTR } from "@modules/ui/rendererMode";
import { INSTRUMENTAL_STYLE_ATTR } from "@modules/settings/instrumentalStyle";

function makeTargetWithClass(className: string | null) {
  return {
    classList: {
      contains: (token: string) => className !== null && token === className,
    },
  };
}

function makeFakeElement(
  classes: string[],
  options: {
    parentElement?: HTMLElement | null;
    bidiSensitive?: boolean;
    content?: string;
    textContent?: string;
  } = {}
): HTMLElement {
  const classSet = new Set(classes);
  return {
    classList: {
      contains: (token: string) => classSet.has(token),
    },
    parentElement: options.parentElement ?? null,
    closest: (selector: string) =>
      selector === `.${BIDI_SENSITIVE_CLASS}` && options.bidiSensitive ? ({} as Element) : null,
    dataset: options.content !== undefined ? { content: options.content } : {},
    textContent: options.textContent ?? "",
  } as unknown as HTMLElement;
}

// 1. Rewrites un-eased core word-wobble calls without mutating inputs
{
  const f0: Keyframe = { transform: "scaleX(1)" };
  const f1: Keyframe = { transform: "translateX(0.05em) scaleX(1.025)", offset: 0.125, easing: "ease-in-out" };
  const f2: Keyframe = { transform: "translateX(0) scaleX(1)", offset: 0.75 };
  const f3: Keyframe = { transform: "scaleX(1)", easing: "ease-out" };
  const keyframes = [f0, f1, f2, f3];
  const options: KeyframeAnimationOptions = { duration: 1000, easing: "ease", fill: "forwards" };

  for (const cls of [WORD_GROUP_CLASS, WORD_CLASS]) {
    const out = normalizeWordWobbleAnimateArgs(makeTargetWithClass(cls), keyframes, options);
    assert.notEqual(out.keyframes, keyframes);
    assert.notEqual(out.options, options);
    assert.equal((out.keyframes as Keyframe[])[0].easing, "ease");
    assert.equal((out.keyframes as Keyframe[])[1].easing, "ease-in-out");
    assert.equal((out.keyframes as Keyframe[])[2].easing, "ease");
    assert.equal((out.keyframes as Keyframe[])[3].easing, "ease-out");
    assert.equal((out.options as KeyframeAnimationOptions).easing, "linear");
  }
  assert.equal(f0.easing, undefined, "input keyframe not mutated");
  assert.equal(options.easing, "ease", "input options not mutated");
}

// 2. Passes through already-fixed calls and non-word-group elements untouched
{
  const fixedKeyframes = [
    { transform: "scaleX(1)", easing: "ease" },
    { transform: "translateX(0.05em) scaleX(1.025)", offset: 0.125, easing: "ease-in-out" },
    { transform: "translateX(0) scaleX(1)", offset: 0.75, easing: "ease" },
    { transform: "scaleX(1)", easing: "ease-out" },
  ];
  const fixedOptions: KeyframeAnimationOptions = { duration: 1000, easing: "linear", fill: "forwards" };
  const unchanged = normalizeWordWobbleAnimateArgs(makeTargetWithClass(WORD_GROUP_CLASS), fixedKeyframes, fixedOptions);
  assert.equal(unchanged.keyframes, fixedKeyframes);
  assert.equal(unchanged.options, fixedOptions);

  const nonWordKeyframes = [
    { transform: "scaleX(1)" },
    { transform: "scaleX(1.025)", offset: 0.125, easing: "ease-in-out" },
    { transform: "scaleX(1)", offset: 0.75 },
    { transform: "scaleX(1)", easing: "ease-out" },
  ];
  const nonWordOptions: KeyframeAnimationOptions = { duration: 1000, easing: "ease", fill: "forwards" };
  const ignored = normalizeWordWobbleAnimateArgs(makeTargetWithClass(null), nonWordKeyframes, nonWordOptions);
  assert.equal(ignored.keyframes, nonWordKeyframes);
  assert.equal(ignored.options, nonWordOptions);
}

// 3. installWordWobblePatch is idempotent and intercepts Element.prototype.animate cleanly
{
  const recorded: Array<{ keyframes: Keyframe[]; options: KeyframeAnimationOptions }> = [];
  class FakeElement {
    classList: { contains: (token: string) => boolean };
    constructor(hasWordGroup: boolean) {
      this.classList = { contains: (token: string) => hasWordGroup && token === WORD_GROUP_CLASS };
    }
    animate(keyframes: Keyframe[], options: KeyframeAnimationOptions): Animation {
      recorded.push({ keyframes, options });
      return {} as Animation;
    }
  }
  const fakeWindow = { Element: FakeElement };
  installWordWobblePatch(fakeWindow);
  installWordWobblePatch(fakeWindow);

  const wordGroup = new FakeElement(true);
  wordGroup.animate(
    [
      { transform: "scaleX(1)" },
      { transform: "translateX(0.05em) scaleX(1.025)", offset: 0.125, easing: "ease-in-out" },
      { transform: "translateX(0) scaleX(1)", offset: 0.75 },
      { transform: "scaleX(1)", easing: "ease-out" },
    ],
    { duration: 1000, easing: "ease", fill: "forwards" }
  );
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].keyframes[0].easing, "ease");
  assert.equal(recorded[0].keyframes[2].easing, "ease");
  assert.equal(recorded[0].options.easing, "linear");
}

// 4. retargetPerWordWobble splits grouped words to per-syllable targets, preserving bidi & joining scripts
{
  const latinGroup = makeFakeElement([WORD_GROUP_CLASS], { content: "hello" });
  const syl1 = makeFakeElement([WORD_CLASS], { parentElement: latinGroup });
  const syl1Hi = makeFakeElement([WORD_CLASS], { parentElement: latinGroup });
  const longGroup = makeFakeElement([WORD_GROUP_CLASS, LONG_WORD_GROUP_CLASS], { content: "superlongword" });
  const longPart = makeFakeElement([WORD_CLASS], { parentElement: longGroup });
  const longPartHi = makeFakeElement([WORD_CLASS], { parentElement: longGroup });
  const arabicGroup = makeFakeElement([WORD_GROUP_CLASS], { content: "مرحبا" });
  const arabicPart = makeFakeElement([WORD_CLASS], { parentElement: arabicGroup });
  const arabicPartHi = makeFakeElement([WORD_CLASS], { parentElement: arabicGroup });
  const bidiGroup = makeFakeElement([WORD_GROUP_CLASS], { content: "test", bidiSensitive: true });
  const bidiPart = makeFakeElement([WORD_CLASS], { parentElement: bidiGroup });
  const bidiPartHi = makeFakeElement([WORD_CLASS], { parentElement: bidiGroup });

  const lines: WobbleLineData[] = [
    {
      parts: [
        { lyricElement: syl1, highlightElement: syl1Hi, wobbleElements: [latinGroup] },
        { lyricElement: longPart, highlightElement: longPartHi, wobbleElements: [longGroup] },
        { lyricElement: arabicPart, highlightElement: arabicPartHi, wobbleElements: [arabicGroup] },
        { lyricElement: bidiPart, highlightElement: bidiPartHi, wobbleElements: [bidiGroup] },
      ],
    },
  ];

  retargetPerWordWobble(lines);
  assert.deepEqual(lines[0].parts[0].wobbleElements, [syl1, syl1Hi]);
  assert.deepEqual(lines[0].parts[1].wobbleElements, [longPart, longPartHi]);
  assert.deepEqual(lines[0].parts[2].wobbleElements, [arabicGroup], "Arabic joining group kept");
  assert.deepEqual(lines[0].parts[3].wobbleElements, [bidiGroup], "bidi-sensitive group kept");
}

// 5. Renderer mode & dual themeSettings registry sync
{
  const legacyDoc = { documentElement: { hasAttribute: () => false } } as unknown as Document;
  const webglDoc = {
    documentElement: { hasAttribute: (attr: string) => attr === WEBGL_LYRICS_ATTR },
  } as unknown as Document;

  assert.equal(readRendererMode(legacyDoc), false);
  assert.equal(readRendererMode(webglDoc), true);

  registerThemeSetting("blyrics-selfcheck-flag", false, true);
  setLegacyThemeSettings(parseLegacyThemeConfig("/* blyrics-selfcheck-flag = true; */"));
  setWebglThemeSettings(parseWebglThemeConfig("/* blyrics-selfcheck-flag = true; */"));
  assert.ok(lyricBuildSettingsKey(legacyDoc).includes("blyrics-selfcheck-flag=true"));
  assert.ok(lyricBuildSettingsKey(webglDoc).includes("blyrics-selfcheck-flag=true"));
  setLegacyThemeSettings(parseLegacyThemeConfig("/* blyrics-selfcheck-flag = false; */"));
  setWebglThemeSettings(parseWebglThemeConfig("/* blyrics-selfcheck-flag = false; */"));
  assert.ok(lyricBuildSettingsKey(legacyDoc).includes("blyrics-selfcheck-flag=false"));
  assert.ok(lyricBuildSettingsKey(webglDoc).includes("blyrics-selfcheck-flag=false"));
}

// 6. Legacy mode decoration injection mounts 1.20.0 DOM without sweep cells
{
  const createNode = (tag: string, text = ""): Record<string, unknown> => {
    const classSet = new Set<string>();
    const attrs = new Map<string, string>();
    const children: Array<Record<string, unknown>> = [];
    let textValue = text;
    const node: Record<string, unknown> = {
      nodeType: tag === "#text" ? 3 : 1,
      tagName: tag.toUpperCase(),
      children,
      childNodes: children,
      dataset: {},
      style: { setProperty: () => {}, removeProperty: () => {}, getPropertyValue: () => "" },
      classList: {
        add: (...cls: string[]) => cls.forEach(c => classSet.add(c)),
        remove: (...cls: string[]) => cls.forEach(c => classSet.delete(c)),
        contains: (c: string) => classSet.has(c),
      },
      get className() {
        return Array.from(classSet).join(" ");
      },
      set className(v: string) {
        classSet.clear();
        for (const t of String(v).split(/\s+/).filter(Boolean)) classSet.add(t);
      },
      setAttribute: (k: string, v: string) => attrs.set(k, v),
      getAttribute: (k: string) => attrs.get(k) ?? null,
      hasAttribute: (k: string) => attrs.has(k),
      get textContent(): string {
        if (this.nodeType === 3) return textValue;
        return children.map(c => String(c.textContent ?? "")).join("");
      },
      set textContent(v: string) {
        textValue = String(v);
        children.length = 0;
      },
      appendChild(child: Record<string, unknown>) {
        child.parentNode = node;
        child.parentElement = node;
        children.push(child);
        return child;
      },
      insertBefore(newChild: Record<string, unknown>, refChild: Record<string, unknown> | null) {
        newChild.parentNode = node;
        newChild.parentElement = node;
        const idx = refChild ? children.indexOf(refChild) : -1;
        if (idx >= 0) children.splice(idx, 0, newChild);
        else children.push(newChild);
        return newChild;
      },
      remove() {
        const parent = node.parentElement as { children?: Array<Record<string, unknown>> } | null;
        if (!parent?.children) return;
        const idx = parent.children.indexOf(node);
        if (idx >= 0) parent.children.splice(idx, 1);
      },
      querySelector(selector: string): Record<string, unknown> | null {
        const wanted = selector.startsWith(".") ? selector.slice(1) : null;
        for (const child of children) {
          if (child.nodeType !== 1) continue;
          if (wanted && (child.classList as { contains: (t: string) => boolean }).contains(wanted)) return child;
          const nested = (child.querySelector as (s: string) => Record<string, unknown> | null)(selector);
          if (nested) return nested;
        }
        return null;
      },
      closest: () => null,
    };
    return node;
  };

  const legacyDoc: Record<string, unknown> = {
    documentElement: { hasAttribute: () => false },
    createElement: (tag: string) => {
      const el = createNode(tag);
      el.ownerDocument = legacyDoc;
      return el;
    },
    createTextNode: (t: string) => {
      const txt = createNode("#text", t);
      txt.ownerDocument = legacyDoc;
      return txt;
    },
  };

  const lyricEl = createNode("div");
  lyricEl.ownerDocument = legacyDoc;
  const line: LineData = {
    time: 1,
    duration: 3,
    lyricElement: lyricEl as unknown as HTMLElement,
    animations: [],
    parts: [],
    isScrolled: false,
    isAnimationPlayStatePlaying: false,
    accumulatedOffsetMs: 0,
    isAnimating: false,
    lastAnimSetupAt: 0,
    isSelected: false,
    height: -1,
    position: -1,
    decorations: new Map(),
  };

  const timedParts = [{ startTimeMs: 1000, durationMs: 1500, words: "konnichiwa", isBackground: false }];
  injectRomanization(legacyDoc as unknown as Document, lyricEl as unknown as HTMLElement, line, "konnichiwa", timedParts);
  injectTranslation(legacyDoc as unknown as Document, lyricEl as unknown as HTMLElement, "hello", "en");
  assert.ok((lyricEl.querySelector as (s: string) => unknown)(`.${ROMANIZED_LYRICS_CLASS}`));
  assert.ok((lyricEl.querySelector as (s: string) => unknown)(`.${TRANSLATED_LYRICS_CLASS}`));
  assert.equal((lyricEl.querySelector as (s: string) => unknown)(`.${SWEEP_CELL_CLASS}`), null);
  assert.equal(line.parts.length, 1);
}

// 7. braccato-core-glassy@1.20.0-glassy.3: seekAnimation, glow-off/resting-invisible fade-out, scrollTop pre-read reuse, stale cleanup & cached lastSungLine
{
  const testDom = new JSDOM("<!doctype html><html><body><div id='scroll'><div id='mount'></div></div></body></html>", {
    pretendToBeVisual: true,
  });
  const tWin = testDom.window as unknown as Window & typeof globalThis;
  const tDoc = tWin.document;
  if (typeof (globalThis as Record<string, unknown>).DOMRect !== "function") {
    (globalThis as Record<string, unknown>).DOMRect = class {
      constructor(
        public x = 0,
        public y = 0,
        public width = 0,
        public height = 0
      ) {}
    };
  }
  let fakeNowMs = 50_000;
  Object.defineProperty(tWin, "performance", {
    configurable: true,
    value: { now: () => fakeNowMs },
  });
  Object.defineProperty(tWin, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent: () => false,
    }),
  });
  Object.defineProperty(tWin, "ResizeObserver", {
    configurable: true,
    value: class {
      observe() {}
      disconnect() {}
    },
  });
  Object.defineProperty(tDoc, "fonts", { configurable: true, value: { ready: Promise.resolve() } });

  interface MockAnim {
    target: Element;
    keyframes: Keyframe[];
    options: KeyframeAnimationOptions;
    playbackRate: number;
    currentTime: number | null;
    startTime: number | null;
    playState: AnimationPlayState;
    timeline: { currentTime: number };
    effect: { target: Element; getComputedTiming: () => { endTime: number }; getKeyframes: () => Keyframe[]; getTiming: () => KeyframeAnimationOptions };
    cancelled: boolean;
    cancel: () => void;
    pause: () => void;
    play: () => void;
    addEventListener: () => void;
  }

  const createdAnims: MockAnim[] = [];
  Object.defineProperty(tWin.Element.prototype, "animate", {
    configurable: true,
    value(this: Element, keyframes: Keyframe[], options: KeyframeAnimationOptions = {}) {
      let currentTime: number | null = null;
      let startTime: number | null = null;
      let playState: AnimationPlayState = "running";
      const anim: MockAnim = {
        target: this,
        keyframes,
        options,
        playbackRate: 1,
        get currentTime() {
          return currentTime;
        },
        set currentTime(v: number | null) {
          currentTime = v;
        },
        get startTime() {
          return startTime;
        },
        set startTime(v: number | null) {
          startTime = v;
          if (v !== null) playState = "running";
        },
        get playState() {
          return playState;
        },
        set playState(v: AnimationPlayState) {
          playState = v;
        },
        timeline: { currentTime: 49_990 },
        effect: {
          target: this,
          getComputedTiming: () => ({ endTime: Number(options.duration ?? 0) }),
          getKeyframes: () => keyframes,
          getTiming: () => options,
        },
        cancelled: false,
        cancel() {
          anim.cancelled = true;
          playState = "idle";
        },
        pause() {
          playState = "paused";
        },
        play() {
          playState = "running";
        },
        addEventListener() {},
      };
      createdAnims.push(anim);
      return anim as unknown as Animation;
    },
  });

  const scroller = tDoc.getElementById("scroll")!;
  const mount = tDoc.getElementById("mount")!;
  let scrollTopVal = 0;
  let scrollTopReads = 0;
  let scrollTopWrites = 0;
  Object.defineProperty(scroller, "scrollTop", {
    configurable: true,
    get: () => {
      scrollTopReads++;
      return scrollTopVal;
    },
    set: (v: number) => {
      scrollTopWrites++;
      scrollTopVal = Math.max(0, Math.min(2000, v));
    },
  });
  Object.defineProperty(scroller, "scrollHeight", { configurable: true, get: () => 2600 });
  Object.defineProperty(scroller, "clientHeight", { configurable: true, get: () => 600 });
  scroller.getBoundingClientRect = () => ({ height: 600, top: 0, left: 0, bottom: 600, right: 400, width: 400, x: 0, y: 0, toJSON: () => ({}) });

  const makeRenderer = () =>
    createLegacyCoreRenderer({
      document: tDoc,
      window: tWin,
      mount,
      host: { getScrollElement: () => scroller },
    });

  // 7a. Playing seekAnimation pins startTime from ownerDocument.defaultView.performance.now() at 1x and 1.5x; paused writes currentTime
  {
    const renderer = makeRenderer();
    renderer.setLyrics(
      [
        { startTimeMs: 1000, durationMs: 800, words: "Hello", parts: [{ startTimeMs: 1000, durationMs: 800, words: "Hello" }] },
        { startTimeMs: 5000, durationMs: 800, words: "World", parts: [{ startTimeMs: 5000, durationMs: 800, words: "World" }] },
        { startTimeMs: 8000, durationMs: 3000, words: "", isInstrumental: true },
      ],
      { songwriters: ["Writer A"] }
    );
    const credits = renderer.container!.querySelector<HTMLElement>(".blyrics-credits");
    assert.ok(credits, "credits element created");
    for (const [idx, y] of [
      [0, 100],
      [1, 900],
      [2, 1100],
    ] as const) {
      const el = renderer.lines[idx].lyricElement;
      el.getClientRects = () => [{ height: 60, width: 400, top: y, left: 0, bottom: y + 60, right: 400, x: 0, y }] as unknown as DOMRectList;
      el.getBoundingClientRect = () => ({ height: 60, top: y, left: 0, bottom: y + 60, right: 400, width: 400, x: 0, y, toJSON: () => ({}) });
    }
    credits.getBoundingClientRect = () => ({ height: 40, top: 1200, left: 0, bottom: 1240, right: 400, width: 400, x: 0, y: 1200, toJSON: () => ({}) });
    renderer.container!.getBoundingClientRect = () => ({ height: 1400, top: 0, left: 0, bottom: 1400, right: 400, width: 400, x: 0, y: 0, toJSON: () => ({}) });
    renderer.relayout(true);

    // No-op scroll at line 0 (scrollPos clamped to 0, scrollTop === 0): 1 read, 0 writes
    createdAnims.length = 0;
    scrollTopReads = 0;
    scrollTopWrites = 0;
    fakeNowMs = 50_000;
    renderer.tick(1.4, { eventCreationTime: -1, isPlaying: true, smoothScroll: false, playbackRate: 1 });
    assert.equal(scrollTopReads, 1, "no-op scroll reads scrollTop once (no mid-tick read-after-write)");
    assert.equal(scrollTopWrites, 0, "no-op scroll skips redundant scrollTop write");

    // Playing at 1x: word swipe/opacity/glow animations pin startTime using tWin.performance.now()
    const line0Opacity = createdAnims.find(
      a => a.target === renderer.lines[0].parts[0].highlightElement && a.options.duration === 1
    );
    assert.ok(line0Opacity, "word opacity animation created");
    assert.equal(line0Opacity.startTime, 50_000 - 1, "playing animation pins startTime to window performance.now() - timeMs / rate");
    assert.equal(line0Opacity.currentTime, null, "playing animation leaves currentTime unset when startTime is pinned");

    // Advancing to line 1 (scrollPos > 0) at 1.5x rate: 2 reads (pre-read + post-write clamp check), 1 write
    createdAnims.length = 0;
    scrollTopReads = 0;
    scrollTopWrites = 0;
    fakeNowMs = 60_000;
    renderer.tick(5.3, { eventCreationTime: -1, isPlaying: true, smoothScroll: false, playbackRate: 1.5 });
    assert.equal(scrollTopWrites, 1, "real scroll writes scrollTop once");
    assert.equal(scrollTopReads, 2, "real scroll reads scrollTop twice (pre-read + post-write clamp check, no mid-tick read before write)");
    assert.ok(scrollTopVal > 0, "scrollTop advanced to line 1");

    const line1Part = renderer.lines[1].parts[0] as unknown as {
      highlightElement: Element;
      highlightLetterElements?: Element[];
    };
    const line1SwipeTarget = line1Part.highlightLetterElements?.[0] ?? line1Part.highlightElement;
    const line1Swipe = createdAnims.find(
      a =>
        a.target === line1SwipeTarget &&
        a.keyframes.some(k => "--lyric-transition-amount-start" in k || "maskPosition" in k)
    );
    assert.ok(line1Swipe, "line 1 swipe animation created");
    assert.equal(line1Swipe.playbackRate, 1.5);
    // wordTimeMs = 300ms, swipeLeadMs = 80ms -> swipeTimeMs = 380ms -> startTime = 60_000 - 380 / 1.5
    assert.ok(
      Math.abs((line1Swipe.startTime ?? 0) - (60_000 - 380 / 1.5)) < 1e-6,
      "1.5x playing animation divides seekMs by playbackRate"
    );

    // Line 0 exited via fade-out: with default glowRestingInvisible (0 radius), fade-out omits filter
    const line0Exit = createdAnims.find(
      a => a.target === renderer.lines[0].parts[0].highlightElement && a.keyframes[0]?.opacity === 1 && a.keyframes[1]?.opacity === 0
    );
    assert.ok(line0Exit, "line 0 fade-out animation created");
    assert.equal(
      line0Exit.keyframes.every(k => k.filter === undefined),
      true,
      "default 0-radius resting glow omits filter during word fade-out"
    );

    // Stale animation cleanup cancels lingering animations past staleAnimationEndTime
    // and cached lastSungLine ignores trailing instrumental (line 2) so credits focus at t >= line 1 end (7.0s)
    assert.equal(renderer.container!.dataset.creditsFocused, undefined, "credits not focused before last sung line ends");
    renderer.tick(9.5, { eventCreationTime: -1, isPlaying: true, smoothScroll: false, playbackRate: 1.5 });
    assert.equal(line1Swipe.cancelled, true, "stale line 1 animation cancelled after staleAnimationEndTime");
    assert.equal(renderer.lines[1].parts[0].animations.length, 0);
    assert.equal(renderer.container!.dataset.creditsFocused, "true", "cached lastSungLine focuses credits after last sung line");

    // Switching to a new song invalidates cachedLastSungLine
    renderer.setLyrics(
      [
        { startTimeMs: 1000, durationMs: 2000, words: "Song 2", parts: [{ startTimeMs: 1000, durationMs: 2000, words: "Song 2" }] },
        { startTimeMs: 12000, durationMs: 3000, words: "Song 2 End", parts: [{ startTimeMs: 12000, durationMs: 3000, words: "Song 2 End" }] },
      ],
      { songwriters: ["Writer B"] }
    );
    const credits2 = renderer.container!.querySelector<HTMLElement>(".blyrics-credits");
    assert.ok(credits2);
    for (const [idx, y] of [
      [0, 100],
      [1, 300],
    ] as const) {
      const el = renderer.lines[idx].lyricElement;
      el.getClientRects = () => [{ height: 60, width: 400, top: y, left: 0, bottom: y + 60, right: 400, x: 0, y }] as unknown as DOMRectList;
      el.getBoundingClientRect = () => ({ height: 60, top: y, left: 0, bottom: y + 60, right: 400, width: 400, x: 0, y, toJSON: () => ({}) });
    }
    credits2.getBoundingClientRect = () => ({ height: 40, top: 400, left: 0, bottom: 440, right: 400, width: 400, x: 0, y: 400, toJSON: () => ({}) });
    renderer.container!.getBoundingClientRect = () => ({ height: 600, top: 0, left: 0, bottom: 600, right: 400, width: 400, x: 0, y: 0, toJSON: () => ({}) });
    renderer.relayout(true);
    renderer.tick(9.5, { eventCreationTime: -1, isPlaying: true, smoothScroll: false });
    assert.equal(renderer.container!.dataset.creditsFocused, undefined, "new song invalidates cachedLastSungLine (not focused at 9.5s)");
    renderer.tick(15.5, { eventCreationTime: -1, isPlaying: true, smoothScroll: false });
    assert.equal(renderer.container!.dataset.creditsFocused, "true", "new song focuses credits at 15.5s");
    renderer.destroy();
  }

  // 7b. Paused seek writes currentTime (not startTime), and glow-off with 4px resting radius still omits filter on exit
  {
    const renderer = makeRenderer();
    renderer.setLyrics([
      { startTimeMs: 2000, durationMs: 800, words: "GlowOff", parts: [{ startTimeMs: 2000, durationMs: 800, words: "GlowOff" }] },
      { startTimeMs: 6000, durationMs: 800, words: "Next", parts: [{ startTimeMs: 6000, durationMs: 800, words: "Next" }] },
    ]);
    renderer.container!.style.setProperty("--blyrics-animate-highlight-glow", "false");
    renderer.container!.style.setProperty("--blyrics-highlight-glow-radius-to", "4px");

    createdAnims.length = 0;
    renderer.tick(2.4, { eventCreationTime: -1, isPlaying: false, smoothScroll: false });
    const pausedPart = renderer.lines[0].parts[0] as unknown as {
      highlightElement: Element;
      highlightLetterElements?: Element[];
    };
    const pausedSwipeTarget = pausedPart.highlightLetterElements?.[0] ?? pausedPart.highlightElement;
    const pausedSwipe = createdAnims.find(
      a =>
        a.target === pausedSwipeTarget &&
        a.keyframes.some(k => "--lyric-transition-amount-start" in k || "maskPosition" in k)
    );
    assert.ok(pausedSwipe, "paused swipe animation created");
    assert.equal(pausedSwipe.startTime, null, "paused animation does not pin startTime");
    // wordTimeMs = 400ms, swipeLeadMs = 80ms -> swipeTimeMs = 480ms
    assert.ok(Math.abs((pausedSwipe.currentTime ?? 0) - 480) < 1e-6, "paused animation holds seek on currentTime");

    // Advance while playing past line 0 end -> triggers fade-out without filter even with 4px resting radius
    createdAnims.length = 0;
    renderer.tick(6.1, { eventCreationTime: -1, isPlaying: true, smoothScroll: false });
    const exitAnim = createdAnims.find(
      a => a.target === renderer.lines[0].parts[0].highlightElement && a.keyframes[0]?.opacity === 1 && a.keyframes[1]?.opacity === 0
    );
    assert.ok(exitAnim, "glow-off fade-out created");
    assert.equal(
      exitAnim.keyframes.every(k => k.filter === undefined),
      true,
      "glow-off theme omits drop-shadow filter during word fade-out even when resting radius is non-zero"
    );
    renderer.destroy();
  }

  // 7c. Glow-on with non-zero resting radius (4px) preserves drop-shadow filter during word fade-out
  {
    const renderer = makeRenderer();
    renderer.setLyrics([
      { startTimeMs: 2000, durationMs: 800, words: "GlowOn", parts: [{ startTimeMs: 2000, durationMs: 800, words: "GlowOn" }] },
      { startTimeMs: 6000, durationMs: 800, words: "After", parts: [{ startTimeMs: 6000, durationMs: 800, words: "After" }] },
    ]);
    renderer.container!.style.setProperty("--blyrics-animate-highlight-glow", "true");
    renderer.container!.style.setProperty("--blyrics-highlight-glow-radius-to", "4px");

    renderer.tick(2.4, { eventCreationTime: -1, isPlaying: true, smoothScroll: false });
    createdAnims.length = 0;
    renderer.tick(6.1, { eventCreationTime: -1, isPlaying: true, smoothScroll: false });
    const exitAnim = createdAnims.find(
      a => a.target === renderer.lines[0].parts[0].highlightElement && a.keyframes[0]?.opacity === 1 && a.keyframes[1]?.opacity === 0
    );
    assert.ok(exitAnim, "glow-on fade-out created");
    assert.equal(
      exitAnim.keyframes[0].filter,
      "drop-shadow(0 0 4px var(--blyrics-glow-color))",
      "glow-on theme with non-zero resting radius preserves filter during word fade-out"
    );
    renderer.destroy();
  }

  // 8. Three dots instrumental indicator: DOM, fill timing, Apple Wave, exit fade, live refresh & swapLyrics signature sync
  {
    const dotsLyrics = [
      { startTimeMs: 0, durationMs: 6000, words: "", isInstrumental: true },
      {
        startTimeMs: 7000,
        durationMs: 2000,
        words: "\u05e9\u05dc\u05d5\u05dd",
        agent: "v2",
        parts: [{ startTimeMs: 7000, durationMs: 2000, words: "\u05e9\u05dc\u05d5\u05dd" }],
      },
      { startTimeMs: 10000, durationMs: 4000, words: "", isInstrumental: true },
      {
        startTimeMs: 15000,
        durationMs: 2000,
        words: "\u05d1\u05d5\u05e7\u05e8",
        agent: "v2",
        parts: [{ startTimeMs: 15000, durationMs: 2000, words: "\u05d1\u05d5\u05e7\u05e8" }],
      },
    ];
    tDoc.documentElement.removeAttribute(INSTRUMENTAL_STYLE_ATTR);
    tDoc.documentElement.removeAttribute("blyrics-auto-hide-instrumental-bg");

    const renderer = makeRenderer();
    renderer.setLyrics(dotsLyrics, { songKey: "dots-song" });
    for (const [idx, y] of [
      [0, 100],
      [1, 300],
      [2, 500],
      [3, 700],
    ] as const) {
      const el = renderer.lines[idx].lyricElement;
      el.getClientRects = () =>
        [{ height: 60, width: 400, top: y, left: 0, bottom: y + 60, right: 400, x: 0, y }] as unknown as DOMRectList;
      el.getBoundingClientRect = () => ({
        height: 60,
        top: y,
        left: 0,
        bottom: y + 60,
        right: 400,
        width: 400,
        x: 0,
        y,
        toJSON: () => ({}),
      });
    }
    renderer.container!.getBoundingClientRect = () => ({
      height: 1000,
      top: 0,
      left: 0,
      bottom: 1000,
      right: 400,
      width: 400,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    renderer.relayout(true);

    const line0El = renderer.lines[0].lyricElement;
    const line2El = renderer.lines[2].lyricElement;
    const dotsIcon0 = line0El.querySelector(".blyrics--instrumental-icon.blyrics--instrumental-dots");
    assert.ok(dotsIcon0, "three dots wrapper created when attribute is dots");
    assert.equal(dotsIcon0.tagName.toLowerCase(), "span");
    assert.equal(line0El.querySelectorAll("span").length, 10, "three dots icon contains exact 10-span structure");
    assert.equal(line0El.querySelectorAll(".blyrics--instrumental-dot").length, 3);
    assert.equal(line0El.querySelectorAll(".blyrics--instrumental-dot-lit").length, 3);
    assert.equal(line2El.classList.contains(RTL_CLASS), true, "dots instrumental line inherits neighbour RTL class");
    assert.equal(line2El.dataset.direction, "rtl");
    assert.equal(line2El.dataset.agent, "v2", "dots instrumental line inherits neighbour duet agent");

    // Sequential 1->2->3 fill + staggered Apple Wave WAAPI animations (2600ms period, 1.5x rate, pause)
    createdAnims.length = 0;
    fakeNowMs = 70_000;
    renderer.tick(1.5, { eventCreationTime: -1, isPlaying: true, smoothScroll: false, playbackRate: 1.5 });
    const dots0 = Array.from(line0El.querySelectorAll(".blyrics--instrumental-dot"));
    const litDots0 = Array.from(line0El.querySelectorAll(".blyrics--instrumental-dot-lit"));
    const fillAnims = litDots0.map(lit =>
      createdAnims.find(a => a.target === lit && a.keyframes[0]?.opacity === 0 && a.keyframes[1]?.opacity === 1)
    );
    assert.equal(fillAnims.every(Boolean), true, "all 3 lit dots receive sequential opacity fill animations");
    assert.deepEqual(
      fillAnims.map(a => a!.options.delay),
      [0, 2000, 4000],
      "without auto-hide, 6000ms instrumental divides into 0/2000/4000ms sequential delays"
    );
    assert.equal(fillAnims[0]!.options.duration, 2000);
    const waveAnims = dots0.map(dot =>
      createdAnims.find(a => a.target === dot && a.options.iterations === Infinity)
    );
    assert.equal(waveAnims.every(Boolean), true, "all 3 dot wrappers receive infinite Apple Wave animations");
    assert.equal(waveAnims[0]!.options.duration, 2600);
    assert.equal(waveAnims[0]!.keyframes.length, 5);
    assert.equal(waveAnims[0]!.playbackRate, 1.5);
    const staggerDeltaMs =
      ((((((waveAnims[1]!.startTime ?? 0) - (waveAnims[0]!.startTime ?? 0)) * 1.5) % 2600) + 2600) % 2600);
    assert.ok(Math.abs(staggerDeltaMs - 350) < 1e-6, "Apple Wave staggers adjacent dots by 350ms modulo 2600ms");

    // Pausing freezes dots wave & fill animations; fresh paused start holds currentTime instead of startTime
    renderer.tick(2.0, { eventCreationTime: -1, isPlaying: false, smoothScroll: false, playbackRate: 1.5 });
    assert.equal(waveAnims.every(a => a!.playState === "paused"), true, "paused tick pauses dot wave animations");
    assert.equal(fillAnims.every(a => a!.playState === "paused"), true, "paused tick pauses dot fill animations");

    // Advancing past instrumental line triggers lit-dot fade-out
    createdAnims.length = 0;
    renderer.tick(7.2, { eventCreationTime: -1, isPlaying: true, smoothScroll: false, playbackRate: 1 });
    const dotExitAnims = litDots0.map(lit =>
      createdAnims.find(a => a.target === lit && a.keyframes[1]?.opacity === 0)
    );
    assert.equal(dotExitAnims.every(Boolean), true, "exiting active dots line triggers lit-dot fade-out");

    // Active Reveal resolveDotsFillDurationMs shortens fill window ahead of scroll lead (5420ms for 6000ms line)
    tDoc.documentElement.setAttribute("blyrics-auto-hide-instrumental-bg", "");
    renderer.setLyrics(dotsLyrics, { songKey: "dots-autohide-song" });
    const autohideLit0 = Array.from(renderer.lines[0].lyricElement.querySelectorAll(".blyrics--instrumental-dot-lit"));
    createdAnims.length = 0;
    renderer.tick(0.5, { eventCreationTime: -1, isPlaying: true, smoothScroll: false });
    const autohideFills = autohideLit0.map(lit =>
      createdAnims.find(a => a.target === lit && a.keyframes[0]?.opacity === 0 && a.keyframes[1]?.opacity === 1)
    );
    assert.ok(Math.abs(Number(autohideFills[0]?.options.duration) - 5420 / 3) < 1e-6, "auto-hide compresses dots fill slice");
    assert.ok(Math.abs(Number(autohideFills[1]?.options.delay) - 5420 / 3) < 1e-6);
    assert.ok(Math.abs(Number(autohideFills[2]?.options.delay) - (2 * 5420) / 3) < 1e-6);
    tDoc.documentElement.removeAttribute("blyrics-auto-hide-instrumental-bg");

    // refreshInstrumentalStyle() live switches note <-> dots, preserves RTL/duet classes, and syncs swapLyrics signature
    renderer.setLyrics(dotsLyrics, { songKey: "dots-swap-song" });
    tDoc.documentElement.setAttribute(INSTRUMENTAL_STYLE_ATTR, "note");
    (renderer as unknown as { refreshInstrumentalStyle: () => void }).refreshInstrumentalStyle();
    assert.equal(renderer.lines[0].lyricElement.querySelector(".blyrics--instrumental-dots"), null);
    const refreshedNoteSvg = renderer.lines[0].lyricElement.querySelector("svg.blyrics--instrumental-icon");
    assert.ok(refreshedNoteSvg, "refreshInstrumentalStyle restores classic note SVG");
    assert.equal(renderer.lines[2].lyricElement.classList.contains(RTL_CLASS), true);
    assert.equal(renderer.lines[2].lyricElement.dataset.agent, "v2");

    // Matching songKey + refreshed signature reuses existing SVG icon element
    renderer.setLyrics(dotsLyrics, { songKey: "dots-swap-song" });
    assert.equal(
      renderer.lines[0].lyricElement.querySelector("svg.blyrics--instrumental-icon"),
      refreshedNoteSvg,
      "syncInstrumentalSignature prevents redundant rebuild on subsequent swapLyrics"
    );

    // Removing note override without refreshInstrumentalStyle() causes swapLyrics to detect signature change and rebuild to dots
    tDoc.documentElement.removeAttribute(INSTRUMENTAL_STYLE_ATTR);
    renderer.setLyrics(dotsLyrics, { songKey: "dots-swap-song" });
    assert.equal(renderer.lines[0].lyricElement.querySelectorAll("span").length, 10, "swapLyrics detects style mismatch in lineSignature");

    renderer.destroy();
  }

  // 8. braccato-core-glassy@1.20.0-glassy.5: lookahead isolation on relayoutChangedLines & 2-line centering while bg sings
  {
    const renderer = makeRenderer();
    renderer.setLyrics([
      {
        startTimeMs: 10000,
        durationMs: 3300, // ends 13.3s (main ends 12.4s, short trailing bg 12.5-13.3s within 0.5s of Line B)
        words: "Line A (bg)",
        parts: [
          { startTimeMs: 10000, durationMs: 2400, words: "Line A" },
          { startTimeMs: 12500, durationMs: 800, words: "(bg)", isBackground: true },
        ],
      },
      {
        startTimeMs: 13000,
        durationMs: 3500, // 13.0s - 16.5s
        words: "Line B",
        parts: [{ startTimeMs: 13000, durationMs: 3500, words: "Line B" }],
      },
      {
        startTimeMs: 17000,
        durationMs: 3000,
        words: "Line C",
        parts: [{ startTimeMs: 17000, durationMs: 3000, words: "Line C" }],
      },
    ]);

    let line0BgH = 0;
    const syncGeom = () => {
      renderer.container!.style.setProperty("--blyrics-scroll-timing-offset", "0.5s");
      const heights = [60 + line0BgH, 60, 60];
      let y = 200;
      for (let i = 0; i < 3; i++) {
        const el = renderer.lines[i].lyricElement;
        const h = heights[i];
        const pos = y;
        el.getClientRects = () => [{ height: h, width: 400, top: pos, left: 0, bottom: pos + h, right: 400, x: 0, y: pos }] as unknown as DOMRectList;
        el.getBoundingClientRect = () => ({ height: h, top: pos, left: 0, bottom: pos + h, right: 400, width: 400, x: 0, y: pos, toJSON: () => ({}) });
        Object.defineProperty(el, "offsetHeight", { configurable: true, get: () => h });
        Object.defineProperty(el, "scrollHeight", { configurable: true, get: () => h });
        y += h + 20;
      }
      renderer.container!.getBoundingClientRect = () => ({ height: 1200, top: 0, left: 0, bottom: 1200, right: 400, width: 400, x: 0, y: 0, toJSON: () => ({}) });
      Object.defineProperty(renderer.container!, "clientWidth", { configurable: true, get: () => 400 });
      Object.defineProperty(renderer.container!, "clientHeight", { configurable: true, get: () => 1200 });
      Object.defineProperty(renderer.container!, "scrollHeight", { configurable: true, get: () => 1200 });
    };
    syncGeom();
    renderer.relayout(true);

    // 8a. Lookahead isolation: expanding Line A via relayoutChangedLines while Line B is in 0.54s lookahead (12.1s -> scrollTime 12.6s >= 13.0-0.54)
    // must center Line A ONLY and must NOT commit Line B early into lastScrollElements!
    renderer.tick(10.5, { eventCreationTime: -1, isPlaying: true, smoothScroll: false });
    const targetOffset = 600 * 0.37; // 222px
    assert.ok(Math.abs(scrollTopVal - (200 + 30 - targetOffset)) <= 1, "initial scroll centers Line A");

    for (const t of [10.9, 11.3, 11.7]) {
      renderer.tick(t, { eventCreationTime: -1, isPlaying: true, smoothScroll: false });
    }

    line0BgH = 45;
    syncGeom();
    (renderer as unknown as { relayoutChangedLines: (idx: number[]) => void }).relayoutChangedLines([0]);
    renderer.tick(12.1, { eventCreationTime: -1, isPlaying: true, smoothScroll: false });
    assert.ok(
      Math.abs(scrollTopVal - (200 + 105 / 2 - targetOffset)) <= 1,
      `layout-only scroll centers Line A (${200 + 105 / 2 - targetOffset}), got ${scrollTopVal}`
    );

    // At 12.55s (lyricScrollTime 13.05s >= Line B.time 13.0s), Line A finishes at 13.3s (within 0.5s ending threshold),
    // so Line B MUST scroll straight to exact focal!
    renderer.tick(12.55, { eventCreationTime: -1, isPlaying: true, smoothScroll: false });
    assert.ok(
      Math.abs(scrollTopVal - (325 + 30 - targetOffset)) <= 1,
      `Line B reaches exact focal (${325 + 30 - targetOffset}), got ${scrollTopVal}`
    );

    // 8b. Past line's trailing bg still playing when Line B starts (Line A main 10-12.5s, bg 12.6-14.8s; Line B 13.0-17.0s):
    // Both lines are actively singing (> 0.5s left on Line A), so [Line A, Line B] MUST center together like normal!
    renderer.setLyrics([
      {
        startTimeMs: 10000,
        durationMs: 4800, // ends 14.8s (main ends 12.5s, bg continues until 14.8s)
        words: "Line A (long bg)",
        parts: [
          { startTimeMs: 10000, durationMs: 2500, words: "Line A" },
          { startTimeMs: 12600, durationMs: 2200, words: "(long bg)", isBackground: true },
        ],
      },
      {
        startTimeMs: 13000,
        durationMs: 4000, // 13.0s - 17.0s
        words: "Line B",
        parts: [{ startTimeMs: 13000, durationMs: 4000, words: "Line B" }],
      },
      {
        startTimeMs: 17500,
        durationMs: 3000,
        words: "Line C",
        parts: [{ startTimeMs: 17500, durationMs: 3000, words: "Line C" }],
      },
    ]);
    // Simulate Active Reveal OFF (bg already expanded) and also lookahead reveal -> both center [Line A, Line B]
    line0BgH = 45;
    syncGeom();
    renderer.relayout(true);

    renderer.tick(10.5, { eventCreationTime: -1, isPlaying: true, smoothScroll: false });
    for (const t of [10.9, 11.3, 11.7, 12.1]) {
      renderer.tick(t, { eventCreationTime: -1, isPlaying: true, smoothScroll: false });
    }
    scrollTopWrites = 0;
    renderer.tick(12.55, { eventCreationTime: -1, isPlaying: true, smoothScroll: false });
    // Line A: 200..305 (center 252.5), Line B: 325..385 (center 355), avg = 303.75 -> scrollTop = 81.75
    const pairCenterWithBg = (200 + 105 / 2 + (325 + 30)) / 2 - targetOffset;
    assert.equal(scrollTopWrites, 1, "2-line centering commits in 1 scroll");
    assert.ok(
      Math.abs(scrollTopVal - pairCenterWithBg) <= 1,
      `active trailing bg + Line B centers both lines (${pairCenterWithBg}), got ${scrollTopVal}`
    );

    // Advancing through Line A's trailing bg end triggers 0 extra scrolls (no double scroll)
    scrollTopWrites = 0;
    for (const t of [13.1, 13.5, 13.9, 14.3, 14.7, 15.1]) {
      renderer.tick(t, { eventCreationTime: -1, isPlaying: true, smoothScroll: false });
    }
    assert.equal(scrollTopWrites, 0, "zero secondary/double scrolls as past line's trailing bg finishes");

    // 8c. Post-scroll bg expansion under Active Reveal:
    // (i) When Line A's trailing bg is still playing with Line B, expanding Line A's bg re-centers [Line A + bg, Line B] (+33.75px).
    line0BgH = 0;
    syncGeom();
    renderer.relayout(true);
    renderer.tick(10.5, { eventCreationTime: -1, isPlaying: true, smoothScroll: false });
    for (const t of [10.9, 11.3, 11.7, 12.1]) {
      renderer.tick(t, { eventCreationTime: -1, isPlaying: true, smoothScroll: false });
    }
    renderer.tick(12.55, { eventCreationTime: -1, isPlaying: true, smoothScroll: false });
    const pairCenterNoBg = (200 + 30 + (280 + 30)) / 2 - targetOffset; // 48
    assert.ok(
      Math.abs(scrollTopVal - pairCenterNoBg) <= 1,
      `collapsed Line A + Line B centers pair before bg reveal (${pairCenterNoBg}), got ${scrollTopVal}`
    );
    line0BgH = 45;
    syncGeom();
    (renderer as unknown as { relayoutChangedLines: (idx: number[]) => void }).relayoutChangedLines([0]);
    renderer.tick(12.75, { eventCreationTime: -1, isPlaying: true, smoothScroll: false });
    assert.ok(
      Math.abs(scrollTopVal - pairCenterWithBg) <= 1,
      `post-scroll bg expansion re-centers [Line A + bg, Line B] (${pairCenterWithBg}), got ${scrollTopVal}`
    );

    // (ii) When Line A's trailing bg finishes within 0.5s of Line B (13.0-13.4s) and expands right after Line B commits,
    // Line B stays locked at exact focal (scrollTop += 45, zero push-down).
    renderer.setLyrics([
      {
        startTimeMs: 10000,
        durationMs: 3400, // ends 13.4s (within 0.5s of Line B at 13.0s)
        words: "Line A (short post-scroll bg)",
        parts: [
          { startTimeMs: 10000, durationMs: 2400, words: "Line A" },
          { startTimeMs: 13000, durationMs: 400, words: "(short)", isBackground: true },
        ],
      },
      {
        startTimeMs: 13000,
        durationMs: 4000,
        words: "Line B",
        parts: [{ startTimeMs: 13000, durationMs: 4000, words: "Line B" }],
      },
      {
        startTimeMs: 17500,
        durationMs: 3000,
        words: "Line C",
        parts: [{ startTimeMs: 17500, durationMs: 3000, words: "Line C" }],
      },
    ]);
    line0BgH = 0;
    syncGeom();
    renderer.relayout(true);
    renderer.tick(10.5, { eventCreationTime: -1, isPlaying: true, smoothScroll: false });
    for (const t of [10.9, 11.3, 11.7, 12.1]) {
      renderer.tick(t, { eventCreationTime: -1, isPlaying: true, smoothScroll: false });
    }
    renderer.tick(12.55, { eventCreationTime: -1, isPlaying: true, smoothScroll: false });
    const lineBFocalNoBg = 280 + 30 - targetOffset; // 88
    assert.ok(Math.abs(scrollTopVal - lineBFocalNoBg) <= 1, `short-bg Line B reaches focal (${lineBFocalNoBg}), got ${scrollTopVal}`);
    line0BgH = 45;
    syncGeom();
    (renderer as unknown as { relayoutChangedLines: (idx: number[]) => void }).relayoutChangedLines([0]);
    renderer.tick(12.65, { eventCreationTime: -1, isPlaying: true, smoothScroll: false });
    const lineBFocalWithBg = 325 + 30 - targetOffset; // 133
    assert.ok(
      Math.abs(scrollTopVal - lineBFocalWithBg) <= 1,
      `short post-scroll bg compensates scrollTop cleanly to keep Line B at focal (${lineBFocalWithBg}), got ${scrollTopVal}`
    );

    // 8d. Standalone background-only line still playing when Line B starts centers both lines together
    renderer.setLyrics([
      {
        startTimeMs: 10000,
        durationMs: 4500, // bg-only overlaps into Line B (ends 14.5s > 13.0s + 0.5s)
        words: "(ooh yeah)",
        parts: [{ startTimeMs: 10000, durationMs: 4500, words: "(ooh yeah)", isBackground: true }],
      },
      {
        startTimeMs: 13000,
        durationMs: 4000,
        words: "Line B",
        parts: [{ startTimeMs: 13000, durationMs: 4000, words: "Line B" }],
      },
      {
        startTimeMs: 17500,
        durationMs: 3000,
        words: "Line C",
        parts: [{ startTimeMs: 17500, durationMs: 3000, words: "Line C" }],
      },
    ]);
    line0BgH = 0;
    syncGeom();
    renderer.relayout(true);
    renderer.tick(10.5, { eventCreationTime: -1, isPlaying: true, smoothScroll: false });
    assert.ok(Math.abs(scrollTopVal - (200 + 30 - targetOffset)) <= 1, "bg-only line centers while it is the active line");
    for (const t of [10.9, 11.3, 11.7, 12.1, 12.55]) {
      renderer.tick(t, { eventCreationTime: -1, isPlaying: true, smoothScroll: false });
    }
    assert.ok(
      Math.abs(scrollTopVal - pairCenterNoBg) <= 1,
      `overlapping bg-only line + Line B centers both lines (${pairCenterNoBg}), got ${scrollTopVal}`
    );

    renderer.destroy();
  }
}

console.log("lyricsRenderer selfcheck passed");
