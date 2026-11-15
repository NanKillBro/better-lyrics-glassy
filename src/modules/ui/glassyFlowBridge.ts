import { ANIMATING_CLASS } from "@braccato/core/constants";
import { mainView } from "@modules/ui/mainLyricsView";

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

type TickOptions = Parameters<typeof mainView.tick>[1];
type TickFn = typeof mainView.tick;
type RetickFn = NonNullable<typeof mainView.retickFromPlaybackClock>;
type SetThemeFn = NonNullable<typeof mainView.setTheme>;

export interface GlassyFlowBridgeTarget {
  readonly container: HTMLElement | null;
  readonly lines: readonly { time: number; duration: number; lyricElement: HTMLElement }[];
  readonly syncType: typeof mainView.syncType;
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

function ensureOffsetObserver(container: HTMLElement): void {
  if (observedContainer === container && offsetObserver) return;
  observedContainer = container;
  cachedOffsetsValid = false;
  offsetObserver?.disconnect();
  offsetObserver = new MutationObserver(() => {
    cachedOffsetsValid = false;
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

export function initGlassyFlowBridge(targetView: GlassyFlowBridgeTarget = mainView): void {
  if (patchedViews.has(targetView)) return;
  patchedViews.add(targetView);

  const originalTick = targetView.tick;
  let appliedLines = new WeakMap<HTMLElement, AppliedLineState>();
  const animatingBeforeTick = new Set<HTMLElement>();
  let lastActualTime = Number.NaN;
  let lastRawTimeS = Number.NaN;

  function snapshotAnimatingLines(): void {
    animatingBeforeTick.clear();
    if (!targetView.container || targetView.lines.length === 0) return;
    for (const line of targetView.lines) {
      const el = line.lyricElement;
      if (el.classList.contains(ANIMATING_CLASS) || el.classList.contains(PRE_ANIMATING_CLASS)) {
        animatingBeforeTick.add(el);
      }
    }
  }

  function applyDelayVars(currentTimeS: number, options: TickOptions): void {
    if (!targetView.container || targetView.lines.length === 0) return;

    const eventCreationTime = options.eventCreationTime ?? -1;
    const isPlaying = Boolean(options.isPlaying);
    const timeOffsetS = isPlaying && eventCreationTime !== -1 ? Math.max(0, (Date.now() - eventCreationTime) / 1000) : 0;

    let actualTime = currentTimeS + timeOffsetS;
    if (targetView.syncType === "richsync") {
      actualTime -= options.richsyncOffsetTrim ?? 0;
      actualTime += getTimingOffsetS(targetView.container, true);
    } else {
      actualTime -= options.lineOffsetTrim ?? 0;
      actualTime += getTimingOffsetS(targetView.container, false);
    }
    actualTime -= (options.globalLyricOffset ?? 0) + (options.lyricOffset ?? 0);

    if (Number.isFinite(lastActualTime) && Math.abs(actualTime - lastActualTime) > REAPPLY_TIME_DRIFT_S) {
      appliedLines = new WeakMap<HTMLElement, AppliedLineState>();
    }
    lastActualTime = actualTime;

    const earlyTime = isPlaying ? ANIMATING_EARLY_TIME_S : 0;
    const skewBuffer = isPlaying ? CLOCK_SKEW_BUFFER_S : 0;

    for (const line of targetView.lines) {
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

  targetView.tick = function (currentTimeS, options) {
    const hasLines = Boolean(targetView.container && targetView.lines.length > 0);
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

  if (typeof targetView.retickFromPlaybackClock === "function") {
    const originalRetick = targetView.retickFromPlaybackClock;
    targetView.retickFromPlaybackClock = function (buildOptions) {
      let capturedOpts: TickOptions | null = null;
      const hasLines = Boolean(targetView.container && targetView.lines.length > 0 && Number.isFinite(lastRawTimeS));
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

  if (typeof targetView.setTheme === "function") {
    const originalSetTheme = targetView.setTheme;
    targetView.setTheme = function (css) {
      cachedOffsetsValid = false;
      return originalSetTheme.call(this, css);
    };
  }
}
