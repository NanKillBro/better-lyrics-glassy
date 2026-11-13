import { ANIMATING_CLASS } from "@braccato/core/constants";
import { mainView } from "@modules/ui/mainLyricsView";

/**
 * GlassyFlow Bridge Module
 *
 * Re-implements custom theme CSS animation delay variables (--blyrics-swipe-delay and --blyrics-anim-delay)
 * by observing class changes on rendered lyric elements.
 *
 * This provides themes (e.g. GlassyFlow, mergetheme, Big Blurry Slow Lyrics for TV) with exact time delays
 * until lyric playback, allowing CSS transitions to calculate precise animation start delays.
 */

const PRE_ANIMATING_CLASS = "blyrics--pre-animating";
const ANIMATING_EARLY_TIME_S = 2;
const CLOCK_SKEW_BUFFER_S = 0.15;
const REAPPLY_TIME_DRIFT_S = 0.25;

type TickOptions = Parameters<typeof mainView.tick>[1];

interface AppliedLineState {
  stage: 1 | 2;
  actualTime: number;
  lineTime: number;
}

let isMonkeyPatched = false;
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

export function initGlassyFlowBridge(): void {
  if (isMonkeyPatched) return;
  isMonkeyPatched = true;

  const originalTick = mainView.tick;
  let appliedLines = new WeakMap<HTMLElement, AppliedLineState>();
  let lastActualTime = Number.NaN;
  let lastRawTimeS = Number.NaN;

  function applyDelayVars(currentTimeS: number, options: TickOptions): void {
    if (!mainView.container || mainView.lines.length === 0) return;

    const eventCreationTime = options.eventCreationTime ?? -1;
    const isPlaying = Boolean(options.isPlaying);
    const timeOffsetS = isPlaying && eventCreationTime !== -1 ? Math.max(0, (Date.now() - eventCreationTime) / 1000) : 0;

    let actualTime = currentTimeS + timeOffsetS;
    if (mainView.syncType === "richsync") {
      actualTime -= options.richsyncOffsetTrim ?? 0;
      actualTime += getTimingOffsetS(mainView.container, true);
    } else {
      actualTime -= options.lineOffsetTrim ?? 0;
      actualTime += getTimingOffsetS(mainView.container, false);
    }
    actualTime -= (options.globalLyricOffset ?? 0) + (options.lyricOffset ?? 0);

    if (Number.isFinite(lastActualTime) && Math.abs(actualTime - lastActualTime) > REAPPLY_TIME_DRIFT_S) {
      appliedLines = new WeakMap<HTMLElement, AppliedLineState>();
    }
    lastActualTime = actualTime;

    const earlyTime = isPlaying ? ANIMATING_EARLY_TIME_S : 0;
    const skewBuffer = isPlaying ? CLOCK_SKEW_BUFFER_S : 0;

    for (const line of mainView.lines) {
      const el = line.lyricElement;
      if (el.classList.contains(ANIMATING_CLASS) || el.classList.contains(PRE_ANIMATING_CLASS)) {
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
          const children = [line, ...line.parts];
          for (const part of children) {
            const timeDelta = actualTime - part.time;
            part.lyricElement.style.setProperty("--blyrics-swipe-delay", `${-timeDelta - part.duration * 0.1}s`);
            part.lyricElement.style.setProperty("--blyrics-anim-delay", `${-timeDelta}s`);
          }
        }
      } else if (appliedLines.has(el)) {
        appliedLines.delete(el);
      }
    }
  }

  mainView.tick = function (currentTimeS, options) {
    if (mainView.container && mainView.lines.length > 0) {
      if (!(currentTimeS === 0 && !options.isPlaying)) {
        lastRawTimeS = currentTimeS;
      }
      applyDelayVars(currentTimeS, options);
    } else {
      lastRawTimeS = Number.NaN;
    }

    return originalTick.call(this, currentTimeS, options);
  };

  if (typeof mainView.retickFromPlaybackClock === "function") {
    const originalRetick = mainView.retickFromPlaybackClock;
    mainView.retickFromPlaybackClock = function (buildOptions) {
      return originalRetick.call(this, (eventCreationTime, isPlaying) => {
        const opts = buildOptions(eventCreationTime, isPlaying);
        if (Number.isFinite(lastRawTimeS)) {
          applyDelayVars(lastRawTimeS, opts);
        }
        return opts;
      });
    };
  }

  if (typeof mainView.setTheme === "function") {
    const originalSetTheme = mainView.setTheme;
    mainView.setTheme = function (css) {
      cachedOffsetsValid = false;
      return originalSetTheme.call(this, css);
    };
  }
}
