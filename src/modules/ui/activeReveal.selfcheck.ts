import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import type { Lyric, TickOptions } from "@braccato/core";
import type { ActiveRevealView, LayoutShiftPayload } from "@modules/ui/activeReveal";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true });
const { window } = dom;
let reducedMotion = false;

const stubMatchMedia = (query: string) => ({
  matches: query.includes("prefers-reduced-motion") ? reducedMotion : false,
  media: query,
  onchange: null,
  addListener() {},
  removeListener() {},
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent: () => false,
});

interface RecordedAnim {
  target: Element;
  keyframes: Keyframe[] | PropertyIndexedKeyframes | null;
  options: KeyframeAnimationOptions | number | undefined;
  cancelled: boolean;
  resolveFinish: () => void;
}

const recordedAnims: RecordedAnim[] = [];

Object.defineProperty(window.Element.prototype, "animate", {
  configurable: true,
  writable: true,
  value(keyframes: Keyframe[] | PropertyIndexedKeyframes | null, options?: KeyframeAnimationOptions | number) {
    let resolveFinish!: () => void;
    const finished = new Promise<void>(resolve => {
      resolveFinish = resolve;
    });
    const record: RecordedAnim = {
      target: this as Element,
      keyframes,
      options,
      cancelled: false,
      resolveFinish,
    };
    recordedAnims.push(record);
    return {
      finished,
      cancel() {
        record.cancelled = true;
      },
      play() {},
      pause() {},
    } as unknown as Animation;
  },
});

Object.assign(globalThis, {
  window,
  document: window.document,
  Element: window.Element,
  HTMLElement: window.HTMLElement,
  SVGElement: window.SVGElement,
  Node: window.Node,
  Event: window.Event,
  CustomEvent: window.CustomEvent,
  getComputedStyle: window.getComputedStyle.bind(window),
  matchMedia: stubMatchMedia,
});
Object.assign(window, { matchMedia: stubMatchMedia });

const {
  AUTO_HIDE_INSTRUMENTAL_BG_ATTR,
  AUTO_HIDE_INSTRUMENTAL_BG_DEFAULTS,
  BACKGROUND_ONLY_ATTR,
  LAYOUT_SHIFT_EVENT,
  REVEAL_COLLAPSED_CLASS,
  REVEAL_EXITING_CLASS,
  composeBlurFilter,
  computeLineLayoutShifts,
  extractBackgroundRowWindow,
  initActiveReveal,
  isAutoHideInstrumentalBgEnabled,
  isBackgroundOnlyLine,
  refreshActiveRevealInstrumental,
  shouldItemBeVisible,
  syncActiveReveal,
} = await import("@modules/ui/activeReveal");
const { WEBGL_LYRICS_ATTR } = await import("@modules/ui/rendererMode");
const { SharpenMarker } = await import("@modules/ui/fullscreenWindow/sharpenMarker");

// 1. Default enabled + feature gate respects WebGL2 Legacy-only boundary
{
  assert.equal(AUTO_HIDE_INSTRUMENTAL_BG_DEFAULTS.isAutoHideInstrumentalBackgroundEnabled, true);
  const root = window.document.documentElement;
  root.removeAttribute(AUTO_HIDE_INSTRUMENTAL_BG_ATTR);
  root.removeAttribute(WEBGL_LYRICS_ATTR);
  assert.equal(isAutoHideInstrumentalBgEnabled(window.document), false);

  root.setAttribute(AUTO_HIDE_INSTRUMENTAL_BG_ATTR, "");
  assert.equal(isAutoHideInstrumentalBgEnabled(window.document), true);

  root.setAttribute(WEBGL_LYRICS_ATTR, "");
  assert.equal(isAutoHideInstrumentalBgEnabled(window.document), false);

  root.removeAttribute(WEBGL_LYRICS_ATTR);
}

// 2. Background-only detection and background row timing extraction
{
  const doc = window.document;
  const normal = doc.createElement("div");
  normal.className = "blyrics--line";
  normal.innerHTML = `<div class="blyrics-line-main"><span class="blyrics--word">Hello</span></div><div class="blyrics-background-line"><span class="blyrics--word" data-time="12" data-duration="1.5">yeah</span><span class="blyrics--word blyrics-word-highlight" data-time="12" data-duration="1.5">yeah</span><span class="blyrics--word" data-time="13.5" data-duration="1">oh</span></div>`;
  assert.equal(isBackgroundOnlyLine(normal), false);
  const bgRow = normal.querySelector<HTMLElement>(".blyrics-background-line")!;
  assert.deepEqual(extractBackgroundRowWindow(bgRow, 10, 5), { startS: 12, endS: 14.5 });

  const lineSyncedBg = doc.createElement("div");
  lineSyncedBg.className = "blyrics-background-line";
  lineSyncedBg.innerHTML = `<span class="blyrics--word" data-time="11" data-duration="0">echo</span>`;
  assert.deepEqual(extractBackgroundRowWindow(lineSyncedBg, 10, 4), { startS: 11, endS: 14 });

  const bgOnly = doc.createElement("div");
  bgOnly.className = "blyrics--line";
  bgOnly.innerHTML = `<div class="blyrics-line-main">   </div><div class="blyrics-background-line"><span class="blyrics--word" data-time="20" data-duration="2">ooh</span></div>`;
  assert.equal(isBackgroundOnlyLine(bgOnly), true);

  const inst = doc.createElement("div");
  inst.className = "blyrics--line blyrics--instrumental";
  inst.dataset.instrumental = "true";
  assert.equal(isBackgroundOnlyLine(inst), false);
}

// 3. Layout shift computation & blur filter composition
{
  const oldTops = [100, 180, 260, 340];
  const newTops = [142, 142, 222, 302];
  assert.deepEqual(computeLineLayoutShifts(oldTops, newTops, 0, 4), [
    [0, -42],
    [1, 38],
    [2, 38],
    [3, 38],
  ]);
  assert.equal(shouldItemBeVisible({ kind: "background-row", lineIndex: 1, openAtS: 11.6, closeAtS: Number.POSITIVE_INFINITY }, 11.5), false);
  assert.equal(shouldItemBeVisible({ kind: "background-row", lineIndex: 1, openAtS: 11.6, closeAtS: Number.POSITIVE_INFINITY }, 11.6), true);
  assert.equal(shouldItemBeVisible({ kind: "background-row", lineIndex: 1, openAtS: 11.6, closeAtS: Number.POSITIVE_INFINITY }, 999), true);

  assert.equal(composeBlurFilter("", 8), "blur(8px)");
  assert.equal(composeBlurFilter("none", 0), "blur(0px)");
  assert.equal(
    composeBlurFilter("drop-shadow(0 0 5px rgba(255, 255, 255, 0.5))", 8),
    "drop-shadow(0 0 5px rgba(255, 255, 255, 0.5)) blur(8px)"
  );
}

// 4. Full lifecycle harness with mock Legacy view
{
  const doc = window.document;
  doc.documentElement.setAttribute(AUTO_HIDE_INSTRUMENTAL_BG_ATTR, "");
  doc.documentElement.removeAttribute(WEBGL_LYRICS_ATTR);

  const scrollEl = doc.createElement("div");
  let scrollTop = 0;
  Object.defineProperty(scrollEl, "scrollTop", {
    configurable: true,
    get: () => scrollTop,
    set: (v: number) => {
      scrollTop = v;
    },
  });
  Object.defineProperty(scrollEl, "clientHeight", { configurable: true, get: () => 800 });
  doc.body.appendChild(scrollEl);

  const container = doc.createElement("div");
  container.className = "blyrics-container blyrics--gf-managed";
  container.dataset.sync = "richsync";
  scrollEl.appendChild(container);

  interface FakeLine {
    time: number;
    duration: number;
    position: number;
    height: number;
    lyricElement: HTMLElement;
  }

  let relayoutCount = 0;
  const incrementalRelayoutCalls: number[][] = [];
  let tickScrollDelta = 0;
  let activeIndexOnTick = -1;
  let observedInstPosDuringTick = Number.NaN;
  const fakeLines: FakeLine[] = [];

  function makeLine(spec: {
    time: number;
    duration: number;
    instrumental?: boolean;
    mainText?: string;
    bgWords?: Array<{ text: string; time: number; duration: number }>;
    hasTranslation?: boolean;
  }): FakeLine {
    const el = doc.createElement("div");
    el.className = "blyrics--line";
    el.dataset.time = String(spec.time);
    el.dataset.duration = String(spec.duration);
    if (spec.instrumental) {
      el.classList.add("blyrics--instrumental");
      el.dataset.instrumental = "true";
      const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.classList.add("blyrics--instrumental-icon");
      el.appendChild(svg);
    } else {
      const main = doc.createElement("div");
      main.className = "blyrics-line-main";
      main.textContent = spec.mainText ?? "";
      el.appendChild(main);
      if (spec.bgWords) {
        const bg = doc.createElement("div");
        bg.className = "blyrics-background-line";
        for (const w of spec.bgWords) {
          const span = doc.createElement("span");
          span.className = "blyrics--word blyrics-background-lyric";
          span.dataset.time = String(w.time);
          span.dataset.duration = String(w.duration);
          span.textContent = w.text;
          bg.appendChild(span);
        }
        el.appendChild(bg);
      }
      if (spec.hasTranslation) {
        const tr = doc.createElement("div");
        tr.className = "blyrics--translated";
        tr.textContent = "translated";
        let trTop = 50;
        Object.defineProperty(tr, "offsetTop", {
          configurable: true,
          get: () => {
            const bg = el.querySelector<HTMLElement>(".blyrics-background-line");
            const bgCollapsed =
              bg && (bg.classList.contains(REVEAL_COLLAPSED_CLASS) || bg.classList.contains(REVEAL_EXITING_CLASS));
            return bgCollapsed ? trTop : trTop + 36;
          },
        });
        el.appendChild(tr);
      }
    }
    container.appendChild(el);
    return { time: spec.time, duration: spec.duration, position: 0, height: 0, lyricElement: el };
  }

  let creditsTop = 0;
  let footerTop = 0;

  function recomputeFakeLayout(): void {
    const introExpanded =
      fakeLines[0] &&
      !fakeLines[0].lyricElement.classList.contains(REVEAL_COLLAPSED_CLASS) &&
      !fakeLines[0].lyricElement.classList.contains(REVEAL_EXITING_CLASS);
    let y = introExpanded ? 100 : 140;
    for (const line of fakeLines) {
      const el = line.lyricElement;
      const collapsed =
        el.classList.contains(REVEAL_COLLAPSED_CLASS) || el.classList.contains(REVEAL_EXITING_CLASS);
      let h = 0;
      if (!collapsed) {
        h = el.dataset.instrumental === "true" ? 80 : 60;
        const bg = el.querySelector<HTMLElement>(":scope > .blyrics-background-line");
        if (
          bg &&
          !el.hasAttribute(BACKGROUND_ONLY_ATTR) &&
          !bg.classList.contains(REVEAL_COLLAPSED_CLASS) &&
          !bg.classList.contains(REVEAL_EXITING_CLASS)
        ) {
          h += 36;
        }
      }
      line.position = y;
      line.height = h;
      y += h > 0 ? h + 20 : 0;
    }
    creditsTop = y;
    footerTop = y + 48;
  }

  const layoutEvents: Array<{ shifts: [number, number][]; mode: string }> = [];
  container.addEventListener(LAYOUT_SHIFT_EVENT, event => {
    const raw = (event as CustomEvent<string>).detail;
    layoutEvents.push(JSON.parse(raw));
  });

  const fakeView = {
    container,
    get lines() {
      return fakeLines;
    },
    syncType: "richsync" as const,
    setLyrics(_lyrics: Lyric[]) {
      container.replaceChildren();
      fakeLines.length = 0;
      fakeLines.push(
        makeLine({ time: 0, duration: 8, instrumental: true }),
        makeLine({
          time: 8,
          duration: 6,
          mainText: "Main lyric",
          bgWords: [{ text: "echo", time: 11, duration: 2 }],
          hasTranslation: true,
        }),
        makeLine({ time: 14, duration: 8, instrumental: true }),
        makeLine({
          time: 22,
          duration: 3,
          mainText: "",
          bgWords: [{ text: "(ooh)", time: 22, duration: 3 }],
        }),
        makeLine({
          time: 25,
          duration: 4,
          mainText: "Next verse",
          bgWords: [{ text: "harmony", time: 25.1, duration: 2 }],
        }),
        makeLine({ time: 29, duration: 4, mainText: "Outro verse" })
      );
      const creditsEl = doc.createElement("div");
      creditsEl.className = "blyrics-credits";
      Object.defineProperty(creditsEl, "offsetTop", { configurable: true, get: () => creditsTop });
      const footerEl = doc.createElement("div");
      footerEl.className = "blyrics-footer";
      Object.defineProperty(footerEl, "offsetTop", { configurable: true, get: () => footerTop });
      container.appendChild(creditsEl);
      container.appendChild(footerEl);
      recomputeFakeLayout();
    },
    tick(_timeS: number, _opts: TickOptions) {
      observedInstPosDuringTick = fakeLines[2]?.position ?? Number.NaN;
      for (let i = 0; i < fakeLines.length; i++) {
        fakeLines[i].lyricElement.classList.toggle("blyrics--active", i === activeIndexOnTick);
      }
      if (tickScrollDelta !== 0) {
        scrollTop += tickScrollDelta;
        tickScrollDelta = 0;
      }
      return "ok" as const;
    },
    retickFromPlaybackClock(build: (t: number, p: boolean) => TickOptions) {
      build(Date.now(), true);
      return "ok" as const;
    },
    relayout() {
      relayoutCount += 1;
      recomputeFakeLayout();
    },
    relayoutChangedLines(changedIndices: readonly number[]) {
      incrementalRelayoutCalls.push([...changedIndices]);
      recomputeFakeLayout();
    },
    clear() {
      container.replaceChildren();
      fakeLines.length = 0;
    },
  };

  const baseTick = (isPlaying = true): TickOptions => ({
    eventCreationTime: -1,
    isPlaying,
    smoothScroll: false,
    globalLyricOffset: 0,
    lyricOffset: 0,
    richsyncOffsetTrim: 0,
    lineOffsetTrim: 0,
    passiveScrollEnabled: true,
    playbackRate: 1,
  });

  const originalViewTick = fakeView.tick;
  const originalViewSetLyrics = fakeView.setLyrics;

  initActiveReveal(fakeView, {
    document: doc,
    isViewVisible: () => true,
    getScrollElement: () => scrollEl,
  });
  assert.notEqual(fakeView.tick, originalViewTick, "hooks attached when setting is enabled");

  // Initial setLyrics collapses inactive items immediately before first paint
  fakeView.setLyrics([]);
  assert.equal(fakeLines[0].lyricElement.classList.contains(REVEAL_COLLAPSED_CLASS), false, "intro stays expanded at t=0");
  assert.equal(
    fakeLines[1].lyricElement.querySelector(".blyrics-background-line")!.classList.contains(REVEAL_COLLAPSED_CLASS),
    true,
    "nested bg collapsed at t=0"
  );
  assert.equal(fakeLines[2].lyricElement.classList.contains(REVEAL_COLLAPSED_CLASS), true, "interlude collapsed at t=0");
  assert.equal(fakeLines[3].lyricElement.hasAttribute(BACKGROUND_ONLY_ATTR), true, "bg-only line stamped");
  assert.equal(fakeLines[3].lyricElement.classList.contains(REVEAL_COLLAPSED_CLASS), true, "bg-only collapsed at t=0");
  assert.equal(relayoutCount, 1, "single synchronous relayout on setLyrics");

  // First tick at t=0.2s snaps without spurious layout-shift events
  activeIndexOnTick = 0;
  fakeView.tick(0.2, baseTick());
  assert.equal(layoutEvents.length, 0);

  // Seek near end of intro (7.1s -> snap still expanded), then normal playback crosses 7.5s
  fakeView.tick(7.1, baseTick());
  assert.equal(fakeLines[0].lyricElement.classList.contains(REVEAL_COLLAPSED_CLASS), false, "intro still expanded at 7.1s");

  // Intro closes at t=7.55s (endS 8 - 0.5s scrollLead), synced with scroll to line 1
  recordedAnims.length = 0;
  layoutEvents.length = 0;
  activeIndexOnTick = 1;
  tickScrollDelta = 50;
  fakeView.tick(7.55, baseTick());
  assert.equal(fakeLines[0].lyricElement.classList.contains(REVEAL_EXITING_CLASS), true, "intro enters non-clipping exiting state");
  assert.equal(layoutEvents.length, 1);
  assert.equal(layoutEvents[0].mode, "sync-scroll");
  // Intro top moved from 100->140 (-40), lines below moved up from 200->140 (+60)
  assert.deepEqual(layoutEvents[0].shifts[0], [0, -40]);
  assert.deepEqual(layoutEvents[0].shifts[1], [1, 60]);
  const introExitAnim = recordedAnims.find(a => a.target.classList.contains("blyrics--instrumental-icon"));
  assert.ok(introExitAnim, "exit WAAPI runs on instrumental icon");
  assert.equal((introExitAnim.options as KeyframeAnimationOptions).delay, 0, "sync-scroll exit starts immediately without pause");
  assert.equal(
    (introExitAnim.options as KeyframeAnimationOptions).duration,
    460,
    "forward GlassyFlow exit stretches smoothly across the 240ms scroll hold"
  );
  assert.equal(
    (introExitAnim.options as KeyframeAnimationOptions).easing,
    "cubic-bezier(0.8, 0.15, 0.4, 1)",
    "forward GlassyFlow exit uses gentle pre-scroll ease-in curve"
  );
  const introExitFrames = introExitAnim.keyframes as Keyframe[];
  assert.ok(String(introExitFrames[0].filter).includes("blur(0px)"), "exit starts unblurred");
  assert.ok(String(introExitFrames[1].filter).includes("blur(8px)"), "exit blurs out to 8px");
  assert.ok(String(introExitFrames[1].transform).includes("scale(0.72)"), "exit scales to 0.72");
  introExitAnim.resolveFinish();
  await Promise.resolve();
  assert.equal(fakeLines[0].lyricElement.classList.contains(REVEAL_COLLAPSED_CLASS), true, "intro transitions to collapsed on finish");
  assert.equal(fakeLines[0].lyricElement.classList.contains(REVEAL_EXITING_CLASS), false);

  // Advance near bgStart=11 without reaching 10.6 (11 - 0.4s lead) -> still collapsed
  fakeView.tick(8.2, baseTick());
  fakeView.tick(8.8, baseTick());
  fakeView.tick(9.4, baseTick());
  fakeView.tick(10.0, baseTick());
  fakeView.tick(10.55, baseTick());
  const bgRow1 = fakeLines[1].lyricElement.querySelector<HTMLElement>(".blyrics-background-line")!;
  assert.equal(bgRow1.classList.contains(REVEAL_COLLAPSED_CLASS), true);

  // Mid-line nested background row opens at t=10.65s (>= 11 - 0.4) -> immediate mode + sibling FLIP + slow blur/scale
  recordedAnims.length = 0;
  layoutEvents.length = 0;
  tickScrollDelta = 18;
  fakeView.tick(10.65, baseTick());
  assert.equal(bgRow1.classList.contains(REVEAL_COLLAPSED_CLASS), false, "nested bg opens at bgStart - 0.4s");
  assert.equal(layoutEvents.length, 1);
  assert.equal(layoutEvents[0].mode, "immediate", "mid-line bg shift uses immediate mode");
  const trFlipAnim = recordedAnims.find(a => a.target.classList.contains("blyrics--translated"));
  assert.ok(trFlipAnim, "translation sibling below bg row gets compositor FLIP");
  const bgEnterAnim = recordedAnims.find(a => a.target === bgRow1);
  assert.ok(bgEnterAnim, "bg row plays enter WAAPI");
  assert.equal((bgEnterAnim.options as KeyframeAnimationOptions).delay, 0, "mid-line bg enter has 0 delay");
  assert.equal((bgEnterAnim.options as KeyframeAnimationOptions).duration, 700, "bg enter runs over 700ms");
  const bgEnterFrames = bgEnterAnim.keyframes as Keyframe[];
  assert.ok(String(bgEnterFrames[0].filter).includes("blur(8px)"), "bg enter starts blurred at 8px");
  assert.ok(String(bgEnterFrames[1].filter).includes("blur(0px)"), "bg enter settles unblurred");
  assert.ok(String(bgEnterFrames[0].transform).includes("scale(0.78)"), "bg enter starts from smaller 0.78 scale");

  // Paused at 10.65s freezes state; user-scrolling defers changes
  fakeView.tick(10.65, baseTick(false));
  assert.equal(bgRow1.classList.contains(REVEAL_COLLAPSED_CLASS), false);

  container.classList.add("blyrics-user-scrolling");
  fakeView.tick(13.6, baseTick());
  assert.equal(fakeLines[2].lyricElement.classList.contains(REVEAL_COLLAPSED_CLASS), true, "user-scrolling defers interlude expand");
  container.classList.remove("blyrics-user-scrolling");

  // Advance past bgEnd=13 without collapsing nested bg row (past-line fade hides it naturally)
  fakeView.tick(11.3, baseTick());
  fakeView.tick(12.0, baseTick());
  fakeView.tick(12.7, baseTick());
  fakeView.tick(13.35, baseTick());
  assert.equal(bgRow1.classList.contains(REVEAL_COLLAPSED_CLASS), false, "nested bg stays expanded after bgEnd");
  assert.equal(bgRow1.classList.contains(REVEAL_EXITING_CLASS), false, "nested bg does not exit after bgEnd");

  // Mid-song instrumental opens at t=13.55s (14 - 0.5s): keeps true active line position (no scroll bias) + blur/scale enter
  recordedAnims.length = 0;
  layoutEvents.length = 0;
  activeIndexOnTick = 2;
  tickScrollDelta = 90;
  fakeView.tick(13.55, baseTick());
  assert.equal(fakeLines[2].lyricElement.classList.contains(REVEAL_COLLAPSED_CLASS), false, "interlude opens at start - 0.5s");
  assert.equal(bgRow1.classList.contains(REVEAL_COLLAPSED_CLASS), false, "nested bg remains expanded into interlude");
  assert.equal(layoutEvents.length, 1);
  assert.equal(layoutEvents[0].mode, "sync-scroll");
  const expectedRealInstPos = fakeLines[1].position + fakeLines[1].height + 20;
  assert.equal(observedInstPosDuringTick, expectedRealInstPos, "interlude uses true active line position during tick");
  const instEnterAnim = recordedAnims.find(a => a.target === fakeLines[2].lyricElement.querySelector(".blyrics--instrumental-icon"));
  assert.ok(instEnterAnim, "interlude enter WAAPI runs on icon");
  assert.equal((instEnterAnim.options as KeyframeAnimationOptions).delay, 180, "interlude enter waits 180ms");
  assert.equal((instEnterAnim.options as KeyframeAnimationOptions).duration, 420, "interlude enter runs over 420ms");
  const instEnterFrames = instEnterAnim.keyframes as Keyframe[];
  assert.ok(String(instEnterFrames[0].filter).includes("blur(8px)"), "interlude enter starts blurred at 8px");
  assert.ok(String(instEnterFrames[1].filter).includes("blur(0px)"), "interlude enter settles unblurred");
  assert.ok(String(instEnterFrames[0].transform).includes("scale(0.72)"), "interlude enter scales from 0.72");

  // Backward seek jump (> 0.75s) before bg openAtS re-collapses nested bg and interlude cleanly
  recordedAnims.length = 0;
  layoutEvents.length = 0;
  fakeView.tick(9.0, baseTick());
  assert.equal(bgRow1.classList.contains(REVEAL_COLLAPSED_CLASS), true, "backward seek re-collapses nested bg");
  assert.equal(fakeLines[2].lyricElement.classList.contains(REVEAL_COLLAPSED_CLASS), true, "backward seek re-collapses interlude");
  assert.equal(layoutEvents.length, 0, "seek snaps without FLIP dispatch");
  assert.equal(recordedAnims.length, 0, "seek snaps without enter/exit WAAPI");

  // Near-start nested bg on line 4 (lineStart=25, bgStart=25.1 <= 0.25s) aligns to lineStart - scrollLead (24.5s)
  // and uses sync-scroll even when .blyrics--active was already stamped early if a real lyric scroll occurs.
  fakeView.tick(24.0, baseTick());
  const bgRow4 = fakeLines[4].lyricElement.querySelector<HTMLElement>(".blyrics-background-line")!;
  assert.equal(bgRow4.classList.contains(REVEAL_COLLAPSED_CLASS), true, "near-start bg stays collapsed at 24.0s");
  fakeLines[0].lyricElement.style.setProperty("content-visibility", "auto");
  const fullRelayoutsBeforeBg4 = relayoutCount;
  incrementalRelayoutCalls.length = 0;
  fakeLines[4].lyricElement.classList.add("blyrics--active"); // simulate 0.54s early active stamp
  activeIndexOnTick = 4;
  recordedAnims.length = 0;
  layoutEvents.length = 0;
  tickScrollDelta = 110; // real lyric scroll coinciding with bg open
  fakeView.tick(24.55, baseTick());
  assert.equal(relayoutCount, fullRelayoutsBeforeBg4, "live toggle uses incremental relayout instead of full relayout");
  assert.deepEqual(incrementalRelayoutCalls, [[4]], "incremental relayout receives exact changed line index");
  assert.equal(
    fakeLines[0].lyricElement.style.contentVisibility,
    "auto",
    "offscreen culled line stays culled across live incremental relayout"
  );
  assert.equal(bgRow4.classList.contains(REVEAL_COLLAPSED_CLASS), false, "near-start bg aligns to lineStart - 0.5s");
  assert.equal(layoutEvents.length, 1);
  assert.equal(layoutEvents[0].mode, "sync-scroll", "coinciding lyric scroll uses sync-scroll even if active did not change");
  assert.ok(
    layoutEvents[0].shifts.some(([idx, dy]) => idx === fakeLines.length && dy === -36),
    "credits shift included at lines.length"
  );
  assert.ok(
    layoutEvents[0].shifts.some(([idx, dy]) => idx === fakeLines.length + 1 && dy === -36),
    "footer (Unison/source credit) shift included at lines.length + 1"
  );
  const bg4EnterAnim = recordedAnims.find(a => a.target === bgRow4);
  assert.ok(bg4EnterAnim);
  assert.equal((bg4EnterAnim.options as KeyframeAnimationOptions).delay, 260, "sync-scroll bg enter waits 260ms until hold releases");

  // Forward seek jump into interlude snaps nested bg expanded (already passed) and interlude expanded
  recordedAnims.length = 0;
  layoutEvents.length = 0;
  fakeView.tick(15.0, baseTick());
  assert.equal(bgRow1.classList.contains(REVEAL_COLLAPSED_CLASS), false, "forward seek keeps past bg expanded");
  assert.equal(fakeLines[2].lyricElement.classList.contains(REVEAL_COLLAPSED_CLASS), false, "forward seek snaps interlude expanded");
  assert.equal(layoutEvents.length, 0, "seek snaps without FLIP dispatch");
  assert.equal(recordedAnims.length, 0, "seek snaps without enter/exit WAAPI");

  // Smooth Scrolling fallback (not GlassyFlow managed) runs standalone WAAPI FLIP
  container.classList.remove("blyrics--gf-managed");
  fakeView.tick(15.6, baseTick());
  fakeView.tick(16.2, baseTick());
  fakeView.tick(16.8, baseTick());
  fakeView.tick(17.4, baseTick());
  fakeView.tick(18.0, baseTick());
  fakeView.tick(18.6, baseTick());
  fakeView.tick(19.2, baseTick());
  fakeView.tick(19.8, baseTick());
  fakeView.tick(20.4, baseTick());
  fakeView.tick(21.0, baseTick());
  recordedAnims.length = 0;
  layoutEvents.length = 0;
  activeIndexOnTick = 3;
  fakeView.tick(21.55, baseTick());
  assert.equal(layoutEvents.length, 0, "non-GlassyFlow does not dispatch GlassyFlow event");
  assert.equal(fakeLines[2].lyricElement.classList.contains(REVEAL_EXITING_CLASS), true, "interlude exits");
  assert.equal(fakeLines[3].lyricElement.classList.contains(REVEAL_COLLAPSED_CLASS), false, "bg-only opens at bgStart - 0.5s");

  // Advancing past bg-only end keeps bg-only expanded (no disappear)
  fakeView.tick(22.1, baseTick());
  fakeView.tick(22.7, baseTick());
  fakeView.tick(23.3, baseTick());
  fakeView.tick(23.9, baseTick());
  fakeView.tick(24.5, baseTick());
  fakeView.tick(25.1, baseTick());
  assert.equal(fakeLines[3].lyricElement.classList.contains(REVEAL_COLLAPSED_CLASS), false, "bg-only stays expanded after end");
  assert.equal(fakeLines[3].lyricElement.classList.contains(REVEAL_EXITING_CLASS), false, "bg-only does not exit after end");

  // Reduced motion snaps transitions without WAAPI animations
  fakeView.tick(13.0, baseTick()); // seek before interlude
  assert.equal(fakeLines[2].lyricElement.classList.contains(REVEAL_COLLAPSED_CLASS), true);
  reducedMotion = true;
  recordedAnims.length = 0;
  fakeView.tick(13.6, baseTick());
  assert.equal(fakeLines[2].lyricElement.classList.contains(REVEAL_COLLAPSED_CLASS), false, "interlude opens under reduced motion");
  assert.equal(recordedAnims.length, 0, "no WAAPI animations under reduced motion");
  reducedMotion = false;

  // Live toggle OFF restores every element, relayouts once, and detaches view hooks (zero per-tick overhead)
  const beforeRestoreRelayout = relayoutCount;
  doc.documentElement.removeAttribute(AUTO_HIDE_INSTRUMENTAL_BG_ATTR);
  syncActiveReveal(fakeView);
  assert.equal(relayoutCount, beforeRestoreRelayout + 1);
  assert.equal(fakeView.tick, originalViewTick, "tick hook detached when disabled");
  assert.equal(fakeView.setLyrics, originalViewSetLyrics, "setLyrics hook detached when disabled");
  for (const line of fakeLines) {
    assert.equal(line.lyricElement.classList.contains(REVEAL_COLLAPSED_CLASS), false);
    assert.equal(line.lyricElement.classList.contains(REVEAL_EXITING_CLASS), false);
    assert.equal(line.lyricElement.hasAttribute(BACKGROUND_ONLY_ATTR), false);
    const bg = line.lyricElement.querySelector(".blyrics-background-line");
    if (bg) assert.equal(bg.classList.contains(REVEAL_COLLAPSED_CLASS), false);
  }

  // Re-enabling re-attaches hooks cleanly
  doc.documentElement.setAttribute(AUTO_HIDE_INSTRUMENTAL_BG_ATTR, "");
  syncActiveReveal(fakeView);
  assert.notEqual(fakeView.tick, originalViewTick, "tick hook re-attached when re-enabled");

  // SharpenMarker skips collapsed lines when assigning below-1..6 ranks (only when setting enabled)
  const marker = new SharpenMarker();
  fakeLines[1].lyricElement.classList.add("blyrics--active", "blyrics--animating");
  fakeLines[1].lyricElement.style.setProperty("--blyrics-anim-delay", "0s");
  fakeLines[2].lyricElement.classList.add(REVEAL_COLLAPSED_CLASS);
  fakeLines[3].lyricElement.classList.add(REVEAL_COLLAPSED_CLASS);
  marker.sync(scrollEl, 9.0, true);
  assert.equal(fakeLines[2].lyricElement.classList.contains("blyrics--gf-below-1"), false, "collapsed line skipped");
  assert.equal(fakeLines[3].lyricElement.classList.contains("blyrics--gf-below-1"), false, "collapsed bg-only skipped");
  assert.equal(fakeLines[4].lyricElement.classList.contains("blyrics--gf-below-1"), true, "first visible line below gets below-1");

  // Expanding line 2 immediately updates below ranks
  fakeLines[2].lyricElement.classList.remove(REVEAL_COLLAPSED_CLASS);
  marker.sync(scrollEl, 9.1, false);
  assert.equal(fakeLines[2].lyricElement.classList.contains("blyrics--gf-below-1"), true);
  assert.equal(fakeLines[4].lyricElement.classList.contains("blyrics--gf-below-2"), true);
}

// 4. braccato-core-glassy leading background row ordering + activeReveal upward bloom & early openAtS
{
  const { createLyricsRenderer } = await import("@braccato/core-legacy");
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
  tDoc.documentElement.setAttribute(AUTO_HIDE_INSTRUMENTAL_BG_ATTR, "");
  Object.defineProperty(tWin, "matchMedia", { configurable: true, value: stubMatchMedia });
  Object.defineProperty(tWin, "ResizeObserver", {
    configurable: true,
    value: class {
      observe() {}
      disconnect() {}
    },
  });
  Object.defineProperty(tDoc, "fonts", { configurable: true, value: { ready: Promise.resolve() } });
  const leadingAnims: RecordedAnim[] = [];
  Object.defineProperty(tWin.Element.prototype, "animate", {
    configurable: true,
    value(this: Element, keyframes: Keyframe[] | PropertyIndexedKeyframes | null, options?: KeyframeAnimationOptions | number) {
      let resolveFinish = () => {};
      const finished = new Promise<void>(resolve => {
        resolveFinish = resolve;
      });
      const rec: RecordedAnim = { target: this, keyframes, options, cancelled: false, resolveFinish };
      leadingAnims.push(rec);
      return {
        finished,
        cancel() {
          rec.cancelled = true;
        },
        pause() {},
        play() {},
      } as unknown as Animation;
    },
  });

  const mount = tDoc.getElementById("mount")!;
  const scroller = tDoc.getElementById("scroll")!;
  const renderer = createLyricsRenderer({
    document: tDoc,
    window: tWin,
    mount,
    host: { getScrollElement: () => scroller },
  });

  renderer.setLyrics([
    {
      startTimeMs: 10000,
      durationMs: 4000,
      words: "(hey) Main after lead",
      parts: [
        { startTimeMs: 9000, durationMs: 800, words: "(hey)", isBackground: true, backgroundGroup: 0 },
        { startTimeMs: 10000, durationMs: 4000, words: "Main after lead" },
      ],
    },
    {
      startTimeMs: 15000,
      durationMs: 4000,
      words: "Main same (same)",
      parts: [
        { startTimeMs: 15000, durationMs: 2000, words: "Main same" },
        { startTimeMs: 15000, durationMs: 2000, words: "(same)", isBackground: true, backgroundGroup: 0 },
      ],
    },
    {
      startTimeMs: 20000,
      durationMs: 4000,
      words: "Main first (echo)",
      parts: [
        { startTimeMs: 20000, durationMs: 2000, words: "Main first" },
        { startTimeMs: 22000, durationMs: 1500, words: "(echo)", isBackground: true, backgroundGroup: 0 },
      ],
    },
    {
      startTimeMs: 29000,
      durationMs: 5000,
      words: "(pre) Center (post)",
      parts: [
        { startTimeMs: 29000, durationMs: 800, words: "(pre)", isBackground: true, backgroundGroup: 0 },
        { startTimeMs: 30000, durationMs: 2000, words: "Center" },
        { startTimeMs: 32000, durationMs: 1500, words: "(post)", isBackground: true, backgroundGroup: 1 },
      ],
    },
    {
      startTimeMs: 36000,
      durationMs: 3000,
      words: "(bg only)",
      parts: [{ startTimeMs: 36000, durationMs: 2500, words: "(bg only)", isBackground: true, backgroundGroup: 0 }],
    },
  ]);

  // Line 0: leading bg (9000 < 10000) placed ABOVE .blyrics-line-main
  const l0Children = Array.from(renderer.lines[0].lyricElement.children);
  assert.equal(l0Children[0].classList.contains("blyrics-background-line"), true, "leading bg is first child");
  assert.equal(l0Children[0].classList.contains("blyrics-background-line--above"), true, "leading bg carries --above class");
  assert.equal(l0Children[1].classList.contains("blyrics-line-main"), true, "main follows leading bg");

  // Line 1: simultaneous bg (15000 === 15000) stays BELOW .blyrics-line-main
  const l1Children = Array.from(renderer.lines[1].lyricElement.children);
  assert.equal(l1Children[0].classList.contains("blyrics-line-main"), true, "simultaneous main stays first");
  assert.equal(l1Children[1].classList.contains("blyrics-background-line"), true, "simultaneous bg stays below");
  assert.equal(l1Children[1].classList.contains("blyrics-background-line--above"), false);

  // Line 2: trailing bg (22000 > 20000) stays BELOW .blyrics-line-main
  const l2Children = Array.from(renderer.lines[2].lyricElement.children);
  assert.equal(l2Children[0].classList.contains("blyrics-line-main"), true, "trailing main stays first");
  assert.equal(l2Children[1].classList.contains("blyrics-background-line"), true, "trailing bg stays below");
  assert.equal(l2Children[1].classList.contains("blyrics-background-line--above"), false);

  // Line 3: mixed leading (group 0) + trailing (group 1) wraps around .blyrics-line-main
  const l3Children = Array.from(renderer.lines[3].lyricElement.children);
  assert.equal(l3Children.length, 3);
  assert.equal(l3Children[0].classList.contains("blyrics-background-line--above"), true, "group 0 above main");
  assert.equal(l3Children[1].classList.contains("blyrics-line-main"), true, "main in middle");
  assert.equal(l3Children[2].classList.contains("blyrics-background-line"), true, "group 1 below main");
  assert.equal(l3Children[2].classList.contains("blyrics-background-line--above"), false);

  // Line 4: background-only line stays standard (no --above)
  const l4Children = Array.from(renderer.lines[4].lyricElement.children);
  assert.equal(l4Children[0].classList.contains("blyrics-line-main"), true);
  assert.equal(l4Children[1].classList.contains("blyrics-background-line"), true);
  assert.equal(l4Children[1].classList.contains("blyrics-background-line--above"), false);

  // Verify activeReveal opens early leading bg (startS=9.0 < lineStartS=10.0) at 8.6s (not late at 9.5s)
  // and blooms upward (+10px) while FLIPing .blyrics-line-main smoothly.
  const leadBgEl = l0Children[0] as HTMLElement;
  const mainEl = l0Children[1] as HTMLElement;
  Object.defineProperty(mainEl, "offsetTop", {
    configurable: true,
    get: () => (leadBgEl.classList.contains(REVEAL_COLLAPSED_CLASS) ? 0 : 34),
  });
  initActiveReveal(renderer, { document: tDoc, isViewVisible: () => true, getScrollElement: () => scroller });
  syncActiveReveal(renderer);
  assert.equal(leadBgEl.classList.contains(REVEAL_COLLAPSED_CLASS), true, "leading bg collapsed initially");

  const tickOpts: TickOptions = { eventCreationTime: -1, isPlaying: true, smoothScroll: false };
  renderer.tick(8.2, tickOpts); // snap before openAtS=8.6s
  assert.equal(leadBgEl.classList.contains(REVEAL_COLLAPSED_CLASS), true, "leading bg still collapsed at 8.2s");

  leadingAnims.length = 0;
  renderer.tick(8.65, tickOpts); // crosses bgStartS - 0.4s (8.6s), before lineStartS - 0.5s (9.5s)!
  assert.equal(leadBgEl.classList.contains(REVEAL_COLLAPSED_CLASS), false, "early leading bg opens at bgStartS - 0.4s");
  const aboveEnter = leadingAnims.find(a => a.target === leadBgEl);
  assert.ok(aboveEnter, "leading bg plays enter WAAPI");
  assert.ok(
    String((aboveEnter.keyframes as Keyframe[])[0].transform).includes("translateY(10px)"),
    "leading bg blooms upward from +10px"
  );
  const mainFlip = leadingAnims.find(a => a.target === mainEl);
  assert.ok(mainFlip, ".blyrics-line-main gets inner sibling FLIP when leading bg expands");
  assert.equal((mainFlip.keyframes as Keyframe[])[0].translate, "0px -34.00px");

  renderer.destroy();
}

// 7. refreshActiveRevealInstrumental rebinds .blyrics--instrumental-icon and collapses exiting items
{
  const { createLyricsRenderer } = await import("@braccato/core-legacy");
  const { INSTRUMENTAL_STYLE_ATTR } = await import("@modules/settings/instrumentalStyle");
  const testDom = new JSDOM("<!doctype html><html><body><div id='scroll'><div id='mount'></div></div></body></html>", {
    pretendToBeVisual: true,
  });
  const tWin = testDom.window as unknown as Window & typeof globalThis;
  const tDoc = tWin.document;
  tDoc.documentElement.setAttribute(AUTO_HIDE_INSTRUMENTAL_BG_ATTR, "");
  tDoc.documentElement.setAttribute(INSTRUMENTAL_STYLE_ATTR, "note");
  Object.defineProperty(tWin, "matchMedia", { configurable: true, value: stubMatchMedia });
  Object.defineProperty(tWin, "ResizeObserver", {
    configurable: true,
    value: class {
      observe() {}
      disconnect() {}
    },
  });
  Object.defineProperty(tDoc, "fonts", { configurable: true, value: { ready: Promise.resolve() } });
  const refreshAnims: RecordedAnim[] = [];
  Object.defineProperty(tWin.Element.prototype, "animate", {
    configurable: true,
    value(this: Element, keyframes: Keyframe[] | PropertyIndexedKeyframes | null, options?: KeyframeAnimationOptions | number) {
      let resolveFinish = () => {};
      const finished = new Promise<void>(resolve => {
        resolveFinish = resolve;
      });
      const rec: RecordedAnim = { target: this, keyframes, options, cancelled: false, resolveFinish };
      refreshAnims.push(rec);
      return {
        finished,
        cancel() {
          rec.cancelled = true;
        },
        pause() {},
        play() {},
      } as unknown as Animation;
    },
  });

  const mount = tDoc.getElementById("mount")!;
  const scroller = tDoc.getElementById("scroll")!;
  const renderer = createLyricsRenderer({
    document: tDoc,
    window: tWin,
    mount,
    host: { getScrollElement: () => scroller },
  });
  initActiveReveal(renderer, { document: tDoc, isViewVisible: () => true, getScrollElement: () => scroller });
  renderer.setLyrics([
    { startTimeMs: 10000, durationMs: 6000, words: "", isInstrumental: true },
    { startTimeMs: 17000, durationMs: 2000, words: "After", parts: [{ startTimeMs: 17000, durationMs: 2000, words: "After" }] },
  ]);
  syncActiveReveal(renderer);

  const instLineEl = renderer.lines[0].lyricElement;
  const tickOpts: TickOptions = { eventCreationTime: -1, isPlaying: true, smoothScroll: false };
  renderer.tick(16.2, tickOpts);
  assert.equal(instLineEl.classList.contains(REVEAL_COLLAPSED_CLASS), false, "instrumental active and expanded");
  renderer.tick(16.6, tickOpts);
  assert.equal(instLineEl.classList.contains(REVEAL_EXITING_CLASS), true, "instrumental in exiting state while WAAPI exit pending");

  tDoc.documentElement.removeAttribute(INSTRUMENTAL_STYLE_ATTR);
  (renderer as unknown as { refreshInstrumentalStyle: () => void }).refreshInstrumentalStyle();
  refreshActiveRevealInstrumental(renderer);

  assert.equal(instLineEl.classList.contains(REVEAL_EXITING_CLASS), false, "exiting class cleared after instrumental refresh");
  assert.equal(instLineEl.classList.contains(REVEAL_COLLAPSED_CLASS), true, "exiting item finalized as collapsed after refresh");
  const newDotsIcon = instLineEl.querySelector(".blyrics--instrumental-icon.blyrics--instrumental-dots");
  assert.ok(newDotsIcon, "dots icon mounted in place of SVG");

  renderer.tick(9.2, tickOpts);
  assert.equal(instLineEl.classList.contains(REVEAL_COLLAPSED_CLASS), true, "instrumental stays collapsed before open boundary");
  refreshAnims.length = 0;
  renderer.tick(9.6, tickOpts);
  assert.equal(
    refreshAnims.some(a => a.target === newDotsIcon),
    true,
    "subsequent instrumental reveal targets rebound .blyrics--instrumental-dots visualElement"
  );

  renderer.destroy();
}

// 8. Offscreen .blyrics-credits/.blyrics-footer are omitted from layout-shift payloads, while near-viewport ones are kept
{
  const testDom = new JSDOM("<!doctype html><html><body><div id='scroll'><div class='blyrics-container blyrics--gf-managed'></div></div></body></html>", {
    pretendToBeVisual: true,
  });
  const tWin = testDom.window as unknown as Window & typeof globalThis;
  const tDoc = tWin.document;
  tDoc.documentElement.setAttribute(AUTO_HIDE_INSTRUMENTAL_BG_ATTR, "");
  Object.defineProperty(tWin, "matchMedia", { configurable: true, value: stubMatchMedia });

  const scroller = tDoc.getElementById("scroll")!;
  let mockScrollTop = 0;
  Object.defineProperty(scroller, "clientHeight", { configurable: true, get: () => 500 });
  Object.defineProperty(scroller, "scrollTop", {
    configurable: true,
    get: () => mockScrollTop,
    set: (v: number) => {
      mockScrollTop = v;
    },
  });

  const container = scroller.querySelector<HTMLElement>(".blyrics-container")!;
  const instEl = tDoc.createElement("div");
  instEl.className = "blyrics--line blyrics--instrumental";
  instEl.dataset.instrumental = "true";
  const iconEl = tDoc.createElement("span");
  iconEl.className = "blyrics--instrumental-icon";
  instEl.appendChild(iconEl);
  container.appendChild(instEl);

  const mainEl = tDoc.createElement("div");
  mainEl.className = "blyrics--line";
  mainEl.innerHTML = `<div class="blyrics-line-main"><span class="blyrics--word" data-time="5" data-duration="2">Hello</span></div>`;
  container.appendChild(mainEl);

  const footerEl = tDoc.createElement("div");
  footerEl.className = "blyrics-footer";
  let footerBaseTop = 3000;
  let instExpanded = true;
  Object.defineProperty(footerEl, "offsetTop", {
    configurable: true,
    get: () => footerBaseTop + (instExpanded ? 80 : 0),
  });
  container.appendChild(footerEl);

  const lines: Array<{ time: number; duration: number; position: number; height: number; lyricElement: HTMLElement }> = [
    { time: 0, duration: 5, position: 0, height: 80, lyricElement: instEl },
    { time: 5, duration: 4, position: 80, height: 60, lyricElement: mainEl },
  ];

  const shiftsReceived: LayoutShiftPayload[] = [];
  container.addEventListener(LAYOUT_SHIFT_EVENT, ev => {
    const detail = (ev as CustomEvent<string>).detail;
    shiftsReceived.push(JSON.parse(detail));
  });

  const fakeView: ActiveRevealView = {
    get container() {
      return container;
    },
    get lines() {
      return lines;
    },
    syncType: "richsync",
    setLyrics() {},
    tick() {
      return "ok";
    },
    retickFromPlaybackClock() {
      return "ok";
    },
    relayout() {
      instExpanded = !instEl.classList.contains(REVEAL_COLLAPSED_CLASS) && !instEl.classList.contains(REVEAL_EXITING_CLASS);
      lines[0].height = instExpanded ? 80 : 0;
      lines[1].position = instExpanded ? 80 : 0;
    },
    relayoutChangedLines() {
      this.relayout(true);
    },
  };

  initActiveReveal(fakeView, { document: tDoc, isViewVisible: () => true, getScrollElement: () => scroller });
  const tickOpts: TickOptions = { eventCreationTime: -1, isPlaying: true, smoothScroll: false };

  // Snap at t=4.2 (intro expanded), then exit intro at t=4.6 (< 0.75s step) while footer is far offscreen (3080 > 1000).
  fakeView.tick(4.2, tickOpts);
  shiftsReceived.length = 0;
  fakeView.tick(4.6, tickOpts);
  assert.equal(shiftsReceived.length, 1, "line shift dispatched for line 1");
  assert.equal(
    shiftsReceived[0].shifts.some(([idx]) => idx === 2),
    false,
    "offscreen footer (> scrollTop + 2*viewportH) omitted from layout-shift payload"
  );

  // Move footer into near-viewport range (600 <= 1000) and repeat collapse: footer shift IS emitted.
  footerBaseTop = 600;
  fakeView.tick(1.0, tickOpts); // seek > 0.75s back to re-expand intro
  fakeView.tick(4.2, tickOpts); // snap just before closeAtS=4.5
  shiftsReceived.length = 0;
  fakeView.tick(4.6, tickOpts);
  assert.equal(shiftsReceived.length, 1);
  assert.deepEqual(
    shiftsReceived[0].shifts.find(([idx]) => idx === 2),
    [2, 80],
    "near-viewport footer shift is preserved"
  );
}

console.log("activeReveal self-checks passed");
