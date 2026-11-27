import type { Lyric, LyricsRenderer, SetLyricsOptions, TickOptions } from "@braccato/core";
import { readRendererMode } from "@modules/ui/rendererMode";

export const AUTO_HIDE_INSTRUMENTAL_BG_ATTR = "blyrics-auto-hide-instrumental-bg" as const;
export const AUTO_HIDE_INSTRUMENTAL_BG_DEFAULTS = {
  isAutoHideInstrumentalBackgroundEnabled: true,
} as const;
export const LAYOUT_SHIFT_EVENT = "blyrics-layout-shift" as const;
export const REVEAL_COLLAPSED_CLASS = "blyrics--reveal-collapsed" as const;
export const REVEAL_EXITING_CLASS = "blyrics--reveal-exiting" as const;
export const BACKGROUND_ONLY_ATTR = "data-background-only" as const;
const BACKGROUND_ABOVE_CLASS = "blyrics-background-line--above" as const;

const BG_OPEN_LEAD_S = 0.4;
const BG_ALIGN_BEFORE_LINE_WINDOW_S = 0.15;
const BG_ALIGN_TO_LINE_WINDOW_S = 0.25;
const DEFAULT_SCROLL_LEAD_S = 0.5;
const SEEK_SNAP_THRESHOLD_S = 0.75;
const MIN_SHIFT_PX = 0.5;
const BG_ENTER_DURATION_MS = 700;
const INST_ENTER_DURATION_MS = 420;
const INST_EXIT_DURATION_MS = 320;
const FLIP_SYNC_DURATION_MS = 460;
const FLIP_IMMEDIATE_DURATION_MS = 620;
const GF_ENTER_DELAY_MS = 180;
const GF_INNER_FLIP_SYNC_DELAY_MS = 240;
const GF_BG_SYNC_DELAY_MS = 260;
const GF_EXIT_DELAY_MS = 140;
const BG_ENTER_SCALE_FROM = 0.78;
const INST_ENTER_SCALE_FROM = 0.72;
const INST_EXIT_SCALE_TO = 0.72;
const BG_ENTER_BLUR_PX = 8;
const INST_BLUR_PX = 8;
const ENTER_EASING = "cubic-bezier(0.2, 0.85, 0.25, 1)";
const EXIT_EASING = "cubic-bezier(0.4, 0, 0.2, 1)";
const FLIP_EASING = "cubic-bezier(0.2, 0.85, 0.25, 1)";
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

export type RevealItemKind = "instrumental" | "background-only" | "background-row";

export interface RevealTimingItem {
  readonly kind: RevealItemKind;
  readonly lineIndex: number;
  readonly openAtS: number;
  readonly closeAtS: number;
}

export interface LayoutShiftPayload {
  readonly shifts: readonly [number, number][];
  readonly mode: "sync-scroll" | "immediate";
}

export interface ActiveRevealLineLike {
  readonly time: number;
  readonly duration: number;
  readonly position?: number;
  readonly height?: number;
  readonly lyricElement: HTMLElement;
}

export interface ActiveRevealView {
  readonly container: HTMLElement | null;
  readonly lines: readonly ActiveRevealLineLike[];
  readonly syncType: LyricsRenderer["syncType"];
  setLyrics: (lyrics: Lyric[], options?: SetLyricsOptions) => void;
  tick: LyricsRenderer["tick"];
  retickFromPlaybackClock: LyricsRenderer["retickFromPlaybackClock"];
  relayout: (measureLines?: boolean) => void;
  relayoutChangedLines?: (changedIndices: readonly number[]) => void;
  clear?: () => void;
}

export interface ActiveRevealOptions {
  readonly document?: Document;
  readonly isViewVisible?: () => boolean;
  readonly getScrollElement?: () => HTMLElement | null;
}

interface ExitAnchorSnapshot {
  readonly beforeVisualTop: number;
  readonly fallbackOffsetPx: number;
  readonly hasRect: boolean;
  readonly baseFilter: string;
  midRestingTop: number;
}

interface ManagedItem extends RevealTimingItem {
  readonly lineElement: HTMLElement;
  readonly targetElement: HTMLElement;
  visualElement: Element;
  state: "expanded" | "exiting" | "collapsed";
  generation: number;
  visualAnim: Animation | null;
}

interface CachedOffsets {
  richsyncOffsetS: number;
  timingOffsetS: number;
  scrollLeadS: number;
  valid: boolean;
}

interface ViewController {
  syncFromSettingChange: () => void;
  refreshInstrumentalVisuals: () => void;
}

const controllers = new WeakMap<ActiveRevealView, ViewController>();

function parseCSSDurationS(raw: string, fallbackS = 0): number {
  const trimmed = raw.trim();
  if (!trimmed) return fallbackS;
  if (trimmed.endsWith("ms")) {
    const parsed = Number.parseFloat(trimmed);
    return Number.isFinite(parsed) ? parsed / 1000 : fallbackS;
  }
  const parsed = Number.parseFloat(trimmed);
  return Number.isFinite(parsed) ? parsed : fallbackS;
}

export function isAutoHideInstrumentalBgEnabled(doc: Document | null | undefined): boolean {
  return doc?.documentElement?.hasAttribute?.(AUTO_HIDE_INSTRUMENTAL_BG_ATTR) === true && !readRendererMode(doc);
}

function isHtmlElement(node: unknown): node is HTMLElement {
  return Boolean(node && typeof node === "object" && (node as Element).nodeType === 1 && "style" in node);
}

export function isBackgroundOnlyLine(lyricElement: HTMLElement): boolean {
  if (lyricElement.dataset.instrumental === "true") return false;
  let hasBgRow = false;
  let mainEl: HTMLElement | null = null;
  for (const child of Array.from(lyricElement.children)) {
    if (!isHtmlElement(child)) continue;
    if (child.classList.contains("blyrics-background-line")) {
      hasBgRow = true;
    } else if (child.classList.contains("blyrics-line-main")) {
      mainEl = child;
    }
  }
  if (!hasBgRow) return false;
  if (!mainEl) return true;
  return (mainEl.textContent ?? "").trim().length === 0;
}

export function extractBackgroundRowWindow(
  bgRow: HTMLElement,
  lineStartS: number,
  lineDurationS: number
): { startS: number; endS: number } {
  const words = bgRow.querySelectorAll<HTMLElement>(".blyrics--word:not(.blyrics-word-highlight)");
  let minStart = Number.POSITIVE_INFINITY;
  let maxEnd = Number.NEGATIVE_INFINITY;
  let hasTimedDuration = false;

  for (const word of Array.from(words)) {
    const start = Number(word.dataset.time);
    const dur = Number(word.dataset.duration);
    if (!Number.isFinite(start)) continue;
    if (start < minStart) minStart = start;
    if (Number.isFinite(dur) && dur > 0) {
      hasTimedDuration = true;
      const end = start + dur;
      if (end > maxEnd) maxEnd = end;
    } else if (start > maxEnd) {
      maxEnd = start;
    }
  }

  const lineEndS = lineStartS + Math.max(lineDurationS, 0);
  if (!Number.isFinite(minStart)) {
    return { startS: lineStartS, endS: lineEndS };
  }
  if (!hasTimedDuration) {
    return { startS: minStart, endS: Math.max(maxEnd, lineEndS) };
  }
  return { startS: minStart, endS: Math.max(maxEnd, minStart) };
}

export function shouldItemBeVisible(item: RevealTimingItem, actualTimeS: number): boolean {
  return actualTimeS >= item.openAtS && actualTimeS < item.closeAtS;
}

export function computeLineLayoutShifts(
  oldTops: readonly number[],
  newTops: readonly number[],
  visibleStart: number,
  visibleEnd: number
): [number, number][] {
  const shifts: [number, number][] = [];
  const start = Math.max(0, visibleStart);
  const end = Math.min(oldTops.length, newTops.length, visibleEnd);
  for (let i = start; i < end; i += 1) {
    const dy = oldTops[i] - newTops[i];
    if (Math.abs(dy) >= MIN_SHIFT_PX) {
      shifts.push([i, Math.round(dy * 100) / 100]);
    }
  }
  return shifts;
}

export function composeBlurFilter(baseFilter: string, blurPx: number): string {
  const trimmed = baseFilter.trim();
  const blurFn = `blur(${blurPx}px)`;
  if (!trimmed || trimmed === "none") return blurFn;
  return `${trimmed} ${blurFn}`;
}

function isEligibleContainer(container: HTMLElement | null, syncType: LyricsRenderer["syncType"]): container is HTMLElement {
  if (!container || !container.isConnected) return false;
  if (container.classList.contains("brs-layout")) return false;
  if (container.dataset.layout === "stage") return false;
  if (syncType === "none" || container.dataset.sync === "none" || container.classList.contains("blyrics--no-sync")) {
    return false;
  }
  return isAutoHideInstrumentalBgEnabled(container.ownerDocument);
}

function isReducedMotion(win: Window | null | undefined): boolean {
  try {
    return win?.matchMedia?.(REDUCED_MOTION_QUERY)?.matches === true;
  } catch {
    return false;
  }
}

function readOffsets(container: HTMLElement, cache: CachedOffsets): CachedOffsets {
  if (cache.valid) return cache;
  const win = container.ownerDocument?.defaultView;
  if (win && typeof win.getComputedStyle === "function") {
    const style = win.getComputedStyle(container);
    cache.richsyncOffsetS = parseCSSDurationS(style.getPropertyValue("--blyrics-richsync-timing-offset"), 0);
    cache.timingOffsetS = parseCSSDurationS(style.getPropertyValue("--blyrics-timing-offset"), 0);
    const lead = parseCSSDurationS(style.getPropertyValue("--blyrics-scroll-timing-offset"), DEFAULT_SCROLL_LEAD_S);
    cache.scrollLeadS = lead > 0 ? lead : DEFAULT_SCROLL_LEAD_S;
  } else {
    cache.richsyncOffsetS = 0;
    cache.timingOffsetS = 0;
    cache.scrollLeadS = DEFAULT_SCROLL_LEAD_S;
  }
  cache.valid = true;
  return cache;
}

function cancelAnim(anim: Animation | null): void {
  if (!anim) return;
  try {
    anim.cancel();
  } catch {
    // Ignore detached-element cancel errors.
  }
}

function readRawLineTop(line: ActiveRevealLineLike): number {
  if (typeof line.position === "number" && line.position >= 0) {
    return line.position;
  }
  return line.lyricElement.offsetTop || 0;
}

function readComputedFilter(el: Element): string {
  const win = el.ownerDocument?.defaultView;
  if (!win || typeof win.getComputedStyle !== "function") return "";
  return win.getComputedStyle(el).filter || "";
}

function parseCSSTranslateY(raw: string | null | undefined): number {
  if (!raw || raw === "none") return 0;
  const parts = raw.trim().split(/\s+/);
  if (parts.length < 2) return 0;
  const parsed = Number.parseFloat(parts[1]);
  return Number.isFinite(parsed) ? parsed : 0;
}

function captureExitSnapshot(item: ManagedItem): ExitAnchorSnapshot {
  const win = item.targetElement.ownerDocument?.defaultView;
  let fallbackOffsetPx = 0;
  let baseFilter = "";
  if (win && typeof win.getComputedStyle === "function") {
    const style = win.getComputedStyle(item.targetElement);
    if (item.kind === "background-row") {
      fallbackOffsetPx = Number.parseFloat(style.marginTop) || 0;
    } else {
      const paddingTop = Number.parseFloat(style.paddingTop) || 0;
      const visualHeight = Number.parseFloat(win.getComputedStyle(item.visualElement).height) || 0;
      fallbackOffsetPx = paddingTop + visualHeight;
    }
    baseFilter = win.getComputedStyle(item.visualElement).filter || "";
  }
  const rect =
    typeof item.visualElement.getBoundingClientRect === "function"
      ? item.visualElement.getBoundingClientRect()
      : null;
  const hasRect = Boolean(rect && rect.height > 0);
  return {
    beforeVisualTop: rect ? rect.top : 0,
    fallbackOffsetPx,
    hasRect,
    baseFilter,
    midRestingTop: 0,
  };
}

function measureMidRestingVisualTop(item: ManagedItem): number {
  const rect =
    typeof item.visualElement.getBoundingClientRect === "function"
      ? item.visualElement.getBoundingClientRect()
      : null;
  if (!rect) return 0;
  const win = item.lineElement.ownerDocument?.defaultView;
  const lineTranslateY =
    win && typeof win.getComputedStyle === "function"
      ? parseCSSTranslateY(win.getComputedStyle(item.lineElement).translate)
      : 0;
  return rect.top - lineTranslateY;
}

function collectInnerSiblingsAfter(bgRow: HTMLElement): HTMLElement[] {
  const siblings: HTMLElement[] = [];
  let cursor = bgRow.nextElementSibling;
  while (cursor) {
    if (isHtmlElement(cursor)) {
      siblings.push(cursor);
    }
    cursor = cursor.nextElementSibling;
  }
  return siblings;
}

function resolveVisibleIndexRange(
  lines: readonly ActiveRevealLineLike[],
  tops: readonly number[],
  scrollEl: HTMLElement | null
): { start: number; end: number } {
  if (!scrollEl || lines.length === 0) {
    return { start: 0, end: lines.length };
  }
  const viewportH = scrollEl.clientHeight || 0;
  if (viewportH <= 0) {
    return { start: 0, end: lines.length };
  }
  const scrollTop = scrollEl.scrollTop || 0;
  const minY = scrollTop - viewportH;
  const maxY = scrollTop + viewportH * 2;
  let start = 0;
  while (start < lines.length && tops[start] + (lines[start].height ?? 60) < minY) {
    start += 1;
  }
  let end = lines.length;
  while (end > start && tops[end - 1] > maxY) {
    end -= 1;
  }
  return { start: Math.max(0, start - 2), end: Math.min(lines.length, end + 2) };
}

export function initActiveReveal(view: ActiveRevealView, options?: ActiveRevealOptions): void {
  if (controllers.has(view)) return;

  const originalSetLyrics = view.setLyrics;
  const originalTick = view.tick;
  const originalRetick = view.retickFromPlaybackClock;
  const originalClear = view.clear;

  let trackedContainer: HTMLElement | null = null;
  let trackedLines: readonly ActiveRevealLineLike[] = [];
  let managedItems: ManagedItem[] = [];
  let lastActualTimeS = Number.NaN;
  let lastLyricScrollAtMs = 0;
  let lastLyricScrollTimeS = Number.NaN;
  let lastTickArgs: { timeS: number; options: TickOptions } | null = null;
  let wasEnabled = false;
  const offsets: CachedOffsets = {
    richsyncOffsetS: 0,
    timingOffsetS: 0,
    scrollLeadS: DEFAULT_SCROLL_LEAD_S,
    valid: false,
  };
  const standaloneFlipAnims = new WeakMap<Element, Animation>();

  function cancelElementFlip(el: Element): void {
    const prev = standaloneFlipAnims.get(el);
    if (prev) {
      standaloneFlipAnims.delete(el);
      cancelAnim(prev);
    }
  }

  function runStandaloneFlip(
    el: HTMLElement,
    dy: number,
    useAddComposite: boolean,
    durationMs: number,
    delayMs = 0
  ): void {
    if (typeof el.animate !== "function") return;
    cancelElementFlip(el);
    const anim = el.animate([{ translate: `0px ${dy.toFixed(2)}px` }, { translate: "0px 0px" }], {
      duration: durationMs,
      delay: delayMs,
      easing: FLIP_EASING,
      composite: useAddComposite ? "add" : "replace",
      fill: delayMs > 0 ? "backwards" : "none",
    });
    standaloneFlipAnims.set(el, anim);
    anim.finished
      ?.then(() => {
        if (standaloneFlipAnims.get(el) === anim) {
          standaloneFlipAnims.delete(el);
        }
      })
      .catch(() => {});
  }

  function clearItemAnimations(item: ManagedItem): void {
    item.generation += 1;
    cancelAnim(item.visualAnim);
    item.visualAnim = null;
  }

  function restoreAllItems(relayoutAfter: boolean): void {
    let changed = false;
    for (const item of managedItems) {
      clearItemAnimations(item);
      if (item.targetElement.classList.contains(REVEAL_COLLAPSED_CLASS)) {
        item.targetElement.classList.remove(REVEAL_COLLAPSED_CLASS);
        changed = true;
      }
      if (item.targetElement.classList.contains(REVEAL_EXITING_CLASS)) {
        item.targetElement.classList.remove(REVEAL_EXITING_CLASS);
        changed = true;
      }
      if (item.kind === "background-only" && item.lineElement.hasAttribute(BACKGROUND_ONLY_ATTR)) {
        item.lineElement.removeAttribute(BACKGROUND_ONLY_ATTR);
      }
      item.state = "expanded";
    }
    if (changed && relayoutAfter) {
      view.relayout(true);
    }
  }

  function resetTracking(): void {
    for (const item of managedItems) {
      clearItemAnimations(item);
    }
    trackedContainer = null;
    trackedLines = [];
    managedItems = [];
    lastActualTimeS = Number.NaN;
    lastLyricScrollAtMs = 0;
    lastLyricScrollTimeS = Number.NaN;
    offsets.valid = false;
  }

  function rebuildIndex(container: HTMLElement, lines: readonly ActiveRevealLineLike[]): void {
    for (const item of managedItems) {
      clearItemAnimations(item);
    }
    offsets.valid = false;
    const { scrollLeadS } = readOffsets(container, offsets);
    const nextItems: ManagedItem[] = [];

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const lineEl = line.lyricElement;
      const lineStartS = line.time;
      const lineDurationS = Math.max(line.duration, 0);
      const lineEndS = lineStartS + lineDurationS;

      if (lineEl.dataset.instrumental === "true") {
        const hasFollowingLine = i + 1 < lines.length;
        const nextLineStartS = hasFollowingLine ? lines[i + 1].time : lineEndS;
        // Match @braccato/core-legacy active-line lifetime: max(nextTime, time + duration).
        const effectiveEndS = hasFollowingLine ? Math.max(lineEndS, nextLineStartS) : lineEndS;
        const isIntro = i === 0 && lineStartS <= 0.5;
        const openAtS = isIntro ? Number.NEGATIVE_INFINITY : lineStartS - scrollLeadS;
        const closeAtS = hasFollowingLine ? Math.max(lineStartS, effectiveEndS - scrollLeadS) : lineEndS;
        const visualEl = lineEl.querySelector(".blyrics--instrumental-icon") ?? lineEl;
        nextItems.push({
          kind: "instrumental",
          lineIndex: i,
          lineElement: lineEl,
          targetElement: lineEl,
          visualElement: visualEl,
          openAtS,
          closeAtS,
          state: lineEl.classList.contains(REVEAL_COLLAPSED_CLASS) ? "collapsed" : "expanded",
          generation: 0,
          visualAnim: null,
        });
        continue;
      }

      const bgRows = Array.from(lineEl.children).filter(
        (child): child is HTMLElement => isHtmlElement(child) && child.classList.contains("blyrics-background-line")
      );
      if (bgRows.length === 0) {
        if (lineEl.hasAttribute(BACKGROUND_ONLY_ATTR)) {
          lineEl.removeAttribute(BACKGROUND_ONLY_ATTR);
        }
        continue;
      }

      if (isBackgroundOnlyLine(lineEl)) {
        lineEl.setAttribute(BACKGROUND_ONLY_ATTR, "true");
        let minStart = Number.POSITIVE_INFINITY;
        for (const row of bgRows) {
          const win = extractBackgroundRowWindow(row, lineStartS, lineDurationS);
          if (win.startS < minStart) minStart = win.startS;
        }
        const bgStartS = Number.isFinite(minStart) ? minStart : lineStartS;
        nextItems.push({
          kind: "background-only",
          lineIndex: i,
          lineElement: lineEl,
          targetElement: lineEl,
          visualElement: bgRows[0],
          openAtS: bgStartS - scrollLeadS,
          // Stay visible once sung; past-line styling (.blyrics--gf-behind) hides it naturally.
          closeAtS: Number.POSITIVE_INFINITY,
          state: lineEl.classList.contains(REVEAL_COLLAPSED_CLASS) ? "collapsed" : "expanded",
          generation: 0,
          visualAnim: null,
        });
        continue;
      }

      if (lineEl.hasAttribute(BACKGROUND_ONLY_ATTR)) {
        lineEl.removeAttribute(BACKGROUND_ONLY_ATTR);
      }
      for (const row of bgRows) {
        const { startS } = extractBackgroundRowWindow(row, lineStartS, lineDurationS);
        // Align background rows starting right with their parent line to the line's scroll tick
        // so both layout and scroll resolve in one combined GlassyFlow wave without mid-scroll jitter.
        const deltaFromLineStartS = startS - lineStartS;
        const openAtS =
          deltaFromLineStartS >= -BG_ALIGN_BEFORE_LINE_WINDOW_S && deltaFromLineStartS <= BG_ALIGN_TO_LINE_WINDOW_S
            ? lineStartS - scrollLeadS
            : startS - BG_OPEN_LEAD_S;
        nextItems.push({
          kind: "background-row",
          lineIndex: i,
          lineElement: lineEl,
          targetElement: row,
          visualElement: row,
          openAtS,
          closeAtS: Number.POSITIVE_INFINITY,
          state: row.classList.contains(REVEAL_COLLAPSED_CLASS) ? "collapsed" : "expanded",
          generation: 0,
          visualAnim: null,
        });
      }
    }

    trackedContainer = container;
    trackedLines = lines;
    managedItems = nextItems;
  }

  function ensureIndexed(container: HTMLElement): boolean {
    const lines = view.lines;
    const sameLines = trackedContainer === container && trackedLines === lines && trackedLines.length === lines.length;
    if (!sameLines) {
      rebuildIndex(container, lines);
      return true;
    }
    return false;
  }

  function computeActualTimeS(container: HTMLElement, currentTimeS: number, tickOptions: TickOptions): number {
    const eventCreationTime = tickOptions.eventCreationTime ?? -1;
    const isPlaying = Boolean(tickOptions.isPlaying);
    const timeOffsetS =
      isPlaying && eventCreationTime !== -1 ? Math.max(0, (Date.now() - eventCreationTime) / 1000) : 0;
    const { richsyncOffsetS, timingOffsetS } = readOffsets(container, offsets);
    let actualTime = currentTimeS + timeOffsetS;
    if (view.syncType === "richsync") {
      actualTime += richsyncOffsetS - (tickOptions.richsyncOffsetTrim ?? 0);
    } else {
      actualTime += timingOffsetS - (tickOptions.lineOffsetTrim ?? 0);
    }
    actualTime -= (tickOptions.globalLyricOffset ?? 0) + (tickOptions.lyricOffset ?? 0);
    return actualTime;
  }

  function startEnterAnimation(item: ManagedItem, delayMs: number, precomputedBaseFilter?: string): void {
    clearItemAnimations(item);
    const el = item.visualElement as HTMLElement;
    if (typeof el.animate !== "function") return;
    const isInst = item.kind === "instrumental";
    const isAboveBg =
      item.kind === "background-row" && item.targetElement.classList.contains(BACKGROUND_ABOVE_CLASS);
    const scaleFrom = isInst ? INST_ENTER_SCALE_FROM : BG_ENTER_SCALE_FROM;
    const offsetY = isInst ? 0 : isAboveBg ? 10 : -10;
    const blurPx = isInst ? INST_BLUR_PX : BG_ENTER_BLUR_PX;
    const duration = isInst ? INST_ENTER_DURATION_MS : BG_ENTER_DURATION_MS;
    const baseFilter = precomputedBaseFilter ?? readComputedFilter(el);
    const anim = el.animate(
      [
        {
          opacity: 0,
          filter: composeBlurFilter(baseFilter, blurPx),
          transform: `translateY(${offsetY}px) scale(${scaleFrom})`,
        },
        {
          opacity: 1,
          filter: composeBlurFilter(baseFilter, 0),
          transform: "translateY(0px) scale(1)",
        },
      ],
      {
        duration,
        delay: delayMs,
        easing: ENTER_EASING,
        fill: delayMs > 0 ? "backwards" : "none",
      }
    );
    item.visualAnim = anim;
    const gen = item.generation;
    anim.finished
      ?.then(() => {
        if (item.generation === gen && item.visualAnim === anim) {
          item.visualAnim = null;
        }
      })
      .catch(() => {});
  }

  function startExitAnimation(
    item: ManagedItem,
    anchorOffsetPx: number,
    delayMs: number,
    precomputedBaseFilter?: string
  ): void {
    clearItemAnimations(item);
    const el = item.visualElement as HTMLElement;
    const gen = item.generation;
    if (typeof el.animate !== "function") {
      item.targetElement.classList.remove(REVEAL_EXITING_CLASS);
      item.targetElement.classList.add(REVEAL_COLLAPSED_CLASS);
      item.state = "collapsed";
      return;
    }
    const scaleTo = item.kind === "instrumental" ? INST_EXIT_SCALE_TO : BG_ENTER_SCALE_FROM;
    const blurPx = item.kind === "instrumental" ? INST_BLUR_PX : BG_ENTER_BLUR_PX;
    const baseFilter = precomputedBaseFilter ?? readComputedFilter(el);
    const fromY = anchorOffsetPx;
    const toY = anchorOffsetPx - 12;
    const anim = el.animate(
      [
        {
          opacity: 1,
          filter: composeBlurFilter(baseFilter, 0),
          transform: `translateY(${fromY.toFixed(2)}px) scale(1)`,
        },
        {
          opacity: 0,
          filter: composeBlurFilter(baseFilter, blurPx),
          transform: `translateY(${toY.toFixed(2)}px) scale(${scaleTo})`,
        },
      ],
      {
        duration: INST_EXIT_DURATION_MS,
        delay: delayMs,
        easing: EXIT_EASING,
        fill: "both",
      }
    );
    item.visualAnim = anim;
    anim.finished
      ?.then(() => {
        if (item.generation !== gen || item.state !== "exiting") return;
        item.visualAnim = null;
        cancelAnim(anim);
        item.targetElement.classList.remove(REVEAL_EXITING_CLASS);
        item.targetElement.classList.add(REVEAL_COLLAPSED_CLASS);
        item.state = "collapsed";
      })
      .catch(() => {});
  }

  function snapAllToTime(container: HTMLElement, actualTimeS: number, relayoutAfter: boolean): boolean {
    let changed = false;
    for (const item of managedItems) {
      const wantVisible = shouldItemBeVisible(item, actualTimeS);
      if (wantVisible) {
        if (item.state !== "expanded") {
          clearItemAnimations(item);
          item.targetElement.classList.remove(REVEAL_COLLAPSED_CLASS, REVEAL_EXITING_CLASS);
          item.state = "expanded";
          changed = true;
        }
      } else if (item.state !== "collapsed") {
        clearItemAnimations(item);
        item.targetElement.classList.remove(REVEAL_EXITING_CLASS);
        item.targetElement.classList.add(REVEAL_COLLAPSED_CLASS);
        item.state = "collapsed";
        changed = true;
      }
    }
    if (changed && relayoutAfter) {
      view.relayout(true);
    }
    // Keep container reference read for type completeness.
    void container;
    return changed;
  }

  function runWithActiveReveal<Result>(
    currentTimeS: number,
    tickOptions: TickOptions,
    invokeTick: () => Result
  ): Result {
    lastTickArgs = { timeS: currentTimeS, options: tickOptions };

    const container = view.container;
    const enabled = isEligibleContainer(container, view.syncType);
    if (!enabled) {
      if (wasEnabled) {
        wasEnabled = false;
        restoreAllItems(true);
      }
      return invokeTick();
    }

    wasEnabled = true;
    const freshlyBuilt = ensureIndexed(container);

    if (options?.isViewVisible && !options.isViewVisible()) {
      return invokeTick();
    }

    // Do not shift layout under the user's cursor while they browse manually.
    if (container.classList.contains("blyrics-user-scrolling")) {
      return invokeTick();
    }

    if (managedItems.length === 0) {
      return invokeTick();
    }

    const actualTimeS = computeActualTimeS(container, currentTimeS, tickOptions);
    const isPlaying = Boolean(tickOptions.isPlaying);
    const timeChanged = !Number.isFinite(lastActualTimeS) || Math.abs(actualTimeS - lastActualTimeS) > 0.01;
    const isSeekOrInit =
      freshlyBuilt || !Number.isFinite(lastActualTimeS) || Math.abs(actualTimeS - lastActualTimeS) > SEEK_SNAP_THRESHOLD_S;

    // Freeze state while paused unless the user scrubbed/seeked to a different timestamp.
    if (!isPlaying && !timeChanged && !freshlyBuilt) {
      return invokeTick();
    }

    lastActualTimeS = actualTimeS;

    if (isSeekOrInit) {
      snapAllToTime(container, actualTimeS, true);
      return invokeTick();
    }

    const toExpand: ManagedItem[] = [];
    const toCollapse: ManagedItem[] = [];
    for (const item of managedItems) {
      const wantVisible = shouldItemBeVisible(item, actualTimeS);
      if (wantVisible && item.state !== "expanded") {
        toExpand.push(item);
      } else if (!wantVisible && item.state === "expanded") {
        toCollapse.push(item);
      }
    }

    const scrollEl = options?.getScrollElement?.() ?? null;
    if (toExpand.length === 0 && toCollapse.length === 0) {
      const beforeScroll = scrollEl?.scrollTop ?? 0;
      const steadyResult = invokeTick();
      const afterScroll = scrollEl?.scrollTop ?? beforeScroll;
      if (scrollEl && Math.abs(afterScroll - beforeScroll) > 25) {
        lastLyricScrollAtMs = Date.now();
        lastLyricScrollTimeS = actualTimeS;
      }
      return steadyResult;
    }

    const reducedMotion = isReducedMotion(container.ownerDocument?.defaultView);
    if (reducedMotion) {
      snapAllToTime(container, actualTimeS, true);
      return invokeTick();
    }

    const lines = view.lines;
    const oldScrollTop = scrollEl?.scrollTop ?? 0;
    const oldTops = lines.map(readRawLineTop);
    // Match GlassyFlow's getLines() trailing elements (.blyrics-credits & .blyrics-footer, including Unison card) in DOM order.
    const trailingEls = Array.from(
      container.querySelectorAll<HTMLElement>(":scope > .blyrics-credits, :scope > .blyrics-footer")
    );
    const oldTrailingTops = trailingEls.map(el => el.offsetTop);

    // Track siblings inside lines whose nested background row is toggling.
    const innerSiblingSnapshots = new Map<HTMLElement, number>();
    for (const item of [...toExpand, ...toCollapse]) {
      if (item.kind !== "background-row") continue;
      for (const sibling of collectInnerSiblingsAfter(item.targetElement)) {
        if (!innerSiblingSnapshots.has(sibling)) {
          innerSiblingSnapshots.set(sibling, sibling.offsetTop);
        }
      }
    }

    const exitSnapshots = new Map<ManagedItem, ExitAnchorSnapshot>();
    for (const item of toCollapse) {
      exitSnapshots.set(item, captureExitSnapshot(item));
    }

    const activeBefore = new Set<HTMLElement>();
    for (const line of lines) {
      if (line.lyricElement.classList.contains("blyrics--active")) {
        activeBefore.add(line.lyricElement);
      }
    }

    // One-shot discrete class switches before synchronous relayout.
    let hasLineLevelToggle = false;
    for (const item of toExpand) {
      if (item.kind !== "background-row") hasLineLevelToggle = true;
      clearItemAnimations(item);
      item.targetElement.classList.remove(REVEAL_COLLAPSED_CLASS, REVEAL_EXITING_CLASS);
      item.state = "expanded";
    }
    for (const item of toCollapse) {
      if (item.kind !== "background-row") hasLineLevelToggle = true;
      clearItemAnimations(item);
      item.targetElement.classList.remove(REVEAL_COLLAPSED_CLASS);
      item.targetElement.classList.add(REVEAL_EXITING_CLASS);
      item.state = "exiting";
    }

    const changedLineIndices: number[] = [];
    for (const item of toExpand) {
      if (!changedLineIndices.includes(item.lineIndex)) changedLineIndices.push(item.lineIndex);
    }
    for (const item of toCollapse) {
      if (!changedLineIndices.includes(item.lineIndex)) changedLineIndices.push(item.lineIndex);
    }
    if (typeof view.relayoutChangedLines === "function") {
      view.relayoutChangedLines(changedLineIndices);
    } else {
      view.relayout(true);
    }

    // Read post-relayout metrics & computed filters while layout is clean (before invokeTick mutates classes).
    const newTops = lines.map(readRawLineTop);
    const visibleRange = resolveVisibleIndexRange(lines, newTops, scrollEl);
    const lineShifts = computeLineLayoutShifts(oldTops, newTops, visibleRange.start, visibleRange.end);
    const trailingShifts: [number, number][] = [];
    for (let t = 0; t < trailingEls.length; t += 1) {
      const dy = Math.round((oldTrailingTops[t] - trailingEls[t].offsetTop) * 100) / 100;
      if (Math.abs(dy) >= MIN_SHIFT_PX) {
        trailingShifts.push([lines.length + t, dy]);
      }
    }
    const innerSiblingDeltas: Array<[HTMLElement, number]> = [];
    for (const [sibling, oldSiblingTop] of innerSiblingSnapshots) {
      const dySibling = oldSiblingTop - sibling.offsetTop;
      if (Math.abs(dySibling) >= MIN_SHIFT_PX) {
        innerSiblingDeltas.push([sibling, dySibling]);
      }
    }
    const expandBaseFilters = new Map<ManagedItem, string>();
    for (const item of toExpand) {
      expandBaseFilters.set(item, readComputedFilter(item.visualElement));
    }
    for (const [item, snapshot] of exitSnapshots) {
      if (snapshot.hasRect) {
        snapshot.midRestingTop = measureMidRestingVisualTop(item);
      }
    }

    const result = invokeTick();

    const newScrollTop = scrollEl?.scrollTop ?? oldScrollTop;
    const signedScrollDelta = newScrollTop - oldScrollTop;
    const scrollDeltaPx = Math.abs(signedScrollDelta);
    const didScroll = scrollDeltaPx > 2;

    let activeChanged = false;
    let activeAfterCount = 0;
    for (const line of lines) {
      if (line.lyricElement.classList.contains("blyrics--active")) {
        activeAfterCount += 1;
        if (!activeBefore.has(line.lyricElement)) {
          activeChanged = true;
        }
      }
    }
    if (activeAfterCount !== activeBefore.size) {
      activeChanged = true;
    }

    let maxLayoutShiftPx = 0;
    for (const [, dy] of lineShifts) {
      const absDy = Math.abs(dy);
      if (absDy > maxLayoutShiftPx) maxLayoutShiftPx = absDy;
    }
    // Engine stamps .blyrics--active up to 0.54s before committing the scroll, so a real lyric scroll
    // coinciding with a background reveal can have activeChanged=false; detect it by scroll magnitude.
    const isScrollTransition = scrollDeltaPx > maxLayoutShiftPx * 0.75 + 12;

    const isGlassyFlowManaged = container.classList.contains("blyrics--gf-managed");
    const shiftMode: LayoutShiftPayload["mode"] =
      hasLineLevelToggle || activeChanged || isScrollTransition ? "sync-scroll" : "immediate";
    const flipDurationMs = shiftMode === "immediate" ? FLIP_IMMEDIATE_DURATION_MS : FLIP_SYNC_DURATION_MS;
    const allShifts = trailingShifts.length > 0 ? [...lineShifts, ...trailingShifts] : lineShifts;

    if (allShifts.length > 0 || (isGlassyFlowManaged && shiftMode === "immediate" && didScroll)) {
      if (isGlassyFlowManaged) {
        const CustomEventCtor = container.ownerDocument?.defaultView?.CustomEvent ?? CustomEvent;
        const payload: LayoutShiftPayload = { shifts: allShifts, mode: shiftMode };
        container.dispatchEvent(new CustomEventCtor(LAYOUT_SHIFT_EVENT, { detail: JSON.stringify(payload) }));
      } else {
        const useAddComposite = didScroll && tickOptions.smoothScroll !== false;
        for (const [lineIdx, dy] of lineShifts) {
          const lineEl = lines[lineIdx]?.lyricElement;
          if (lineEl) runStandaloneFlip(lineEl, dy, useAddComposite, flipDurationMs);
        }
        for (const [trailingIdx, dy] of trailingShifts) {
          const trailingEl = trailingEls[trailingIdx - lines.length];
          if (trailingEl) runStandaloneFlip(trailingEl, dy, useAddComposite, flipDurationMs);
        }
      }
    }

    const nowMs = Date.now();
    if (shiftMode === "sync-scroll" && scrollDeltaPx > 25) {
      lastLyricScrollAtMs = nowMs;
      lastLyricScrollTimeS = actualTimeS;
    }

    const useSyncDelay = isGlassyFlowManaged && shiftMode === "sync-scroll" && didScroll;
    const innerSiblingDelayMs = useSyncDelay ? GF_INNER_FLIP_SYNC_DELAY_MS : 0;
    for (const [sibling, dySibling] of innerSiblingDeltas) {
      runStandaloneFlip(sibling, dySibling, false, flipDurationMs, innerSiblingDelayMs);
    }
    const withinRecentScrollWindow =
      isGlassyFlowManaged &&
      lastLyricScrollAtMs > 0 &&
      Number.isFinite(lastLyricScrollTimeS) &&
      Math.abs(actualTimeS - lastLyricScrollTimeS) < 0.35;
    const recentScrollHoldMs = withinRecentScrollWindow
      ? Math.max(0, GF_BG_SYNC_DELAY_MS - (nowMs - lastLyricScrollAtMs))
      : 0;
    // Only delay exit when scrolling forward (GlassyFlow applies its 240ms hold); if scroll is
    // zero or negative, incoming lines move immediately so the exiting note must dissolve right away.
    const exitDelayMs = isGlassyFlowManaged && shiftMode === "sync-scroll" && signedScrollDelta > 2 ? GF_EXIT_DELAY_MS : 0;

    for (const item of toExpand) {
      let itemEnterDelayMs = useSyncDelay ? GF_ENTER_DELAY_MS : 0;
      if (item.kind !== "instrumental" && isGlassyFlowManaged) {
        itemEnterDelayMs = useSyncDelay ? GF_BG_SYNC_DELAY_MS : recentScrollHoldMs;
      }
      startEnterAnimation(item, itemEnterDelayMs, expandBaseFilters.get(item));
    }
    for (const item of toCollapse) {
      const snapshot = exitSnapshots.get(item);
      let anchorOffsetPx = snapshot?.fallbackOffsetPx ?? 0;
      if (snapshot?.hasRect) {
        anchorOffsetPx =
          snapshot.beforeVisualTop - snapshot.midRestingTop + (isGlassyFlowManaged ? signedScrollDelta : 0);
      }
      startExitAnimation(item, anchorOffsetPx, exitDelayMs, snapshot?.baseFilter);
    }

    return result;
  }

  let hooksAttached = false;

  function resolveDoc(): Document | null {
    return view.container?.ownerDocument ?? options?.document ?? (typeof document !== "undefined" ? document : null);
  }

  function patchedSetLyrics(this: ActiveRevealView, lyrics: Lyric[], setOptions?: SetLyricsOptions): void {
    resetTracking();
    originalSetLyrics.call(this, lyrics, setOptions);
    const container = view.container;
    if (!isEligibleContainer(container, view.syncType)) {
      wasEnabled = false;
      return;
    }
    wasEnabled = true;
    rebuildIndex(container, view.lines);
    if (managedItems.length > 0) {
      // Collapse inactive targets before first paint so songs never flash hidden notes or bg lines.
      snapAllToTime(container, 0, true);
    }
  }

  function patchedTick(this: ActiveRevealView, currentTimeS: number, tickOptions: TickOptions) {
    return runWithActiveReveal(currentTimeS, tickOptions, () => originalTick.call(this, currentTimeS, tickOptions));
  }

  function patchedClear(this: ActiveRevealView): void {
    resetTracking();
    originalClear?.call(this);
  }

  function attachHooks(): void {
    if (hooksAttached) return;
    hooksAttached = true;
    view.setLyrics = patchedSetLyrics;
    view.tick = patchedTick;
    if (typeof originalClear === "function") {
      view.clear = patchedClear;
    }
  }

  function detachHooks(): void {
    if (!hooksAttached) return;
    hooksAttached = false;
    view.setLyrics = originalSetLyrics;
    view.tick = originalTick;
    view.retickFromPlaybackClock = originalRetick;
    if (typeof originalClear === "function") {
      view.clear = originalClear;
    }
  }

  // Keep view methods completely unwrapped (zero per-tick overhead) when the setting is disabled.
  if (isAutoHideInstrumentalBgEnabled(resolveDoc())) {
    attachHooks();
  }

  controllers.set(view, {
    syncFromSettingChange() {
      const enabled = isAutoHideInstrumentalBgEnabled(resolveDoc());
      const container = view.container;
      if (!enabled) {
        wasEnabled = false;
        restoreAllItems(Boolean(container && container.isConnected));
        resetTracking();
        detachHooks();
        return;
      }
      attachHooks();
      if (!isEligibleContainer(container, view.syncType)) {
        wasEnabled = false;
        restoreAllItems(false);
        return;
      }
      wasEnabled = true;
      ensureIndexed(container);
      let timeS = 0;
      if (lastTickArgs) {
        timeS = computeActualTimeS(container, lastTickArgs.timeS, lastTickArgs.options);
      } else if (Number.isFinite(lastActualTimeS)) {
        timeS = lastActualTimeS;
      } else {
        const activeLine = view.lines.find(line => line.lyricElement.classList.contains("blyrics--active"));
        if (activeLine) timeS = activeLine.time;
      }
      snapAllToTime(container, timeS, true);
    },
    refreshInstrumentalVisuals() {
      for (const item of managedItems) {
        if (item.kind !== "instrumental") continue;
        clearItemAnimations(item);
        item.visualElement = item.lineElement.querySelector(".blyrics--instrumental-icon") ?? item.lineElement;
        if (item.state === "exiting") {
          item.targetElement.classList.remove(REVEAL_EXITING_CLASS);
          item.targetElement.classList.add(REVEAL_COLLAPSED_CLASS);
          item.state = "collapsed";
        }
      }
    },
  });
}

export function syncActiveReveal(view: ActiveRevealView): void {
  controllers.get(view)?.syncFromSettingChange();
}

export function refreshActiveRevealInstrumental(view: ActiveRevealView): void {
  controllers.get(view)?.refreshInstrumentalVisuals();
}
