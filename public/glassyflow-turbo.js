/**
 * ════════════════════════════════════════════════════════════════════════
 *  GlassyFlow Turbo — compositor-driven variant of GlassyFlow v5
 * ════════════════════════════════════════════════════════════════════════
 *
 *  Same spring, same stagger, same config, same feel. The only thing that
 *  changes is WHICH THREAD moves the lines.
 *
 *  WHY THIS EXISTS
 *
 *  glassyflow.js drives every line from an rAF loop:
 *
 *      const y = data.spring.update(dt);
 *      line.style.translate = `0px ${y}px`;
 *
 *  Writing an inline style forces Blink to recalculate style. On the YouTube
 *  Music DOM that walk covers ~8,900 elements and costs ~4.2ms, and the loop
 *  does it for ~11 lines every frame — ~97 writes/sec. Measured consequence
 *  on a 120Hz panel (perf-probe-compo.js, 2s per phase):
 *
 *      idle                     230 frames   gap 8.30ms   dropped  11/229
 *      WAAPI keyframes          219 frames   gap 8.30ms   dropped  21/218
 *      per-frame style writes    71 frames   gap 25.10ms  dropped  70/70
 *
 *  35fps, and every single frame late. No stylesheet tuning reaches the
 *  8.33ms budget from there; the writes themselves are the cost.
 *
 *  HOW THIS FIXES IT
 *
 *  The spring is a closed-form solution — _solveSpring() returns position as
 *  a pure function of t, and its derivative gives velocity at any t. So the
 *  entire trajectory is knowable up front. Instead of stepping it once per
 *  frame on the main thread, bake it into WAAPI keyframes and hand it to the
 *  compositor. The main thread then does nothing at all until the next scroll.
 *
 *  Cost moves from ~4.2ms x 97/sec (continuous) to one bake per scroll batch
 *  (~1-2/sec). The motion is identical because it is the same solver sampled
 *  at 60Hz rather than evaluated at 120Hz — sub-pixel difference, see
 *  bakeSpring() for the error budget.
 *
 *  WHAT ELSE CHANGED, AND WHY IT IS SAFE
 *
 *   - No will-change writes. WAAPI promotes the element for the animation's
 *     lifetime on its own, so glassyflow's set/clear pair was redundant.
 *   - No half-pixel quantisation. `(y*2+0.5|0)/2` existed to make style
 *     writes cheaper; on the compositor it would only make motion steppy.
 *   - No arrival cleanup write. fill:'backwards' fills only the delay phase,
 *     so once finished the element falls back to its base style — which has
 *     no translate, i.e. exactly the arrival state.
 *   - The Spring class is gone. Its only purpose was the stateful update(dt)
 *     this file no longer calls; _solveSpring/_derivative (the actual
 *     physics) are used verbatim.
 *
 *  Everything else — CFG constants, dynamic lookBehind/lookAhead, viewport
 *  measurement, Delta-Adaptive LookAhead, Fast Transition, scroll delay
 *  debounce, deferred-delta busy gating, Dynamic Speedup, container
 *  compensation, no-sync detection, resize recovery — is carried over
 *  unchanged from glassyflow.js.
 *
 *  NOTE: past-line fading is not this file's business. mergetheme.js stamps
 *  .blyrics--gf-behind the moment .blyrics--active moves and hides the line
 *  from CSS, whether or not a GlassyFlow-family script is driving the scroll.
 * ════════════════════════════════════════════════════════════════════════
 */

(function () {
    'use strict';

    // glassyflow.js is a bare IIFE with no guard; only one of the two is ever
    // injected (the preload picks a single filename), but guard anyway so a
    // double-inject cannot end up with two loops fighting over the same lines.
    if (window.__glassyFlowTurboInstalled) {
        console.warn('[GlassyFlow Turbo] Already installed — skipping duplicate injection.');
        return;
    }
    window.__glassyFlowTurboInstalled = true;

    /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
     *  SPRING SOLVER — damped harmonic oscillator (ported from AMLL)
     *
     *  Unchanged from glassyflow.js. _solveSpring returns position as a pure
     *  function of t (seconds); _derivative gives velocity at any t. Those two
     *  properties are what make the bake exact rather than approximate.
     * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

    function _solveSpring(from, velocity, to, stiffness, damping, mass) {
        const delta = to - from;
        if (damping * damping >= 4.0 * stiffness * mass) {
            const angFreq = -Math.sqrt(stiffness / mass);
            const leftover = -angFreq * delta - velocity;
            return (t) => {
                if (t < 0) return from;
                return to - (delta + t * leftover) * Math.exp(t * angFreq);
            };
        }
        const dampFreq = Math.sqrt(4.0 * mass * stiffness - damping * damping);
        const leftover = (damping * delta - 2.0 * mass * velocity) / dampFreq;
        const dfm = (0.5 * dampFreq) / mass;
        const dm = -(0.5 * damping) / mass;
        return (t) => {
            if (t < 0) return from;
            return (
                to -
                (Math.cos(t * dfm) * delta + Math.sin(t * dfm) * leftover) *
                Math.exp(t * dm)
            );
        };
    }

    function _derivative(fn) {
        const h = 0.001;
        return (t) => (fn(t + h) - fn(t - h)) / (2 * h);
    }

    /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
     *  CONFIG — identical to glassyflow.js so the motion matches exactly
     * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
    const DEBUG = false; // Set true to enable hot-path logging

    const CFG = {
        staggerStep: 40,
        // lookBehind / lookAhead: computed dynamically — see getLookBehind(), getLookAhead()
        lookBehindRatio: 0.30,  // fraction of visible lines allocated above ref
        lookAheadRatio: 0.70,   // fraction of visible lines allocated below ref
        lookBehindMin: 2,       // minimum lookBehind regardless of viewport
        lookBehindMax: 15,      // maximum lookBehind
        lookAheadMin: 4,        // minimum lookAhead regardless of viewport
        lookAheadMax: 25,       // maximum lookAhead
        minDelta: 2,
        stiffness: 110,
        damping: 15,
        mass: 1,
        scrollDelay: 200,   // ms — delay trước khi thực hiện scroll (0 = không delay)

        // Dynamic Speedup — tăng tốc animation khi cuộn quá nhanh
        speedupThreshold: 100,  // px — ngưỡng deferredDelta để kích hoạt speedup
        speedupScale: 2.5,      // hệ số playbackRate khi speedup kích hoạt

        // Delta-Adaptive LookAhead — mở rộng phạm vi animation khi scroll delta lớn
        deltaAdaptiveEnabled: true,
        avgLineHeightFallback: 48,  // px — fallback nếu không đo được chiều cao dòng

        // Fast Transition Dynamic Config (Gap ngắn)
        fastTransitionEnabled: true,
        fastTransitionThreshold: 1.7, // giây
        fastStaggerStep: 30,          // Stagger nhanh hơn
        fastStiffness: 120,           // Lò xo cứng hơn
        fastDamping: 18,              // Ít ma sát hơn
        fastMass: 1,                // Khối lượng nhẹ hơn

        // ── Turbo-only ──
        // Arrival threshold. Matches Spring.arrived() in glassyflow.js
        // (|target - pos| < 0.1 && |v| < 0.1) so the baked duration is exactly
        // as long as the rAF loop would have run.
        arriveEpsilon: 0.1,
        bakeSamplesPerSec: 60,  // keyframe density — see bakeSpring()
        bakeMaxSamples: 80,
        bakeMaxDuration: 4,     // s — hard cap on the settle search
    };

    /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
     *  DYNAMIC LOOK-BEHIND / LOOK-AHEAD
     * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
    let _viewportCache = { visibleLines: 14, ts: 0 }; // fallback = 14 lines
    const _VIEWPORT_CACHE_TTL = 500; // ms

    function _getLineFullHeight(lineEl) {
        let target;
        if (lineEl.classList.contains('blyrics--line')) {
            // .blyrics--line nằm trong wrapper div → đo wrapper
            target = lineEl.parentElement;
            // Safety: nếu parent là container thay vì wrapper → fallback
            if (!target || target === container) {
                target = lineEl;
            }
        } else {
            // .blyrics-footer hoặc element trực tiếp → đo chính nó
            target = lineEl;
        }

        const oh = target.offsetHeight;
        if (oh <= 0) return 0;
        const style = getComputedStyle(target);
        return oh + parseFloat(style.marginTop) + parseFloat(style.marginBottom);
    }

    function _measureVisibleLines() {
        const now = Date.now();
        if (now - _viewportCache.ts < _VIEWPORT_CACHE_TTL) {
            return _viewportCache.visibleLines;
        }

        if (!container) return _viewportCache.visibleLines;

        // ── Viewport height ──
        // Priority: tab-renderer (BL's actual scroll viewport) → scroll parent → container
        let viewportH = 0;
        const tabRenderer = document.querySelector(
            'ytmusic-tab-renderer[page-type="MUSIC_PAGE_TYPE_TRACK_LYRICS"]'
        );
        if (tabRenderer) {
            viewportH = tabRenderer.clientHeight;
        } else if (scrollParent) {
            viewportH = scrollParent.clientHeight;
        } else {
            viewportH = container.clientHeight;
        }

        // ── Clamp to actually visible area ──
        const vpEl = tabRenderer || scrollParent || container;
        if (vpEl) {
            const rect = vpEl.getBoundingClientRect();
            const visibleTop = Math.max(rect.top, 0);
            const visibleBottom = Math.min(rect.bottom, window.innerHeight);
            const actualVisibleH = visibleBottom - visibleTop;
            if (actualVisibleH > 0 && actualVisibleH < viewportH) {
                viewportH = actualVisibleH;
            }
        }

        if (viewportH <= 0) {
            return _viewportCache.visibleLines;
        }

        // ── Count lines that fit in viewport ──
        const lines = container.querySelectorAll('.blyrics--line, .blyrics-footer');
        if (!lines.length) return _viewportCache.visibleLines;

        const allLines = Array.from(lines);
        const ref = getRefIndex(allLines);

        // Count forward from ref (how many lines fit below)
        let accH = 0, countFwd = 0;
        for (let i = ref; i < allLines.length; i++) {
            const h = _getLineFullHeight(allLines[i]);
            if (h <= 0) continue;
            countFwd++;          // count BEFORE overflow check → partially visible lines included
            accH += h;
            if (accH >= viewportH) break;
        }

        // Count backward from ref (how many lines fit above)
        accH = 0;
        let countBwd = 0;
        for (let i = ref - 1; i >= 0; i--) {
            const h = _getLineFullHeight(allLines[i]);
            if (h <= 0) continue;
            countBwd++;          // count BEFORE overflow check
            accH += h;
            if (accH >= viewportH) break;
        }

        // +1 buffer on each direction to cover edge lines that just enter the viewport
        const visible = Math.max(countFwd, countBwd + 1, 4);

        if (DEBUG && (_viewportCache.visibleLines !== visible || _viewportCache.ts === 0)) {
            const lb = Math.max(CFG.lookBehindMin, Math.min(CFG.lookBehindMax, Math.round(visible * CFG.lookBehindRatio)));
            const la = Math.max(CFG.lookAheadMin, Math.min(CFG.lookAheadMax, Math.round(visible * CFG.lookAheadRatio)));
            console.info(`[GlassyFlow Turbo] 📏 Viewport Measurement:
  - Viewport Height: ${viewportH.toFixed(1)}px
  - Result: ~${visible} visible lines (lookBehind: ${lb}, lookAhead: ${la})`);
        }

        _viewportCache = { visibleLines: visible, ts: now };
        return visible;
    }

    function getLookBehind() {
        const v = _measureVisibleLines();
        const raw = Math.round(v * CFG.lookBehindRatio);
        return Math.max(CFG.lookBehindMin, Math.min(CFG.lookBehindMax, raw));
    }

    function getLookAhead() {
        const v = _measureVisibleLines();
        const raw = Math.round(v * CFG.lookAheadRatio);
        return Math.max(CFG.lookAheadMin, Math.min(CFG.lookAheadMax, raw));
    }

    /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
     *  DELTA-ADAPTIVE LOOKAHEAD HELPER
     * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
    let _avgLineHeightCache = { value: 48, ts: 0 };

    function _estimateAvgLineHeight(lines, ref) {
        const now = Date.now();
        // Reuse viewport cache TTL to avoid extra DOM reads
        if (now - _avgLineHeightCache.ts < _VIEWPORT_CACHE_TTL) {
            return _avgLineHeightCache.value;
        }

        let totalH = 0, count = 0;
        const sampleStart = Math.max(0, ref - 2);
        const sampleEnd = Math.min(lines.length, ref + 3);
        for (let i = sampleStart; i < sampleEnd; i++) {
            const h = _getLineFullHeight(lines[i]);
            if (h > 0) { totalH += h; count++; }
        }

        const avg = count > 0 ? totalH / count : CFG.avgLineHeightFallback;
        _avgLineHeightCache = { value: avg, ts: now };
        return avg;
    }

    /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
     *  FAST TRANSITION CHECKER
     * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
    function _checkFastTransition(lines, ref) {
        if (!CFG.fastTransitionEnabled) return false;

        if (ref + 1 < lines.length) {
            const time1 = parseFloat(lines[ref].getAttribute('data-time') || 0);
            const time2 = parseFloat(lines[ref + 1].getAttribute('data-time') || 0);

            if (time2 - time1 > 0 && time2 - time1 < CFG.fastTransitionThreshold) {
                return true;
            }

            // Check gap between ref+1 and ref+2 to prepare early
            if (ref + 2 < lines.length) {
                const time3 = parseFloat(lines[ref + 2].getAttribute('data-time') || 0);
                if (time3 - time2 > 0 && time3 - time2 < CFG.fastTransitionThreshold) {
                    return true;
                }
            }
        }
        return false;
    }

    /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
     *  STATE
     * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
    let container = null;
    let pendingDelta = 0;
    let domObserver = null;
    let styleObserver = null;
    let isScriptEnabled = true;
    let resizeTimer = null;
    let suppressTransform = false;
    let lastFlipTime = 0;

    // Deferred delta — tích lũy scroll bị defer khi animation busy
    let deferredDelta = 0;
    let isAnimationBusy = false;

    // Scroll delay — timer chờ trước khi thực hiện scroll
    let scrollDelayTimer = null;
    let delayedDelta = 0;

    // Dynamic Speedup. In glassyflow.js this multiplied dt inside springLoop;
    // here it is the playbackRate applied to every live animation, which has
    // the same effect (playbackRate preserves currentTime, so each spring
    // continues from where it is at the new rate) without cancelling anything.
    let timeScale = 1.0;
    let lastRefIndex = -1;  // refIndex lần cuối, dùng để phát hiện nhảy >= 2 dòng

    // Per-line: { stiffness, damping, mass, anim, baked, delayMs }
    const lineState = new WeakMap();
    let activeLines = new Set();

    // No-sync detection — tự disable khi lyrics tĩnh
    let isNoSyncMode = false;
    let noSyncRetryTimer = null;

    /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
     *  HELPERS
     * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
    function setScrollOverride(enabled) {
        if (!container) return;
        if (enabled) {
            container.style.setProperty('--blyrics-lyric-scroll-duration', '0ms', 'important');
        } else {
            container.style.removeProperty('--blyrics-lyric-scroll-duration');
        }
    }

    function parseTranslateY(val) {
        if (!val || val === 'none') return 0;
        const m = val.match(/translate\(\s*-?[\d.]+px\s*,\s*(-?[\d.]+)px\s*\)/);
        if (m) return parseFloat(m[1]);
        const m2 = val.match(/translateY\(\s*(-?[\d.]+)px\s*\)/);
        if (m2) return parseFloat(m2[1]);
        return 0;
    }

    let _linesCache = { lines: null, ts: 0 };
    const _LINES_CACHE_TTL = 16; // ms — ~1 frame

    function getLines() {
        const now = performance.now();
        if (_linesCache.lines && now - _linesCache.ts < _LINES_CACHE_TTL) {
            return _linesCache.lines;
        }
        if (!container) return [];
        const lines = Array.from(container.querySelectorAll('.blyrics--line, .blyrics-footer'));
        _linesCache = { lines, ts: now };
        return lines;
    }

    function getRefIndex(lines) {
        let preAnimIdx = -1, currentIdx = -1;
        for (let i = 0; i < lines.length; i++) {
            const cl = lines[i].classList;
            if (cl.contains('blyrics--animating')) return i;
            if (preAnimIdx < 0 && cl.contains('blyrics--pre-animating')) preAnimIdx = i;
            if (currentIdx < 0 && cl.contains('blyrics-current-lyric')) currentIdx = i;
        }
        if (preAnimIdx >= 0) return preAnimIdx;
        if (currentIdx >= 0) return currentIdx;
        return Math.floor(lines.length / 5);
    }

    function getOrCreateLineState(line) {
        let data = lineState.get(line);
        if (!data) {
            data = {
                stiffness: CFG.stiffness,
                damping: CFG.damping,
                mass: CFG.mass,
                anim: null,
                baked: null,
                delayMs: 0,
            };
            lineState.set(line, data);
        }
        return data;
    }

    /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
     *  CONTAINER TRANSLATE — giữ nguyên vị trí khi defer
     *
     *  Khi BL set scrollTop nhưng ta defer animation, dùng
     *  container.style.translate (CSS translate property, TÁCH BIỆT với
     *  transform) để bù lại scrollTop change → lines không nhúc nhích.
     *
     *  One write on the container per deferred scroll — not per frame, so this
     *  stays as-is.
     * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
    function setContainerCompensation(delta) {
        if (!container) return;
        if (Math.abs(delta) < 0.5) {
            container.style.translate = '';
        } else {
            container.style.translate = `0px ${delta}px`;
        }
    }

    /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
     *  THE BAKE — spring trajectory → WAAPI keyframes
     *
     *  This replaces springLoop() entirely. There is no rAF loop in this file.
     * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

    /**
     * bakeSpring — solve the spring once, sample it into keyframes.
     *
     * Target is always 0 (lines always settle to their natural position), so
     * the arrival predicate is |pos| < eps && |v| < eps — the same test
     * Spring.arrived() applied in glassyflow.js. Stepping it gives the exact
     * duration the rAF loop would have run for.
     */
    function bakeSpring(from, velocity, stiffness, damping, mass) {
        const solver = _solveSpring(from, velocity, 0, stiffness, damping, mass);
        const getV = _derivative(solver);
        const eps = CFG.arriveEpsilon;

        const STEP = 1 / 120;
        let t = 0;
        while (
            t < CFG.bakeMaxDuration &&
            !(Math.abs(solver(t)) < eps && Math.abs(getV(t)) < eps)
        ) {
            t += STEP;
        }
        const dur = Math.max(STEP, t);

        /* Keyframe density. The compositor interpolates linearly between
         * samples, so the error is the chord-vs-curve gap: |a|/8 * dt^2. Worst
         * case here is a ~50px throw at stiffness 110, giving |a| ≈ 5500px/s²
         * — at 60 samples/sec that is 5500/8 * (1/60)² ≈ 0.19px, comfortably
         * sub-pixel. At 30/sec it would be ~0.76px and visible, which is why
         * this is 60 and not lower. */
        const n = Math.max(8, Math.min(CFG.bakeMaxSamples, Math.round(dur * CFG.bakeSamplesPerSec)));
        const frames = new Array(n + 1);
        for (let i = 0; i <= n; i++) {
            const p = i / n;
            frames[i] = {
                offset: p,
                translate: `0px ${solver(p * dur).toFixed(2)}px`,
            };
        }

        return { frames, durationMs: dur * 1000, solver, getV };
    }

    /**
     * startLine — hand one line's whole trajectory to the compositor.
     *
     * fill:'backwards' does two jobs at once. It holds the first keyframe
     * (= `from`) through the delay phase, replacing both the releaseDelay
     * countdown and the immediate `translate = 0px ${delta}px` write that
     * glassyflow.js needed. And because `backwards` fills only BEFORE the
     * active phase, nothing is filled after it finishes — the element falls
     * back to its base style, which has no translate. That is exactly the
     * arrival state, so arrival needs no cleanup write at all.
     */
    function startLine(line, data, from, velocity, delayMs) {
        // Already home and not moving → nothing to animate.
        if (Math.abs(from) < CFG.arriveEpsilon && Math.abs(velocity) < CFG.arriveEpsilon) {
            retireLine(line, data);
            return;
        }

        const baked = bakeSpring(from, velocity, data.stiffness, data.damping, data.mass);

        const anim = line.animate(baked.frames, {
            duration: baked.durationMs,
            delay: delayMs,
            easing: 'linear',
            fill: 'backwards',
        });
        if (timeScale !== 1.0) anim.playbackRate = timeScale;

        data.anim = anim;
        data.baked = baked;
        data.delayMs = delayMs;

        /* animation.finished REJECTS on cancel() — hence the catch. The
         * identity check stops a cancelled animation's handler from retiring
         * the line that its own replacement is now driving. */
        anim.finished
            .then(() => {
                if (data.anim === anim) retireLine(line, data);
            })
            .catch(() => {});
    }

    /**
     * nudgeLine — the interruption path (Spring.nudge + _resetSolver).
     *
     * Because the trajectory is closed-form, the line's exact position AND
     * velocity at the interruption point are analytically available — no
     * getComputedStyle, no layout read. Re-derive them, add the new delta,
     * cancel, re-bake from there. Motion continues without a discontinuity.
     */
    function nudgeLine(line, data, delta) {
        const anim = data.anim;
        const now = Number(anim.currentTime) || 0;

        /* currentTime already accounts for playbackRate and counts the delay
         * phase, so spring-local time is (currentTime - delayMs). Clamps to 0
         * while the line is still waiting out its stagger. */
        const springT = Math.max(0, now - data.delayMs) / 1000;
        const pos = data.baked.solver(springT) + delta;   // Spring.nudge: pos += delta
        const vel = data.baked.getV(springT);

        /* If the line has not started moving yet, keep waiting out what is
         * left of its stagger — that is what releaseDelay did. (glassyflow.js
         * called _resetSolver() here, which re-solved toward the stale target
         * left by setPosition(); this is the intended behaviour instead.) */
        const remainingDelay = Math.max(0, data.delayMs - now);

        data.anim = null;   // makes the old finished-handler's identity check fail
        anim.cancel();
        startLine(line, data, pos, vel, remainingDelay);
    }

    /** retireLine — a line arrived. No style writes: nothing to undo. */
    function retireLine(line, data) {
        data.anim = null;
        data.baked = null;
        activeLines.delete(line);

        if (activeLines.size === 0) {
            isAnimationBusy = false;
            if (timeScale !== 1.0) {
                if (DEBUG) console.info(
                    `[GlassyFlow Turbo] ⚡ Speedup reset — timeScale ${timeScale} → 1.0`
                );
                timeScale = 1.0;
            }
        }
    }

    /** applyTimeScale — push the current timeScale onto every live animation. */
    function applyTimeScale() {
        for (const line of activeLines) {
            const data = lineState.get(line);
            if (data && data.anim) data.anim.playbackRate = timeScale;
        }
    }

    /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
     *  APPLY STAGGER — start (or re-aim) one animation per line
     * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
    function applyStagger(delta) {
        if (!isScriptEnabled || Math.abs(delta) < CFG.minDelta) return;

        const lines = getLines();
        if (!lines.length) return;

        const ref = getRefIndex(lines);
        const lookBehind = getLookBehind();
        let lookAhead = getLookAhead();

        // ── Delta-Adaptive LookAhead ──
        // Khi scroll delta lớn (ví dụ: chuyển từ 2 dòng lyrics cùng lúc sang
        // 2 dòng tiếp theo), mở rộng lookAhead để cover các line sẽ scroll
        // vào viewport. Extra lines = ceil(|delta| / avgLineHeight).
        if (CFG.deltaAdaptiveEnabled) {
            const avgH = _estimateAvgLineHeight(lines, ref);
            const extraLines = Math.round(Math.abs(delta) / avgH);
            if (extraLines > 1) {
                const baseLookAhead = lookAhead;
                lookAhead = Math.min(lookAhead + extraLines, lines.length - ref);
                if (DEBUG) console.info(
                    `[GlassyFlow Turbo] 🔮 Delta-Adaptive: |delta|=${Math.abs(delta).toFixed(0)}px, ` +
                    `avgH=${avgH.toFixed(0)}px, extra=+${extraLines} → ` +
                    `lookAhead ${baseLookAhead} → ${lookAhead}`
                );
            }
        }

        const start = Math.max(0, ref - lookBehind);
        const end = Math.min(lines.length, ref + lookAhead + 1);

        if (DEBUG) console.info(
            `[GlassyFlow Turbo] applyStagger: delta=${delta.toFixed(1)}px, ` +
            `ref=${ref}, range=[${start},${end}), ` +
            `behind=${lookBehind}, ahead=${lookAhead}, lines=${end - start}`
        );

        let aheadCount = 0;

        const isFast = _checkFastTransition(lines, ref);
        const currentStaggerStep = isFast ? CFG.fastStaggerStep : CFG.staggerStep;
        const currentStiffness = isFast ? CFG.fastStiffness : CFG.stiffness;
        const currentDamping = isFast ? CFG.fastDamping : CFG.damping;
        const currentMass = isFast ? CFG.fastMass : CFG.mass;

        if (DEBUG && isFast) {
            console.info(`[GlassyFlow Turbo] ⚡ Fast Transition triggered (Gap < ${CFG.fastTransitionThreshold}s)`);
        }

        for (let i = start; i < end; i++) {
            const line = lines[i];
            const delay = i >= ref ? (aheadCount++) * currentStaggerStep : 0;

            const data = getOrCreateLineState(line);
            data.stiffness = currentStiffness;
            data.damping = currentDamping;
            data.mass = currentMass;

            if (activeLines.has(line) && data.anim) {
                nudgeLine(line, data, delta);
            } else {
                startLine(line, data, delta, 0, delay);
            }

            // startLine may have retired the line immediately (already home);
            // only track it if it actually has a running animation.
            if (data.anim) activeLines.add(line);
        }

        isAnimationBusy = activeLines.size > 0;
    }

    /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
     *  SCROLL EXECUTION — busy gating
     *
     *  Được gọi khi style observer hoặc scroll fallback detect scroll.
     *  Nếu busy → defer + container compensate.
     *  Nếu rảnh → flush deferred + apply combined delta.
     * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
    function _executeScroll(delta) {
        if (!isScriptEnabled || isNoSyncMode || Math.abs(delta) < CFG.minDelta) return;

        if (isAnimationBusy) {
            // ╔══════════════════════════════════════════════════════════╗
            // ║  BUSY: Defer delta, giữ nguyên vị trí bằng container     ║
            // ║  translate để bù scrollTop change.                       ║
            // ║  + Dynamic Speedup: nếu tích lũy quá nhiều → tua nhanh   ║
            // ╚══════════════════════════════════════════════════════════╝
            deferredDelta += delta;
            setContainerCompensation(deferredDelta);

            const shouldSpeedup = _checkSpeedupCondition();
            if (shouldSpeedup && timeScale < CFG.speedupScale) {
                timeScale = CFG.speedupScale;
                // TUYỆT ĐỐI KHÔNG hủy animation đang chạy — playbackRate
                // preserves currentTime, so each spring just runs faster from
                // wherever it already is.
                applyTimeScale();
                if (DEBUG) console.info(
                    `[GlassyFlow Turbo] ⚡ Dynamic Speedup activated! ` +
                    `timeScale → ${timeScale} ` +
                    `(deferred: ${deferredDelta.toFixed(1)}px)`
                );
            }

            if (DEBUG) console.debug(
                `[GlassyFlow Turbo] Busy — deferred ${delta.toFixed(1)}px ` +
                `(total: ${deferredDelta.toFixed(1)}px, timeScale: ${timeScale})`
            );
        } else {
            // ╔══════════════════════════════════════════════════════════╗
            // ║  RẢNH: Gộp deferred + new delta → 1 spring animation     ║
            // ║  Gỡ container translate trước, rồi apply combined.       ║
            // ╚══════════════════════════════════════════════════════════╝
            const combined = delta + deferredDelta;
            if (DEBUG && Math.abs(deferredDelta) > 0.5) {
                console.info(
                    `[GlassyFlow Turbo] Flushing deferred: ${deferredDelta.toFixed(1)}px ` +
                    `+ new: ${delta.toFixed(1)}px = ${combined.toFixed(1)}px`
                );
            }

            // Gỡ container compensation TRƯỚC khi apply spring
            // (cùng frame, browser không render giữa 2 thao tác)
            deferredDelta = 0;
            setContainerCompensation(0);

            // Cập nhật lastRefIndex cho speedup detection
            const lines = getLines();
            if (lines.length) lastRefIndex = getRefIndex(lines);

            applyStagger(combined);
        }
    }

    /**
     * _checkSpeedupCondition — kiểm tra xem có nên kích hoạt Dynamic Speedup.
     *
     * Trả về true nếu:
     *   - Tổng |deferredDelta| >= CFG.speedupThreshold (cuộn tích lũy quá nhiều)
     *   - HOẶC refIndex hiện tại nhảy >= 2 dòng so với lần cuối
     */
    function _checkSpeedupCondition() {
        if (Math.abs(deferredDelta) >= CFG.speedupThreshold) {
            return true;
        }

        const lines = getLines();
        if (lines.length && lastRefIndex >= 0) {
            const currentRef = getRefIndex(lines);
            if (Math.abs(currentRef - lastRefIndex) >= 2) {
                return true;
            }
        }

        return false;
    }

    /**
     * handleNewDelta — entry point cho mỗi scroll event.
     *
     * Nếu CFG.scrollDelay > 0:
     *   - Tích lũy delta vào delayedDelta
     *   - Dùng container translate để bù scrollTop (giữ nguyên vị trí)
     *   - Reset timer mỗi lần có scroll mới
     *   - Khi timer hết → gỡ compensation + gọi _executeScroll(combined)
     *
     * Nếu CFG.scrollDelay = 0: gọi _executeScroll ngay.
     */
    function handleNewDelta(delta) {
        if (!isScriptEnabled || isNoSyncMode || Math.abs(delta) < CFG.minDelta) return;

        // Không delay → thực hiện ngay
        if (CFG.scrollDelay <= 0) {
            _executeScroll(delta);
            return;
        }

        // ── Có delay: tích lũy + debounce ──
        delayedDelta += delta;
        setContainerCompensation(delayedDelta + deferredDelta);

        if (DEBUG) console.debug(
            `[GlassyFlow Turbo] Delay queued ${delta.toFixed(1)}px ` +
            `(pending: ${delayedDelta.toFixed(1)}px, wait: ${CFG.scrollDelay}ms)`
        );

        // Reset timer
        if (scrollDelayTimer !== null) {
            clearTimeout(scrollDelayTimer);
        }

        scrollDelayTimer = setTimeout(() => {
            scrollDelayTimer = null;
            const totalDelayed = delayedDelta;
            delayedDelta = 0;

            // Gỡ compensation cho phần delayed (deferred vẫn giữ nếu busy)
            setContainerCompensation(deferredDelta);

            if (DEBUG) console.debug(
                `[GlassyFlow Turbo] Delay fired — executing ${totalDelayed.toFixed(1)}px`
            );

            _executeScroll(totalDelayed);
        }, CFG.scrollDelay);
    }

    /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
     *  STYLE OBSERVER — theo dõi BL's FLIP transform
     * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
    function installStyleObserver(el) {
        styleObserver?.disconnect();

        let lastTransform = el.style.transform || '';

        styleObserver = new MutationObserver(() => {
            if (!isScriptEnabled || suppressTransform) return;

            const transformVal = el.style.transform;
            if (transformVal === lastTransform) return;

            // Early return: BL đôi khi chỉ thay đổi transition/style khác
            // mà không đổi transform → skip nhanh
            if (!transformVal || transformVal === 'none') {
                // transform bị clear (BL set 'none' hoặc remove)
                // Chỉ xử lý nếu đang có pendingDelta
                if (pendingDelta !== 0) {
                    lastTransform = transformVal;
                    const delta = pendingDelta;
                    pendingDelta = 0;

                    suppressTransform = true;
                    el.style.transition = 'none';
                    el.style.transform = 'none';
                    lastTransform = 'none';
                    suppressTransform = false;

                    handleNewDelta(delta);
                    lastFlipTime = Date.now();
                } else {
                    lastTransform = transformVal;
                }
                return;
            }

            lastTransform = transformVal;
            const y = parseTranslateY(transformVal);

            if (Math.abs(y) > CFG.minDelta) {
                // FLIP Step 2 — BL set offset transform
                pendingDelta = y;
                suppressTransform = true;
                el.style.transform = 'translate(0px, 0px)';
                lastTransform = 'translate(0px, 0px)';
                suppressTransform = false;
            } else if (pendingDelta !== 0) {
                // FLIP Step 5 — BL animate to 0
                const delta = pendingDelta;
                pendingDelta = 0;

                suppressTransform = true;
                el.style.transition = 'none';
                el.style.transform = 'none';
                lastTransform = 'none';
                suppressTransform = false;

                handleNewDelta(delta);
                lastFlipTime = Date.now();
            }
        });

        styleObserver.observe(el, {
            attributes: true,
            attributeFilter: ['style'],
        });

        console.info('[GlassyFlow Turbo] Style observer installed on', el);
    }

    /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
     *  SCROLL FALLBACK
     * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
    let scrollParent = null;
    let scrollHandler = null;
    let lastScrollTop = 0;

    function installScrollFallback(el) {
        removeScrollFallback();
        scrollParent = findScrollParent(el);
        if (!scrollParent) return;
        lastScrollTop = scrollParent.scrollTop;

        scrollHandler = () => {
            const cur = scrollParent.scrollTop;
            const delta = cur - lastScrollTop;
            lastScrollTop = cur;

            if (pendingDelta !== 0) return;
            if (Date.now() - lastFlipTime < 150) return;
            if (container && container.classList.contains('blyrics-user-scrolling')) return;

            if (Math.abs(delta) > CFG.minDelta) {
                handleNewDelta(delta);
            }
        };

        scrollParent.addEventListener('scroll', scrollHandler, { passive: true });
    }

    function removeScrollFallback() {
        if (scrollParent && scrollHandler) {
            scrollParent.removeEventListener('scroll', scrollHandler);
        }
        scrollParent = null;
        scrollHandler = null;
    }

    function findScrollParent(el) {
        let p = el.parentElement;
        while (p && p !== document.documentElement) {
            const { overflow, overflowY } = getComputedStyle(p);
            if (/(auto|scroll)/.test(overflow + overflowY)) return p;
            p = p.parentElement;
        }
        return null;
    }

    /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
     *  CONTAINER LIFECYCLE
     * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
    function attach(el) {
        if (el === container) return;
        console.info('[GlassyFlow Turbo] Attaching to new container', el);
        cleanupAllSprings();

        container = el;
        el.classList.add('blyrics--gf-managed');
        pendingDelta = 0;
        deferredDelta = 0;
        isAnimationBusy = false;
        timeScale = 1.0;
        lastRefIndex = -1;

        installStyleObserver(el);
        installScrollFallback(el);
        setScrollOverride(true);

        // No-sync detection: đợi rồi check
        startNoSyncDetection(el);
    }

    function boot() {
        console.info('[GlassyFlow Turbo] Booting compositor spring scroll...');
        const existing = document.querySelector('.blyrics-container');
        if (existing) attach(existing);

        domObserver?.disconnect();
        let domCheckQueued = false;
        // Narrow scope: observe #side-panel thay vì toàn bộ body
        const observeTarget = document.querySelector('#side-panel') || document.body;
        domObserver = new MutationObserver(() => {
            if (domCheckQueued) return;
            domCheckQueued = true;
            queueMicrotask(() => {
                domCheckQueued = false;
                const el = observeTarget.querySelector('.blyrics-container');
                if (el && el !== container) {
                    console.info('[GlassyFlow Turbo] New container detected (song change)');
                    attach(el);
                }
            });
        });
        domObserver.observe(observeTarget, { childList: true, subtree: true });
    }

    /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
     *  CLEANUP HELPER
     *
     *  Name kept from glassyflow.js so the two files stay comparable. Cancels
     *  live animations rather than clearing inline styles — the inline clears
     *  are kept only as belt-and-braces against leftover state.
     * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
    function cleanupAllSprings() {
        _linesCache = { lines: null, ts: 0 };

        for (const line of activeLines) {
            const data = lineState.get(line);
            if (data && data.anim) {
                const anim = data.anim;
                // Null it FIRST so the pending finished-handler's identity
                // check fails and retireLine never runs against stale state.
                data.anim = null;
                data.baked = null;
                anim.cancel();
            }
            line.style.translate = '';
            line.style.willChange = '';
        }
        activeLines.clear();

        if (scrollDelayTimer !== null) {
            clearTimeout(scrollDelayTimer);
            scrollDelayTimer = null;
        }
        isAnimationBusy = false;
        deferredDelta = 0;
        delayedDelta = 0;
        timeScale = 1.0;
        lastRefIndex = -1;
        setContainerCompensation(0);
    }

    /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
     *  NO-SYNC DETECTION — disable khi lyrics tĩnh
     *
     *  BetterLyrics luôn đặt `data-time` và `data-duration` trên mỗi dòng:
     *    - Synced: data-duration có giá trị thực (≠ "0")
     *    - Static: data-duration = "0" cho TẤT CẢ dòng
     * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

    function setNoSyncState(enabled) {
        if (isNoSyncMode === enabled) return;
        isNoSyncMode = enabled;
        if (enabled) {
            // Disable scroll: cho BL tự scroll bình thường
            setScrollOverride(false);
            cleanupAllSprings();
            if (container) container.classList.remove('blyrics--gf-managed');
            console.info('[GlassyFlow Turbo] 🔇 No-sync detected (all lines data-duration=0) — spring scroll disabled.');
        } else {
            // Re-enable scroll
            setScrollOverride(true);
            if (container) container.classList.add('blyrics--gf-managed');
            console.info('[GlassyFlow Turbo] 🎵 Synced lyrics detected (data-duration > 0 found) — spring scroll re-enabled.');
        }
    }

    function startNoSyncDetection(el) {
        // Cleanup previous retry timer
        if (noSyncRetryTimer !== null) {
            clearTimeout(noSyncRetryTimer);
            noSyncRetryTimer = null;
        }
        isNoSyncMode = false;

        // One-shot check: data-duration được BL set 1 lần khi inject lyrics,
        // không bao giờ thay đổi. Khi đổi bài, BL tạo container mới →
        // domObserver detect → attach() → startNoSyncDetection() lại.
        const _check = () => {
            if (!el.isConnected || el !== container) return;
            const lines = el.querySelectorAll('.blyrics--line');
            if (lines.length === 0) {
                // Lines chưa inject — retry sau 500ms
                noSyncRetryTimer = setTimeout(_check, 500);
                return;
            }
            const hasSynced = el.querySelector('.blyrics--line[data-duration]:not([data-duration="0"])');
            setNoSyncState(!hasSynced);
        };
        _check();
    }

    /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
     *  SPA NAVIGATION
     * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
    window.addEventListener('yt-navigate-finish', () => {
        container = null;
        pendingDelta = 0;
        deferredDelta = 0;
        delayedDelta = 0;
        isAnimationBusy = false;
        timeScale = 1.0;
        lastRefIndex = -1;
        _lastMarkedActive = -1;
        _linesCache = { lines: null, ts: 0 };
        if (scrollDelayTimer !== null) {
            clearTimeout(scrollDelayTimer);
            scrollDelayTimer = null;
        }
        if (noSyncRetryTimer !== null) {
            clearTimeout(noSyncRetryTimer);
            noSyncRetryTimer = null;
        }
        styleObserver?.disconnect();
        removeScrollFallback();
        cleanupAllSprings();
        boot();
    });

    /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
     *  INIT
     * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }

    /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
     *  RESIZE RECOVERY
     * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
    window.addEventListener('resize', () => {
        isScriptEnabled = false;
        pendingDelta = 0;
        deferredDelta = 0;
        delayedDelta = 0;
        isAnimationBusy = false;
        timeScale = 1.0;
        lastRefIndex = -1;
        _viewportCache.ts = 0; // Invalidate → recalculate lookBehind/lookAhead after resize
        _avgLineHeightCache.ts = 0; // Invalidate → recalculate avg line height after resize
        if (scrollDelayTimer !== null) {
            clearTimeout(scrollDelayTimer);
            scrollDelayTimer = null;
        }
        setScrollOverride(false);
        cleanupAllSprings();
        if (container) container.classList.remove('blyrics--gf-managed');

        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            isScriptEnabled = true;
            setScrollOverride(true);
            if (container && !isNoSyncMode) {
                container.classList.add('blyrics--gf-managed');
            }
            console.info('[GlassyFlow Turbo] Re-enabled after resize.');
        }, 1500);
    });
})();
