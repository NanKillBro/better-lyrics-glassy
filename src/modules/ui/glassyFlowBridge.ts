import type { LyricsRenderer, TickOptions } from "@braccato/core";
import { ANIMATING_CLASS } from "@braccato/core/constants";

/**
 * GlassyFlow Bridge Module
 *
 * Re-implements custom theme CSS animation delay variable (--blyrics-anim-delay)
 * so themes (e.g. GlassyFlow, mergetheme, Big Blurry Slow Lyrics for TV) receive exact
 * countdown delays for upcoming lines, while running after core engine ticks to avoid
 * invalidating layout before scroll measurements.
 */

const PRE_ANIMATING_CLASS = "blyrics--pre-animating";
const ANIMATING_EARLY_TIME_S = 2;
const CLOCK_SKEW_BUFFER_S = 0.15;
const REAPPLY_TIME_DRIFT_S = 0.25;

type TickFn = LyricsRenderer["tick"];
type RetickFn = LyricsRenderer["retickFromPlaybackClock"];
type SetThemeFn = LyricsRenderer["setTheme"];

export interface GlassyFlowBridgeTarget {
  readonly container: HTMLElement | null;
  readonly lines: readonly { time: number; duration: number; lyricElement: HTMLElement }[];
  readonly syncType: LyricsRenderer["syncType"];
  tick: TickFn;
  retickFromPlaybackClock?: RetickFn;
  setTheme?: SetThemeFn;
}

interface AppliedLineState {
  stage: 1 | 2;
  actualTime: number;
  lineTime: number;
}

const patchedViews = new WeakSet<GlassyFlowBridgeTarget>();
const inlineOffsetSignatures = new WeakMap<Element, string>();
let defaultTarget: GlassyFlowBridgeTarget | null = null;
let observedContainer: HTMLElement | null = null;
let offsetObserver: MutationObserver | null = null;
let headObserver: MutationObserver | null = null;
let cachedOffsetsValid = false;
let cachedRichsyncOffsetS = 0;
let cachedTimingOffsetS = 0;

function parseCSSDurationInMs(val: string): number {
  const trimmed = val.trim();
  if (!trimmed) return 0;
  if (trimmed.endsWith("ms")) return parseFloat(trimmed) || 0;
  if (trimmed.endsWith("s")) return (parseFloat(trimmed) || 0) * 1000;
  return parseFloat(trimmed) || 0;
}

function hasStylesheetMutation(mutations: MutationRecord[]): boolean {
  for (const mutation of mutations) {
    if (mutation.type === "characterData") {
      if (mutation.target.parentNode?.nodeName === "STYLE") return true;
      continue;
    }
    if (mutation.target.nodeName === "STYLE") return true;
    for (const node of mutation.addedNodes) {
      if (node.nodeName === "STYLE" || node.nodeName === "LINK") return true;
    }
    for (const node of mutation.removedNodes) {
      if (node.nodeName === "STYLE" || node.nodeName === "LINK") return true;
    }
  }
  return false;
}

function getInlineOffsetSignature(target: Element): string | null {
  const style = (target as HTMLElement).style;
  if (style && typeof style.getPropertyValue === "function") {
    return `${style.getPropertyValue("--blyrics-richsync-timing-offset")}\0${style.getPropertyValue("--blyrics-timing-offset")}`;
  }
  if (typeof target.getAttribute === "function") {
    const raw = target.getAttribute("style") ?? "";
    return raw.includes("--blyrics-") ? raw : "";
  }
  return null;
}

function seedInlineOffsetSignatures(container: HTMLElement): void {
  const containerSig = getInlineOffsetSignature(container);
  if (containerSig !== null) {
    inlineOffsetSignatures.set(container, containerSig);
  }
  const root = container.ownerDocument?.documentElement;
  if (root) {
    const rootSig = getInlineOffsetSignature(root);
    if (rootSig !== null) {
      inlineOffsetSignatures.set(root, rootSig);
    }
  }
}

function hasRelevantOffsetMutation(mutations: MutationRecord[]): boolean {
  for (const mutation of mutations) {
    if (mutation.attributeName !== "style") {
      return true;
    }
    const target = mutation.target as Element | null;
    if (!target) return true;
    const nextSig = getInlineOffsetSignature(target);
    if (nextSig === null) return true;
    const prevSig = inlineOffsetSignatures.get(target);
    if (prevSig === undefined || nextSig !== prevSig) {
      inlineOffsetSignatures.set(target, nextSig);
      return true;
    }
  }
  return false;
}

function ensureOffsetObserver(container: HTMLElement): void {
  if (observedContainer === container && offsetObserver) return;
  observedContainer = container;
  cachedOffsetsValid = false;
  seedInlineOffsetSignatures(container);
  offsetObserver?.disconnect();
  offsetObserver = new MutationObserver(mutations => {
    if (hasRelevantOffsetMutation(mutations)) {
      cachedOffsetsValid = false;
    }
  });
  offsetObserver.observe(container, { attributes: true, attributeFilter: ["style", "class"] });
  const doc = container.ownerDocument;
  if (doc?.documentElement) {
    offsetObserver.observe(doc.documentElement, {
      attributes: true,
      attributeFilter: ["style", "class"],
    });
  }
  headObserver?.disconnect();
  headObserver = null;
  if (doc?.head) {
    headObserver = new MutationObserver(mutations => {
      if (hasStylesheetMutation(mutations)) {
        cachedOffsetsValid = false;
      }
    });
    headObserver.observe(doc.head, { childList: true, subtree: true, characterData: true });
  }
}

function getTimingOffsetS(container: HTMLElement, isRichsync: boolean): number {
  ensureOffsetObserver(container);
  if (!cachedOffsetsValid) {
    const computed = getComputedStyle(container);
    cachedRichsyncOffsetS = parseCSSDurationInMs(computed.getPropertyValue("--blyrics-richsync-timing-offset")) / 1000;
    cachedTimingOffsetS = parseCSSDurationInMs(computed.getPropertyValue("--blyrics-timing-offset")) / 1000;
    cachedOffsetsValid = true;
  }
  return isRichsync ? cachedRichsyncOffsetS : cachedTimingOffsetS;
}

export function initGlassyFlowBridge(targetView?: GlassyFlowBridgeTarget): void {
  const resolved = targetView ?? defaultTarget;
  if (!resolved) return;
  const target: GlassyFlowBridgeTarget = resolved;
  if (!defaultTarget) defaultTarget = target;
  if (patchedViews.has(target)) return;
  patchedViews.add(target);

  const originalTick = target.tick;
  let appliedLines = new WeakMap<HTMLElement, AppliedLineState>();
  const animatingBeforeTick = new Set<HTMLElement>();
  let lastActualTime = Number.NaN;
  let lastRawTimeS = Number.NaN;

  function snapshotAnimatingLines(): void {
    animatingBeforeTick.clear();
    if (!target.container || target.lines.length === 0) return;
    for (const line of target.lines) {
      const el = line.lyricElement;
      if (el.classList.contains(ANIMATING_CLASS) || el.classList.contains(PRE_ANIMATING_CLASS)) {
        animatingBeforeTick.add(el);
      }
    }
  }

  function applyDelayVars(currentTimeS: number, options: TickOptions): void {
    if (!target.container || target.lines.length === 0) return;

    const eventCreationTime = options.eventCreationTime ?? -1;
    const isPlaying = Boolean(options.isPlaying);
    const timeOffsetS = isPlaying && eventCreationTime !== -1 ? Math.max(0, (Date.now() - eventCreationTime) / 1000) : 0;

    let actualTime = currentTimeS + timeOffsetS;
    if (target.syncType === "richsync") {
      actualTime -= options.richsyncOffsetTrim ?? 0;
      actualTime += getTimingOffsetS(target.container, true);
    } else {
      actualTime -= options.lineOffsetTrim ?? 0;
      actualTime += getTimingOffsetS(target.container, false);
    }
    actualTime -= (options.globalLyricOffset ?? 0) + (options.lyricOffset ?? 0);

    if (Number.isFinite(lastActualTime) && Math.abs(actualTime - lastActualTime) > REAPPLY_TIME_DRIFT_S) {
      appliedLines = new WeakMap<HTMLElement, AppliedLineState>();
    }
    lastActualTime = actualTime;

    const earlyTime = isPlaying ? ANIMATING_EARLY_TIME_S : 0;
    const skewBuffer = isPlaying ? CLOCK_SKEW_BUFFER_S : 0;

    for (const line of target.lines) {
      const el = line.lyricElement;
      // Skip lines that were already animating before the core tick ran.
      if (animatingBeforeTick.has(el)) {
        appliedLines.delete(el);
        continue;
      }
      const timeToLine = line.time - actualTime;
      const minTimeToLine = -Math.max(2, (line.duration || 0) + 0.05);
      if (timeToLine <= earlyTime + skewBuffer && timeToLine > minTimeToLine) {
        const stage: 1 | 2 = timeToLine <= earlyTime ? 2 : 1;
        const prev = appliedLines.get(el);
        if (
          !prev ||
          prev.stage < stage ||
          prev.lineTime !== line.time ||
          Math.abs(actualTime - prev.actualTime) > REAPPLY_TIME_DRIFT_S
        ) {
          appliedLines.set(el, { stage, actualTime, lineTime: line.time });
          const timeDelta = actualTime - line.time;
          el.style.setProperty("--blyrics-anim-delay", `${-timeDelta}s`);
        }
      } else if (appliedLines.has(el)) {
        appliedLines.delete(el);
      }
    }
    animatingBeforeTick.clear();
  }

  target.tick = function (currentTimeS, options) {
    const hasLines = Boolean(target.container && target.lines.length > 0);
    if (hasLines) {
      if (!(currentTimeS === 0 && !options.isPlaying)) {
        lastRawTimeS = currentTimeS;
      }
      snapshotAnimatingLines();
    } else {
      animatingBeforeTick.clear();
      lastRawTimeS = Number.NaN;
    }

    const result = originalTick.call(this, currentTimeS, options);
    if (hasLines) {
      applyDelayVars(currentTimeS, options);
    }
    return result;
  };

  if (typeof target.retickFromPlaybackClock === "function") {
    const originalRetick = target.retickFromPlaybackClock;
    target.retickFromPlaybackClock = function (buildOptions) {
      let capturedOpts: TickOptions | null = null;
      const hasLines = Boolean(target.container && target.lines.length > 0 && Number.isFinite(lastRawTimeS));
      if (hasLines) {
        snapshotAnimatingLines();
      } else {
        animatingBeforeTick.clear();
      }

      const result = originalRetick.call(this, (eventCreationTime, isPlaying) => {
        const opts = buildOptions(eventCreationTime, isPlaying);
        capturedOpts = opts;
        return opts;
      });

      if (hasLines && capturedOpts && Number.isFinite(lastRawTimeS)) {
        applyDelayVars(lastRawTimeS, capturedOpts);
      } else {
        animatingBeforeTick.clear();
      }
      return result;
    };
  }

  if (typeof target.setTheme === "function") {
    const originalSetTheme = target.setTheme;
    target.setTheme = function (css) {
      cachedOffsetsValid = false;
      return originalSetTheme.call(this, css);
    };
  }
}
