// The animation engine: one instance per rendered view, holding that view's lines, its selection,
// its scroll state and the per frame work that keeps the three in step. `renderer.ts` is what a
// consumer holds; this is what it is holding.
//
// An instance per rendered surface rather than a singleton, because this extension runs two: the
// YouTube Music side panel and the floating window. The two share parsed lyric data and a playback
// clock and nothing else, so anything one view can disagree with another about lives on the
// instance.
//
// The module owns no clock. A tick arrives from outside with the time already on it, which here is
// the interpolated player snapshot behind `blyrics-send-player-time`, and in the floating window a
// second interpolation of that same snapshot. Neither is a media element, which is why the custom
// element can own an animation frame loop over one while nothing under here owns a loop at all.
//
// Two things are module scope rather than instance scope: the set of live instances, and the
// playback clock the last tick wrote. Their unit is a bundle rather than a document, and this
// module is bundled into the isolated world and the page world separately, so those are two clocks
// that never meet. `themeSettings.ts` holds the third thing under that rule.
import { ANIMATING_CLASS, CREDITS_CLASS, CURRENT_LYRICS_CLASS, FOOTER_CLASS, LINE_CLASS, PAUSED_CLASS, ROMANIZED_LYRICS_CLASS, RTL_CLASS, TRANSLATED_LYRICS_CLASS, USER_SCROLLING_CLASS, WORD_STATE_ACTIVE, WORD_STATE_ATTR, WORD_STATE_PAST, WORD_STATE_UPCOMING, } from "./constants.js";
import { refreshInstrumentalImages } from "./imageHighlights.js";
import { INSTRUMENTAL_DOTS_CLASS, INSTRUMENTAL_DOT_CLASS, INSTRUMENTAL_DOT_LIT_CLASS, INSTRUMENTAL_WAVE_PATH_HIGH, INSTRUMENTAL_WAVE_PATH_LOW, readInstrumentalStyle, replaceInstrumentalIcon, } from "./instrumental.js";
import { layoutStage, planStage, queuedStageY, stageTextSpan, } from "./stage.js";
import { registerThemeSetting } from "./themeSettings.js";
import { clamp, getRelativeLayoutBounds, isGecko, positiveModulo, roundedMs, toMs } from "./util.js";
const NO_LYRICS_ELEMENT_LOG = "No lyrics element found on the page, skipping lyrics injection";
const LYRICS_CHECK_INTERVAL_ERROR = "Error in lyrics check interval:";
const PAUSING_LYRICS_SCROLL_LOG = "Pausing Lyrics Autoscroll Due to User Scroll";
const USER_SCROLL_RESUME_DELAY_MS = 25000;
const PASSIVE_USER_SCROLL_RESUME_DELAY_MS = 5000;
const PASSIVE_DRIFT_SCROLL_TOLERANCE_PX = 1;
const LYRIC_ENDING_THRESHOLD_S = registerThemeSetting("blyrics-lyric-ending-threshold-s", 0.5);
const EARLY_SCROLL_CONSIDER = registerThemeSetting("blyrics-early-scroll-consider-s", 0.54);
const TIME_JUMP_THRESHOLD = 0.5;
// Gecko steps media time every ~40ms, so reads lag by a random amount (never lead) that reseeks lines as drift.
const SMOOTH_PLAYBACK_CLOCK = isGecko();
// One Gecko step (~45ms) plus margin: a read further off is a seek or a timer spike, not media lag.
const CLOCK_RESYNC_THRESHOLD_S = 0.06;
const CLOCK_SLEW_PER_S = 0.1;
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const SCROLL_PREPARE_LEAD_MS = 120;
const LINE_SCROLL_FALLBACK_DURATION_MS = 750;
const SWIPE_LEAD_RATIO = registerThemeSetting("blyrics-swipe-lead-ratio", 0.1);
const SWIPE_DURATION_RATIO = registerThemeSetting("blyrics-swipe-duration-ratio", 1.6);
const ENABLE_DEBUG_RENDER = registerThemeSetting("blyrics-debug-renderer", false);
const ENABLE_ANIMATION_TIMING_LOGS = registerThemeSetting("blyrics-debug-animation-timing", false);
const ANIMATION_TIMING_LOG_WINDOW_MS = 3000;
const ANIMATION_TIMING_LOG_INTERVAL_MS = 750;
const ANIMATION_TIMING_LOG_THRESHOLD_MS = 30;
const ANIMATION_TIMING_RESET_THRESHOLD_MS = 100;
const ANIMATION_TIMING_ACCUMULATION_DECAY = 1.08;
const ANIMATION_TIMING_ACCUMULATION_WEIGHT = 0.4;
const ANIMATION_TIMING_LEARN_RATE = 0.08;
const ANIMATION_TIMING_LEARN_SAMPLE_LIMIT_MS = 80;
const ANIMATION_TIMING_MAX_LEARNED_OFFSET_MS = 80;
function registerLineScrollStyleSetting(property, defaultValue) {
    return [property, registerThemeSetting(property.slice(2), defaultValue)];
}
const LINE_SCROLL_AFTER_FUNCTION = "calc(750ms + log(var(--blyrics-line-scroll-abs-relative-index) + 2, 2.71828) * 80ms + (var(--blyrics-line-scroll-abs-relative-index) + 1) * 20ms)";
const LINE_SCROLL_STYLE_SETTINGS = [
    registerLineScrollStyleSetting("--blyrics-line-scroll-duration", LINE_SCROLL_AFTER_FUNCTION),
    registerLineScrollStyleSetting("--blyrics-line-scroll-above-duration", "calc(750ms + min(var(--blyrics-line-scroll-abs-relative-index), 6) * 20ms)"),
    registerLineScrollStyleSetting("--blyrics-line-scroll-active-duration", ""),
    registerLineScrollStyleSetting("--blyrics-line-scroll-below-duration", LINE_SCROLL_AFTER_FUNCTION),
    registerLineScrollStyleSetting("--blyrics-line-scroll-timing-function", "var(--blyrics-lyric-scroll-timing-function)"),
    registerLineScrollStyleSetting("--blyrics-line-scroll-start-easing", "var(--blyrics-line-scroll-timing-function)"),
    registerLineScrollStyleSetting("--blyrics-line-scroll-end-easing", "linear"),
    registerLineScrollStyleSetting("--blyrics-line-scroll-above-start-easing", ""),
    registerLineScrollStyleSetting("--blyrics-line-scroll-active-start-easing", ""),
    registerLineScrollStyleSetting("--blyrics-line-scroll-below-start-easing", ""),
    registerLineScrollStyleSetting("--blyrics-line-scroll-above-end-easing", ""),
    registerLineScrollStyleSetting("--blyrics-line-scroll-active-end-easing", ""),
    registerLineScrollStyleSetting("--blyrics-line-scroll-below-end-easing", ""),
    registerLineScrollStyleSetting("--blyrics-line-scroll-translate-y-start", "var(--blyrics-line-scroll-delta-px)"),
    registerLineScrollStyleSetting("--blyrics-line-scroll-translate-y-end", "0px"),
    registerLineScrollStyleSetting("--blyrics-line-scroll-above-translate-y-start", ""),
    registerLineScrollStyleSetting("--blyrics-line-scroll-active-translate-y-start", ""),
    registerLineScrollStyleSetting("--blyrics-line-scroll-below-translate-y-start", ""),
    registerLineScrollStyleSetting("--blyrics-line-scroll-above-translate-y-end", ""),
    registerLineScrollStyleSetting("--blyrics-line-scroll-active-translate-y-end", ""),
    registerLineScrollStyleSetting("--blyrics-line-scroll-below-translate-y-end", ""),
];
// Tracked so the tick can skip the per-line translate write-then-read unless a theme overrides it.
const LINE_SCROLL_TRANSLATE_SETTINGS = LINE_SCROLL_STYLE_SETTINGS.filter(([property]) => property.includes("translate-y")).map(([, setting]) => setting);
const animationTimingLastLogTimes = new WeakMap();
// 0.5 means the selected lyric will be in the middle of the screen, 0 means top, 1 means bottom
const SCROLL_POS_OFFSET_RATIO = registerThemeSetting("blyrics-target-scroll-pos-ratio", 0.37);
const PASSIVE_SCROLL_ENABLED = registerThemeSetting("blyrics-passive-scroll-enabled", true);
const PASSIVE_SECONDS_PER_LINE = registerThemeSetting("blyrics-passive-scroll-seconds-per-line", 3.5);
const PASSIVE_BOTTOM_PAUSE_S = registerThemeSetting("blyrics-passive-scroll-bottom-pause-s", 1.5);
const PASSIVE_RESET_DURATION_S = registerThemeSetting("blyrics-passive-scroll-reset-duration-s", 0.6);
const PASSIVE_TOP_PAUSE_S = registerThemeSetting("blyrics-passive-scroll-top-pause-s", 0.8);
/**
 * Stands where a snapshot's wall clock timestamp would be when the time did not come from a live
 * player, and so says nothing about how long ago it was sampled.
 */
const NO_PLAYER_SNAPSHOT = -1;
/**
 * Every instance that has been created and not yet destroyed. Operations that describe the song
 * rather than one view are addressed to all of them: nothing outside this module gets to name a
 * particular view, so nothing outside it can leave one showing lyrics the others have dropped.
 */
const liveEngines = new Set();
/**
 * Runs an operation against every live instance. Cheap enough for a scroll or a song change, and
 * deliberately not used inside the tick, which runs per frame and per line.
 */
export function forEveryLiveView(runOperation) {
    for (const engine of liveEngines) {
        runOperation(engine);
    }
}
export function createAnimationEngineInstance(engineDocument, engineWindow, host, layout = "scroll") {
    const reducedMotionQuery = engineWindow.matchMedia(REDUCED_MOTION_QUERY);
    const handleReducedMotionChange = () => clearStyleCaches(engine);
    const engine = {
        document: engineDocument,
        window: engineWindow,
        host,
        lines: [],
        lyricsContainer: null,
        syncType: "none",
        lyricWidth: 0,
        lyricHeight: 0,
        skipScrolls: 0,
        skipScrollsDecayTimes: [],
        scrollResumeTime: 0,
        scrollPos: -1,
        selectedElementIndex: 0,
        wasUserScrolling: false,
        lastScrollElements: [],
        pinnedScrollLine: null,
        lastScrollDebugContext: {
            activeElms: [],
            centers: [],
            lyricScrollTime: 0,
        },
        passiveScrollAccumulatedTime: 0,
        passiveLastWallTime: 0,
        passiveScrollTop: null,
        cachedTabRendererHeight: null,
        cachedScrollInsets: NO_SCROLL_INSETS,
        cachedFooterItem: null,
        cachedCreditsItem: null,
        cachedLastSungLineRef: null,
        cachedLastSungLine: undefined,
        creditsFocused: false,
        cachedLineScrollTiming: new Map(),
        tabRendererResizeObserver: null,
        observedTabRenderer: null,
        lineScrollAnimations: [],
        lineScrollAnimationToken: 0,
        pendingLineScroll: null,
        lineScrollElementTokens: new WeakMap(),
        visibleWillChangeElements: new Set(),
        culledLineElements: new Set(),
        waveAnimationPool: [],
        lineCullObserver: null,
        cachedDurations: new Map(),
        cachedCSSValues: new Map(),
        cachedAnimationSettings: null,
        passiveScrollEnabled: false,
        lastTickOptions: null,
        playbackRate: 1,
        passiveRAFId: null,
        pendingLyricsUpdateFrame: null,
        learnedAnimationTimingOffsetMs: 0,
        animationTimingVisibilityLogUntil: 0,
        layout,
        stageKey: "",
        stageRemeasured: false,
        stageHeight: 0,
        stageBox: null,
        stageMetrics: new Map(),
        stageY: new Map(),
        stageMoves: new Map(),
        stageFades: new Map(),
        stageBlurs: new Map(),
        stageFontSize: 16,
        destroy: () => {
            liveEngines.delete(engine);
            reducedMotionQuery.removeEventListener("change", handleReducedMotionChange);
            engine.tabRendererResizeObserver?.disconnect();
            engine.tabRendererResizeObserver = null;
            engine.observedTabRenderer = null;
            engine.lineCullObserver?.disconnect();
            engine.lineCullObserver = null;
            stopPassiveScrollLoop(engine);
            cancelLyricPositionUpdate(engine);
        },
    };
    reducedMotionQuery.addEventListener("change", handleReducedMotionChange);
    liveEngines.add(engine);
    return engine;
}
const playbackClock = {
    lastTime: 0,
    lastPlayState: false,
    lastEventCreationTime: NO_PLAYER_SNAPSHOT,
    smoothedTime: 0,
    smoothedAt: NO_PLAYER_SNAPSHOT,
};
/**
 * Forgets the last player snapshot, so the next tick is treated as the first one of a new song
 * rather than as a jump away from the previous one.
 */
export function resetPlaybackClock() {
    playbackClock.lastTime = 0;
    playbackClock.lastPlayState = false;
    playbackClock.lastEventCreationTime = NO_PLAYER_SNAPSHOT;
    playbackClock.smoothedAt = NO_PLAYER_SNAPSHOT;
}
export function smoothedPlaybackTime(previousTime, previousAt, rawTime, now, playbackRate) {
    if (previousAt === NO_PLAYER_SNAPSHOT)
        return rawTime;
    const elapsedS = Math.max(0, now - previousAt) / 1000;
    const predictedTime = previousTime + elapsedS * playbackRate;
    const errorS = rawTime - predictedTime;
    if (errorS >= 0 || Math.abs(errorS) >= CLOCK_RESYNC_THRESHOLD_S)
        return rawTime;
    return predictedTime + errorS * Math.min(1, elapsedS * CLOCK_SLEW_PER_S);
}
// -- View operations --------------------------
/**
 * The user asked for autoscroll back, now.
 */
export function resetScrollResume(engine) {
    engine.scrollResumeTime = 0;
}
/**
 * The user asked for autoscroll back, now. Resuming is a property of playback rather than of one
 * view, so every live instance resumes. Published in this shape rather than as the registry walk
 * and the per view operation it is built from, so that nothing outside the module gets to name a
 * particular view.
 */
export function resumeAllAutoscroll() {
    forEveryLiveView(resetScrollResume);
}
/**
 * The user scrolled this view. Scrolls the engine itself performed are swallowed;
 * a real one pauses autoscroll long enough to read where it landed, and offers the way back.
 *
 * @param isPassive - Whether the lyrics on screen are unsynced, and so are drifting on their own
 *   rather than following the song. Those resume sooner.
 */
export function noteUserScroll(engine, isPassive) {
    if (isPassive) {
        if (isPassiveDriftScroll(engine))
            return;
    }
    else if (engine.skipScrolls > 0) {
        engine.skipScrolls--;
        engine.skipScrollsDecayTimes.shift();
        return;
    }
    dropPendingLineScroll(engine);
    if (engine.host.isLoaderActive())
        return;
    if (engine.scrollResumeTime < Date.now()) {
        engine.host.log(PAUSING_LYRICS_SCROLL_LOG);
    }
    engine.scrollResumeTime =
        Date.now() + (isPassive ? PASSIVE_USER_SCROLL_RESUME_DELAY_MS : USER_SCROLL_RESUME_DELAY_MS);
    engine.wasUserScrolling = true;
    engine.host.setResumeAffordanceVisible(true);
    engine.lyricsContainer?.classList.add(USER_SCROLLING_CLASS);
}
/**
 * Reports whether the container is a different size than the lines were last measured against, and
 * clears the scroll cooldown when it is so the caller's re-measurement can scroll immediately. The
 * new size is recorded by that re-measurement, not here.
 */
export function noteContainerResize(engine, width, height) {
    if (width === engine.lyricWidth && height === engine.lyricHeight)
        return false;
    return true;
}
/**
 * Takes the lines this view is showing off the screen, keeping the container they were in, and
 * reports whether there was anything there to take.
 */
export function clearOnScreenLyrics(engine) {
    if (!engine.lyricsContainer)
        return false;
    engine.lyricsContainer.replaceChildren();
    resetStage(engine);
    return true;
}
export function hasRenderedLines(engine) {
    return engine.lines.length > 0;
}
/**
 * The render records this view built. Handing them out is a leak: they carry this view's elements
 * and its `Animation` objects, so a caller that rewrites line times or hangs translations off them
 * can only ever reach one view. Phase 5 revisits it, when both of those have to reach two.
 */
export function getRenderedLines(engine) {
    return engine.lines;
}
export function getRenderedSyncType(engine) {
    return engine.syncType;
}
/**
 * Drops the song this view was rendering: its selection, its pending scroll work, its animations
 * and its render records. The records go before the caller clears the DOM, so the elements they
 * hold are released along with it.
 */
export function clearLyrics(engine) {
    engine.scrollPos = -1;
    dropPendingLineScroll(engine);
    clearLineScrollAnimations(engine);
    clearVisibleLyricWillChange(engine);
    engine.lineCullObserver?.disconnect();
    engine.lineCullObserver = null;
    clearOffscreenLineCulling(engine);
    for (const line of engine.lines) {
        resetLineAnimationState(line);
        line.isSelected = false;
    }
    engine.skipScrollsDecayTimes = [];
    engine.lastScrollElements = [];
    engine.pinnedScrollLine = null;
    engine.lastScrollDebugContext.activeElms = [];
    engine.lastScrollDebugContext.centers = [];
    engine.passiveScrollAccumulatedTime = 0;
    engine.passiveLastWallTime = 0;
    engine.passiveScrollTop = null;
    stopPassiveScrollLoop(engine);
    engine.lines = [];
    engine.cachedFooterItem = null;
    engine.cachedCreditsItem = null;
    engine.cachedLastSungLineRef = null;
    engine.cachedLastSungLine = undefined;
    engine.creditsFocused = false;
    engine.lyricsContainer = null;
    engine.waveAnimationPool.length = 0;
    resetStage(engine);
}
/**
 * How far a scroll still running has carried a line from its place, or zero with none running on it.
 */
export function lineScrollOffset(engine, element) {
    if (!engine.lineScrollAnimations.some(record => record.lineElement === element))
        return 0;
    return currentTranslateY(engine, element, 0);
}
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
export function replaceRenderedLines(engine, lines, dropped, replaced) {
    const successors = new Map();
    for (const [line, previous] of replaced)
        successors.set(previous, line);
    const droppedElements = new Set(dropped.map(line => line.lyricElement));
    const carry = (line) => successors.get(line) ?? (droppedElements.has(line.lyricElement) ? null : line);
    const carryAll = (from) => from.map(carry).filter((line) => line !== null);
    // The line being sung is still the line being sung, so a theme keyed on those classes does not dim it
    // and bring it back. Its animations are set up again from the new timing on the next tick. Read
    // before the dropped lines are let go, which clears their selection.
    for (const [line, previous] of replaced) {
        line.isScrolled = previous.isScrolled;
        line.isSelected = previous.isSelected;
        togglePartClass(line, CURRENT_LYRICS_CLASS, previous.lyricElement.classList.contains(CURRENT_LYRICS_CLASS));
        togglePartClass(line, ANIMATING_CLASS, previous.lyricElement.classList.contains(ANIMATING_CLASS));
    }
    // A planned scroll was planned against lines and places this swap is about to change.
    dropPendingLineScroll(engine);
    for (const record of [...engine.lineScrollAnimations]) {
        if (!droppedElements.has(record.lineElement))
            continue;
        record.animation.cancel();
        removeLineScrollAnimation(engine, record);
    }
    for (const line of dropped) {
        resetLineAnimationState(line);
        line.isSelected = false;
        engine.visibleWillChangeElements.delete(line.lyricElement);
        engine.culledLineElements.delete(line.lyricElement);
    }
    engine.lastScrollElements = carryAll(engine.lastScrollElements);
    engine.lastScrollDebugContext.activeElms = carryAll(engine.lastScrollDebugContext.activeElms);
    engine.pinnedScrollLine = engine.pinnedScrollLine === null ? null : carry(engine.pinnedScrollLine);
    engine.lines = lines;
    if (engine.layout === "stage")
        replaceStageElements(engine, dropped, replaced);
}
/**
 * Starts the same animation on another element at the point the first one has reached, or answers
 * null when there is nothing left of it to carry on.
 */
function continueAnimation(animation, element) {
    const effect = animation?.effect;
    if (!animation || !effect || typeof effect.getKeyframes !== "function" || animation.playState === "finished") {
        return null;
    }
    if (animation.playState === "idle")
        return null;
    const continued = element.animate(effect.getKeyframes(), { ...effect.getTiming(), composite: effect.composite });
    continued.playbackRate = animation.playbackRate;
    continued.currentTime = animation.currentTime;
    if (animation.playState === "paused")
        continued.pause();
    return continued;
}
/**
 * Moves what the stage held for each replaced line onto the line built in its place, and lets go of
 * every dropped line. A replacement starts exactly where and as visible as the line it replaced, so
 * placing the stage afterwards only moves it if the new song puts it somewhere else.
 */
function replaceStageElements(engine, dropped, replaced) {
    for (const [line, previous] of replaced) {
        const element = line.lyricElement;
        const role = previous.lyricElement.dataset.stageRole;
        const y = engine.stageY.get(previous.lyricElement);
        if (role === undefined || y === undefined)
            continue;
        element.dataset.stageRole = role;
        const visible = previous.lyricElement.dataset.stageVisible !== undefined;
        if (visible)
            element.dataset.stageVisible = "";
        // A line replaced mid-glide carries on gliding from wherever the one it replaced had got to.
        const move = continueAnimation(engine.stageMoves.get(previous.lyricElement), element);
        if (move === null) {
            snapStageElement(engine, element, y);
        }
        else {
            engine.stageMoves.set(element, move);
            engine.stageY.set(element, y);
        }
        const fade = continueAnimation(engine.stageFades.get(previous.lyricElement), element) ??
            element.animate([{ [STAGE_OPACITY_PROPERTY]: isStageRoleVisible(role) ? 1 : 0 }], {
                duration: 0,
                fill: "forwards",
            });
        if (!isStageRoleVisible(role)) {
            fade.onfinish = () => {
                if (engine.stageFades.get(element) === fade)
                    delete element.dataset.stageVisible;
            };
        }
        engine.stageFades.set(element, fade);
        const blur = continueAnimation(engine.stageBlurs.get(previous.lyricElement), element);
        if (blur !== null)
            engine.stageBlurs.set(element, blur);
    }
    for (const line of dropped) {
        const element = line.lyricElement;
        for (const animations of [engine.stageMoves, engine.stageFades, engine.stageBlurs]) {
            animations.get(element)?.cancel();
            animations.delete(element);
        }
        engine.stageY.delete(element);
        engine.stageMetrics.delete(element);
    }
    // The roles are planned again against the new lines, even where they come out the same.
    engine.stageKey = "";
}
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
export function settleSwappedLines(engine, before, scrollTopBefore) {
    const container = engine.lyricsContainer;
    const scrollElement = engine.host.getScrollElement();
    if (container === null || scrollElement === null || engine.layout === "stage")
        return;
    const readerOwnsScroll = engine.scrollResumeTime > Date.now();
    const followed = readerOwnsScroll
        ? engine.lines.find(line => {
            const was = before.get(line);
            return was !== undefined && was.position + was.height > scrollTopBefore;
        })
        : (engine.lastScrollElements.findLast(line => before.has(line)) ??
            engine.lines.find(line => before.has(line) && line.isScrolled));
    const followedWas = followed === undefined ? undefined : before.get(followed)?.position;
    // A line that has not been measured, because the view is not on screen, has nowhere to hold still.
    if (followed !== undefined && followedWas !== undefined && followedWas >= 0 && followed.position >= 0) {
        const moved = followed.position - followedWas;
        if (Math.abs(moved) >= DECORATION_MIN_SHIFT_PX)
            scrollElement.scrollTop = scrollTopBefore + moved;
    }
    // Read back rather than assumed: the browser may have clamped the write, or clamped the scroll for
    // a song that got shorter before anything here wrote it. Either way the event that follows is not
    // the reader's, and a write the browser clamped to nothing sends none.
    const shift = scrollElement.scrollTop - scrollTopBefore;
    if (shift !== 0) {
        engine.skipScrolls += 1;
        engine.skipScrollsDecayTimes.push(Date.now() + 2000);
        if (engine.scrollPos >= 0)
            engine.scrollPos += shift;
    }
    if (!decorationSlideAllowed(engine, container))
        return;
    for (const line of engine.lines) {
        const was = before.get(line);
        if (was === undefined || was.position < 0 || line.position < 0)
            continue;
        // From where it is on screen, which a line scroll still running carries away from its place.
        const onScreenShift = was.position + was.offset - line.position + shift;
        if (Math.abs(onScreenShift) >= DECORATION_MIN_SHIFT_PX)
            slideElementBy(line.lyricElement, onScreenShift);
    }
}
function resetStage(engine) {
    for (const animation of [
        ...engine.stageMoves.values(),
        ...engine.stageFades.values(),
        ...engine.stageBlurs.values(),
    ]) {
        animation.cancel();
    }
    engine.stageMoves.clear();
    engine.stageFades.clear();
    engine.stageBlurs.clear();
    engine.stageMetrics.clear();
    engine.stageY.clear();
    engine.stageKey = "";
    engine.stageHeight = 0;
    if (engine.stageBox !== null) {
        engine.stageBox = null;
        engine.host.onStageLayout?.(null);
    }
}
/**
 * Lets go of a part moving to another line or leaving the view: its animations stop, back to the pool
 * they came from, and it shows no sung state until a line that is being sung sets it up again.
 */
export function releasePart(part) {
    resetPartAnimations(part);
    togglePartClass(part, PAUSED_CLASS, false);
    togglePartClass(part, ANIMATING_CLASS, false);
    part.wordState = WORD_STATE_UPCOMING;
    part.lyricElement.setAttribute(WORD_STATE_ATTR, WORD_STATE_UPCOMING);
    part.highlightElement.setAttribute(WORD_STATE_ATTR, WORD_STATE_UPCOMING);
    part.imageLayers?.highlight?.setAttribute(WORD_STATE_ATTR, WORD_STATE_UPCOMING);
}
function resetPartAnimations(part) {
    for (const animation of part.animations) {
        animation.cancel();
        const pool = pooledWaveAnimations.get(animation);
        if (pool)
            pool.push(animation);
    }
    part.animations = [];
}
const linesMayHaveAnimations = new WeakSet();
function resetLineAnimations(lineData) {
    resetPartAnimations(lineData);
    const parts = lineData.parts;
    for (let i = 0; i < parts.length; i++) {
        resetPartAnimations(parts[i]);
    }
    linesMayHaveAnimations.delete(lineData);
}
function hasLineAnimations(lineData) {
    if (!linesMayHaveAnimations.has(lineData))
        return false;
    if (lineData.animations.length > 0)
        return true;
    const parts = lineData.parts;
    for (let i = 0; i < parts.length; i++) {
        if (parts[i].animations.length > 0)
            return true;
    }
    linesMayHaveAnimations.delete(lineData);
    return false;
}
function markLineAnimationsStopped(lineData) {
    lineData.isAnimating = false;
    lineData.isAnimationPlayStatePlaying = false;
    lineData.accumulatedOffsetMs = 0;
}
function resetLineAnimationState(lineData) {
    resetLineAnimations(lineData);
    markLineAnimationsStopped(lineData);
}
function togglePartClass(part, className, force) {
    part.lyricElement.classList.toggle(className, force);
    if ("highlightElement" in part) {
        part.highlightElement.classList.toggle(className, force);
        part.imageLayers?.highlight?.classList.toggle(className, force);
    }
}
function setPartAnimationsPlayState(part, isPlaying) {
    togglePartClass(part, PAUSED_CLASS, !isPlaying);
    for (const animation of part.animations) {
        if (isPlaying) {
            animation.play();
        }
        else {
            animation.pause();
        }
    }
}
function setAnimationsPlayState(lineData, isPlaying) {
    setPartAnimationsPlayState(lineData, isPlaying);
    const parts = lineData.parts;
    for (let i = 0; i < parts.length; i++) {
        setPartAnimationsPlayState(parts[i], isPlaying);
    }
}
function clearLineStateClasses(lineData) {
    lineData.lyricElement.classList.remove(ANIMATING_CLASS);
    togglePartClass(lineData, PAUSED_CLASS, false);
    const parts = lineData.parts;
    for (let i = 0; i < parts.length; i++) {
        togglePartClass(parts[i], PAUSED_CLASS, false);
    }
}
export function updateWordStates(lineData, currentTime) {
    const parts = lineData.parts;
    const lineEndTime = lineData.time + lineData.duration;
    for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        const endTime = part.duration > 0 ? part.time + part.duration : (parts[i + 1]?.time ?? lineEndTime);
        let state = WORD_STATE_PAST;
        if (currentTime < part.time) {
            state = WORD_STATE_UPCOMING;
        }
        else if (currentTime < endTime) {
            state = WORD_STATE_ACTIVE;
        }
        if (part.wordState === state)
            continue;
        part.wordState = state;
        part.lyricElement.setAttribute(WORD_STATE_ATTR, state);
        part.highlightElement.setAttribute(WORD_STATE_ATTR, state);
        part.imageLayers?.highlight?.setAttribute(WORD_STATE_ATTR, state);
    }
}
const LINE_SYNCED_WORD_CLASS = "blyrics-line-synced-word";
const INSTRUMENTAL_FILL_SELECTOR = ".blyrics--instrumental-fill";
const INSTRUMENTAL_WAVE_CLIP_SELECTOR = ".blyrics--wave-clip";
const INSTRUMENTAL_WAVE_PATH_SELECTOR = ".blyrics--wave-path";
const INSTRUMENTAL_DOTS_SELECTOR = `.${INSTRUMENTAL_DOTS_CLASS}`;
const INSTRUMENTAL_DOT_SELECTOR = `.${INSTRUMENTAL_DOT_CLASS}`;
const INSTRUMENTAL_DOT_LIT_SELECTOR = `.${INSTRUMENTAL_DOT_LIT_CLASS}`;
const DOTS_WAVE_PERIOD_MS = 2600;
const DOTS_WAVE_STAGGER_MS = 350;
const DOTS_WAVE_KEYFRAMES = [
    { transform: "translateY(0px) scale(1)", easing: "ease-out" },
    { transform: "translateY(-0.06em) scale(1.12)", offset: 0.25, easing: "ease-in" },
    { transform: "translateY(0px) scale(1)", offset: 0.5, easing: "ease-out" },
    { transform: "translateY(0.06em) scale(0.92)", offset: 0.75, easing: "ease-in" },
    { transform: "translateY(0px) scale(1)" },
];
const INSTRUMENTAL_WAVE_PATH_HIGH_FALLBACK = `path("${INSTRUMENTAL_WAVE_PATH_HIGH}")`;
const INSTRUMENTAL_WAVE_PATH_LOW_FALLBACK = `path("${INSTRUMENTAL_WAVE_PATH_LOW}")`;
const LINE_SCROLL_INDEX_PROPERTY = "--blyrics-line-scroll-index";
const LINE_SCROLL_ACTIVE_INDEX_PROPERTY = "--blyrics-line-scroll-active-index";
const LINE_SCROLL_RELATIVE_INDEX_PROPERTY = "--blyrics-line-scroll-relative-index";
const LINE_SCROLL_ABS_RELATIVE_INDEX_PROPERTY = "--blyrics-line-scroll-abs-relative-index";
const LINE_SCROLL_SIDE_PROPERTY = "--blyrics-line-scroll-side";
const LINE_SCROLL_DELTA_PROPERTY = "--blyrics-line-scroll-delta-px";
const LINE_SCROLL_DISTANCE_PROPERTY = "--blyrics-line-scroll-distance-px";
const LINE_SCROLL_WILL_CHANGE_VALUE = "transform, translate";
const LINE_SCROLL_INLINE_PROPERTIES = [
    LINE_SCROLL_INDEX_PROPERTY,
    LINE_SCROLL_ACTIVE_INDEX_PROPERTY,
    LINE_SCROLL_RELATIVE_INDEX_PROPERTY,
    LINE_SCROLL_ABS_RELATIVE_INDEX_PROPERTY,
    LINE_SCROLL_SIDE_PROPERTY,
    LINE_SCROLL_DELTA_PROPERTY,
    LINE_SCROLL_DISTANCE_PROPERTY,
    ...LINE_SCROLL_STYLE_SETTINGS.map(([property]) => property),
];
const animationTimingTracks = new WeakMap();
// A document's timeline counts from its own window's time origin, which differs in another window or frame.
function timelineNow(animation) {
    const target = animation.effect?.target;
    return target?.ownerDocument?.defaultView?.performance?.now?.() ?? performance.now();
}
// A current time set before an animation starts holds until its first frame, which a long setup frame delays.
function seekAnimation(engine, animation, timeMs) {
    const rate = animation.playbackRate;
    if (!engine.lastTickOptions?.isPlaying || typeof animation.timeline?.currentTime !== "number" || rate === 0) {
        animation.currentTime = timeMs;
        return;
    }
    animation.startTime = timelineNow(animation) - timeMs / rate;
}
function mirrorImageHighlightAnimations(part, animations) {
    const target = part.imageLayers?.highlight;
    if (!target)
        return [];
    const mirrors = [];
    for (const animation of animations) {
        const effect = animation.effect;
        if (!effect || effect.target !== part.highlightElement)
            continue;
        const mirror = target.animate(effect.getKeyframes(), effect.getTiming());
        mirror.playbackRate = animation.playbackRate;
        if (animation.playState === "running" && animation.startTime !== null) {
            mirror.startTime = animation.startTime;
        }
        else {
            mirror.currentTime = animation.currentTime;
        }
        const timing = animationTimingTracks.get(animation);
        if (timing)
            animationTimingTracks.set(mirror, { ...timing, skipDriftSample: true });
        mirrors.push(mirror);
    }
    return mirrors;
}
function trackLyricAnimationTiming(engine, animation, timing) {
    animationTimingTracks.set(animation, {
        ...timing,
        appliedTimingOffsetMs: timing.appliedTimingOffsetMs ?? engine.learnedAnimationTimingOffsetMs,
    });
    // Being tracked is what makes an animation the song's rather than the interface's, so it is also
    // what decides which ones follow the song's rate.
    animation.playbackRate = engine.playbackRate;
    return animation;
}
// Finished per-letter wave animations are pooled and retargeted onto new letters, since recreating
// ~150 identical ones per line activation is pure churn.
const pooledWaveAnimations = new WeakMap();
const pooledWaveKeyframeSignatures = new WeakMap();
function acquireWaveAnimation(engine, letterElement, keyframes, keyframeSignature, timing) {
    const pool = engine.waveAnimationPool;
    const pooled = pool[pool.length - 1];
    const effect = pooled?.effect;
    if (pooled && effect && typeof effect.setKeyframes === "function") {
        pool.pop();
        effect.target = letterElement;
        if (pooledWaveKeyframeSignatures.get(pooled) !== keyframeSignature) {
            effect.setKeyframes(keyframes);
            pooledWaveKeyframeSignatures.set(pooled, keyframeSignature);
        }
        effect.updateTiming(timing);
        pooled.play();
        return pooled;
    }
    const animation = letterElement.animate(keyframes, timing);
    pooledWaveAnimations.set(animation, pool);
    pooledWaveKeyframeSignatures.set(animation, keyframeSignature);
    return animation;
}
/**
 * Puts the animations already running onto a new rate. Setting `playbackRate` keeps `currentTime`,
 * so each one carries on from where the song left it rather than restarting.
 */
function applyPlaybackRateToRunningAnimations(engine) {
    for (const line of engine.lines) {
        for (const animation of line.animations) {
            if (animationTimingTracks.has(animation))
                animation.playbackRate = engine.playbackRate;
        }
        for (const part of line.parts) {
            for (const animation of part.animations) {
                if (animationTimingTracks.has(animation))
                    animation.playbackRate = engine.playbackRate;
            }
        }
    }
}
function correctedAnimationTimeMs(targetTimeMs, appliedTimingOffsetMs, maxTimeMs) {
    const scheduledTimeMs = targetTimeMs - appliedTimingOffsetMs;
    return maxTimeMs === undefined ? scheduledTimeMs : Math.min(scheduledTimeMs, maxTimeMs);
}
function correctedWrappedAnimationTimeMs(targetTimeMs, appliedTimingOffsetMs, wrapDurationMs) {
    return positiveModulo(targetTimeMs - appliedTimingOffsetMs, wrapDurationMs);
}
function correctedScrollTimeS(engine, currentTime) {
    return currentTime - engine.learnedAnimationTimingOffsetMs / 1000;
}
function timingValueToMs(value) {
    if (typeof value === "number") {
        return Number.isFinite(value) || value === Number.POSITIVE_INFINITY ? value : null;
    }
    if (typeof value === "string") {
        const durationMs = toMs(value);
        return durationMs > 0 ? durationMs : null;
    }
    if (!value || typeof value !== "object") {
        return null;
    }
    const numericValue = value;
    if (typeof numericValue.to !== "function") {
        return null;
    }
    try {
        const msValue = numericValue.to("ms").value;
        return typeof msValue === "number" && Number.isFinite(msValue) ? msValue : null;
    }
    catch (_err) {
        return null;
    }
}
// The timeline's time is held per task and per frame, so a running animation is read against now, the clock it was placed on.
function animationCurrentTimeMs(animation, nowMs) {
    const startTimeMs = animation.startTime;
    if (animation.playState === "running" && typeof startTimeMs === "number") {
        const liveNowMs = nowMs !== undefined ? nowMs : timelineNow(animation);
        return (liveNowMs - startTimeMs) * animation.playbackRate;
    }
    return timingValueToMs(animation.currentTime);
}
// A finished animation's currentTime stops at its end time, which counts the delay, so that is where
// the expected time has to stop too. Clamping to the active duration alone saturates a delayed
// animation as soon as it is created and hides any drift in it.
function animationEndTimeMs(animation) {
    return timingValueToMs(animation.effect?.getComputedTiming().endTime);
}
function wrappedTimingOffsetMs(actualTimeMs, expectedTimeMs, wrapDurationMs) {
    return positiveModulo(actualTimeMs - expectedTimeMs + wrapDurationMs / 2, wrapDurationMs) - wrapDurationMs / 2;
}
function normalizeAnimationTimeMs(animation, timeMs, timing) {
    if (!Number.isFinite(timeMs) || timeMs < 0) {
        return null;
    }
    if (timing.wrapDurationMs && timing.wrapDurationMs > 0) {
        return positiveModulo(timeMs, timing.wrapDurationMs);
    }
    const endTimeMs = animationEndTimeMs(animation);
    if (endTimeMs !== null && Number.isFinite(endTimeMs)) {
        return Math.min(timeMs, endTimeMs);
    }
    return timeMs;
}
function animationTimingSample(part, animation, currentTime, nowMs) {
    const timing = animationTimingTracks.get(animation);
    if (!timing || timing.skipDriftSample) {
        return null;
    }
    if (animation.playState === "idle") {
        return null;
    }
    const actualTimeMs = animationCurrentTimeMs(animation, nowMs);
    if (actualTimeMs === null) {
        return null;
    }
    const rawExpectedTimeMs = (currentTime - part.time) * 1000 + timing.offsetMs;
    const expectedTimeMs = normalizeAnimationTimeMs(animation, rawExpectedTimeMs, timing);
    const normalizedActualTimeMs = normalizeAnimationTimeMs(animation, actualTimeMs, timing);
    if (expectedTimeMs === null || normalizedActualTimeMs === null) {
        return null;
    }
    const offsetMs = timing.wrapDurationMs && timing.wrapDurationMs > 0
        ? wrappedTimingOffsetMs(normalizedActualTimeMs, expectedTimeMs, timing.wrapDurationMs)
        : normalizedActualTimeMs - expectedTimeMs;
    const biasOffsetMs = offsetMs + timing.appliedTimingOffsetMs;
    return {
        actualTimeMs: normalizedActualTimeMs,
        appliedTimingOffsetMs: timing.appliedTimingOffsetMs,
        biasOffsetMs,
        expectedTimeMs,
        offsetMs,
        playState: animation.playState,
    };
}
function accumulateLargestNativeTimingSample(part, currentTime, largestSample, nowMs) {
    for (const animation of part.animations) {
        const sample = animationTimingSample(part, animation, currentTime, nowMs);
        if (sample !== null && (largestSample === null || Math.abs(sample.offsetMs) > Math.abs(largestSample.offsetMs))) {
            largestSample = sample;
        }
    }
    return largestSample;
}
function lineNativeTimingSample(lineData, currentTime, nowMs) {
    let largestSample = accumulateLargestNativeTimingSample(lineData, currentTime, null, nowMs);
    const parts = lineData.parts;
    for (let i = 0; i < parts.length; i++) {
        largestSample = accumulateLargestNativeTimingSample(parts[i], currentTime, largestSample, nowMs);
    }
    return largestSample;
}
function countLineAnimations(lineData) {
    let count = lineData.animations.length;
    const parts = lineData.parts;
    for (let i = 0; i < parts.length; i++) {
        count += parts[i].animations.length;
    }
    return count;
}
function linePreview(lineData) {
    return lineData.lyricElement.textContent?.trim().replace(/\s+/g, " ").slice(0, 80) ?? "";
}
function canUseTimingSampleForDrift(sample, isPlaying) {
    if (!isPlaying) {
        return false;
    }
    return sample.playState === "running" || sample.playState === "finished";
}
function learnAnimationTimingOffset(engine, sample) {
    if (Math.abs(sample.biasOffsetMs) > ANIMATION_TIMING_LEARN_SAMPLE_LIMIT_MS) {
        return engine.learnedAnimationTimingOffsetMs;
    }
    engine.learnedAnimationTimingOffsetMs = clamp(engine.learnedAnimationTimingOffsetMs +
        (sample.biasOffsetMs - engine.learnedAnimationTimingOffsetMs) * ANIMATION_TIMING_LEARN_RATE, -ANIMATION_TIMING_MAX_LEARNED_OFFSET_MS, ANIMATION_TIMING_MAX_LEARNED_OFFSET_MS);
    return engine.learnedAnimationTimingOffsetMs;
}
function shouldLogAnimationTiming(engine, lineData, sample, now) {
    if (!ENABLE_ANIMATION_TIMING_LOGS.getBooleanValue()) {
        return false;
    }
    const isVisibilityLogWindow = now < engine.animationTimingVisibilityLogUntil;
    if (!isVisibilityLogWindow && Math.abs(sample.offsetMs) < ANIMATION_TIMING_LOG_THRESHOLD_MS) {
        return false;
    }
    const lastLogTime = animationTimingLastLogTimes.get(lineData) ?? 0;
    if (now - lastLogTime < ANIMATION_TIMING_LOG_INTERVAL_MS) {
        return false;
    }
    animationTimingLastLogTimes.set(lineData, now);
    return true;
}
function logAnimationTiming(engine, reason, lineData, lineIndex, sample, currentTime, accumulatedOffsetMs, learnedOffsetMs = engine.learnedAnimationTimingOffsetMs, residualOffsetMs = sample.offsetMs) {
    if (!ENABLE_ANIMATION_TIMING_LOGS.getBooleanValue()) {
        return;
    }
    engine.host.log("WAAPI timing", {
        reason,
        lineIndex,
        lineTimeS: roundedMs(lineData.time * 1000) / 1000,
        mediaTimeS: roundedMs(currentTime * 1000) / 1000,
        actualTimeMs: roundedMs(sample.actualTimeMs),
        expectedTimeMs: roundedMs(sample.expectedTimeMs),
        offsetMs: roundedMs(sample.offsetMs),
        learnedOffsetMs: roundedMs(learnedOffsetMs),
        appliedTimingOffsetMs: roundedMs(sample.appliedTimingOffsetMs),
        biasOffsetMs: roundedMs(sample.biasOffsetMs),
        residualOffsetMs: roundedMs(residualOffsetMs),
        accumulatedOffsetMs: roundedMs(accumulatedOffsetMs),
        playState: sample.playState,
        text: linePreview(lineData),
    });
}
function logAnimationCleanup(engine, reason, lineData, lineIndex, currentTime, staleAnimationEndTime) {
    if (!ENABLE_ANIMATION_TIMING_LOGS.getBooleanValue()) {
        return;
    }
    engine.host.log("Animation cleanup", {
        reason,
        lineIndex,
        lineTimeS: roundedMs(lineData.time * 1000) / 1000,
        mediaTimeS: roundedMs(currentTime * 1000) / 1000,
        staleAnimationEndTimeS: roundedMs(staleAnimationEndTime * 1000) / 1000,
        runningAnimationCount: countLineAnimations(lineData),
        text: linePreview(lineData),
    });
}
export function noteVisibilityChange(engine) {
    if (!ENABLE_ANIMATION_TIMING_LOGS.getBooleanValue()) {
        return;
    }
    if (!engine.lyricsContainer)
        return;
    const runningAnimationCount = engine.lines.reduce((count, line) => count + countLineAnimations(line), 0);
    if (engine.document.visibilityState === "visible") {
        engine.animationTimingVisibilityLogUntil = Date.now() + ANIMATION_TIMING_LOG_WINDOW_MS;
        engine.host.log("Visibility changed; keeping WAAPI animations for timing verification", {
            visibilityState: engine.document.visibilityState,
            runningAnimationCount,
            resetSkipped: true,
            timingLogWindowMs: ANIMATION_TIMING_LOG_WINDOW_MS,
        });
        return;
    }
    engine.host.log("Visibility changed; WAAPI animations left intact", {
        visibilityState: engine.document.visibilityState,
        runningAnimationCount,
        resetSkipped: true,
    });
}
function activeTextGradientKeyframes(config) {
    return [
        {
            "--lyric-transition-amount-start": config.highlight.swipeStartFrom,
            "--lyric-transition-amount-end": config.highlight.swipeEndFrom,
        },
        {
            "--lyric-transition-amount-start": config.highlight.swipeStartTo,
            "--lyric-transition-amount-end": config.highlight.swipeEndTo,
        },
    ];
}
function activeTextGlowKeyframes(config, part) {
    if (part.imageLayers)
        return [
            { filter: `blur(${config.highlight.imageGlowFrom})`, opacity: config.highlight.imageGlowOpacityFrom },
            { filter: `blur(${config.highlight.imageGlowTo})`, opacity: config.highlight.imageGlowOpacityTo },
        ];
    return [{ filter: config.highlight.glowFrom }, { filter: config.highlight.glowTo }];
}
function activeTextVisibleKeyframes() {
    return [{ opacity: 1 }, { opacity: 1 }];
}
function activeTextInstantKeyframes(config) {
    return [
        {
            opacity: 1,
            "--lyric-transition-amount-start": config.highlight.swipeStartTo,
            "--lyric-transition-amount-end": config.highlight.swipeEndTo,
        },
        {
            opacity: 1,
            "--lyric-transition-amount-start": config.highlight.swipeStartTo,
            "--lyric-transition-amount-end": config.highlight.swipeEndTo,
        },
    ];
}
function lineSyncedTextKeyframes(config) {
    return [
        {
            opacity: 0,
            "--lyric-transition-amount-start": config.highlight.swipeStartTo,
            "--lyric-transition-amount-end": config.highlight.swipeEndTo,
        },
        {
            opacity: 1,
            "--lyric-transition-amount-start": config.highlight.swipeStartTo,
            "--lyric-transition-amount-end": config.highlight.swipeEndTo,
        },
    ];
}
function fadeOutTextKeyframes(config, part) {
    const glowFilter = part.imageLayers
        ? { filter: "none" }
        : config.enabled.highlightGlow && !part.glowSuppressed && !config.highlight.glowRestingInvisible
            ? { filter: config.highlight.glowTo }
            : {};
    return [
        {
            opacity: 1,
            ...glowFilter,
            "--lyric-transition-amount-start": config.highlight.swipeStartTo,
            "--lyric-transition-amount-end": config.highlight.swipeEndTo,
        },
        {
            opacity: 0,
            ...glowFilter,
            "--lyric-transition-amount-start": config.highlight.swipeStartTo,
            "--lyric-transition-amount-end": config.highlight.swipeEndTo,
        },
    ];
}
// null unless the ramp is linear and forward; planLetterMaskSweep sweeps the whole word instead there.
export function computeLetterSwipeWindows(swipe, letterCount, swipeDurationMs) {
    if (swipe.easing !== "linear" || swipeDurationMs <= 0 || letterCount <= 0) {
        return null;
    }
    const startFrom = Number.parseFloat(swipe.startFrom);
    const startTo = Number.parseFloat(swipe.startTo);
    const endFrom = Number.parseFloat(swipe.endFrom);
    const endTo = Number.parseFloat(swipe.endTo);
    if (![startFrom, startTo, endFrom, endTo].every(Number.isFinite) || startTo <= startFrom || endTo <= endFrom) {
        return null;
    }
    const startAt = (timeMs) => startFrom + ((startTo - startFrom) * timeMs) / swipeDurationMs;
    const endAt = (timeMs) => endFrom + ((endTo - endFrom) * timeMs) / swipeDurationMs;
    const timeWhereEnd = (value) => (swipeDurationMs * (value - endFrom)) / (endTo - endFrom);
    const timeWhereStart = (value) => (swipeDurationMs * (value - startFrom)) / (startTo - startFrom);
    const windows = [];
    for (let index = 0; index < letterCount; index++) {
        const beginMs = clamp(timeWhereEnd(index / letterCount), 0, swipeDurationMs);
        const finishMs = clamp(timeWhereStart((index + 1) / letterCount), 0, swipeDurationMs);
        windows.push({
            delayMs: beginMs,
            durationMs: Math.max(finishMs - beginMs, 1),
            from: { start: startAt(beginMs), end: endAt(beginMs) },
            to: { start: startAt(finishMs), end: endAt(finishMs) },
        });
    }
    return windows;
}
// Per-letter mask reveal. A linear forward ramp keeps the short windowed animations so a settled letter
// holds a finished one; any other easing runs the same geometry over the whole duration, letting the
// theme easing warp when each letter reveals, so it ends revealed rather than swept past.
export function planLetterMaskSweep(swipe, letterCount, swipeDurationMs, rtl) {
    if (letterCount <= 0)
        return [];
    const windows = computeLetterSwipeWindows({ ...swipe, easing: "linear" }, letterCount, swipeDurationMs);
    if (!windows)
        return [];
    const maskSpan = letterCount + 2;
    const maskPositionAt = (start, index) => {
        const q = (0.5 * maskSpan - (start * letterCount - index)) / (maskSpan - 1);
        return `${(rtl ? 1 - q : q) * 100}% 0%`;
    };
    const linear = swipe.easing === "linear";
    const durationMs = swipeDurationMs > 0 ? swipeDurationMs : 1;
    return windows.map((window, index) => {
        const from = maskPositionAt(window.from.start, index);
        const to = maskPositionAt(window.to.start, index);
        if (linear) {
            return {
                keyframes: [
                    { offset: 0, maskPosition: from },
                    { offset: 1, maskPosition: to },
                ],
                delayMs: window.delayMs,
                durationMs: window.durationMs,
                easing: "linear",
            };
        }
        const revealStart = clamp(window.delayMs / durationMs, 0, 1);
        const revealEnd = clamp((window.delayMs + window.durationMs) / durationMs, 0, 1);
        const keyframes = [{ offset: 0, maskPosition: from }];
        if (revealStart > 0)
            keyframes.push({ offset: revealStart, maskPosition: from });
        if (revealEnd > revealStart)
            keyframes.push({ offset: revealEnd, maskPosition: to });
        if (revealEnd < 1)
            keyframes.push({ offset: 1, maskPosition: to });
        return { keyframes, delayMs: 0, durationMs, easing: swipe.easing };
    });
}
function swipeRamp(config) {
    return {
        easing: config.highlight.swipeEasing,
        startFrom: config.highlight.swipeStartFrom,
        startTo: config.highlight.swipeStartTo,
        endFrom: config.highlight.swipeEndFrom,
        endTo: config.highlight.swipeEndTo,
    };
}
// How far through its float a letter crests, as a keyframe offset.
const LETTER_WAVE_CREST_OFFSET = 0.4;
// WebRender redraws a cached tile only after a quarter device pixel of movement, so Gecko letters step.
// An invisible additive opacity ripple changes every frame and forces the redraw.
const GECKO_REDRAW = isGecko();
const GECKO_REDRAW_KEYFRAMES = [{ opacity: 0 }, { opacity: -0.002 }, { opacity: 0 }];
const GECKO_REDRAW_PERIOD_MS = 200;
// When each letter's wave starts, counted from the start of the word, and how long it lasts. A letter
// crests just as the swipe finishes lighting it. If the swipe lights it faster than the float rises,
// it starts early enough to make that, which on a short word means before the word itself does. If the
// swipe lights it slower, it starts as the swipe touches it and its float stretches to crest on time.
export function planLetterWave(swipe, letterCount, wordDurationMs, swipeDurationMs, swipeLeadMs, floatDurationMs) {
    const riseMs = floatDurationMs * LETTER_WAVE_CREST_OFFSET;
    const windows = computeLetterSwipeWindows({ ...swipe, easing: "linear" }, letterCount, swipeDurationMs);
    const timings = [];
    for (let index = 0; index < letterCount; index++) {
        if (!windows) {
            // No windows for this ramp, so spread the letters evenly over the word.
            timings.push({ delayMs: (wordDurationMs * index) / letterCount, durationMs: floatDurationMs });
            continue;
        }
        // The swipe runs swipeLeadMs ahead of the word, so take the lead back off.
        const touchedMs = windows[index].delayMs - swipeLeadMs;
        const litMs = touchedMs + windows[index].durationMs;
        if (litMs - riseMs > touchedMs) {
            timings.push({ delayMs: touchedMs, durationMs: (litMs - touchedMs) / LETTER_WAVE_CREST_OFFSET });
        }
        else {
            timings.push({ delayMs: litMs - riseMs, durationMs: floatDurationMs });
        }
    }
    return timings;
}
function startRichSyncedHighlightAnimations(engine, part, config, swipeTimeMs, wordTimeMs, swipeDurationMs, glowDurationMs, appliedTimingOffsetMs) {
    const animations = [];
    const highlight = part.highlightElement;
    let swipeAnimation;
    if (config.enabled.highlightSwipe) {
        const swipeTiming = { appliedTimingOffsetMs, offsetMs: swipeTimeMs - wordTimeMs };
        const swipeCurrentTimeMs = correctedAnimationTimeMs(swipeTimeMs, appliedTimingOffsetMs, swipeDurationMs);
        const highlightLetters = part.highlightLetterElements;
        if (highlightLetters && highlightLetters.length > 0) {
            const sweeps = planLetterMaskSweep(swipeRamp(config), highlightLetters.length, swipeDurationMs, part.highlightElement.classList.contains(RTL_CLASS));
            sweeps.forEach((sweep, index) => {
                const targets = [highlightLetters[index], part.imageLayers?.glowLetters[index]].filter((target) => target !== undefined);
                for (const target of targets) {
                    const animation = trackLyricAnimationTiming(engine, target.animate(sweep.keyframes.map(frame => ({
                        offset: frame.offset,
                        maskPosition: frame.maskPosition,
                        WebkitMaskPosition: frame.maskPosition,
                    })), { duration: sweep.durationMs, delay: sweep.delayMs, easing: sweep.easing, fill: "both" }), 
                    // The last letter's sweep ends last, so it alone covers the whole word.
                    index === sweeps.length - 1 && target === highlightLetters[index]
                        ? swipeTiming
                        : { ...swipeTiming, skipDriftSample: true });
                    seekAnimation(engine, animation, swipeCurrentTimeMs);
                    if (index === 0)
                        swipeAnimation = animation;
                    animations.push(animation);
                }
            });
        }
        else {
            swipeAnimation = trackLyricAnimationTiming(engine, highlight.animate(activeTextGradientKeyframes(config), {
                duration: swipeDurationMs,
                easing: config.highlight.swipeEasing,
                fill: "forwards",
            }), swipeTiming);
            seekAnimation(engine, swipeAnimation, swipeCurrentTimeMs);
            animations.push(swipeAnimation);
        }
    }
    const opacityAnimation = trackLyricAnimationTiming(engine, highlight.animate(config.enabled.highlightSwipe ? activeTextVisibleKeyframes() : activeTextInstantKeyframes(config), {
        duration: 1,
        easing: "linear",
        fill: "forwards",
    }), { appliedTimingOffsetMs, offsetMs: 0 });
    seekAnimation(engine, opacityAnimation, correctedAnimationTimeMs(wordTimeMs, appliedTimingOffsetMs, 1));
    animations.push(opacityAnimation);
    let glowAnimation;
    if (config.enabled.highlightGlow && !part.glowSuppressed) {
        glowAnimation = trackLyricAnimationTiming(engine, (part.imageLayers?.glow ?? highlight).animate(activeTextGlowKeyframes(config, part), {
            duration: glowDurationMs,
            easing: config.highlight.glowEasing,
            fill: part.imageLayers ? "forwards" : config.highlight.glowRestingInvisible ? "none" : "forwards",
        }), { appliedTimingOffsetMs, offsetMs: 0 });
        seekAnimation(engine, glowAnimation, correctedAnimationTimeMs(wordTimeMs, appliedTimingOffsetMs, glowDurationMs));
        animations.push(glowAnimation);
    }
    return { animations, swipe: swipeAnimation, fade: opacityAnimation, glow: glowAnimation };
}
function startLineSyncedHighlightAnimations(engine, part, config, wordTimeMs, glowDurationMs, appliedTimingOffsetMs) {
    const animations = [];
    const fadeInDuration = config.enabled.highlightFade ? config.highlight.fadeInDurationMs : 1;
    const highlight = part.highlightElement;
    const opacityAnimation = trackLyricAnimationTiming(engine, highlight.animate(lineSyncedTextKeyframes(config), {
        duration: fadeInDuration,
        easing: config.enabled.highlightFade ? config.highlight.fadeInEasing : "linear",
        fill: "forwards",
    }), { appliedTimingOffsetMs, offsetMs: 0 });
    seekAnimation(engine, opacityAnimation, correctedAnimationTimeMs(wordTimeMs, appliedTimingOffsetMs, fadeInDuration));
    animations.push(opacityAnimation);
    let glowAnimation;
    if (config.enabled.highlightGlow && !part.glowSuppressed) {
        glowAnimation = trackLyricAnimationTiming(engine, (part.imageLayers?.glow ?? highlight).animate(activeTextGlowKeyframes(config, part), {
            duration: glowDurationMs,
            easing: config.highlight.glowEasing,
            fill: part.imageLayers ? "forwards" : config.highlight.glowRestingInvisible ? "none" : "forwards",
        }), { appliedTimingOffsetMs, offsetMs: 0 });
        seekAnimation(engine, glowAnimation, correctedAnimationTimeMs(wordTimeMs, appliedTimingOffsetMs, glowDurationMs));
        animations.push(glowAnimation);
    }
    return { animations, fade: opacityAnimation, glow: glowAnimation };
}
function startLineAnimation(engine, lineData, config, currentTime, appliedTimingOffsetMs) {
    resetPartAnimations(lineData);
    const rawElapsedMs = (currentTime - lineData.time) * 1000;
    if (!config.enabled.lineScale) {
        lineData.animations = [];
        return;
    }
    const animation = trackLyricAnimationTiming(engine, lineData.lyricElement.animate([{ transform: config.line.enterFrom }, { transform: config.line.enterTo }], {
        duration: config.line.durationMs,
        easing: config.line.enterEasing,
        fill: "forwards",
    }), { appliedTimingOffsetMs, offsetMs: 0 });
    seekAnimation(engine, animation, correctedAnimationTimeMs(rawElapsedMs, appliedTimingOffsetMs, config.line.durationMs));
    lineData.animations = [animation];
}
function startLineExitAnimation(lineData, config) {
    resetPartAnimations(lineData);
    if (!config.enabled.lineScale) {
        return;
    }
    const animation = lineData.lyricElement.animate([{ transform: config.line.exitFrom }, { transform: config.line.exitTo }], {
        duration: config.line.durationMs,
        easing: config.line.exitEasing,
        fill: "none",
    });
    lineData.animations = [animation];
    animation.addEventListener("finish", () => {
        resetPartAnimations(lineData);
    }, { once: true });
}
function startWordAnimations(engine, part, config, currentTime, appliedTimingOffsetMs) {
    resetPartAnimations(part);
    const rawElapsedMs = (currentTime - part.time) * 1000;
    // Providers do ship words that end before they start: one -0.01s word in a Musixmatch richsync
    // was enough to make animate() throw here, and the throw took the rest of the tick with it, so
    // the line never finished setting up and the engine tried it again on every frame.
    const timedDurationMs = Math.max(0, part.duration * 1000);
    const isLineSyncedWord = part.lyricElement.classList.contains(LINE_SYNCED_WORD_CLASS);
    const swipeLeadMs = timedDurationMs * SWIPE_LEAD_RATIO.getNumberValue();
    const swipeTimeMs = rawElapsedMs + swipeLeadMs;
    const wordTimeMs = rawElapsedMs;
    const swipeDurationMs = timedDurationMs * SWIPE_DURATION_RATIO.getNumberValue();
    const glowDurationMs = Math.max(timedDurationMs * config.highlight.glowDurationRatio, config.highlight.glowMinDurationMs);
    const highlightAnimations = isLineSyncedWord
        ? startLineSyncedHighlightAnimations(engine, part, config, wordTimeMs, config.highlight.glowMinDurationMs, appliedTimingOffsetMs)
        : startRichSyncedHighlightAnimations(engine, part, config, swipeTimeMs, wordTimeMs, swipeDurationMs, glowDurationMs, appliedTimingOffsetMs);
    const wobbleAnimations = [];
    if (config.enabled.wordWobble) {
        const wobbleKeyframes = [
            { transform: config.word.wobbleFrom },
            {
                transform: config.word.wobblePeak,
                offset: config.word.wobblePeakOffset,
                easing: config.word.wobblePeakEasing,
            },
            {
                transform: config.word.wobbleSettle,
                offset: Math.max(config.word.wobblePeakOffset, config.word.wobbleSettleOffset),
            },
            { transform: config.word.wobbleTo, easing: config.word.wobbleEndEasing },
        ];
        const wobbleOptions = {
            duration: config.word.wobbleDurationMs,
            easing: config.word.wobbleEasing,
            fill: "forwards",
        };
        const wobbleStartMs = correctedAnimationTimeMs(wordTimeMs, appliedTimingOffsetMs, config.word.wobbleDurationMs);
        for (const wordElement of part.wobbleElements) {
            const animation = trackLyricAnimationTiming(engine, wordElement.animate(wobbleKeyframes, wobbleOptions), {
                appliedTimingOffsetMs,
                offsetMs: 0,
            });
            seekAnimation(engine, animation, wobbleStartMs);
            wobbleAnimations.push(animation);
        }
        const letters = part.letterElements;
        if (letters && letters.length > 0) {
            const emphasise = part.lyricElement?.dataset.longWord === "true";
            const emphasisPeak = emphasise ? ` scale(${config.letterWave.emphasisScale})` : "";
            const emphasisRest = emphasise ? " scale(1)" : "";
            const floatKeyframes = [
                { transform: `translateY(0)${emphasisRest}`, easing: config.letterWave.riseEasing },
                {
                    transform: `${config.letterWave.transform}${emphasisPeak}`,
                    offset: LETTER_WAVE_CREST_OFFSET,
                    easing: config.letterWave.fallEasing,
                },
                { transform: `${config.letterWave.settle}${emphasisRest}` },
            ];
            const letterCount = letters.length;
            const waves = planLetterWave(swipeRamp(config), letterCount, timedDurationMs, swipeDurationMs, swipeLeadMs, config.letterWave.durationMs);
            // A letter that starts before the word would have a negative delay, which the drift check reads
            // as the wave running behind once it finishes. Run the wave's clock ahead by the head start
            // instead, the way the swipe carries its lead, so every delay stays at zero or above.
            const waveLeadMs = Math.max(0, -Math.min(...waves.map(wave => wave.delayMs)));
            const waveEndsMs = waves.map(wave => wave.delayMs + wave.durationMs);
            const lastWaveEndMs = Math.max(...waveEndsMs);
            const lastEndingWaveIndex = waveEndsMs.lastIndexOf(lastWaveEndMs);
            const cascadeDurationMs = waveLeadMs + lastWaveEndMs;
            const floatStartMs = correctedAnimationTimeMs(wordTimeMs + waveLeadMs, appliedTimingOffsetMs, cascadeDurationMs);
            const floatKeyframeSignature = JSON.stringify(floatKeyframes);
            // Glow letters only show while the glow does: never when it is off or renders nothing for this
            // word, and not once it has faded out. Their waves stop there instead of running to the end.
            const glowLetters = config.enabled.highlightGlow && !part.glowSuppressed ? part.imageLayers?.glowLetters : undefined;
            const glowEndMs = Number.parseFloat(config.highlight.imageGlowOpacityTo) === 0 ? waveLeadMs + glowDurationMs : Infinity;
            const animateLetters = (letters, endMs, sampled) => {
                letters?.forEach((letterElement, index) => {
                    const delayMs = waves[index].delayMs + waveLeadMs;
                    if (delayMs >= endMs)
                        return;
                    const endDelayMs = Math.min(0, endMs - delayMs - waves[index].durationMs);
                    const animation = trackLyricAnimationTiming(engine, acquireWaveAnimation(engine, letterElement, floatKeyframes, floatKeyframeSignature, {
                        duration: waves[index].durationMs,
                        delay: delayMs,
                        endDelay: endDelayMs,
                        fill: "forwards",
                    }), {
                        appliedTimingOffsetMs,
                        offsetMs: waveLeadMs,
                        // The wave that ends last covers the whole word. A theme's swipe ramp can make that an early letter.
                        skipDriftSample: !sampled || index !== lastEndingWaveIndex,
                    });
                    seekAnimation(engine, animation, floatStartMs);
                    wobbleAnimations.push(animation);
                    if (!GECKO_REDRAW || !sampled)
                        return;
                    const redraw = trackLyricAnimationTiming(engine, letterElement.animate(GECKO_REDRAW_KEYFRAMES, {
                        duration: GECKO_REDRAW_PERIOD_MS,
                        iterations: waves[index].durationMs / GECKO_REDRAW_PERIOD_MS,
                        delay: delayMs,
                        composite: "add",
                    }), { appliedTimingOffsetMs, offsetMs: waveLeadMs, skipDriftSample: true });
                    seekAnimation(engine, redraw, floatStartMs);
                    wobbleAnimations.push(redraw);
                });
            };
            animateLetters(part.letterElements, Infinity, true);
            animateLetters(part.highlightLetterElements, Infinity, false);
            animateLetters(glowLetters, glowEndMs, false);
        }
    }
    part.animations = [
        ...highlightAnimations.animations,
        ...mirrorImageHighlightAnimations(part, highlightAnimations.animations),
        ...wobbleAnimations,
    ];
}
function startLineAnimations(engine, lineData, config, currentTime) {
    linesMayHaveAnimations.add(lineData);
    const appliedTimingOffsetMs = engine.learnedAnimationTimingOffsetMs;
    startLineAnimation(engine, lineData, config, currentTime, appliedTimingOffsetMs);
    if (lineData.lyricElement.dataset.instrumental === "true") {
        startInstrumentalAnimations(engine, lineData, config, currentTime, appliedTimingOffsetMs);
        return;
    }
    resolveLineGlowSuppression(engine, lineData, config);
    for (const part of lineData.parts) {
        startWordAnimations(engine, part, config, currentTime, appliedTimingOffsetMs);
    }
}
function startWordExitAnimation(part, config, imagePaint = []) {
    resetPartAnimations(part);
    const fadeDuration = config.enabled.highlightFade ? config.highlight.fadeOutDurationMs : 1;
    const animation = part.highlightElement.animate(fadeOutTextKeyframes(config, part), {
        duration: fadeDuration,
        easing: config.enabled.highlightFade ? config.highlight.fadeOutEasing : "linear",
        fill: "none",
    });
    part.animations = [animation, ...mirrorImageHighlightAnimations(part, [animation])];
    // Keep the current blur, letter masks and motion visible until the parent fade ends.
    for (const { target, frame } of imagePaint) {
        part.animations.push(target.animate([frame, frame], { duration: fadeDuration, fill: "none" }));
    }
    animation.addEventListener("finish", () => {
        resetPartAnimations(part);
    }, { once: true });
}
function startLineExitAnimations(engine, lineData, config, currentTime) {
    linesMayHaveAnimations.add(lineData);
    // Read the entire line before cancelling any effects, so this does not alternate
    // per-word style reads with writes. There are no extra reads during normal ticks.
    const imagePaint = new Map();
    for (const part of lineData.parts) {
        if (!part.imageLayers || currentTime < part.time)
            continue;
        const style = engine.window.getComputedStyle(part.imageLayers.glow);
        const paint = [
            { target: part.imageLayers.glow, frame: { opacity: style.opacity, filter: style.filter } },
        ];
        for (const target of part.letterElements ?? []) {
            paint.push({ target, frame: { transform: engine.window.getComputedStyle(target).transform } });
        }
        for (const target of [...(part.highlightLetterElements ?? []), ...part.imageLayers.glowLetters]) {
            const letterStyle = engine.window.getComputedStyle(target);
            paint.push({ target, frame: { maskPosition: letterStyle.maskPosition, transform: letterStyle.transform } });
        }
        imagePaint.set(part, paint);
    }
    startLineExitAnimation(lineData, config);
    if (lineData.lyricElement.dataset.instrumental === "true") {
        startInstrumentalExitAnimations(engine, lineData, config, currentTime);
        return;
    }
    for (const part of lineData.parts) {
        if (currentTime >= part.time) {
            startWordExitAnimation(part, config, imagePaint.get(part));
        }
        else {
            resetPartAnimations(part);
        }
    }
}
function animateInstrumentalChild(engine, lineData, selector, keyframes, options, timing) {
    const element = lineData.lyricElement.querySelector(selector);
    if (!element)
        return null;
    const animation = timing
        ? trackLyricAnimationTiming(engine, element.animate(keyframes, options), timing)
        : element.animate(keyframes, options);
    lineData.animations.push(animation);
    return animation;
}
function resolveDotsFillDurationMs(engine, lineData, durationMs) {
    const docEl = engine.document.documentElement;
    const autoHide = engine.layout !== "stage" &&
        docEl?.hasAttribute("blyrics-auto-hide-instrumental-bg") === true &&
        !docEl?.hasAttribute("blyrics-webgl-lyrics");
    if (!autoHide || durationMs <= 1) {
        return durationMs;
    }
    const lineIdx = engine.lines.indexOf(lineData);
    if (lineIdx < 0 || lineIdx + 1 >= engine.lines.length) {
        return durationMs;
    }
    const scrollLeadMs = engine.lyricsContainer
        ? getCSSDurationInMs(engine, engine.lyricsContainer, "--blyrics-scroll-timing-offset") || 500
        : 500;
    return Math.max(durationMs - scrollLeadMs - 80, Math.round(durationMs * 0.55), 1);
}
function startDotsInstrumentalAnimations(engine, lineData, dotsEl, config, currentTime, appliedTimingOffsetMs) {
    if (config.enabled.highlightGlow) {
        delete dotsEl.dataset.noGlow;
    }
    else {
        dotsEl.dataset.noGlow = "true";
    }
    const rawElapsedMs = (currentTime - lineData.time) * 1000;
    const durationMs = Math.max(lineData.duration * 1000, 1);
    const dots = dotsEl.querySelectorAll(INSTRUMENTAL_DOT_SELECTOR);
    const litDots = dotsEl.querySelectorAll(INSTRUMENTAL_DOT_LIT_SELECTOR);
    if (litDots.length === 0) {
        return;
    }
    if (!config.enabled.instrumental) {
        const fadeMs = config.instrumental.fillFadeDurationMs;
        const fadeEasing = config.instrumental.fillFadeEasing;
        for (let i = 0; i < litDots.length; i++) {
            const anim = trackLyricAnimationTiming(engine, litDots[i].animate([{ opacity: 0 }, { opacity: 1 }], {
                duration: fadeMs,
                easing: fadeEasing,
                fill: "both",
            }), { appliedTimingOffsetMs, offsetMs: 0, skipDriftSample: i !== 0 });
            lineData.animations.push(anim);
            seekAnimation(engine, anim, correctedAnimationTimeMs(rawElapsedMs, appliedTimingOffsetMs, fadeMs));
        }
        return;
    }
    const fillDurationMs = resolveDotsFillDurationMs(engine, lineData, durationMs);
    const sliceDurationMs = Math.max(fillDurationMs / litDots.length, 1);
    for (let i = 0; i < litDots.length; i++) {
        const sliceDelayMs = (i * fillDurationMs) / litDots.length;
        const totalEndMs = sliceDelayMs + sliceDurationMs;
        const fillAnim = trackLyricAnimationTiming(engine, litDots[i].animate([{ opacity: 0 }, { opacity: 1 }], {
            delay: sliceDelayMs,
            duration: sliceDurationMs,
            easing: "ease-in-out",
            fill: "both",
        }), {
            appliedTimingOffsetMs,
            offsetMs: 0,
            skipDriftSample: i !== litDots.length - 1,
        });
        lineData.animations.push(fillAnim);
        seekAnimation(engine, fillAnim, correctedAnimationTimeMs(rawElapsedMs, appliedTimingOffsetMs, totalEndMs));
    }
    for (let i = 0; i < dots.length; i++) {
        const waveAnim = trackLyricAnimationTiming(engine, dots[i].animate(DOTS_WAVE_KEYFRAMES, {
            duration: DOTS_WAVE_PERIOD_MS,
            iterations: Infinity,
        }), {
            appliedTimingOffsetMs,
            offsetMs: -i * DOTS_WAVE_STAGGER_MS,
            wrapDurationMs: DOTS_WAVE_PERIOD_MS,
            skipDriftSample: true,
        });
        lineData.animations.push(waveAnim);
        seekAnimation(engine, waveAnim, correctedWrappedAnimationTimeMs(rawElapsedMs - i * DOTS_WAVE_STAGGER_MS, appliedTimingOffsetMs, DOTS_WAVE_PERIOD_MS));
    }
}
function startInstrumentalAnimations(engine, lineData, config, currentTime, appliedTimingOffsetMs) {
    const dotsEl = lineData.lyricElement.querySelector(INSTRUMENTAL_DOTS_SELECTOR);
    if (dotsEl) {
        startDotsInstrumentalAnimations(engine, lineData, dotsEl, config, currentTime, appliedTimingOffsetMs);
        return;
    }
    const rawElapsedMs = (currentTime - lineData.time) * 1000;
    const durationMs = Math.max(lineData.duration * 1000, 1);
    const fillFadeDuration = config.enabled.instrumental ? config.instrumental.fillFadeDurationMs : 1;
    const fillAnimation = animateInstrumentalChild(engine, lineData, INSTRUMENTAL_FILL_SELECTOR, [{ opacity: 0 }, { opacity: 1 }], {
        duration: fillFadeDuration,
        easing: config.enabled.instrumental ? config.instrumental.fillFadeEasing : "linear",
        fill: "forwards",
    }, { appliedTimingOffsetMs, offsetMs: 0 });
    let fillTravelAnimation = null;
    let waveFlattenAnimation = null;
    let waveOscillationAnimation = null;
    if (config.enabled.instrumental) {
        fillTravelAnimation = animateInstrumentalChild(engine, lineData, INSTRUMENTAL_WAVE_CLIP_SELECTOR, [{ transform: config.instrumental.fillFrom }, { transform: config.instrumental.fillTo }], {
            duration: durationMs,
            easing: config.instrumental.fillEasing,
            fill: "both",
        }, { appliedTimingOffsetMs, offsetMs: 0 });
        waveFlattenAnimation = animateInstrumentalChild(engine, lineData, INSTRUMENTAL_WAVE_PATH_SELECTOR, [{ transform: config.instrumental.waveFrom }, { transform: config.instrumental.waveTo }], {
            duration: durationMs,
            easing: config.instrumental.waveEasing,
            fill: "both",
        }, { appliedTimingOffsetMs, offsetMs: 0 });
        waveOscillationAnimation = animateInstrumentalChild(engine, lineData, INSTRUMENTAL_WAVE_PATH_SELECTOR, [
            { d: config.instrumental.wavePathHigh },
            { d: config.instrumental.wavePathLow, offset: 0.5 },
            { d: config.instrumental.wavePathHigh },
        ], {
            duration: config.instrumental.waveOscillationDurationMs,
            easing: config.instrumental.waveOscillationEasing,
            iterations: Infinity,
        }, {
            appliedTimingOffsetMs,
            offsetMs: 0,
            wrapDurationMs: config.instrumental.waveOscillationDurationMs,
        });
    }
    if (fillAnimation) {
        seekAnimation(engine, fillAnimation, correctedAnimationTimeMs(rawElapsedMs, appliedTimingOffsetMs, fillFadeDuration));
    }
    if (fillTravelAnimation) {
        seekAnimation(engine, fillTravelAnimation, correctedAnimationTimeMs(rawElapsedMs, appliedTimingOffsetMs, durationMs));
    }
    if (waveFlattenAnimation) {
        seekAnimation(engine, waveFlattenAnimation, correctedAnimationTimeMs(rawElapsedMs, appliedTimingOffsetMs, durationMs));
    }
    if (waveOscillationAnimation) {
        seekAnimation(engine, waveOscillationAnimation, correctedWrappedAnimationTimeMs(rawElapsedMs, appliedTimingOffsetMs, Math.max(config.instrumental.waveOscillationDurationMs, 1)));
    }
}
function startInstrumentalExitAnimations(engine, lineData, config, currentTime) {
    if (currentTime < lineData.time)
        return;
    const dotsEl = lineData.lyricElement.querySelector(INSTRUMENTAL_DOTS_SELECTOR);
    if (dotsEl) {
        const fadeDuration = config.enabled.instrumental && config.enabled.highlightFade ? config.highlight.fadeOutDurationMs : 1;
        const fadeEasing = config.enabled.instrumental && config.enabled.highlightFade ? config.highlight.fadeOutEasing : "linear";
        const litDots = dotsEl.querySelectorAll(INSTRUMENTAL_DOT_LIT_SELECTOR);
        if (litDots.length === 0)
            return;
        const durationMs = Math.max(lineData.duration * 1000, 1);
        const rawElapsedMs = (currentTime - lineData.time) * 1000;
        const fillDurationMs = resolveDotsFillDurationMs(engine, lineData, durationMs);
        const sliceDurationMs = Math.max(fillDurationMs / litDots.length, 1);
        for (let i = 0; i < litDots.length; i++) {
            const sliceDelayMs = (i * fillDurationMs) / litDots.length;
            const startOpacity = config.enabled.instrumental
                ? clamp((rawElapsedMs - sliceDelayMs) / sliceDurationMs, 0, 1)
                : 1;
            if (startOpacity <= 0)
                continue;
            const anim = litDots[i].animate([{ opacity: startOpacity }, { opacity: 0 }], {
                duration: fadeDuration,
                easing: fadeEasing,
                fill: "none",
            });
            lineData.animations.push(anim);
        }
        return;
    }
    const fadeDuration = config.enabled.instrumental && config.enabled.highlightFade ? config.highlight.fadeOutDurationMs : 1;
    animateInstrumentalChild(engine, lineData, INSTRUMENTAL_FILL_SELECTOR, [{ opacity: 1 }, { opacity: 0 }], {
        duration: fadeDuration,
        easing: config.enabled.instrumental ? config.highlight.fadeOutEasing : "linear",
        fill: "none",
    });
}
export function refreshInstrumentalStyle(engine, measureLines = true) {
    const lyricsElement = engine.lyricsContainer;
    const lines = engine.lines;
    if (!lyricsElement || lines.length === 0) {
        return [];
    }
    const wantDots = readInstrumentalStyle(engine.document) === "dots";
    const changedIndices = [];
    const changedLines = [];
    for (let i = 0; i < lines.length; i++) {
        const lineData = lines[i];
        if (lineData.lyricElement.dataset.instrumental !== "true") {
            continue;
        }
        const hasDots = lineData.lyricElement.querySelector(INSTRUMENTAL_DOTS_SELECTOR) !== null;
        if (hasDots === wantDots) {
            continue;
        }
        resetLineAnimationState(lineData);
        replaceInstrumentalIcon(engine.document, lineData.lyricElement, Math.max(0, Math.round(lineData.duration * 1000)));
        changedIndices.push(i);
        changedLines.push(lineData);
    }
    if (changedLines.length === 0) {
        return [];
    }
    if (!wantDots) {
        refreshInstrumentalImages(lyricsElement, engine.window);
    }
    if (!measureLines) {
        relayout(engine, false);
    }
    else if (engine.layout === "stage") {
        relayout(engine, true);
    }
    else {
        relayoutChangedLines(engine, changedIndices);
    }
    return changedLines;
}
export function clearStyleCaches(engine) {
    dropPendingLineScroll(engine);
    engine.cachedDurations.clear();
    engine.cachedCSSValues.clear();
    engine.cachedAnimationSettings = null;
    engine.cachedLineScrollTiming.clear();
}
function getCSSValue(engine, lyricsElement, property, fallback) {
    let value = engine.cachedCSSValues.get(property);
    if (value === undefined) {
        value = engine.window.getComputedStyle(lyricsElement).getPropertyValue(property).trim() || fallback;
        engine.cachedCSSValues.set(property, value);
    }
    return value;
}
/**
 * Gets and caches a css duration.
 * The cache belongs to one engine instance, which resolves every lookup against its own lyrics
 * container, so this function does not key its cache on the element provided -- it assumes that
 * it isn't relevant to the calling code
 *
 * @param lyricsElement - the element to look up against
 * @param property - the css property to look up
 * @return - in ms
 */
function getCSSDurationInMs(engine, lyricsElement, property) {
    let duration = engine.cachedDurations.get(property);
    if (duration === undefined) {
        duration = toMs(getCSSValue(engine, lyricsElement, property, "0ms"));
        engine.cachedDurations.set(property, duration);
    }
    return duration;
}
function getCSSDurationWithFallback(engine, lyricsElement, property, fallback) {
    return Math.max(toMs(getCSSValue(engine, lyricsElement, property, fallback)), 1);
}
function getCSSNumber(engine, lyricsElement, property, fallback) {
    const value = Number.parseFloat(getCSSValue(engine, lyricsElement, property, `${fallback}`));
    return Number.isFinite(value) ? value : fallback;
}
function getCSSBoolean(engine, lyricsElement, property, fallback) {
    const value = getCSSValue(engine, lyricsElement, property, fallback ? "1" : "0").toLowerCase();
    if (value === "false" || value === "off" || value === "none")
        return false;
    const numericValue = Number.parseFloat(value);
    if (Number.isFinite(numericValue))
        return numericValue > 0;
    return fallback;
}
function getCSSOffset(engine, lyricsElement, property, fallback) {
    return Math.max(0, Math.min(1, getCSSNumber(engine, lyricsElement, property, fallback)));
}
// The comment setting is shared by every view in a bundle; the custom property lets a theme scope it to one.
function getTargetScrollRatio(engine, lyricsElement) {
    const scoped = Number.parseFloat(getCSSValue(engine, lyricsElement, "--blyrics-target-scroll-pos-ratio", ""));
    return Number.isFinite(scoped) ? Math.max(0, Math.min(1, scoped)) : SCROLL_POS_OFFSET_RATIO.getNumberValue();
}
// Compose the glow filter so the color stays an unresolved var(--blyrics-glow-color).
// Reading a fully composed --blyrics-highlight-glow-filter-* off the container resolves the
// nested color there, which would defeat per-word overrides like
// .blyrics--word[data-long-word] { --blyrics-glow-color: ... }. Building the filter here with
// the color left as a literal var lets the Web Animations API resolve it against each animated
// word instead. A theme that sets the full filter var still wins, but its color resolves once
// at the container (globally), as before.
// A glow whose resolved color falls below half a quantization step stays invisible even after the
// blur spreads it, so the per-frame drop-shadow can be skipped with no pixel changing.
const GLOW_INVISIBLE_ALPHA = 0.5 / 255;
function alphaToken(token) {
    const value = token.endsWith("%") ? Number.parseFloat(token) / 100 : Number.parseFloat(token);
    return clamp(value, 0, 1);
}
// null for an unrecognized format, which the caller treats as opaque so a visible glow is never dropped.
export function parseColorAlpha(value) {
    const color = value.trim().toLowerCase();
    if (color === "")
        return null;
    if (color === "transparent")
        return 0;
    const slashAlpha = color.match(/\/\s*([0-9]*\.?[0-9]+%?)\s*\)\s*$/);
    if (slashAlpha)
        return alphaToken(slashAlpha[1]);
    const commaAlpha = color.match(/^(?:rgba|hsla)\([^)]*,\s*([0-9]*\.?[0-9]+%?)\s*\)$/);
    if (commaAlpha)
        return alphaToken(commaAlpha[1]);
    const hex = color.match(/^#([0-9a-f]{4}|[0-9a-f]{8})$/);
    if (hex) {
        const digits = hex[1];
        const alphaHex = digits.length === 8 ? digits.slice(6) : digits.slice(3).repeat(2);
        return Number.parseInt(alphaHex, 16) / 255;
    }
    const opaqueFunction = /^(?:rgb|hsl|hwb|lab|lch|oklab|oklch|color)\(/.test(color);
    const opaqueHex = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/.test(color);
    const namedColor = /^[a-z]+$/.test(color);
    if (opaqueFunction || opaqueHex || namedColor)
        return 1;
    return null;
}
// Per-word glow is resolved only when the container glow already renders nothing, so an empty word
// drops its blur while a word a theme lit up keeps it.
function resolveLineGlowSuppression(engine, lineData, config) {
    if (lineData.parts.some(part => part.imageLayers) || config.highlight.glowContainerAlpha >= GLOW_INVISIBLE_ALPHA) {
        for (const part of lineData.parts)
            part.glowSuppressed = false;
        return;
    }
    for (const part of lineData.parts) {
        const color = engine.window.getComputedStyle(part.highlightElement).getPropertyValue("--blyrics-glow-color");
        part.glowSuppressed = (parseColorAlpha(color) ?? 1) < GLOW_INVISIBLE_ALPHA;
    }
}
function resolveGlowFilter(engine, lyricsElement, suffix, radiusDefault) {
    const override = getCSSValue(engine, lyricsElement, `--blyrics-highlight-glow-filter-${suffix}`, "");
    if (override)
        return override;
    const radius = getCSSValue(engine, lyricsElement, `--blyrics-highlight-glow-radius-${suffix}`, radiusDefault);
    return `drop-shadow(0 0 ${radius} var(--blyrics-glow-color))`;
}
// Only the engine's own drop-shadow(0 0 <radius> ...) resting shape counts, so a theme override or a
// non-zero radius keeps its permanent glow on fill:forwards.
function isGlowRestingInvisible(glowTo) {
    const value = glowTo.trim();
    if (value === "" || value === "none")
        return true;
    const match = value.match(/^drop-shadow\(\s*0\s+0\s+(\S+)\s+var\(--blyrics-glow-color\)\)$/);
    return match ? Number.parseFloat(match[1]) === 0 : false;
}
function readAnimationConfig(engine, lyricsElement) {
    const prefersReducedMotion = engine.window.matchMedia(REDUCED_MOTION_QUERY).matches;
    const scrollEasing = getCSSValue(engine, lyricsElement, "--blyrics-lyric-scroll-timing-function", "cubic-bezier(0.86, 0, 0.2, 1)");
    return {
        enabled: {
            lineScale: getCSSBoolean(engine, lyricsElement, "--blyrics-animate-line-scale", true),
            wordWobble: getCSSBoolean(engine, lyricsElement, "--blyrics-animate-word-wobble", true),
            highlightSwipe: getCSSBoolean(engine, lyricsElement, "--blyrics-animate-highlight-swipe", true),
            highlightGlow: getCSSBoolean(engine, lyricsElement, "--blyrics-animate-highlight-glow", true),
            highlightFade: getCSSBoolean(engine, lyricsElement, "--blyrics-animate-highlight-fade", true),
            scroll: getCSSBoolean(engine, lyricsElement, "--blyrics-animate-scroll", true),
            instrumental: getCSSBoolean(engine, lyricsElement, "--blyrics-animate-instrumental", true),
        },
        line: {
            durationMs: getCSSDurationWithFallback(engine, lyricsElement, "--blyrics-scale-transition-duration", "0.166s"),
            enterEasing: getCSSValue(engine, lyricsElement, "--blyrics-line-enter-easing", "ease"),
            exitEasing: getCSSValue(engine, lyricsElement, "--blyrics-line-exit-easing", "ease"),
            enterFrom: getCSSValue(engine, lyricsElement, "--blyrics-line-enter-transform-from", "scale(var(--blyrics-scale))"),
            enterTo: getCSSValue(engine, lyricsElement, "--blyrics-line-enter-transform-to", "scale(var(--blyrics-active-scale))"),
            exitFrom: getCSSValue(engine, lyricsElement, "--blyrics-line-exit-transform-from", "scale(var(--blyrics-active-scale))"),
            exitTo: getCSSValue(engine, lyricsElement, "--blyrics-line-exit-transform-to", "scale(var(--blyrics-scale))"),
        },
        highlight: {
            fadeInDurationMs: getCSSDurationWithFallback(engine, lyricsElement, "--blyrics-lyric-highlight-fade-in-duration", "0.33s"),
            fadeOutDurationMs: getCSSDurationWithFallback(engine, lyricsElement, "--blyrics-lyric-highlight-fade-out-duration", "0.5s"),
            fadeInEasing: getCSSValue(engine, lyricsElement, "--blyrics-lyric-highlight-fade-in-easing", "ease"),
            fadeOutEasing: getCSSValue(engine, lyricsElement, "--blyrics-lyric-highlight-fade-out-easing", "ease"),
            swipeEasing: getCSSValue(engine, lyricsElement, "--blyrics-highlight-swipe-easing", "linear"),
            swipeStartFrom: getCSSValue(engine, lyricsElement, "--blyrics-highlight-swipe-start-from", "-0.2"),
            swipeEndFrom: getCSSValue(engine, lyricsElement, "--blyrics-highlight-swipe-end-from", "-0.1"),
            swipeStartTo: getCSSValue(engine, lyricsElement, "--blyrics-highlight-swipe-start-to", "1.4"),
            swipeEndTo: getCSSValue(engine, lyricsElement, "--blyrics-highlight-swipe-end-to", "1.5"),
            imageGlowFrom: getCSSValue(engine, lyricsElement, "--blyrics-highlight-glow-radius-from", "0.8rem"),
            imageGlowTo: getCSSValue(engine, lyricsElement, "--blyrics-highlight-glow-radius-to", "0px"),
            imageGlowOpacityFrom: getCSSValue(engine, lyricsElement, "--blyrics-image-glow-opacity-from", "0.5"),
            imageGlowOpacityTo: getCSSValue(engine, lyricsElement, "--blyrics-image-glow-opacity-to", "0"),
            glowFrom: resolveGlowFilter(engine, lyricsElement, "from", "0.8rem"),
            glowTo: resolveGlowFilter(engine, lyricsElement, "to", "0"),
            glowDurationRatio: getCSSNumber(engine, lyricsElement, "--blyrics-highlight-glow-duration-ratio", 1.2),
            glowMinDurationMs: getCSSDurationWithFallback(engine, lyricsElement, "--blyrics-highlight-glow-min-duration", "1.2s"),
            glowEasing: getCSSValue(engine, lyricsElement, "--blyrics-highlight-glow-easing", "ease"),
            glowContainerAlpha: parseColorAlpha(getCSSValue(engine, lyricsElement, "--blyrics-glow-color", "")) ?? 1,
            glowRestingInvisible: isGlowRestingInvisible(resolveGlowFilter(engine, lyricsElement, "to", "0")),
        },
        word: {
            wobbleDurationMs: getCSSDurationWithFallback(engine, lyricsElement, "--blyrics-wobble-duration", "1s"),
            wobbleEasing: getCSSValue(engine, lyricsElement, "--blyrics-word-wobble-easing", "ease"),
            wobblePeakEasing: getCSSValue(engine, lyricsElement, "--blyrics-word-wobble-peak-easing", "ease-in-out"),
            wobbleEndEasing: getCSSValue(engine, lyricsElement, "--blyrics-word-wobble-end-easing", "ease-out"),
            wobbleFrom: getCSSValue(engine, lyricsElement, "--blyrics-word-wobble-transform-from", "scaleX(1)"),
            wobblePeak: getCSSValue(engine, lyricsElement, "--blyrics-word-wobble-transform-peak", "translateX(0.05em) scaleX(1.025)"),
            wobbleSettle: getCSSValue(engine, lyricsElement, "--blyrics-word-wobble-transform-settle", "translateX(0) scaleX(1)"),
            wobbleTo: getCSSValue(engine, lyricsElement, "--blyrics-word-wobble-transform-to", "scaleX(1)"),
            wobblePeakOffset: getCSSOffset(engine, lyricsElement, "--blyrics-word-wobble-peak-offset", 0.125),
            wobbleSettleOffset: getCSSOffset(engine, lyricsElement, "--blyrics-word-wobble-settle-offset", 0.75),
        },
        letterWave: {
            transform: getCSSValue(engine, lyricsElement, "--blyrics-letter-wave-transform", "translateY(-0.06em)"),
            settle: getCSSValue(engine, lyricsElement, "--blyrics-letter-wave-settle", "translateY(-0.05em)"),
            emphasisScale: getCSSValue(engine, lyricsElement, "--blyrics-letter-wave-emphasis-scale", "1.08"),
            durationMs: getCSSDurationWithFallback(engine, lyricsElement, "--blyrics-letter-wave-duration", "0.9s"),
            riseEasing: getCSSValue(engine, lyricsElement, "--blyrics-letter-wave-rise-easing", "ease-in-out"),
            fallEasing: getCSSValue(engine, lyricsElement, "--blyrics-letter-wave-fall-easing", "ease-in-out"),
        },
        instrumental: {
            fillFadeDurationMs: getCSSDurationWithFallback(engine, lyricsElement, "--blyrics-instrumental-fill-fade-duration", "150ms"),
            fillFadeEasing: getCSSValue(engine, lyricsElement, "--blyrics-instrumental-fill-fade-easing", "ease"),
            fillFrom: getCSSValue(engine, lyricsElement, "--blyrics-instrumental-fill-transform-from", "translateY(78%)"),
            fillTo: getCSSValue(engine, lyricsElement, "--blyrics-instrumental-fill-transform-to", "translateY(-4%)"),
            fillEasing: getCSSValue(engine, lyricsElement, "--blyrics-instrumental-fill-easing", "linear"),
            waveFrom: getCSSValue(engine, lyricsElement, "--blyrics-instrumental-wave-transform-from", "scaleY(1.2)"),
            waveTo: getCSSValue(engine, lyricsElement, "--blyrics-instrumental-wave-transform-to", "scaleY(0.0001)"),
            waveEasing: getCSSValue(engine, lyricsElement, "--blyrics-instrumental-wave-easing", "ease-in"),
            wavePathHigh: getCSSValue(engine, lyricsElement, "--blyrics-instrumental-wave-path-high", INSTRUMENTAL_WAVE_PATH_HIGH_FALLBACK),
            wavePathLow: getCSSValue(engine, lyricsElement, "--blyrics-instrumental-wave-path-low", INSTRUMENTAL_WAVE_PATH_LOW_FALLBACK),
            waveOscillationDurationMs: getCSSDurationWithFallback(engine, lyricsElement, "--blyrics-instrumental-wave-oscillation-duration", "1.25s"),
            waveOscillationEasing: getCSSValue(engine, lyricsElement, "--blyrics-instrumental-wave-oscillation-easing", "ease-in-out"),
        },
        lineScroll: {
            easing: scrollEasing,
            differentialEffects: !prefersReducedMotion,
        },
    };
}
function readScrollTiming() {
    return { earlyScrollConsiderS: Math.max(0, EARLY_SCROLL_CONSIDER.getNumberValue()) };
}
function getAnimationSettings(engine, lyricsElement) {
    if (!engine.cachedAnimationSettings) {
        const config = readAnimationConfig(engine, lyricsElement);
        engine.cachedAnimationSettings = {
            config,
            scrollTiming: readScrollTiming(),
        };
    }
    return engine.cachedAnimationSettings;
}
function clearLineScrollAnimations(engine) {
    const records = engine.lineScrollAnimations;
    engine.lineScrollAnimations = [];
    for (const record of records) {
        record.animation.cancel();
        clearLineScrollInlineProperties(engine, record.lineElement, record.token);
    }
}
function removeLineScrollAnimation(engine, record) {
    const index = engine.lineScrollAnimations.indexOf(record);
    if (index !== -1) {
        engine.lineScrollAnimations.splice(index, 1);
    }
    clearLineScrollInlineProperties(engine, record.lineElement, record.token);
}
function trackLineScrollAnimation(engine, animation, lineElement, token) {
    const record = { animation, lineElement, token };
    engine.lineScrollAnimations.push(record);
    animation.addEventListener("finish", () => removeLineScrollAnimation(engine, record), { once: true });
    animation.addEventListener("cancel", () => removeLineScrollAnimation(engine, record), { once: true });
}
function lineScrollSide(relativeIndex, scrollDeltaPx) {
    const isScrollingUp = scrollDeltaPx < 0;
    if (relativeIndex < 0)
        return isScrollingUp ? "below" : "above";
    if (relativeIndex > 0)
        return isScrollingUp ? "above" : "below";
    return "active";
}
function setLineScrollSettingProperty(lineElement, property, setting) {
    const value = setting.getStringValue().trim();
    if (value) {
        lineElement.style.setProperty(property, value);
    }
    else {
        lineElement.style.removeProperty(property);
    }
}
function setLineScrollStyleProperties(lineElement) {
    for (const [property, setting] of LINE_SCROLL_STYLE_SETTINGS) {
        setLineScrollSettingProperty(lineElement, property, setting);
    }
}
function lineScrollTranslate(side, state, useDifferentialEffects) {
    const sideProperty = `--blyrics-line-scroll-${side}-translate-y-${state}`;
    const sharedProperty = `--blyrics-line-scroll-translate-y-${state}`;
    const fallback = state === "start" ? "var(--blyrics-line-scroll-delta-px, 0px)" : "0px";
    if (useDifferentialEffects) {
        return `0 var(${sideProperty}, var(${sharedProperty}, ${fallback}))`;
    }
    return `0 var(${sharedProperty}, ${fallback})`;
}
function normalizedTranslate(translateValue) {
    const translate = translateValue.trim();
    return translate && translate !== "none" ? translate : "0px 0px";
}
function restoreInlineStyleProperty(lineElement, property, previousValue, previousPriority) {
    if (previousValue) {
        lineElement.style.setProperty(property, previousValue, previousPriority);
    }
    else {
        lineElement.style.removeProperty(property);
    }
}
function lineScrollDurationProperty(side, fallbackMs, useDifferentialEffects) {
    return useDifferentialEffects
        ? `var(--blyrics-line-scroll-${side}-duration, var(--blyrics-line-scroll-duration, ${fallbackMs}ms))`
        : `var(--blyrics-line-scroll-duration, ${fallbackMs}ms)`;
}
function clearLineScrollInlineProperties(engine, lineElement, token) {
    if (token !== undefined && engine.lineScrollElementTokens.get(lineElement) !== token) {
        return;
    }
    for (const property of LINE_SCROLL_INLINE_PROPERTIES) {
        lineElement.style.removeProperty(property);
    }
    engine.lineScrollElementTokens.delete(lineElement);
}
function lineScrollEasingProperty(side, keyframe, fallback, useDifferentialEffects) {
    return useDifferentialEffects
        ? `var(--blyrics-line-scroll-${side}-${keyframe}-easing, var(--blyrics-line-scroll-${keyframe}-easing, var(--blyrics-line-scroll-timing-function, ${fallback})))`
        : `var(--blyrics-line-scroll-${keyframe}-easing, var(--blyrics-line-scroll-timing-function, ${fallback}))`;
}
/**
 * Resolves one temporary computed-style probe for every visible line. Keeping
 * each property in its own write/read/restore phase preserves the original
 * resolver semantics while reducing N style flushes to one flush per probe.
 */
function batchResolveLineScrollProperty(engine, items, property, probeValue, readValue) {
    const previous = items.map(item => ({
        value: item.lineElement.style.getPropertyValue(property),
        priority: item.lineElement.style.getPropertyPriority(property),
    }));
    for (const item of items) {
        item.lineElement.style.setProperty(property, probeValue(item), "important");
    }
    const values = items.map(item => readValue(engine.window.getComputedStyle(item.lineElement)));
    for (let index = 0; index < items.length; index++) {
        restoreInlineStyleProperty(items[index].lineElement, property, previous[index].value, previous[index].priority);
    }
    return values;
}
function isLineVisibleDuringScroll(lineData, fromScrollTop, toScrollTop, viewportHeight) {
    const visibleTop = Math.min(fromScrollTop, toScrollTop);
    const visibleBottom = Math.max(fromScrollTop + viewportHeight, toScrollTop + viewportHeight);
    const lineTop = lineData.position;
    const lineBottom = lineData.position + lineData.height;
    return lineBottom >= visibleTop && lineTop <= visibleBottom;
}
function clearVisibleLyricWillChange(engine) {
    for (const element of engine.visibleWillChangeElements) {
        element.style.removeProperty("will-change");
    }
    engine.visibleWillChangeElements = new Set();
}
// Near-viewport lines come from the intersection observer with one viewport of overscan, not from
// scrollTop, because a scaled/transformed scroll decouples layout coords from what is on screen.
const LINE_CULL_ROOT_MARGIN = "100% 0px 100% 0px";
function cullLine(element) {
    element.style.setProperty("content-visibility", "auto");
}
function uncullLine(element) {
    element.style.removeProperty("content-visibility");
}
function clearOffscreenLineCulling(engine) {
    for (const element of engine.culledLineElements) {
        uncullLine(element);
    }
    engine.culledLineElements = new Set();
}
// Rebuilt rather than updated on every line change or relayout, so a skipped line's placeholder height
// is always freshly measured. Without IntersectionObserver every line stays rendered.
export function setupLineCullObserver(engine) {
    engine.lineCullObserver?.disconnect();
    clearOffscreenLineCulling(engine);
    if (engine.layout === "stage") {
        engine.lineCullObserver = null;
        return;
    }
    const ObserverConstructor = engine.window.IntersectionObserver;
    if (typeof ObserverConstructor !== "function" || engine.lines.length === 0) {
        engine.lineCullObserver = null;
        return;
    }
    // Scroll anchoring would compensate residual cull height-shifts with a scroll the engine misreads as the user's (Firefox); the engine owns scrollTop, so disable it.
    engine.host.getScrollElement()?.style.setProperty("overflow-anchor", "none");
    // Pin each line's skipped placeholder to its last rendered size, so skipping a line never shifts the
    // container's scroll height, which the engine would misread as a user scroll.
    const restingHeights = engine.lines.map(line => line.lyricElement.offsetHeight);
    const lineByElement = new WeakMap();
    engine.lines.forEach((line, index) => {
        line.restingHeight = restingHeights[index];
        lineByElement.set(line.lyricElement, line);
        line.lyricElement.style.setProperty("contain-intrinsic-block-size", `auto ${restingHeights[index]}px`);
    });
    const observer = new ObserverConstructor(entries => {
        for (const entry of entries) {
            const element = entry.target;
            if (entry.isIntersecting) {
                if (engine.culledLineElements.delete(element))
                    uncullLine(element);
            }
            else if (!engine.culledLineElements.has(element)) {
                const line = lineByElement.get(element);
                if (line && typeof line.restingHeight === "number") {
                    const nextSize = `auto ${line.restingHeight}px`;
                    if (element.style.getPropertyValue("contain-intrinsic-block-size") !== nextSize) {
                        element.style.setProperty("contain-intrinsic-block-size", nextSize);
                    }
                }
                cullLine(element);
                engine.culledLineElements.add(element);
            }
        }
    }, { root: null, rootMargin: LINE_CULL_ROOT_MARGIN, threshold: 0 });
    for (const line of engine.lines) {
        observer.observe(line.lyricElement);
    }
    engine.lineCullObserver = observer;
}
function updateVisibleLyricWillChange(engine, lines, fromScrollTop, toScrollTop, viewportHeight) {
    const nextVisibleElements = new Set();
    for (const line of lines) {
        if (isLineVisibleDuringScroll(line, fromScrollTop, toScrollTop, viewportHeight)) {
            line.lyricElement.style.setProperty("will-change", LINE_SCROLL_WILL_CHANGE_VALUE);
            nextVisibleElements.add(line.lyricElement);
        }
    }
    for (const element of engine.visibleWillChangeElements) {
        if (!nextVisibleElements.has(element)) {
            element.style.removeProperty("will-change");
        }
    }
    engine.visibleWillChangeElements = nextVisibleElements;
}
// The credits and the footer after the last line scroll with the lines. Their bounds come from the
// relayout-time cache, not a getBoundingClientRect here, which would force a synchronous recalc
// mid-tick after the scroll commit dirtied style.
function getLineScrollItems(engine, lines) {
    const trailing = [engine.cachedCreditsItem, engine.cachedFooterItem].filter(item => item !== null);
    return trailing.length > 0 ? [...lines, ...trailing] : lines;
}
function measureTrailingItem(lyricsElement, className) {
    const element = lyricsElement.querySelector(`:scope > .${className}`);
    if (!element)
        return null;
    const bounds = getRelativeLayoutBounds(lyricsElement, element);
    return { lyricElement: element, position: bounds.y, height: bounds.height };
}
// A leading line slower than the one behind closes their gap by distance times progress difference.
function lineScrollStaggerScale(lines, activeLineIndex, scrollDistancePx, naturalAdvance) {
    if (naturalAdvance)
        return 1;
    const active = lines[activeLineIndex];
    const steps = [lines[activeLineIndex - 1], lines[activeLineIndex + 1]]
        .filter(neighbour => neighbour !== undefined)
        .map(neighbour => Math.abs(active.position - neighbour.position));
    const stepPx = steps.length > 0 ? Math.min(...steps) : active.height;
    return Math.min(1, stepPx / scrollDistancePx);
}
function prepareLineScrollOffsets(engine, lines, activeLineIndex, scrollDeltaPx, fromScrollTop, toScrollTop, viewportHeight, config, naturalAdvance) {
    if (!config.enabled.scroll || activeLineIndex < 0) {
        return null;
    }
    const scrollDistancePx = Math.abs(scrollDeltaPx);
    const translateThemed = LINE_SCROLL_TRANSLATE_SETTINGS.some(setting => setting.isManuallySet());
    const defaultStartTranslate = `0px ${scrollDeltaPx}px`;
    // Preserve the original windowing exactly: only lines intersecting the
    // union of the old and new viewports receive scroll animations.
    const requests = [];
    for (let index = 0; index < lines.length; index++) {
        if (!isLineVisibleDuringScroll(lines[index], fromScrollTop, toScrollTop, viewportHeight)) {
            continue;
        }
        const lineElement = lines[index].lyricElement;
        const relativeIndex = index - activeLineIndex;
        const side = lineScrollSide(relativeIndex, scrollDeltaPx);
        const token = ++engine.lineScrollAnimationToken;
        engine.lineScrollElementTokens.set(lineElement, token);
        const item = { lineElement, side, token };
        const timingKey = `${side}|${Math.abs(relativeIndex)}`;
        requests.push({ item, index, relativeIndex, timingKey, timing: engine.cachedLineScrollTiming.get(timingKey) });
    }
    // The line-scroll vars reach the DOM only for an uncached line, or every line when a theme drives the
    // translate off them, so an otherwise-cached scroll leaves the visible lines untouched.
    const linesToWrite = requests.filter(request => translateThemed || !request.timing);
    for (const { item, index, relativeIndex } of linesToWrite) {
        const lineElement = item.lineElement;
        lineElement.style.setProperty(LINE_SCROLL_INDEX_PROPERTY, String(index));
        lineElement.style.setProperty(LINE_SCROLL_ACTIVE_INDEX_PROPERTY, String(activeLineIndex));
        lineElement.style.setProperty(LINE_SCROLL_RELATIVE_INDEX_PROPERTY, String(relativeIndex));
        lineElement.style.setProperty(LINE_SCROLL_ABS_RELATIVE_INDEX_PROPERTY, String(Math.abs(relativeIndex)));
        lineElement.style.setProperty(LINE_SCROLL_SIDE_PROPERTY, item.side);
        lineElement.style.setProperty(LINE_SCROLL_DELTA_PROPERTY, `${scrollDeltaPx}px`);
        lineElement.style.setProperty(LINE_SCROLL_DISTANCE_PROPERTY, `${scrollDistancePx}px`);
        setLineScrollStyleProperties(lineElement);
    }
    const misses = requests.filter(request => !request.timing);
    if (misses.length > 0) {
        const missItems = misses.map(request => request.item);
        const durations = batchResolveLineScrollProperty(engine, missItems, "transition-duration", item => lineScrollDurationProperty(item.side, LINE_SCROLL_FALLBACK_DURATION_MS, config.lineScroll.differentialEffects), style => {
            const durationMs = toMs(style.transitionDuration.split(",")[0].trim());
            return durationMs > 0 ? durationMs : LINE_SCROLL_FALLBACK_DURATION_MS;
        });
        const startEasings = batchResolveLineScrollProperty(engine, missItems, "transition-timing-function", item => lineScrollEasingProperty(item.side, "start", config.lineScroll.easing, config.lineScroll.differentialEffects), style => style.transitionTimingFunction.trim() || config.lineScroll.easing);
        const endEasings = batchResolveLineScrollProperty(engine, missItems, "transition-timing-function", item => lineScrollEasingProperty(item.side, "end", config.lineScroll.easing, config.lineScroll.differentialEffects), style => style.transitionTimingFunction.trim() || config.lineScroll.easing);
        misses.forEach((request, resolveIndex) => {
            const timing = {
                durationMs: durations[resolveIndex],
                startEasing: startEasings[resolveIndex],
                endEasing: endEasings[resolveIndex],
            };
            engine.cachedLineScrollTiming.set(request.timingKey, timing);
            request.timing = timing;
        });
    }
    let startTranslates = null;
    let endTranslates = null;
    if (translateThemed) {
        const items = requests.map(request => request.item);
        startTranslates = batchResolveLineScrollProperty(engine, items, "translate", item => lineScrollTranslate(item.side, "start", config.lineScroll.differentialEffects), style => normalizedTranslate(style.translate));
        endTranslates = batchResolveLineScrollProperty(engine, items, "translate", item => lineScrollTranslate(item.side, "end", config.lineScroll.differentialEffects), style => normalizedTranslate(style.translate));
    }
    const staggerScale = lineScrollStaggerScale(lines, activeLineIndex, scrollDistancePx, naturalAdvance);
    const activeDurationMs = requests.find(request => request.relativeIndex === 0)?.timing?.durationMs;
    return {
        items: requests.map((request, requestIndex) => {
            const timing = request.timing;
            return {
                ...request.item,
                durationMs: activeDurationMs === undefined
                    ? timing.durationMs
                    : activeDurationMs + (timing.durationMs - activeDurationMs) * staggerScale,
                startEasing: timing.startEasing,
                endEasing: timing.endEasing,
                startTranslate: startTranslates ? startTranslates[requestIndex] : defaultStartTranslate,
                endTranslate: endTranslates ? endTranslates[requestIndex] : "0px 0px",
            };
        }),
    };
}
function startPreparedLineScroll(engine, plan) {
    for (const item of plan.items) {
        if (!item.lineElement.isConnected || engine.lineScrollElementTokens.get(item.lineElement) !== item.token)
            continue;
        const animation = item.lineElement.animate([
            { translate: item.startTranslate, easing: item.startEasing },
            { translate: item.endTranslate, easing: item.endEasing },
        ], {
            composite: "add",
            duration: item.durationMs,
            easing: "linear",
            fill: "none",
        });
        trackLineScrollAnimation(engine, animation, item.lineElement, item.token);
    }
}
function discardLineScrollPlan(engine, plan) {
    for (const item of plan.items) {
        clearLineScrollInlineProperties(engine, item.lineElement, item.token);
    }
}
function dropPendingLineScroll(engine) {
    if (!engine.pendingLineScroll)
        return;
    discardLineScrollPlan(engine, engine.pendingLineScroll.plan);
    engine.pendingLineScroll = null;
}
function pendingLineScrollMatches(engine, activeLine, fromScrollTop, toScrollTop) {
    return !!(engine.pendingLineScroll &&
        engine.pendingLineScroll.activeLineElement === activeLine.lyricElement &&
        Math.abs(engine.pendingLineScroll.fromScrollTop - fromScrollTop) <= 2 &&
        Math.abs(engine.pendingLineScroll.toScrollTop - toScrollTop) <= 2);
}
function commitOrPrepareLineScroll(engine, lines, activeLine, scrollDeltaPx, fromScrollTop, toScrollTop, viewportHeight, config, naturalAdvance) {
    if (pendingLineScrollMatches(engine, activeLine, fromScrollTop, toScrollTop)) {
        const pending = engine.pendingLineScroll;
        engine.pendingLineScroll = null;
        startPreparedLineScroll(engine, pending.plan);
        return;
    }
    dropPendingLineScroll(engine);
    const plan = prepareLineScrollOffsets(engine, lines, lines.findIndex(line => line.lyricElement === activeLine.lyricElement), scrollDeltaPx, fromScrollTop, toScrollTop, viewportHeight, config, naturalAdvance);
    if (plan)
        startPreparedLineScroll(engine, plan);
}
function prepareUpcomingLineScroll(engine, lines, activeLine, scrollDeltaPx, fromScrollTop, toScrollTop, viewportHeight, config, naturalAdvance) {
    if (pendingLineScrollMatches(engine, activeLine, fromScrollTop, toScrollTop))
        return;
    dropPendingLineScroll(engine);
    const activeLineIndex = lines.findIndex(line => line.lyricElement === activeLine.lyricElement);
    const plan = prepareLineScrollOffsets(engine, lines, activeLineIndex, scrollDeltaPx, fromScrollTop, toScrollTop, viewportHeight, config, naturalAdvance);
    if (plan) {
        engine.pendingLineScroll = {
            plan,
            activeLineElement: activeLine.lyricElement,
            fromScrollTop,
            toScrollTop,
        };
    }
}
// -- Skip Scrolls Decay --------------------------
function decaySkipScrolls(engine, now, keepsReserve) {
    let j = 0;
    for (; j < engine.skipScrollsDecayTimes.length; j++) {
        if (engine.skipScrollsDecayTimes[j] > now) {
            break;
        }
    }
    engine.skipScrollsDecayTimes = engine.skipScrollsDecayTimes.slice(j);
    engine.skipScrolls = Math.max(keepsReserve ? 1 : 0, engine.skipScrolls - j);
}
// -- Passive Scroll Engine --------------------------
/**
 * The "no lyrics" message is one line at time zero, which is shaped exactly like unsynced lyrics.
 * Nothing here applies to it: passive scroll would drift the message up and down for the length of
 * the song, and there is no line to sync.
 */
function hasNoLyricsPlaceholder(engine) {
    return engine.lyricsContainer?.dataset.noLyrics === "true";
}
/**
 * Unsynced lyrics that this view still has on screen. `syncType` outlives the lyrics it was derived
 * from, so the container is the term that says they are still there.
 */
export function hasUnsyncedLyrics(engine) {
    return engine.lyricsContainer !== null && engine.syncType === "none" && !hasNoLyricsPlaceholder(engine);
}
function stopPassiveScrollLoop(engine) {
    if (engine.passiveRAFId !== null) {
        engine.window.cancelAnimationFrame(engine.passiveRAFId);
        engine.passiveRAFId = null;
    }
}
function startPassiveScrollLoop(engine) {
    if (engine.passiveRAFId !== null)
        return;
    engine.passiveRAFId = engine.window.requestAnimationFrame(() => passiveScrollRAFLoop(engine));
}
function passiveScrollRAFLoop(engine) {
    engine.passiveRAFId = null;
    if (!engine.passiveScrollEnabled || !PASSIVE_SCROLL_ENABLED.getBooleanValue() || !hasUnsyncedLyrics(engine))
        return;
    passiveScrollEngine(engine, playbackClock.lastPlayState);
    engine.passiveRAFId = engine.window.requestAnimationFrame(() => passiveScrollRAFLoop(engine));
}
function passiveScrollEngine(engine, isPlaying) {
    if (!engine.host.isViewVisible())
        return;
    if (engine.host.isLoaderActive())
        return;
    const tabRenderer = engine.host.getScrollElement();
    if (!tabRenderer)
        return;
    const now = Date.now();
    // -- Accumulate play time --------------------------
    if (engine.passiveLastWallTime > 0 && isPlaying) {
        const wallDelta = (now - engine.passiveLastWallTime) / 1000;
        engine.passiveScrollAccumulatedTime += Math.min(wallDelta, 0.5);
    }
    engine.passiveLastWallTime = now;
    // -- User scroll interruption --------------------------
    if (engine.scrollResumeTime > now) {
        return;
    }
    if (engine.wasUserScrolling) {
        engine.host.setResumeAffordanceVisible(false);
        engine.lyricsContainer?.classList.remove(USER_SCROLLING_CLASS);
        engine.wasUserScrolling = false;
        // Re-sync accumulated time to current scroll position so scroll continues from where user left off
        const maxScroll = tabRenderer.scrollHeight - tabRenderer.clientHeight;
        if (maxScroll > 0) {
            const ratio = tabRenderer.scrollTop / maxScroll;
            const numLines = engine.lines.length;
            const scrollDuration = numLines * PASSIVE_SECONDS_PER_LINE.getNumberValue();
            engine.passiveScrollAccumulatedTime = ratio * scrollDuration;
        }
    }
    // -- Cycle calculation --------------------------
    const numLines = engine.lines.length;
    if (numLines === 0)
        return;
    const scrollDuration = numLines * PASSIVE_SECONDS_PER_LINE.getNumberValue();
    const bottomPause = PASSIVE_BOTTOM_PAUSE_S.getNumberValue();
    const resetDuration = PASSIVE_RESET_DURATION_S.getNumberValue();
    const topPause = PASSIVE_TOP_PAUSE_S.getNumberValue();
    const cycleLength = scrollDuration + bottomPause + resetDuration + topPause;
    const maxScroll = tabRenderer.scrollHeight - tabRenderer.clientHeight;
    if (maxScroll <= 0)
        return;
    const cycleTime = engine.passiveScrollAccumulatedTime % cycleLength;
    let targetScroll;
    if (cycleTime < scrollDuration) {
        // Phase 1: linear scroll down
        targetScroll = (cycleTime / scrollDuration) * maxScroll;
    }
    else if (cycleTime < scrollDuration + bottomPause) {
        // Phase 2: hold at bottom
        targetScroll = maxScroll;
    }
    else if (cycleTime < scrollDuration + bottomPause + resetDuration) {
        // Phase 3: ease-out scroll back to top
        const resetProgress = (cycleTime - scrollDuration - bottomPause) / resetDuration;
        const eased = 1 - (1 - resetProgress) * (1 - resetProgress);
        targetScroll = maxScroll * (1 - eased);
    }
    else {
        // Phase 4: hold at top
        targetScroll = 0;
    }
    tabRenderer.scrollTop = targetScroll;
    engine.passiveScrollTop = tabRenderer.scrollTop;
}
/**
 * The drift writes the scroll every frame, and a browser folds that scroll and the reader's into one
 * event, so the drift's own scrolls are told apart by where they land rather than by counting them.
 */
function isPassiveDriftScroll(engine) {
    const scrollTop = engine.host.getScrollElement()?.scrollTop;
    return (engine.passiveScrollTop !== null &&
        scrollTop !== undefined &&
        Math.abs(scrollTop - engine.passiveScrollTop) < PASSIVE_DRIFT_SCROLL_TOLERANCE_PX);
}
/**
 * Sets up a ResizeObserver on the tab renderer to cache its height.
 * Avoids calling getBoundingClientRect() every tick which causes layout thrashing.
 */
function setupTabRendererObserver(engine, element) {
    if (engine.tabRendererResizeObserver) {
        engine.tabRendererResizeObserver.disconnect();
    }
    engine.tabRendererResizeObserver = new engine.window.ResizeObserver(() => {
        dropPendingLineScroll(engine);
        if (element && element.isConnected) {
            measureScrollViewport(engine, element);
        }
    });
    engine.tabRendererResizeObserver.observe(element);
    engine.observedTabRenderer = element;
    measureScrollViewport(engine, element);
}
const NO_SCROLL_INSETS = { top: 0, bottom: 0 };
function resolveScrollInset(value, viewportHeight) {
    const amount = Number.parseFloat(value);
    if (!Number.isFinite(amount) || amount <= 0)
        return 0;
    return value.trim().endsWith("%") ? (viewportHeight * amount) / 100 : amount;
}
/**
 * The scroll element's `scroll-padding` is the part of its viewport a host has declared unreadable,
 * such as an edge faded out by a mask. Insets that leave no band at all are ignored rather than
 * obeyed, since there would be nowhere left to put a line.
 */
export function resolveScrollInsets(scrollPaddingTop, scrollPaddingBottom, viewportHeight) {
    const top = resolveScrollInset(scrollPaddingTop, viewportHeight);
    const bottom = resolveScrollInset(scrollPaddingBottom, viewportHeight);
    return top + bottom < viewportHeight ? { top, bottom } : NO_SCROLL_INSETS;
}
function measureScrollViewport(engine, element) {
    const height = element.getBoundingClientRect().height;
    const { scrollPaddingTop, scrollPaddingBottom } = engine.window.getComputedStyle(element);
    engine.cachedTabRendererHeight = height;
    engine.cachedScrollInsets = resolveScrollInsets(scrollPaddingTop, scrollPaddingBottom, height);
}
/**
 * The line the singer is on: the latest one still being sung. An earlier line still running is a
 * tail, such as a background echo or a held note, and a later one is still in its lookahead. A line
 * stays active past its own end until the next one starts, so a started line only wins while it runs.
 */
export function findScrollAnchor(sungLines, scrollTime) {
    return (sungLines.findLast(line => line.time <= scrollTime && scrollTime < line.time + line.duration) ??
        sungLines.findLast(line => line.time <= scrollTime) ??
        sungLines[0]);
}
/**
 * Where to scroll so the lines being sung sit around the target, inside the visible band. When they
 * do not all fit, the anchor keeps its top in view and the rest give way. `overflowsBand` tells the
 * caller the view is pinned to the anchor, and has to move on once that line ends.
 *
 * @param sungLines - In order, never empty. The last is the last active line.
 */
export function computeActiveLinesScrollTop(sungLines, anchor, viewportHeight, insets, targetOffset) {
    const first = sungLines[0];
    const last = sungLines[sungLines.length - 1];
    const averageCentre = sungLines.reduce((total, line) => total + line.position + line.height / 2, 0) / sungLines.length;
    const visibleBottom = viewportHeight - insets.bottom;
    let scrollTop = averageCentre - targetOffset;
    scrollTop = Math.max(scrollTop, last.position + last.height - visibleBottom);
    scrollTop = Math.min(scrollTop, last.position - insets.top);
    scrollTop = Math.min(scrollTop, first.position - insets.top);
    scrollTop = Math.max(scrollTop, anchor.position + anchor.height - visibleBottom);
    scrollTop = Math.min(scrollTop, anchor.position - insets.top);
    return {
        scrollTop,
        overflowsBand: last.position + last.height - first.position > visibleBottom - insets.top,
    };
}
/**
 * Fills in everything a caller left out of a tick. The tick reads each of these arithmetically, so
 * a missing one would not fail: it would quietly turn the playback time into NaN and leave the view
 * matching no line at all.
 */
export function resolveTickOptions(options) {
    return {
        isPlaying: options.isPlaying,
        eventCreationTime: options.eventCreationTime ?? NO_PLAYER_SNAPSHOT,
        smoothScroll: options.smoothScroll ?? true,
        globalLyricOffset: options.globalLyricOffset ?? 0,
        lyricOffset: options.lyricOffset ?? 0,
        richsyncOffsetTrim: options.richsyncOffsetTrim ?? 0,
        lineOffsetTrim: options.lineOffsetTrim ?? 0,
        passiveScrollEnabled: options.passiveScrollEnabled ?? false,
        playbackRate: resolvePlaybackRate(options.playbackRate),
        followPausedSeeks: options.followPausedSeeks ?? false,
        countEveryUserScroll: options.countEveryUserScroll ?? false,
    };
}
// A rate of zero or less would freeze every animation that follows the song, which is a second
// answer to the question `isPlaying` already answers.
function resolvePlaybackRate(rate) {
    return rate !== undefined && Number.isFinite(rate) && rate > 0 ? rate : 1;
}
// -- Stage layout --------------------------------------------
const STAGE_MOTION = { durationMs: 380, easing: "cubic-bezier(0.2, 0, 0, 1)" };
// Read by an important rule in stage.css, so a theme's own important opacity cannot reveal a line
// the stage is hiding or fading.
const STAGE_OPACITY_PROPERTY = "--blyrics-stage-opacity";
const stageOpacityRegistrations = new WeakSet();
const STAGE_FADE_IN_MS = 300;
const STAGE_FADE_IN_DELAY_MS = 70;
const STAGE_FADE_OUT_MS = 220;
// Lines blur out and in across a handoff, so one reads as turning into the next.
const STAGE_BLUR = "blur(3px)";
const STAGE_GAP_EM = 0.32;
function stageElements(engine) {
    const elements = [];
    const items = [];
    let lastEnd = 0;
    for (const line of engine.lines) {
        const end = line.time + line.duration;
        lastEnd = Math.max(lastEnd, end);
        elements.push(line.lyricElement);
        items.push({
            kind: line.lyricElement.dataset.instrumental === "true"
                ? "instrumental"
                : line.lyricElement.dataset.blank === "true"
                    ? "blank"
                    : "line",
            start: line.time,
            end,
        });
    }
    const credits = engine.lyricsContainer?.querySelector(`:scope > .${CREDITS_CLASS}`);
    if (credits) {
        elements.push(credits);
        items.push({ kind: "credits", start: lastEnd, end: Number.POSITIVE_INFINITY });
    }
    return { elements, items };
}
function originXOf(align) {
    if (align === "center")
        return 0.5;
    if (align === "right" || align === "end")
        return 1;
    return 0;
}
const ELEMENT_NODE = 1;
const TEXT_NODE = 3;
function contentWidthOf(element, style) {
    return (element.clientWidth - (Number.parseFloat(style.paddingLeft) || 0) - (Number.parseFloat(style.paddingRight) || 0));
}
// A block that fills its parent is looked inside; inline boxes and shrunk blocks (the romanization pill) count whole.
function collectContentRects(engine, range, node, contentWidth, rects) {
    for (const child of node.childNodes) {
        if (child.nodeType === TEXT_NODE) {
            range.selectNodeContents(child);
            rects.push(...range.getClientRects());
            continue;
        }
        if (child.nodeType !== ELEMENT_NODE)
            continue;
        const element = child;
        const style = engine.window.getComputedStyle(element);
        if (style.display === "none")
            continue;
        if (style.display === "contents") {
            collectContentRects(engine, range, element, contentWidth, rects);
        }
        else if (style.display.startsWith("inline")) {
            rects.push(...element.getClientRects());
        }
        else if (element.offsetWidth < contentWidth - 1) {
            rects.push(element.getBoundingClientRect());
        }
        else {
            collectContentRects(engine, range, element, contentWidthOf(element, style), rects);
        }
    }
    return rects;
}
export function measureStage(engine) {
    engine.stageMetrics.clear();
    const container = engine.lyricsContainer;
    if (!container)
        return;
    engine.stageFontSize = Number.parseFloat(engine.window.getComputedStyle(container).fontSize) || 16;
    const range = engine.document.createRange();
    for (const element of stageElements(engine).elements) {
        const style = engine.window.getComputedStyle(element);
        const originX = originXOf(style.textAlign);
        const span = stageTextSpan(element.offsetLeft, element.offsetWidth, element.getBoundingClientRect(), collectContentRects(engine, range, element, contentWidthOf(element, style), []), { left: Number.parseFloat(style.paddingLeft) || 0, right: Number.parseFloat(style.paddingRight) || 0 }, originX);
        engine.stageMetrics.set(element, {
            height: element.offsetHeight,
            left: span.left,
            width: span.width,
            originX,
        });
    }
    engine.stageKey = "";
    engine.stageRemeasured = true;
}
function currentTranslateY(engine, element, fallback) {
    const parts = engine.window.getComputedStyle(element).translate.split(" ");
    const y = Number.parseFloat(parts[1] ?? "");
    return Number.isFinite(y) ? y : fallback;
}
function snapStageElement(engine, element, y) {
    engine.stageMoves.get(element)?.cancel();
    engine.stageMoves.set(element, element.animate([{ translate: `0 ${y}px` }], { duration: 0, fill: "forwards" }));
    engine.stageY.set(element, y);
}
function placeStageElement(engine, { element, placement, wasVisible, fromY, fromOpacity }, instant, reduced) {
    engine.stageMoves.get(element)?.cancel();
    engine.stageFades.get(element)?.cancel();
    const moveMs = instant || reduced ? 0 : STAGE_MOTION.durationMs;
    engine.stageMoves.set(element, element.animate([{ translate: `0 ${fromY}px` }, { translate: `0 ${placement.y}px` }], {
        duration: moveMs,
        easing: STAGE_MOTION.easing,
        fill: "forwards",
    }));
    const fadeMs = instant ? 0 : placement.visible ? STAGE_FADE_IN_MS : STAGE_FADE_OUT_MS;
    if (placement.visible)
        element.dataset.stageVisible = "";
    else if (fadeMs === 0)
        delete element.dataset.stageVisible;
    const fade = element.animate([{ [STAGE_OPACITY_PROPERTY]: fromOpacity }, { [STAGE_OPACITY_PROPERTY]: placement.visible ? 1 : 0 }], {
        duration: fadeMs,
        delay: placement.visible && !instant ? STAGE_FADE_IN_DELAY_MS : 0,
        easing: placement.visible ? "ease-out" : "ease",
        // Backwards too: the fade replaces one that was cancelled, and through its delay the line would
        // otherwise drop to the stylesheet's resting opacity of zero.
        fill: "both",
    });
    if (!placement.visible && fadeMs > 0) {
        fade.onfinish = () => {
            if (engine.stageFades.get(element) === fade)
                delete element.dataset.stageVisible;
        };
    }
    engine.stageFades.set(element, fade);
    engine.stageY.set(element, placement.y);
    engine.stageBlurs.get(element)?.cancel();
    engine.stageBlurs.delete(element);
    if (fadeMs === 0 || reduced || wasVisible === placement.visible)
        return;
    const blurs = ["none", STAGE_BLUR];
    engine.stageBlurs.set(element, element.animate((placement.visible ? blurs.reverse() : blurs).map(filter => ({ filter })), {
        duration: fadeMs,
        delay: placement.visible ? STAGE_FADE_IN_DELAY_MS : 0,
        easing: placement.visible ? "ease-out" : "ease",
        // Added to the theme's own filter rather than replacing it, and held only until the line is in focus.
        composite: "add",
        fill: placement.visible ? "backwards" : "forwards",
    }));
}
// Registered from script rather than with @property, which Firefox ignores in a stylesheet
// cross-origin to the document. Unregistered, the fade would snap instead of interpolating.
function registerStageOpacity(engine) {
    const css = engine.window.CSS;
    if (stageOpacityRegistrations.has(engine.window) || typeof css?.registerProperty !== "function")
        return;
    stageOpacityRegistrations.add(engine.window);
    try {
        css.registerProperty({ name: STAGE_OPACITY_PROPERTY, syntax: "<number>", inherits: false, initialValue: "0" });
    }
    catch (error) {
        engine.host.log("Stage opacity property was already registered", error);
    }
}
function isStageRoleVisible(role) {
    return role !== "queued" && role !== "gone";
}
function sameBox(a, b) {
    if (a === null || b === null)
        return a === b;
    return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}
function applyStage(engine, timeS, instant) {
    const container = engine.lyricsContainer;
    if (!container)
        return;
    registerStageOpacity(engine);
    const { elements, items } = stageElements(engine);
    const roles = planStage(items, timeS);
    const key = roles.join(",");
    if (key === engine.stageKey && !instant)
        return;
    engine.stageKey = key;
    const remeasured = engine.stageRemeasured;
    engine.stageRemeasured = false;
    const metrics = elements.map(element => engine.stageMetrics.get(element) ?? { height: 0, left: 0, width: 0, originX: 0 });
    const geometry = {
        stageHeight: container.clientHeight,
        gap: engine.stageFontSize * STAGE_GAP_EM,
        activeScale: getCSSNumber(engine, container, "--blyrics-active-scale", 1),
    };
    // Lines sit on the floor, so a resize moves every place by how far the floor moved.
    const floorShift = remeasured && engine.stageHeight > 0 ? geometry.stageHeight - engine.stageHeight : 0;
    engine.stageHeight = geometry.stageHeight;
    const { placements, box } = layoutStage(roles, items, metrics, elements.map(element => {
        const y = engine.stageY.get(element);
        return y === undefined ? null : y + floorShift;
    }), geometry);
    // Only the elements whose place changed move. A line that stays where it is keeps its running
    // animations, and one already hidden stays hidden without being animated again.
    const moves = [];
    elements.forEach((element, index) => {
        const placement = placements[index];
        const previousY = engine.stageY.get(element);
        const wasVisible = element.dataset.stageRole !== undefined && isStageRoleVisible(element.dataset.stageRole);
        const unchanged = previousY !== undefined && wasVisible === placement.visible && (!placement.visible || previousY === placement.y);
        // After a resize a line still on screen, fading out included, jumps to its new place and keeps
        // the fade and blur it was in the middle of.
        const onScreen = placement.visible || element.dataset.stageVisible !== undefined;
        if (remeasured && !instant && onScreen && element.dataset.stageRole === roles[index]) {
            if (previousY !== placement.y)
                snapStageElement(engine, element, placement.y);
            return;
        }
        if (unchanged && !instant)
            return;
        moves.push({
            element,
            placement,
            wasVisible,
            // A queued line rises from below the floor as it is now, never from where an older size put it.
            fromY: element.dataset.stageRole === "queued" && placement.visible
                ? queuedStageY(geometry.stageHeight, metrics[index].height, geometry.gap)
                : currentTranslateY(engine, element, previousY ?? placement.y),
            fromOpacity: Number(engine.window.getComputedStyle(element).opacity) || 0,
        });
    });
    const reduced = engine.window.matchMedia(REDUCED_MOTION_QUERY).matches;
    elements.forEach((element, index) => {
        if (element.dataset.stageRole !== roles[index])
            element.dataset.stageRole = roles[index];
    });
    for (const move of moves)
        placeStageElement(engine, move, instant, reduced);
    if (!sameBox(box, engine.stageBox)) {
        engine.stageBox = box;
        engine.host.onStageLayout?.(box);
    }
}
/**
 * Seconds to add to the player time to get the lyric time this view renders: the theme's offset
 * and the trim for its sync type, less the global and per-song offsets.
 */
function lyricClockShiftS(engine, lyricsElement, options) {
    const syncTypeShiftS = engine.syncType === "richsync"
        ? getCSSDurationInMs(engine, lyricsElement, "--blyrics-richsync-timing-offset") / 1000 -
            options.richsyncOffsetTrim
        : getCSSDurationInMs(engine, lyricsElement, "--blyrics-timing-offset") / 1000 - options.lineOffsetTrim;
    return syncTypeShiftS - options.globalLyricOffset - options.lyricOffset;
}
/**
 * The player time at which a lyric time plays, under the offsets of the last tick.
 */
export function playerTimeForLyricTime(engine, lyricTimeS) {
    const options = engine.lastTickOptions;
    const lyricsElement = engine.lyricsContainer;
    if (!options || !lyricsElement)
        return lyricTimeS;
    return Math.max(0, lyricTimeS - lyricClockShiftS(engine, lyricsElement, options));
}
/**
 * Renders one view against a tick with nothing left out.
 */
export function tickView(engine, currentTime, options) {
    const { eventCreationTime, isPlaying, smoothScroll } = options;
    engine.lastTickOptions = options;
    engine.passiveScrollEnabled = options.passiveScrollEnabled;
    if (engine.playbackRate !== options.playbackRate) {
        engine.playbackRate = options.playbackRate;
        applyPlaybackRateToRunningAnimations(engine);
    }
    const now = Date.now();
    if (currentTime === 0 && !isPlaying) {
        return "ok";
    }
    if (hasNoLyricsPlaceholder(engine)) {
        stopPassiveScrollLoop(engine);
        return "ok";
    }
    if (hasUnsyncedLyrics(engine)) {
        // The stage shows lines by their time, and unsynced lines have none.
        if (engine.layout === "stage")
            return "ok";
        if (!playbackClock.lastPlayState && isPlaying) {
            engine.scrollResumeTime = 0;
        }
        playbackClock.lastPlayState = isPlaying;
        if (!options.passiveScrollEnabled)
            return "ok";
        startPassiveScrollLoop(engine);
        return "ok";
    }
    const timeJumped = Math.abs(currentTime - playbackClock.lastTime - (eventCreationTime - playbackClock.lastEventCreationTime) / 1000) >
        TIME_JUMP_THRESHOLD;
    // Without a player snapshot the reading is the media clock, which runs backwards only on a seek, so a
    // loop shorter than the jump threshold still re-arms lines. A snapshot host's extrapolated clock is
    // pulled back by every correction, so it is left to the threshold.
    const mediaSteppedBack = eventCreationTime === NO_PLAYER_SNAPSHOT &&
        isPlaying &&
        currentTime < playbackClock.lastTime - CLOCK_RESYNC_THRESHOLD_S;
    // A clock that was already paused only moves when the host seeks it, however small the step, as a
    // scrub does. The tick that pauses lands a moment past the last playing one and is not a seek.
    const pausedSeek = options.followPausedSeeks && !isPlaying && !playbackClock.lastPlayState && currentTime !== playbackClock.lastTime;
    if (timeJumped)
        dropPendingLineScroll(engine);
    playbackClock.lastTime = currentTime;
    playbackClock.lastPlayState = isPlaying;
    playbackClock.lastEventCreationTime = eventCreationTime;
    let timeOffset = now - eventCreationTime;
    if (!isPlaying || eventCreationTime === NO_PLAYER_SNAPSHOT) {
        timeOffset = 0;
    }
    currentTime += timeOffset / 1000;
    if (SMOOTH_PLAYBACK_CLOCK) {
        if (isPlaying && !timeJumped) {
            currentTime = smoothedPlaybackTime(playbackClock.smoothedTime, playbackClock.smoothedAt, currentTime, now, engine.playbackRate);
        }
        playbackClock.smoothedTime = currentTime;
        playbackClock.smoothedAt = isPlaying ? now : NO_PLAYER_SNAPSHOT;
    }
    if (!engine.host.isViewVisible()) {
        clearVisibleLyricWillChange(engine);
        return "ok";
    }
    if (engine.host.syncAdState()) {
        return "ok";
    }
    try {
        const lyricsElement = engine.lyricsContainer;
        // If lyrics element doesn't exist, clear the interval and return silently
        if (!lyricsElement) {
            engine.host.log(NO_LYRICS_ELEMENT_LOG);
            return "lyrics-missing";
        }
        const lines = engine.lines;
        currentTime += lyricClockShiftS(engine, lyricsElement, options);
        const lyricScrollTime = correctedScrollTimeS(engine, currentTime) +
            getCSSDurationInMs(engine, lyricsElement, "--blyrics-scroll-timing-offset") / 1000;
        const { config: animationConfig, scrollTiming } = getAnimationSettings(engine, lyricsElement);
        // Read layout values before the loop writes class changes, to avoid forced reflow
        const isStage = engine.layout === "stage";
        const tabRenderer = isStage ? null : engine.host.getScrollElement();
        if (!isStage && !tabRenderer) {
            clearVisibleLyricWillChange(engine);
            return "ok";
        }
        if (tabRenderer && tabRenderer !== engine.observedTabRenderer) {
            setupTabRendererObserver(engine, tabRenderer);
        }
        const tabRendererHeight = tabRenderer
            ? (engine.cachedTabRendererHeight ?? tabRenderer.getBoundingClientRect().height)
            : 0;
        // Read before the loop's class writes so this layout read is batched and forces no mid-frame reflow.
        let scrollTop = tabRenderer?.scrollTop ?? 0;
        const maxScrollTop = tabRenderer ? Math.max(0, tabRenderer.scrollHeight - tabRenderer.clientHeight) : 0;
        if (!isStage && animationConfig.enabled.scroll) {
            updateVisibleLyricWillChange(engine, lines, scrollTop, engine.pendingLineScroll?.toScrollTop ?? scrollTop, tabRendererHeight);
        }
        else {
            dropPendingLineScroll(engine);
            clearVisibleLyricWillChange(engine);
            clearLineScrollAnimations(engine);
        }
        const tickTimelineNowMs = (engine.document.defaultView ?? engine.window).performance?.now?.() ?? performance.now();
        let activeElems = [];
        const linesToAnimate = [];
        let newLyricSelected = timeJumped;
        lines.every((lineData, index) => {
            const time = lineData.time;
            let nextTime = Infinity;
            if (index + 1 < lines.length) {
                const nextLyric = lines[index + 1];
                nextTime = nextLyric.time;
            }
            if (lyricScrollTime >= time - scrollTiming.earlyScrollConsiderS &&
                (lyricScrollTime < nextTime || lyricScrollTime < time + lineData.duration)) {
                activeElems.push(lineData);
                if (!engine.lastScrollElements.includes(lineData) && lyricScrollTime >= time) {
                    newLyricSelected = true;
                }
                // const timeDelta = lyricScrollTime - time;
                // if (engine.selectedElementIndex !== index && timeDelta > 0.05 && index > 0) {
                //   Utils.log(`[BetterLyrics] Scrolling to new lyric was late, dt: ${timeDelta.toFixed(5)}s`);
                // }
                engine.selectedElementIndex = index;
                if (!lineData.isScrolled) {
                    lineData.lyricElement.classList.add(CURRENT_LYRICS_CLASS);
                    lineData.isScrolled = true;
                }
            }
            else {
                if (lineData.isScrolled) {
                    lineData.lyricElement.classList.remove(CURRENT_LYRICS_CLASS);
                    lineData.isScrolled = false;
                }
            }
            /**
             * Time in seconds to set up animations. This shouldn't affect any visible effects, just help when the browser stutters
             */
            let setUpAnimationEarlyTime = 2;
            if (!isPlaying) {
                setUpAnimationEarlyTime = 0;
            }
            const effectiveEndTime = Math.max(nextTime, time + lineData.duration + 0.05);
            if (currentTime + setUpAnimationEarlyTime >= time && currentTime < effectiveEndTime) {
                if (!lineData.isSelected) {
                    lineData.isSelected = true;
                    lineData.lyricElement.classList.add(ANIMATING_CLASS);
                }
                if (isPlaying !== lineData.isAnimationPlayStatePlaying) {
                    lineData.isAnimationPlayStatePlaying = isPlaying;
                    setAnimationsPlayState(lineData, isPlaying);
                    if (isPlaying)
                        lineData.isAnimating = false; // reset the animation against current media time
                }
                // Lead-in animations have no timing sample for the drift check, so a jump while playing must reset them.
                if (((timeJumped && isPlaying) || mediaSteppedBack || pausedSeek) && lineData.isAnimating)
                    resetLineAnimationState(lineData);
                updateWordStates(lineData, currentTime);
                const nativeTimingSample = lineNativeTimingSample(lineData, currentTime, tickTimelineNowMs);
                let usedNativeTimingSampleForDrift = false;
                lineData.accumulatedOffsetMs = lineData.accumulatedOffsetMs / ANIMATION_TIMING_ACCUMULATION_DECAY;
                if (nativeTimingSample !== null && canUseTimingSampleForDrift(nativeTimingSample, isPlaying)) {
                    usedNativeTimingSampleForDrift = true;
                    const learnedOffsetMs = learnAnimationTimingOffset(engine, nativeTimingSample);
                    const residualOffsetMs = nativeTimingSample.offsetMs;
                    lineData.accumulatedOffsetMs += residualOffsetMs * ANIMATION_TIMING_ACCUMULATION_WEIGHT;
                    if (shouldLogAnimationTiming(engine, lineData, nativeTimingSample, now)) {
                        logAnimationTiming(engine, "sample", lineData, index, nativeTimingSample, currentTime, lineData.accumulatedOffsetMs, learnedOffsetMs, residualOffsetMs);
                    }
                }
                else if (nativeTimingSample !== null && shouldLogAnimationTiming(engine, lineData, nativeTimingSample, now)) {
                    logAnimationTiming(engine, "ignored-sample", lineData, index, nativeTimingSample, currentTime, lineData.accumulatedOffsetMs);
                }
                if (lineData.isAnimating &&
                    usedNativeTimingSampleForDrift &&
                    Math.abs(lineData.accumulatedOffsetMs) > ANIMATION_TIMING_RESET_THRESHOLD_MS &&
                    isPlaying) {
                    if (nativeTimingSample !== null) {
                        logAnimationTiming(engine, "drift-reset", lineData, index, nativeTimingSample, currentTime, lineData.accumulatedOffsetMs);
                    }
                    resetLineAnimationState(lineData);
                }
                if (!lineData.isAnimating) {
                    // We'll take care of the animation setup in a batch later
                    linesToAnimate.push(lineData);
                }
            }
            else {
                const staleAnimationEndTime = effectiveEndTime + animationConfig.highlight.fadeOutDurationMs / 1000 + 0.05;
                if (lineData.isSelected) {
                    if (isPlaying || timeJumped || pausedSeek) {
                        if (currentTime > staleAnimationEndTime) {
                            logAnimationCleanup(engine, "selected-stale-reset", lineData, index, currentTime, staleAnimationEndTime);
                            resetLineAnimationState(lineData);
                        }
                        else {
                            startLineExitAnimations(engine, lineData, animationConfig, currentTime);
                            markLineAnimationsStopped(lineData);
                        }
                    }
                    else {
                        setAnimationsPlayState(lineData, false);
                        lineData.isAnimationPlayStatePlaying = false;
                    }
                    lineData.isSelected = false;
                    clearLineStateClasses(lineData);
                    updateWordStates(lineData, currentTime);
                }
                else if ((timeJumped || currentTime > staleAnimationEndTime) && hasLineAnimations(lineData)) {
                    logAnimationCleanup(engine, timeJumped ? "time-jump-reset" : "stale-reset", lineData, index, currentTime, staleAnimationEndTime);
                    resetLineAnimationState(lineData);
                }
                if (timeJumped) {
                    updateWordStates(lineData, currentTime);
                }
            }
            return true;
        });
        if (linesToAnimate.length > 0) {
            for (const lineData of linesToAnimate) {
                startLineAnimations(engine, lineData, animationConfig, currentTime);
                lineData.isAnimating = true;
                lineData.lastAnimSetupAt = now;
                lineData.isAnimationPlayStatePlaying = isPlaying;
                lineData.accumulatedOffsetMs = 0;
                if (!isPlaying)
                    setAnimationsPlayState(lineData, false);
            }
        }
        let lastSungLine;
        if (engine.cachedLastSungLineRef === lines) {
            lastSungLine = engine.cachedLastSungLine;
        }
        else {
            lastSungLine = lines.findLast(lineData => lineData.lyricElement.dataset.instrumental !== "true");
            engine.cachedLastSungLineRef = lines;
            engine.cachedLastSungLine = lastSungLine;
        }
        const creditsFocused = lastSungLine !== undefined &&
            (engine.cachedCreditsItem?.height ?? 0) > 0 &&
            lyricScrollTime >= lastSungLine.time + lastSungLine.duration;
        if (creditsFocused !== engine.creditsFocused) {
            engine.creditsFocused = creditsFocused;
            if (creditsFocused)
                lyricsElement.dataset.creditsFocused = "true";
            else
                delete lyricsElement.dataset.creditsFocused;
            newLyricSelected = true;
        }
        if (isStage || !tabRenderer) {
            if (isStage)
                applyStage(engine, currentTime, timeJumped);
            return "ok";
        }
        if (engine.scrollResumeTime < Date.now() || engine.scrollPos === -1) {
            if (activeElems.length == 0) {
                activeElems.push(lines[0]);
            }
            // Offset so lyrics appear towards the center of the screen.
            const scrollPosOffset = tabRendererHeight * getTargetScrollRatio(engine, lyricsElement);
            let lastActiveLyric = activeElems[activeElems.length - 1];
            // Ignore lyrics close to finishing unless it is the last active lyric.
            const sungLines = activeElems.filter((lineData, index) => lyricScrollTime < lineData.time + lineData.duration - LYRIC_ENDING_THRESHOLD_S.getNumberValue() ||
                index == activeElems.length - 1);
            const lyricPositions = sungLines.map(lineData => lineData.position + lineData.height / 2);
            const scrollInsets = engine.cachedScrollInsets;
            const scrollAnchor = findScrollAnchor(sungLines, lyricScrollTime);
            const scrollTarget = computeActiveLinesScrollTop(sungLines, scrollAnchor, tabRendererHeight, scrollInsets, scrollPosOffset);
            let scrollPos = scrollTarget.scrollTop;
            const pinned = engine.pinnedScrollLine;
            if (pinned &&
                pinned !== scrollAnchor &&
                (!sungLines.includes(pinned) || lyricScrollTime >= pinned.time + pinned.duration)) {
                newLyricSelected = true;
            }
            const credits = engine.cachedCreditsItem;
            if (engine.creditsFocused && credits && lastSungLine) {
                // Tall credits would otherwise carry the last line out of view while it is still being sung.
                scrollPos = Math.min(credits.position + credits.height / 2 - scrollPosOffset, lastSungLine.position - scrollInsets.top);
            }
            // Past either end the browser clamps the write and reports nothing, leaving the view aiming
            // at a position it never reached and re-aiming once per remaining line.
            scrollPos = clamp(scrollPos, 0, maxScrollTop);
            if (ENABLE_DEBUG_RENDER.getBooleanValue()) {
                let transform = engine.window.getComputedStyle(lyricsElement).transform;
                const matrix = new engine.window.DOMMatrix(transform);
                let yTransform = matrix.f;
                let yTop = scrollTop - yTransform;
                const ctx = engine.host.debug?.beginFrame(yTop);
                if (ctx) {
                    ctx.strokeStyle = "green";
                    ctx.fillStyle = "green";
                    ctx?.fillText("visible top", 0, scrollTop);
                    ctx?.beginPath();
                    ctx?.moveTo(40, scrollTop);
                    ctx?.lineTo(1000, scrollTop);
                    ctx.stroke();
                    ctx.strokeStyle = "blue";
                    ctx.fillStyle = "blue";
                    ctx?.fillText("visible bottom", 0, scrollTop + tabRendererHeight);
                    ctx?.beginPath();
                    ctx?.moveTo(40, scrollTop + tabRendererHeight);
                    ctx?.lineTo(1000, scrollTop + tabRendererHeight);
                    ctx.stroke();
                    ctx.strokeStyle = "yellow";
                    ctx.fillStyle = "yellow";
                    ctx?.fillText("target", 0, scrollTop + scrollPosOffset);
                    ctx?.beginPath();
                    ctx?.moveTo(40, scrollTop + scrollPosOffset);
                    ctx?.lineTo(1000, scrollTop + scrollPosOffset);
                    ctx.stroke();
                    function debugLyrics(xOffset, name, activeElems, lyricPositions, lyricScrollTime) {
                        ctx.strokeStyle = "red";
                        ctx.fillStyle = "red";
                        ctx.fillText(name, xOffset + 2, yTop + 45);
                        ctx.fillText("scroll time: " + lyricScrollTime.toFixed(3), xOffset + 2, yTop + 60);
                        activeElems.forEach(elm => {
                            let timeTillActive = elm.time - lyricScrollTime;
                            let endTime = elm.time + elm.duration;
                            let timeTillEnd = endTime - lyricScrollTime;
                            if (timeTillEnd < LYRIC_ENDING_THRESHOLD_S.getNumberValue()) {
                                ctx.strokeStyle = "gray";
                                ctx.fillStyle = "gray";
                            }
                            else if (timeTillActive > 0) {
                                ctx.strokeStyle = "magenta";
                                ctx.fillStyle = "magenta";
                            }
                            else {
                                ctx.strokeStyle = "orange";
                                ctx.fillStyle = "orange";
                            }
                            ctx?.beginPath();
                            ctx?.moveTo(xOffset + 5, elm.position);
                            ctx?.lineTo(xOffset + 5, elm.position + elm.height);
                            ctx?.stroke();
                            ctx?.fillText("time: start=" + elm.time.toFixed(2) + " end=" + endTime.toFixed(2), xOffset + 15, elm.position);
                            ctx?.fillText("till active: " + timeTillActive.toFixed(2), xOffset + 15, elm.position + 15);
                            ctx?.fillText("till end: " + timeTillEnd.toFixed(2), xOffset + 15, elm.position + 30);
                        });
                        ctx.strokeStyle = "pink";
                        ctx.fillStyle = "pink";
                        lyricPositions.forEach(lyricPosition => {
                            ctx?.beginPath();
                            ctx?.arc(xOffset + 5, lyricPosition, 5, 0, 2 * Math.PI, false);
                            ctx?.fill();
                        });
                    }
                    debugLyrics(0, "realtime", activeElems, lyricPositions, lyricScrollTime);
                    debugLyrics(160, "last scroll", engine.lastScrollDebugContext.activeElms, engine.lastScrollDebugContext.centers, engine.lastScrollDebugContext.lyricScrollTime);
                }
            }
            const timeUntilUpcomingScrollMs = (lastActiveLyric.time - lyricScrollTime) * 1000;
            // Only a scroll from where the engine itself left the view keeps the theme's full stagger.
            const naturalAdvance = !timeJumped && !engine.wasUserScrolling && engine.scrollPos >= 0 && Math.abs(scrollTop - engine.scrollPos) <= 2;
            if (smoothScroll &&
                animationConfig.enabled.scroll &&
                !newLyricSelected &&
                !engine.wasUserScrolling &&
                timeUntilUpcomingScrollMs > 0 &&
                timeUntilUpcomingScrollMs <= SCROLL_PREPARE_LEAD_MS &&
                !engine.lastScrollElements.includes(lastActiveLyric) &&
                Math.abs(scrollTop - scrollPos) > 2) {
                updateVisibleLyricWillChange(engine, lines, scrollTop, scrollPos, tabRendererHeight);
                prepareUpcomingLineScroll(engine, getLineScrollItems(engine, lines), lastActiveLyric, scrollPos - scrollTop, scrollTop, scrollPos, tabRendererHeight, animationConfig, naturalAdvance);
            }
            if (engine.wasUserScrolling || newLyricSelected) {
                // Remember future lines only when their group is committed, so they cannot scroll
                // again at their start. Entering the lookahead window alone does not commit a group.
                engine.lastScrollElements = activeElems;
                engine.pinnedScrollLine = scrollTarget.overflowsBand ? scrollAnchor : null;
                engine.lastScrollDebugContext.lyricScrollTime = lyricScrollTime;
                engine.lastScrollDebugContext.centers = lyricPositions;
                engine.lastScrollDebugContext.activeElms = activeElems;
                if (smoothScroll && Math.abs(scrollTop - scrollPos) > 2) {
                    const scrollDeltaPx = scrollPos - scrollTop;
                    if (animationConfig.enabled.scroll) {
                        updateVisibleLyricWillChange(engine, lines, scrollTop, scrollPos, tabRendererHeight);
                        const lineScrollItems = getLineScrollItems(engine, lines);
                        commitOrPrepareLineScroll(engine, lineScrollItems, lastActiveLyric, scrollDeltaPx, scrollTop, scrollPos, tabRendererHeight, animationConfig, naturalAdvance);
                    }
                }
                else {
                    dropPendingLineScroll(engine);
                }
                const scrollTopBeforeWrite = scrollTop;
                scrollTop = scrollPos;
                engine.scrollPos = scrollTop;
                if (scrollTop !== scrollTopBeforeWrite && !(scrollTop <= 0 && scrollTopBeforeWrite <= 0)) {
                    tabRenderer.scrollTop = scrollTop;
                    if (tabRenderer.scrollTop !== scrollTopBeforeWrite) {
                        engine.skipScrolls += 1;
                        engine.skipScrollsDecayTimes.push(Date.now() + 2000);
                    }
                }
            }
        }
        if (engine.wasUserScrolling && engine.scrollResumeTime < Date.now()) {
            engine.host.setResumeAffordanceVisible(false);
            lyricsElement.classList.remove(USER_SCROLLING_CLASS);
            engine.wasUserScrolling = false;
        }
        decaySkipScrolls(engine, now, !options.countEveryUserScroll);
    }
    catch (err) {
        if (!err.message?.includes("undefined")) {
            engine.host.log(LYRICS_CHECK_INTERVAL_ERROR, err);
        }
    }
    return "ok";
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
export function computeScrollPadding(measurements) {
    const { viewportHeight, targetScrollRatio, contentHeight, lastLineCentre } = measurements;
    const top = Math.max(0, viewportHeight * targetScrollRatio - measurements.firstLineHeight / 2);
    const lastLineTargetContentHeight = lastLineCentre === null ? viewportHeight : lastLineCentre + viewportHeight * (1 - targetScrollRatio);
    const trailingContentHeight = measurements.footerHeight + measurements.lastLineHeight / 2;
    const viewportTailSpace = viewportHeight * (1 - targetScrollRatio) - trailingContentHeight;
    const bottom = Math.max(lastLineTargetContentHeight - contentHeight, viewportHeight - contentHeight, viewportTailSpace, 0);
    return { top, bottom: Math.ceil(bottom) };
}
/**
 * Sizes the padding this view needs and writes it where the stylesheet reads it, which is the
 * document's root element. That makes it the second thing a view writes per document rather than
 * per view, alongside the theme's `<style>`, so it is the same one renderer per document constraint
 * the README states under Theme settings and not a new one: a second renderer in this document
 * overwrites these two properties with the padding its own viewport needs, and the first view is
 * then padded for a viewport it is not in.
 *
 * The root rather than the container because these are published names. Both readers in this repo
 * select `.blyrics-container`, but the extension's own `mobile.css` is one of them, from outside
 * the module, and a theme is free to read them anywhere: narrowing where they resolve would break
 * such a theme silently, the way any custom property that stops resolving does. That is a real cost
 * against a corruption the module already forbids.
 */
function applyScrollPadding(engine) {
    const lyricsElement = engine.lyricsContainer;
    const tabRenderer = engine.host.getScrollElement();
    if (!lyricsElement || !tabRenderer)
        return;
    if (hasNoLyricsPlaceholder(engine)) {
        setScrollPadding(engine, lyricsElement, { top: 0, bottom: 0 });
        return;
    }
    const tabRendererHeight = tabRenderer.getBoundingClientRect().height;
    const scrollPosOffsetRatio = getTargetScrollRatio(engine, lyricsElement);
    const currentPaddingBottom = Number.parseFloat(engine.window.getComputedStyle(lyricsElement).paddingBottom) || 0;
    const lyricsHeightWithoutBottomPadding = Math.max(0, lyricsElement.scrollHeight - currentPaddingBottom);
    const lyricLines = lyricsElement.querySelectorAll(`:scope > .${LINE_CLASS}`);
    const firstLyric = lyricLines[0] ?? null;
    const lastLyric = lyricLines[lyricLines.length - 1] ?? null;
    const credits = lyricsElement.querySelector(`:scope > .${CREDITS_CLASS}`);
    const creditsBounds = credits ? getRelativeLayoutBounds(lyricsElement, credits) : null;
    // The credits take the focus once the song ends, so they are the last thing the scroll must reach.
    const lastLyricBounds = creditsBounds && creditsBounds.height > 0
        ? creditsBounds
        : lastLyric
            ? getRelativeLayoutBounds(lyricsElement, lastLyric)
            : null;
    const footer = lyricsElement.querySelector(`:scope > .${FOOTER_CLASS}`);
    const { top, bottom } = computeScrollPadding({
        viewportHeight: tabRendererHeight,
        targetScrollRatio: scrollPosOffsetRatio,
        contentHeight: lyricsHeightWithoutBottomPadding,
        firstLineHeight: firstLyric ? getRelativeLayoutBounds(lyricsElement, firstLyric).height : 0,
        lastLineCentre: lastLyricBounds ? lastLyricBounds.y + lastLyricBounds.height / 2 : null,
        lastLineHeight: lastLyricBounds?.height ?? 0,
        footerHeight: footer ? getRelativeLayoutBounds(lyricsElement, footer).height : 0,
    });
    setScrollPadding(engine, lyricsElement, { top, bottom });
}
function setScrollPadding(engine, lyricsElement, { top, bottom }) {
    const rootStyle = engine.document.documentElement.style;
    const nextTop = top + "px";
    const nextBottom = bottom + "px";
    if (rootStyle.getPropertyValue("--blyrics-padding-top") !== nextTop) {
        rootStyle.setProperty("--blyrics-padding-top", nextTop);
    }
    if (rootStyle.getPropertyValue("--blyrics-padding-bottom") !== nextBottom) {
        rootStyle.setProperty("--blyrics-padding-bottom", nextBottom);
    }
    // Inline, because a theme's own `.blyrics-container { padding }` is appended after the package's
    // stylesheet at the same weight and would otherwise take this room away.
    if (lyricsElement.style.getPropertyValue("padding-bottom") !== nextBottom) {
        lyricsElement.style.setProperty("padding-bottom", nextBottom);
    }
}
/**
 * Re-reads the view's layout: the scroll padding first, then the line positions the padding moved.
 *
 * @param measureLines - Pass false while the lines are not being rendered. An unrendered container
 *   measures every line as zero height at zero offset, which would leave the scroll maths with
 *   nothing to work from once rendering resumes.
 */
export function relayout(engine, measureLines) {
    if (engine.layout === "stage") {
        if (!measureLines || !engine.lyricsContainer)
            return;
        engine.cachedCreditsItem = measureTrailingItem(engine.lyricsContainer, CREDITS_CLASS);
        measureStage(engine);
        return;
    }
    const lyricsElement = engine.lyricsContainer;
    // Un-cull before scroll padding and cached lyricHeight so neither reads stale culled heights.
    if (measureLines && lyricsElement) {
        clearOffscreenLineCulling(engine);
    }
    applyScrollPadding(engine);
    const scrollElement = engine.host.getScrollElement();
    if (scrollElement)
        measureScrollViewport(engine, scrollElement);
    if (!measureLines || !lyricsElement)
        return;
    // Both dimensions, because both are what a resize is compared against. The scroll padding written
    // above lands on this container, so a measurement that records only the width leaves every later
    // resize report looking like a new height, and each one measures again and forces a rescroll.
    engine.lyricWidth = lyricsElement.clientWidth;
    engine.lyricHeight = lyricsElement.clientHeight;
    for (const line of engine.lines) {
        const bounds = getRelativeLayoutBounds(lyricsElement, line.lyricElement);
        line.position = bounds.y;
        line.height = bounds.height;
        line.decorations = new Map(lineDecorators(line.lyricElement).map(element => [element, getRelativeLayoutBounds(lyricsElement, element).y]));
    }
    engine.cachedCreditsItem = measureTrailingItem(lyricsElement, CREDITS_CLASS);
    engine.cachedFooterItem = measureTrailingItem(lyricsElement, FOOTER_CLASS);
    // Re-arm from the fresh measurements, so a line skipped after this holds its new placeholder height.
    setupLineCullObserver(engine);
    engine.wasUserScrolling = true; // trigger rescrolls
    engine.host.debug?.resize();
}
const MAX_INCREMENTAL_RELAYOUT_SPAN = 16;
export function relayoutChangedLines(engine, changedIndices) {
    if (engine.layout === "stage") {
        relayout(engine, true);
        return;
    }
    const lyricsElement = engine.lyricsContainer;
    const lines = engine.lines;
    if (!lyricsElement || lines.length === 0 || !changedIndices || changedIndices.length === 0) {
        relayout(engine, true);
        return;
    }
    if (engine.lyricWidth <= 0 || engine.lyricHeight <= 0 || hasNoLyricsPlaceholder(engine)) {
        relayout(engine, true);
        return;
    }
    let minIdx = lines.length;
    let maxIdx = -1;
    for (let k = 0; k < changedIndices.length; k++) {
        const idx = changedIndices[k];
        if (Number.isInteger(idx) && idx >= 0 && idx < lines.length) {
            if (idx < minIdx)
                minIdx = idx;
            if (idx > maxIdx)
                maxIdx = idx;
        }
    }
    if (maxIdx < minIdx || maxIdx - minIdx > MAX_INCREMENTAL_RELAYOUT_SPAN) {
        relayout(engine, true);
        return;
    }
    for (let i = minIdx; i <= maxIdx; i++) {
        const lineEl = lines[i].lyricElement;
        if (engine.culledLineElements.delete(lineEl)) {
            uncullLine(lineEl);
        }
    }
    // Width change can reflow every line; fall back to full relayout.
    const currentWidth = lyricsElement.clientWidth;
    if (currentWidth !== engine.lyricWidth) {
        relayout(engine, true);
        return;
    }
    const tabRenderer = engine.host.getScrollElement();
    const viewportHeight = tabRenderer
        ? (engine.cachedTabRendererHeight ?? tabRenderer.getBoundingClientRect().height)
        : 0;
    const scrollPosOffsetRatio = getTargetScrollRatio(engine, lyricsElement);
    if (minIdx === 0 && tabRenderer) {
        const firstLineHeight = getRelativeLayoutBounds(lyricsElement, lines[0].lyricElement).height;
        const nextTop = Math.max(0, viewportHeight * scrollPosOffsetRatio - firstLineHeight / 2);
        const rootStyle = engine.document.documentElement.style;
        const nextTopStr = nextTop + "px";
        if (rootStyle.getPropertyValue("--blyrics-padding-top") !== nextTopStr) {
            rootStyle.setProperty("--blyrics-padding-top", nextTopStr);
        }
    }
    for (let i = minIdx; i <= maxIdx; i++) {
        const line = lines[i];
        const bounds = getRelativeLayoutBounds(lyricsElement, line.lyricElement);
        line.position = bounds.y;
        line.height = bounds.height;
        line.decorations = new Map(lineDecorators(line.lyricElement).map(element => [element, getRelativeLayoutBounds(lyricsElement, element).y]));
        line.restingHeight = line.lyricElement.offsetHeight;
    }
    let anchorIdx = maxIdx + 1;
    let suffixShiftPx = 0;
    let foundAnchor = false;
    while (anchorIdx < lines.length) {
        const anchorLine = lines[anchorIdx];
        const anchorBounds = getRelativeLayoutBounds(lyricsElement, anchorLine.lyricElement);
        if (anchorBounds.height > 0) {
            suffixShiftPx = anchorBounds.y - anchorLine.position;
            foundAnchor = true;
            break;
        }
        anchorLine.position = anchorBounds.y;
        anchorLine.height = anchorBounds.height;
        anchorIdx++;
    }
    if (foundAnchor) {
        if (suffixShiftPx !== 0) {
            for (let j = anchorIdx; j < lines.length; j++) {
                const line = lines[j];
                line.position += suffixShiftPx;
                if (line.decorations.size > 0) {
                    for (const [el, y] of line.decorations) {
                        line.decorations.set(el, y + suffixShiftPx);
                    }
                }
            }
            if (engine.cachedCreditsItem !== null) {
                engine.cachedCreditsItem.position += suffixShiftPx;
            }
            if (engine.cachedFooterItem !== null) {
                engine.cachedFooterItem.position += suffixShiftPx;
            }
        }
    }
    else {
        engine.cachedCreditsItem = measureTrailingItem(lyricsElement, CREDITS_CLASS);
        engine.cachedFooterItem = measureTrailingItem(lyricsElement, FOOTER_CLASS);
    }
    let currentHeight = lyricsElement.clientHeight;
    // Scroll padding-bottom is invariant when neither endpoint changed and content exceeds viewport;
    // skip recomputing it to avoid ±1px rounding jitter writing :root custom properties.
    const inlineBottom = lyricsElement.style.getPropertyValue("padding-bottom");
    const currentPaddingBottom = inlineBottom
        ? (Number.parseFloat(inlineBottom) || 0)
        : (Number.parseFloat(engine.window.getComputedStyle(lyricsElement).paddingBottom) || 0);
    const lyricsHeightWithoutBottomPadding = Math.max(0, lyricsElement.scrollHeight - currentPaddingBottom);
    const needsBottomPaddingUpdate = minIdx === 0 ||
        !foundAnchor ||
        lyricsHeightWithoutBottomPadding < viewportHeight ||
        lyricsHeightWithoutBottomPadding - suffixShiftPx < viewportHeight;
    if (tabRenderer && needsBottomPaddingUpdate) {
        const lastItem = engine.cachedCreditsItem && engine.cachedCreditsItem.height > 0
            ? engine.cachedCreditsItem
            : lines[lines.length - 1];
        const { top, bottom } = computeScrollPadding({
            viewportHeight,
            targetScrollRatio: scrollPosOffsetRatio,
            contentHeight: lyricsHeightWithoutBottomPadding,
            firstLineHeight: lines[0].height,
            lastLineCentre: lastItem ? lastItem.position + lastItem.height / 2 : null,
            lastLineHeight: lastItem?.height ?? 0,
            footerHeight: engine.cachedFooterItem?.height ?? 0,
        });
        const nextBottomStr = bottom + "px";
        const rootStyle = engine.document.documentElement.style;
        let paddingChanged = false;
        if (minIdx === 0) {
            const nextTopStr = top + "px";
            if (rootStyle.getPropertyValue("--blyrics-padding-top") !== nextTopStr) {
                rootStyle.setProperty("--blyrics-padding-top", nextTopStr);
                paddingChanged = true;
            }
        }
        if (rootStyle.getPropertyValue("--blyrics-padding-bottom") !== nextBottomStr) {
            rootStyle.setProperty("--blyrics-padding-bottom", nextBottomStr);
            paddingChanged = true;
        }
        if (lyricsElement.style.getPropertyValue("padding-bottom") !== nextBottomStr) {
            lyricsElement.style.setProperty("padding-bottom", nextBottomStr);
            paddingChanged = true;
        }
        if (paddingChanged) {
            currentHeight = lyricsElement.clientHeight;
        }
    }
    engine.lyricWidth = currentWidth;
    engine.lyricHeight = currentHeight;
    engine.wasUserScrolling = true;
    engine.host.debug?.resize();
}
// -- Decoration slide --------------------------
const DECORATION_SLIDE_MS = 350;
const DECORATION_SLIDE_EASING = "cubic-bezier(0.25, 1, 0.5, 1)";
const DECORATION_MIN_SHIFT_PX = 0.5;
function slideElementBy(element, dy) {
    element.animate({ translate: [`0 ${dy}px`, "0 0"] }, { duration: DECORATION_SLIDE_MS, easing: DECORATION_SLIDE_EASING, composite: "add" });
}
function decorationSlideAllowed(engine, container) {
    if (engine.window.matchMedia(REDUCED_MOTION_QUERY).matches)
        return false;
    return (engine.window.getComputedStyle(container).getPropertyValue("--blyrics-animate-decoration-entry").trim() !== "0");
}
function lineDecorators(lineElement) {
    return [
        ...lineElement.querySelectorAll(`.${ROMANIZED_LYRICS_CLASS}`),
        ...lineElement.querySelectorAll(`.${TRANSLATED_LYRICS_CLASS}`),
    ];
}
/**
 * Snapshots where the lines and their decorators sit now, so the remeasure that follows can slide
 * each one from there to wherever a streamed decoration just pushed it. Returns null when nothing
 * should animate, and otherwise a function to call once the new layout is measured: the line rides
 * its own shift and a decorator rides only the part of its shift its line did not already carry, so
 * a survivor whose line held still still slides into the gap a removed sibling left.
 */
function captureDecorationSlide(engine) {
    const container = engine.lyricsContainer;
    if (!container || engine.layout === "stage" || !decorationSlideAllowed(engine, container))
        return null;
    const before = engine.lines.map(line => ({
        line,
        position: line.position,
        decorations: new Map(line.decorations),
    }));
    return () => {
        for (const { line, position, decorations } of before) {
            const lineShift = position - line.position;
            if (Math.abs(lineShift) >= DECORATION_MIN_SHIFT_PX)
                slideElementBy(line.lyricElement, lineShift);
            for (const [element, was] of decorations) {
                const now = line.decorations.get(element);
                if (now === undefined)
                    continue;
                const shift = was - now - lineShift;
                if (Math.abs(shift) >= DECORATION_MIN_SHIFT_PX)
                    slideElementBy(element, shift);
            }
        }
    };
}
// -- Debounced Lyrics Update --------------------------
function cancelLyricPositionUpdate(engine) {
    if (engine.pendingLyricsUpdateFrame === null)
        return;
    engine.window.cancelAnimationFrame(engine.pendingLyricsUpdateFrame);
    engine.pendingLyricsUpdateFrame = null;
}
/**
 * Renders this view again against the last player snapshot, without moving the clock on. The
 * options are built now rather than handed in, so a caller that reads settings at tick time still
 * reads them at tick time.
 *
 * @param buildTickOptions - Given the snapshot the tick will run against, returns what to render it
 *   with.
 */
export function retickFromPlaybackClock(engine, buildTickOptions) {
    return tickView(engine, playbackClock.lastTime, resolveTickOptions(buildTickOptions(playbackClock.lastEventCreationTime, playbackClock.lastPlayState)));
}
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
export function scheduleLyricPositionUpdate(engine, isViewRendering, retick) {
    if (engine.pendingLyricsUpdateFrame !== null) {
        return;
    }
    dropPendingLineScroll(engine);
    engine.pendingLyricsUpdateFrame = engine.window.requestAnimationFrame(() => {
        engine.pendingLyricsUpdateFrame = null;
        const isRendering = isViewRendering();
        const playSlide = isRendering ? captureDecorationSlide(engine) : null;
        relayout(engine, isRendering);
        playSlide?.();
        if (!isRendering)
            return;
        retick();
    });
}
