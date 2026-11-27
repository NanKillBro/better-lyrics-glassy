import type { LineData, PartData } from "./inject.js";
import { type StageBox, type StageMetrics } from "./stage.js";
import type { LyricsLayout, LyricsRendererHost, LyricSyncType, ResolvedTickOptions, TickOptions } from "./types.js";
/**
 * Everything that belongs to a single rendered lyrics view: one scroll container, one selection,
 * one set of pending scroll work.
 */
interface AnimEngineViewState {
    /**
     * The render records this view built, one per lyric line. They hold this view's elements and
     * this view's `Animation` objects, so a second view never shares them.
     */
    lines: LineData[];
    lyricsContainer: HTMLElement | null;
    syncType: LyricSyncType;
    lyricWidth: number;
    lyricHeight: number;
    skipScrolls: number;
    skipScrollsDecayTimes: number[];
    scrollResumeTime: number;
    scrollPos: number;
    selectedElementIndex: number;
    wasUserScrolling: boolean;
    lastScrollElements: LineData[];
    /** The line a committed scroll kept in view because the active lines overflowed the band. */
    pinnedScrollLine: LineData | null;
    lastScrollDebugContext: {
        activeElms: LineData[];
        centers: number[];
        lyricScrollTime: number;
    };
    passiveScrollAccumulatedTime: number;
    passiveLastWallTime: number;
    /** Where the passive drift last put the scroll, so a scroll that lands anywhere else is the reader's. */
    passiveScrollTop: number | null;
}
/**
 * `Window` alone types neither `ResizeObserver` nor `DOMMatrix`: both are ambient `var`
 * declarations, so they only appear through `typeof globalThis`.
 */
type EngineWindow = Window & typeof globalThis;
export interface AnimationEngineInstance extends AnimEngineViewState {
    document: Document;
    window: EngineWindow;
    host: LyricsRendererHost;
    cachedTabRendererHeight: number | null;
    cachedScrollInsets: ScrollInsets;
    cachedFooterItem: LineScrollItem | null;
    cachedCreditsItem: LineScrollItem | null;
    creditsFocused: boolean;
    cachedLineScrollTiming: Map<string, LineScrollTiming>;
    tabRendererResizeObserver: ResizeObserver | null;
    observedTabRenderer: HTMLElement | null;
    lineScrollAnimations: LineScrollAnimationRecord[];
    lineScrollAnimationToken: number;
    pendingLineScroll: PendingLineScroll | null;
    lineScrollElementTokens: WeakMap<HTMLElement, number>;
    visibleWillChangeElements: Set<HTMLElement>;
    culledLineElements: Set<HTMLElement>;
    waveAnimationPool: Animation[];
    lineCullObserver: IntersectionObserver | null;
    cachedDurations: Map<string, number>;
    cachedCSSValues: Map<string, string>;
    cachedAnimationSettings: AnimationSettings | null;
    /**
     * Last value the tick was given. The passive scroll loop runs from an animation frame rather than
     * from a tick, so it has no options object to read.
     */
    passiveScrollEnabled: boolean;
    /**
     * Last options the tick was given, kept before any early return. A click reads its offsets to seek
     * to where a line plays rather than to its unshifted time.
     */
    lastTickOptions: ResolvedTickOptions | null;
    playbackRate: number;
    passiveRAFId: number | null;
    pendingLyricsUpdateFrame: number | null;
    learnedAnimationTimingOffsetMs: number;
    animationTimingVisibilityLogUntil: number;
    layout: LyricsLayout;
    stageKey: string;
    stageRemeasured: boolean;
    stageHeight: number;
    stageBox: StageBox | null;
    stageMetrics: Map<HTMLElement, StageMetrics>;
    stageY: Map<HTMLElement, number>;
    stageMoves: Map<HTMLElement, Animation>;
    stageFades: Map<HTMLElement, Animation>;
    stageBlurs: Map<HTMLElement, Animation>;
    stageFontSize: number;
    /**
     * Releases everything the instance holds on its window: the reduced motion listener, the tab
     * renderer observer and any frame it still has queued.
     */
    destroy(): void;
}
/**
 * Runs an operation against every live instance. Cheap enough for a scroll or a song change, and
 * deliberately not used inside the tick, which runs per frame and per line.
 */
export declare function forEveryLiveView(runOperation: (engine: AnimationEngineInstance) => void): void;
export declare function createAnimationEngineInstance(engineDocument: Document, engineWindow: EngineWindow, host: LyricsRendererHost, layout?: LyricsLayout): AnimationEngineInstance;
/**
 * Forgets the last player snapshot, so the next tick is treated as the first one of a new song
 * rather than as a jump away from the previous one.
 */
export declare function resetPlaybackClock(): void;
export declare function smoothedPlaybackTime(previousTime: number, previousAt: number, rawTime: number, now: number, playbackRate: number): number;
/**
 * The user asked for autoscroll back, now.
 */
export declare function resetScrollResume(engine: AnimationEngineInstance): void;
/**
 * The user asked for autoscroll back, now. Resuming is a property of playback rather than of one
 * view, so every live instance resumes. Published in this shape rather than as the registry walk
 * and the per view operation it is built from, so that nothing outside the module gets to name a
 * particular view.
 */
export declare function resumeAllAutoscroll(): void;
/**
 * The user scrolled this view. Scrolls the engine itself performed are swallowed;
 * a real one pauses autoscroll long enough to read where it landed, and offers the way back.
 *
 * @param isPassive - Whether the lyrics on screen are unsynced, and so are drifting on their own
 *   rather than following the song. Those resume sooner.
 */
export declare function noteUserScroll(engine: AnimationEngineInstance, isPassive: boolean): void;
/**
 * Reports whether the container is a different size than the lines were last measured against, and
 * clears the scroll cooldown when it is so the caller's re-measurement can scroll immediately. The
 * new size is recorded by that re-measurement, not here.
 */
export declare function noteContainerResize(engine: AnimationEngineInstance, width: number, height: number): boolean;
/**
 * Takes the lines this view is showing off the screen, keeping the container they were in, and
 * reports whether there was anything there to take.
 */
export declare function clearOnScreenLyrics(engine: AnimationEngineInstance): boolean;
export declare function hasRenderedLines(engine: AnimationEngineInstance): boolean;
/**
 * The render records this view built. Handing them out is a leak: they carry this view's elements
 * and its `Animation` objects, so a caller that rewrites line times or hangs translations off them
 * can only ever reach one view. Phase 5 revisits it, when both of those have to reach two.
 */
export declare function getRenderedLines(engine: AnimationEngineInstance): LineData[];
export declare function getRenderedSyncType(engine: AnimationEngineInstance): LyricSyncType;
/**
 * Drops the song this view was rendering: its selection, its pending scroll work, its animations
 * and its render records. The records go before the caller clears the DOM, so the elements they
 * hold are released along with it.
 */
export declare function clearLyrics(engine: AnimationEngineInstance): void;
/**
 * How far a scroll still running has carried a line from its place, or zero with none running on it.
 */
export declare function lineScrollOffset(engine: AnimationEngineInstance, element: HTMLElement): number;
/**
 * Hands the engine the lines of a song swapped into the view it already holds. A kept line is the
 * same record and keeps everything; a dropped line's animations stop and nothing goes on holding it;
 * a line built in place of one is handed what the engine held for that one, so the scroll does not
 * see a line it has not met and the stage does not fade in a line that was already up.
 *
 * @param lines - The new song's records, kept ones included, in order
 * @param dropped - Records of the song before that the new one no longer has
 * @param replaced - Each new record built in place of a dropped one, to the one it replaced
 */
export declare function replaceRenderedLines(engine: AnimationEngineInstance, lines: LineData[], dropped: readonly LineData[], replaced: ReadonlyMap<LineData, LineData>): void;
/**
 * Carries a swapped view across the layout change it caused. The line the reader is following holds
 * still on screen: the scroll moves by however far that line moved in the container. Every other
 * line that moved, relative to it, slides from where it was rather than jumping.
 *
 * Which line is followed depends on who owns the scroll. While the engine does, it is the line the
 * last scroll aimed at; while the reader does, it is the first line they could see.
 *
 * @param before - Where each line was in the container before the swap and how tall, from `swapLyrics`
 * @param scrollTopBefore - The scroll position the swap began at
 */
export declare function settleSwappedLines(engine: AnimationEngineInstance, before: ReadonlyMap<LineData, {
    position: number;
    height: number;
    offset: number;
}>, scrollTopBefore: number): void;
/**
 * Lets go of a part moving to another line or leaving the view: its animations stop, back to the pool
 * they came from, and it shows no sung state until a line that is being sung sets it up again.
 */
export declare function releasePart(part: PartData): void;
export declare function updateWordStates(lineData: LineData, currentTime: number): void;
type LineScrollSide = "above" | "active" | "below";
interface LineScrollItem {
    lyricElement: HTMLElement;
    height: number;
    position: number;
}
interface LineScrollAnimationRecord {
    animation: Animation;
    lineElement: HTMLElement;
    token: number;
}
interface AnimationConfig {
    enabled: {
        lineScale: boolean;
        wordWobble: boolean;
        highlightSwipe: boolean;
        highlightGlow: boolean;
        highlightFade: boolean;
        scroll: boolean;
        instrumental: boolean;
    };
    line: {
        durationMs: number;
        enterEasing: string;
        exitEasing: string;
        enterFrom: string;
        enterTo: string;
        exitFrom: string;
        exitTo: string;
    };
    highlight: {
        fadeInDurationMs: number;
        fadeOutDurationMs: number;
        fadeInEasing: string;
        fadeOutEasing: string;
        swipeEasing: string;
        swipeStartFrom: string;
        swipeEndFrom: string;
        swipeStartTo: string;
        swipeEndTo: string;
        imageGlowFrom: string;
        imageGlowTo: string;
        imageGlowOpacityFrom: string;
        imageGlowOpacityTo: string;
        glowFrom: string;
        glowTo: string;
        glowDurationRatio: number;
        glowMinDurationMs: number;
        glowEasing: string;
        glowContainerAlpha: number;
        glowRestingInvisible: boolean;
    };
    word: {
        wobbleDurationMs: number;
        wobbleEasing: string;
        wobblePeakEasing: string;
        wobbleEndEasing: string;
        wobbleFrom: string;
        wobblePeak: string;
        wobbleSettle: string;
        wobbleTo: string;
        wobblePeakOffset: number;
        wobbleSettleOffset: number;
    };
    letterWave: {
        transform: string;
        settle: string;
        emphasisScale: string;
        durationMs: number;
        riseEasing: string;
        fallEasing: string;
    };
    instrumental: {
        fillFadeDurationMs: number;
        fillFadeEasing: string;
        fillFrom: string;
        fillTo: string;
        fillEasing: string;
        waveFrom: string;
        waveTo: string;
        waveEasing: string;
        wavePathHigh: string;
        wavePathLow: string;
        waveOscillationDurationMs: number;
        waveOscillationEasing: string;
    };
    lineScroll: {
        easing: string;
        differentialEffects: boolean;
    };
}
interface AnimationSettings {
    config: AnimationConfig;
    scrollTiming: {
        earlyScrollConsiderS: number;
    };
}
export declare function noteVisibilityChange(engine: AnimationEngineInstance): void;
export interface LetterSwipeWindow {
    delayMs: number;
    durationMs: number;
    from: {
        start: number;
        end: number;
    };
    to: {
        start: number;
        end: number;
    };
}
export interface SwipeRamp {
    easing: string;
    startFrom: string;
    startTo: string;
    endFrom: string;
    endTo: string;
}
export declare function computeLetterSwipeWindows(swipe: SwipeRamp, letterCount: number, swipeDurationMs: number): LetterSwipeWindow[] | null;
export interface LetterMaskKeyframe {
    offset: number;
    maskPosition: string;
}
export interface LetterMaskSweep {
    keyframes: LetterMaskKeyframe[];
    delayMs: number;
    durationMs: number;
    easing: string;
}
export declare function planLetterMaskSweep(swipe: SwipeRamp, letterCount: number, swipeDurationMs: number, rtl: boolean): LetterMaskSweep[];
export interface LetterWaveTiming {
    delayMs: number;
    durationMs: number;
}
export declare function planLetterWave(swipe: SwipeRamp, letterCount: number, wordDurationMs: number, swipeDurationMs: number, swipeLeadMs: number, floatDurationMs: number): LetterWaveTiming[];
export declare function clearStyleCaches(engine: AnimationEngineInstance): void;
export declare function parseColorAlpha(value: string): number | null;
interface PreparedLineScroll {
    lineElement: HTMLElement;
    side: LineScrollSide;
    token: number;
}
interface ResolvedLineScroll extends PreparedLineScroll {
    durationMs: number;
    startEasing: string;
    endEasing: string;
    startTranslate: string;
    endTranslate: string;
}
interface LineScrollTiming {
    durationMs: number;
    startEasing: string;
    endEasing: string;
}
interface LineScrollPlan {
    items: ResolvedLineScroll[];
}
interface PendingLineScroll {
    plan: LineScrollPlan;
    activeLineElement: HTMLElement;
    fromScrollTop: number;
    toScrollTop: number;
}
export declare function setupLineCullObserver(engine: AnimationEngineInstance): void;
/**
 * Unsynced lyrics that this view still has on screen. `syncType` outlives the lyrics it was derived
 * from, so the container is the term that says they are still there.
 */
export declare function hasUnsyncedLyrics(engine: AnimationEngineInstance): boolean;
export interface ScrollInsets {
    readonly top: number;
    readonly bottom: number;
}
/**
 * The scroll element's `scroll-padding` is the part of its viewport a host has declared unreadable,
 * such as an edge faded out by a mask. Insets that leave no band at all are ignored rather than
 * obeyed, since there would be nowhere left to put a line.
 */
export declare function resolveScrollInsets(scrollPaddingTop: string, scrollPaddingBottom: string, viewportHeight: number): ScrollInsets;
interface ScrollTargetLine {
    readonly time: number;
    readonly duration: number;
    readonly position: number;
    readonly height: number;
}
/**
 * The line the singer is on: the latest one still being sung. An earlier line still running is a
 * tail, such as a background echo or a held note, and a later one is still in its lookahead. A line
 * stays active past its own end until the next one starts, so a started line only wins while it runs.
 */
export declare function findScrollAnchor<Line extends ScrollTargetLine>(sungLines: readonly Line[], scrollTime: number): Line;
/**
 * Where to scroll so the lines being sung sit around the target, inside the visible band. When they
 * do not all fit, the anchor keeps its top in view and the rest give way. `overflowsBand` tells the
 * caller the view is pinned to the anchor, and has to move on once that line ends.
 *
 * @param sungLines - In order, never empty. The last is the last active line.
 */
export declare function computeActiveLinesScrollTop(sungLines: readonly ScrollTargetLine[], anchor: ScrollTargetLine, viewportHeight: number, insets: ScrollInsets, targetOffset: number): {
    scrollTop: number;
    overflowsBand: boolean;
};
/**
 * "lyrics-missing" means this instance has nothing left to render. Whether that ends ticking is the
 * driver's call, not the instance's: one instance running dry must not silence another.
 */
export type AnimationTickStatus = "ok" | "lyrics-missing";
/**
 * Fills in everything a caller left out of a tick. The tick reads each of these arithmetically, so
 * a missing one would not fail: it would quietly turn the playback time into NaN and leave the view
 * matching no line at all.
 */
export declare function resolveTickOptions(options: TickOptions): ResolvedTickOptions;
export declare function measureStage(engine: AnimationEngineInstance): void;
/**
 * The player time at which a lyric time plays, under the offsets of the last tick.
 */
export declare function playerTimeForLyricTime(engine: AnimationEngineInstance, lyricTimeS: number): number;
/**
 * Renders one view against a tick with nothing left out.
 */
export declare function tickView(engine: AnimationEngineInstance, currentTime: number, options: ResolvedTickOptions): AnimationTickStatus;
/**
 * What a view has to know to size its scroll padding. Split out from the element reads so the
 * arithmetic can be checked against the degenerate cases, which is where it went wrong: an
 * unrendered container answers zero to every measurement.
 */
interface ScrollPaddingMeasurements {
    viewportHeight: number;
    targetScrollRatio: number;
    /** The container's own height with whatever bottom padding it currently carries taken back off. */
    contentHeight: number;
    firstLineHeight: number;
    /** Distance from the top of the container to the middle of the last line, or null with no lines. */
    lastLineCentre: number | null;
    lastLineHeight: number;
    footerHeight: number;
}
/**
 * Sizes the padding above the first line and below the last one so either can sit at the view's
 * target scroll position.
 *
 * The first two candidates are exact, and both are measured from the container. They are worth
 * nothing while it is not rendering: every line reports zero, which reads as content that already
 * runs past the last line and asks for no padding at all, and the last lines of the song then have
 * nowhere to scroll to. The viewport keeps its height whether the lyrics render or not, so the
 * space it alone demands below the last line is always knowable, and it is the floor. Over-padding
 * costs nothing visible; under-padding strands the end of every song.
 */
export declare function computeScrollPadding(measurements: ScrollPaddingMeasurements): {
    top: number;
    bottom: number;
};
/**
 * Re-reads the view's layout: the scroll padding first, then the line positions the padding moved.
 *
 * @param measureLines - Pass false while the lines are not being rendered. An unrendered container
 *   measures every line as zero height at zero offset, which would leave the scroll maths with
 *   nothing to work from once rendering resumes.
 */
export declare function relayout(engine: AnimationEngineInstance, measureLines: boolean): void;
export declare function relayoutChangedLines(engine: AnimationEngineInstance, changedIndices: readonly number[]): void;
export declare function refreshInstrumentalStyle(engine: AnimationEngineInstance, measureLines?: boolean): LineData[];
/**
 * Renders this view again against the last player snapshot, without moving the clock on. The
 * options are built now rather than handed in, so a caller that reads settings at tick time still
 * reads them at tick time.
 *
 * @param buildTickOptions - Given the snapshot the tick will run against, returns what to render it
 *   with.
 */
export declare function retickFromPlaybackClock(engine: AnimationEngineInstance, buildTickOptions: (eventCreationTime: number, isPlaying: boolean) => TickOptions): AnimationTickStatus;
/**
 * Called when a new lyrics element is added to trigger re-sync.
 * Debounced via requestAnimationFrame to avoid O(n²) layout thrashing
 * when translations/romanizations load (each addition would otherwise
 * re-measure ALL lines).
 *
 * @param isViewRendering - Asked on the frame rather than now. A driver that has stopped ticking is
 *   one whose lines may no longer be rendered, and an unrendered line measures as nothing, so a
 *   false answer declines both the re-measurement and the re-tick.
 * @param retick - Runs after the re-measurement, on the frame.
 */
export declare function scheduleLyricPositionUpdate(engine: AnimationEngineInstance, isViewRendering: () => boolean, retick: () => void): void;
export {};
