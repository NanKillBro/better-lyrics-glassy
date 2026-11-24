/**
 * GlassyFlow Super — GPU-composited WAAPI spring scroll with LTI wave superposition.
 *
 * Overlapping scroll waves are summed analytically (released waves fold into a
 * single base spring; unreleased staggered waves hold in pending[]) and baked
 * into one replace-mode WAAPI translate animation per line, updated in place
 * via setKeyframes()/updateTiming(). No busy gating, deferred delta, speedup,
 * or container compensation writes.
 */
(function () {
    'use strict';

    if (window.__glassyFlowSuperInstalled || window.__glassyFlowTurboInstalled) {
        console.warn('[GlassyFlow Super] Already installed — skipping duplicate injection.');
        return;
    }
    window.__glassyFlowSuperInstalled = true;
    window.__glassyFlowTurboInstalled = true;

    function _solveSpringPair(from, velocity, to, stiffness, damping, mass) {
        const delta = to - from;
        if (damping * damping >= 4.0 * stiffness * mass) {
            const angFreq = -Math.sqrt(stiffness / mass);
            const leftover = -angFreq * delta - velocity;
            return {
                solver: (t) => {
                    if (t < 0) return from;
                    return to - (delta + t * leftover) * Math.exp(t * angFreq);
                },
                getV: (t) => {
                    if (t < 0) return 0;
                    return -(leftover + angFreq * (delta + t * leftover)) * Math.exp(t * angFreq);
                },
            };
        }
        const dampFreq = Math.sqrt(4.0 * mass * stiffness - damping * damping);
        const leftover = (damping * delta - 2.0 * mass * velocity) / dampFreq;
        const dfm = (0.5 * dampFreq) / mass;
        const dm = -(0.5 * damping) / mass;
        const vCos = dm * delta + dfm * leftover;
        const vSin = dm * leftover - dfm * delta;
        return {
            solver: (t) => {
                if (t < 0) return from;
                return (
                    to -
                    (Math.cos(t * dfm) * delta + Math.sin(t * dfm) * leftover) *
                    Math.exp(t * dm)
                );
            },
            getV: (t) => {
                if (t < 0) return 0;
                return (
                    -(Math.cos(t * dfm) * vCos + Math.sin(t * dfm) * vSin) *
                    Math.exp(t * dm)
                );
            },
        };
    }

    const DEBUG = false;

    const CFG = {
        staggerStep: 40,
        lookBehindRatio: 0.50,
        lookAheadRatio: 0.70,
        lookBehindMin: 5,
        lookBehindMax: 15,
        lookAheadMin: 4,
        lookAheadMax: 25,
        minDelta: 2,
        stiffness: 110,
        damping: 15,
        mass: 1,
        scrollDelay: 240,
        deltaAdaptiveEnabled: true,
        staggerScaleLines: 2.5,
        largeJumpViewportRatio: 0.75,
        attachSnapWindowMs: 600,
        avgLineHeightFallback: 48,
        arriveEpsilon: 0.1,
        bakeSamplesPerSec: 60,
        bakeMaxSamples: 80,
        bakeLargeDeltaSamples: 100,
        bakeMaxDuration: 4,
    };

    let _viewportCache = { visibleLines: 14, ts: 0 };
    const _VIEWPORT_CACHE_TTL = 500;

    let tabRenderer = null;
    let _vpEl = null;
    let _vp = { h: 0, top: 0, bottom: 0, innerH: 0 };
    let _lineGeom = new WeakMap();
    const _observedLines = new Set();
    let _lineGeomRO = null;
    let _vpRO = null;

    if (typeof ResizeObserver !== 'undefined') {
        _lineGeomRO = new ResizeObserver(entries => {
            for (const entry of entries) {
                const target = entry.target;
                let geom = _lineGeom.get(target);
                if (!geom) {
                    const style = getComputedStyle(target);
                    geom = {
                        h: undefined,
                        mt: parseFloat(style.marginTop) || 0,
                        mb: parseFloat(style.marginBottom) || 0,
                    };
                    _lineGeom.set(target, geom);
                }
                const box = entry.borderBoxSize && entry.borderBoxSize[0];
                geom.h = Math.round(box ? box.blockSize : entry.contentRect.height);
            }
        });
        _vpRO = new ResizeObserver(entries => {
            for (const entry of entries) {
                if (entry.target === _vpEl) {
                    _vp = _readViewport(_vpEl);
                    break;
                }
            }
        });
    }

    function _measureTarget(lineEl) {
        if (lineEl.classList.contains('blyrics--line')) {
            const parent = lineEl.parentElement;
            if (parent && parent !== container) return parent;
        }
        return lineEl;
    }

    function _observeLineTarget(target) {
        if (!_lineGeomRO || _observedLines.has(target)) return;
        _observedLines.add(target);
        _lineGeomRO.observe(target);
    }

    function _syncLineTargets(lines) {
        if (!_lineGeomRO) return;
        const current = new Set();
        for (const line of lines) {
            const target = _measureTarget(line);
            current.add(target);
            _observeLineTarget(target);
        }
        for (const target of _observedLines) {
            if (!current.has(target)) {
                _lineGeomRO.unobserve(target);
                _observedLines.delete(target);
                _lineGeom.delete(target);
            }
        }
    }

    function _readViewport(el) {
        if (!el) return { h: 0, top: 0, bottom: 0, innerH: window.innerHeight };
        const rect = el.getBoundingClientRect();
        return {
            h: el.clientHeight,
            top: rect.top,
            bottom: rect.bottom,
            innerH: window.innerHeight,
        };
    }

    function _getViewportElement() {
        if (tabRenderer && !tabRenderer.isConnected) {
            tabRenderer =
                container?.closest('ytmusic-tab-renderer[page-type="MUSIC_PAGE_TYPE_TRACK_LYRICS"]') ||
                container?.closest('ytmusic-tab-renderer') ||
                document.querySelector('ytmusic-tab-renderer[page-type="MUSIC_PAGE_TYPE_TRACK_LYRICS"]');
        }
        return tabRenderer || scrollParent || container;
    }

    function _refreshViewportElement() {
        const el = _getViewportElement();
        if (!el) return false;
        if (el !== _vpEl) {
            if (_vpRO && _vpEl) _vpRO.unobserve(_vpEl);
            _vpEl = el;
            if (_vpRO) _vpRO.observe(el);
        }
        _vp = _readViewport(el);
        return true;
    }

    function _getLineFullHeight(lineEl) {
        const target = _measureTarget(lineEl);
        const geom = _lineGeom.get(target);
        if (geom && geom.h !== undefined) {
            return geom.h > 0 ? geom.h + geom.mt + geom.mb : 0;
        }

        const oh = target.offsetHeight;
        if (oh <= 0) {
            _lineGeom.set(target, { h: 0, mt: 0, mb: 0 });
            _observeLineTarget(target);
            return 0;
        }
        const style = getComputedStyle(target);
        const targetGeom = {
            h: oh,
            mt: parseFloat(style.marginTop) || 0,
            mb: parseFloat(style.marginBottom) || 0,
        };
        _lineGeom.set(target, targetGeom);
        _observeLineTarget(target);
        return oh + targetGeom.mt + targetGeom.mb;
    }

    function _getEffectiveViewportHeight() {
        if (!container) return 0;

        if (!_vp.h || _vp.innerH !== window.innerHeight || _vpEl !== _getViewportElement()) {
            if (!_refreshViewportElement()) return 0;
        }

        let viewportH = _vp.h;
        if (viewportH <= 0) return 0;

        const visibleTop = Math.max(_vp.top, 0);
        const visibleBottom = Math.min(_vp.bottom, _vp.innerH);
        const actualVisibleH = visibleBottom - visibleTop;
        if (actualVisibleH > 0 && actualVisibleH < viewportH) {
            viewportH = actualVisibleH;
        }
        return viewportH;
    }

    function _measureVisibleLines() {
        const now = Date.now();
        if (now - _viewportCache.ts < _VIEWPORT_CACHE_TTL) {
            return _viewportCache.visibleLines;
        }

        const viewportH = _getEffectiveViewportHeight();
        if (viewportH <= 0) {
            return _viewportCache.visibleLines;
        }

        const lines = getLines();
        if (!lines.length) return _viewportCache.visibleLines;

        const ref = getRefIndex(lines);

        let accH = 0, countFwd = 0;
        for (let i = ref; i < lines.length; i++) {
            const h = _getLineFullHeight(lines[i]);
            if (h <= 0) continue;
            countFwd++;
            accH += h;
            if (accH >= viewportH) break;
        }

        accH = 0;
        let countBwd = 0;
        for (let i = ref - 1; i >= 0; i--) {
            const h = _getLineFullHeight(lines[i]);
            if (h <= 0) continue;
            countBwd++;
            accH += h;
            if (accH >= viewportH) break;
        }

        const visible = Math.max(countFwd, countBwd + 1, 4);
        _viewportCache = { visibleLines: visible, ts: now };
        return visible;
    }

    let _avgLineHeightCache = { value: 48, ts: 0 };

    function _estimateAvgLineHeight(lines, ref) {
        const now = Date.now();
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

    let container = null;
    let pendingDelta = 0;
    let domObserver = null;
    let styleObserver = null;
    let isScriptEnabled = true;
    let resizeTimer = null;
    let suppressTransform = false;
    let lastFlipTime = 0;
    let attachedAt = 0;
    let initialScrollTop = 0;
    let _domObserverTarget = null;

    const lineState = new WeakMap();
    const activeLines = new Set();

    let isNoSyncMode = false;
    let noSyncRetryTimer = null;

    function setScrollOverride(enabled) {
        if (!container) return;
        if (enabled) {
            if (container.style.getPropertyValue('--blyrics-lyric-scroll-duration') !== '0ms') {
                container.style.setProperty('--blyrics-lyric-scroll-duration', '0ms', 'important');
            }
            if (container.style.getPropertyValue('--blyrics-animate-scroll') !== '0') {
                container.style.setProperty('--blyrics-animate-scroll', '0', 'important');
            }
            if (document.documentElement.style.getPropertyValue('--blyrics-animate-scroll') !== '0') {
                document.documentElement.style.setProperty('--blyrics-animate-scroll', '0', 'important');
            }
        } else {
            if (container.style.getPropertyValue('--blyrics-lyric-scroll-duration')) {
                container.style.removeProperty('--blyrics-lyric-scroll-duration');
            }
            if (container.style.getPropertyValue('--blyrics-animate-scroll')) {
                container.style.removeProperty('--blyrics-animate-scroll');
            }
            if (document.documentElement.style.getPropertyValue('--blyrics-animate-scroll')) {
                document.documentElement.style.removeProperty('--blyrics-animate-scroll');
            }
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

    let _linesCache = { lines: null };
    let _linesObserver = null;

    function _refreshLines() {
        if (!container) {
            _linesCache.lines = [];
            return [];
        }
        const lines = Array.from(container.querySelectorAll('.blyrics--line, .blyrics-footer, .blyrics-credits'));
        _linesCache.lines = lines;
        _syncLineTargets(lines);
        return lines;
    }

    function getLines() {
        if (!_linesCache.lines) return _refreshLines();
        return _linesCache.lines;
    }

    function _installLinesObserver(el) {
        _linesObserver?.disconnect();
        _linesObserver = new MutationObserver(() => {
            _linesCache.lines = null;
        });
        _linesObserver.observe(el, { childList: true, subtree: true });
    }

    function getRefIndex(lines) {
        let animIdx = -1;
        for (let i = 0; i < lines.length; i++) {
            const cl = lines[i].classList;
            if (cl.contains('blyrics--active')) return i;
            if (animIdx < 0 && cl.contains('blyrics--animating')) animIdx = i;
        }
        if (animIdx >= 0) return animIdx;
        if (lastScrollTop === null || lastScrollTop <= 1) return 0;
        const vpH = _getEffectiveViewportHeight();
        const targetY = lastScrollTop + (vpH > 0 ? vpH * 0.35 : 200);
        let acc = 0;
        for (let i = 0; i < lines.length; i++) {
            const h = _getLineFullHeight(lines[i]);
            acc += h > 0 ? h : CFG.avgLineHeightFallback;
            if (acc >= targetY) return i;
        }
        return Math.max(0, lines.length - 1);
    }

    function getOrCreateLineState(line) {
        let data = lineState.get(line);
        if (!data) {
            data = {
                stiffness: CFG.stiffness,
                damping: CFG.damping,
                mass: CFG.mass,
                anim: null,
                tOriginMs: 0,
                base: null,
                pending: [],
            };
            lineState.set(line, data);
        }
        return data;
    }

    function _findSpringSettleDuration(solver, getV) {
        const eps = CFG.arriveEpsilon;
        const STEP = 1 / 120;
        let t = 0;
        while (
            t < CFG.bakeMaxDuration &&
            !(Math.abs(solver(t)) < eps && Math.abs(getV(t)) < eps)
        ) {
            t += STEP;
        }
        return Math.max(STEP, t);
    }

    function _createWaveComponent(amp, vel, tRelease, stiffness, damping, mass) {
        const { solver, getV } = _solveSpringPair(amp, vel, 0, stiffness, damping, mass);
        const settleDur = _findSpringSettleDuration(solver, getV);
        return { amp, vel, tRelease, solver, getV, settleDur };
    }

    function _evalLinePos(data, t) {
        let sum = 0;
        const base = data.base;
        if (base) {
            const dt = t - base.tRelease;
            if (dt <= base.settleDur) {
                sum += base.solver(Math.max(0, dt));
            }
        }
        const pending = data.pending;
        for (let i = 0; i < pending.length; i++) {
            const c = pending[i];
            if (t < c.tRelease) {
                sum += c.amp;
            } else {
                const dt = t - c.tRelease;
                if (dt <= c.settleDur) {
                    sum += c.solver(dt);
                }
            }
        }
        return sum;
    }

    function _evalLineVel(data, t) {
        let sum = 0;
        const base = data.base;
        if (base) {
            const dt = t - base.tRelease;
            if (dt >= 0 && dt <= base.settleDur) {
                sum += base.getV(dt);
            }
        }
        const pending = data.pending;
        for (let i = 0; i < pending.length; i++) {
            const c = pending[i];
            if (t >= c.tRelease) {
                const dt = t - c.tRelease;
                if (dt <= c.settleDur) {
                    sum += c.getV(dt);
                }
            }
        }
        return sum;
    }

    function _foldReleasedWaves(data, elapsedSec) {
        let pos = 0;
        let vel = 0;
        let hadReleased = false;

        if (data.base) {
            const dt = Math.max(0, elapsedSec - data.base.tRelease);
            if (dt < data.base.settleDur) {
                pos += data.base.solver(dt);
                vel += data.base.getV(dt);
                hadReleased = true;
            }
            data.base = null;
        }

        const remaining = [];
        for (let i = 0; i < data.pending.length; i++) {
            const c = data.pending[i];
            if (c.tRelease <= elapsedSec + 0.0005) {
                const dt = Math.max(0, elapsedSec - c.tRelease);
                if (dt < c.settleDur) {
                    pos += c.solver(dt);
                    vel += c.getV(dt);
                    hadReleased = true;
                }
            } else {
                remaining.push(c);
            }
        }
        data.pending = remaining;

        const eps = CFG.arriveEpsilon;
        if (hadReleased && (Math.abs(pos) >= eps || Math.abs(vel) >= eps)) {
            data.base = _createWaveComponent(
                pos,
                vel,
                elapsedSec,
                data.stiffness,
                data.damping,
                data.mass
            );
        }
    }

    function _bakeSuperposition(data, elapsedSec) {
        const eps = CFG.arriveEpsilon;
        let searchStart = elapsedSec;
        let maxEndBound = elapsedSec + CFG.bakeMaxDuration;
        if (data.base) {
            maxEndBound = Math.max(maxEndBound, data.base.tRelease + data.base.settleDur);
        }
        for (let i = 0; i < data.pending.length; i++) {
            const c = data.pending[i];
            if (c.tRelease > searchStart) searchStart = c.tRelease;
            const cEnd = c.tRelease + c.settleDur;
            if (cEnd > maxEndBound) maxEndBound = cEnd;
        }

        const STEP = 1 / 120;
        let tSettle = searchStart;
        while (
            tSettle < maxEndBound &&
            !(Math.abs(_evalLinePos(data, tSettle)) < eps && Math.abs(_evalLineVel(data, tSettle)) < eps)
        ) {
            tSettle += STEP;
        }
        const tEnd = Math.max(elapsedSec + STEP, tSettle);

        let motionStart = elapsedSec;
        if (!data.base && data.pending.length > 0) {
            let minRel = Infinity;
            for (let i = 0; i < data.pending.length; i++) {
                if (data.pending[i].tRelease < minRel) minRel = data.pending[i].tRelease;
            }
            if (minRel > elapsedSec) motionStart = minRel;
        }

        const activeSpan = Math.max(STEP, tEnd - motionStart);
        const startY = _evalLinePos(data, elapsedSec);
        const maxSamples = Math.abs(startY) > 300 ? CFG.bakeLargeDeltaSamples : CFG.bakeMaxSamples;
        const rawCount = Math.max(8, Math.min(maxSamples, Math.round(activeSpan * CFG.bakeSamplesPerSec)));
        const dt = activeSpan / rawCount;

        const timeSet = new Set();
        timeSet.add(0);
        if (elapsedSec > 0.0005) {
            timeSet.add(elapsedSec);
        }
        for (let i = 0; i < data.pending.length; i++) {
            const tr = data.pending[i].tRelease;
            if (tr > elapsedSec && tr < tEnd) {
                timeSet.add(tr);
            }
        }
        for (let i = 0; i <= rawCount; i++) {
            const t = motionStart + i * dt;
            if (t >= elapsedSec && t <= tEnd) {
                timeSet.add(t);
            }
        }
        timeSet.add(tEnd);

        const times = Array.from(timeSet).sort((a, b) => a - b);
        const cleanTimes = [times[0]];
        for (let i = 1; i < times.length; i++) {
            if (times[i] - cleanTimes[cleanTimes.length - 1] >= 0.0002) {
                cleanTimes.push(times[i]);
            }
        }
        if (cleanTimes[cleanTimes.length - 1] !== tEnd) {
            cleanTimes[cleanTimes.length - 1] = tEnd;
        }

        const frames = new Array(cleanTimes.length);
        for (let i = 0; i < cleanTimes.length; i++) {
            const t = cleanTimes[i];
            const p = i === 0 ? 0 : (i === cleanTimes.length - 1 ? 1 : t / tEnd);
            const y = t < elapsedSec ? startY : _evalLinePos(data, t);
            frames[i] = {
                offset: p,
                translate: `0px ${y.toFixed(2)}px`,
            };
        }

        return { frames, durationMs: tEnd * 1000 };
    }

    function retireLine(line, data) {
        data.anim = null;
        data.base = null;
        data.pending.length = 0;
        data.tOriginMs = 0;
        activeLines.delete(line);
    }

    function _pushWaveComponent(data, delta, elapsedSec, totalDelaySec, stiffness, damping, mass) {
        const tRelease = elapsedSec + totalDelaySec;
        if (totalDelaySec <= 0.0005) {
            const curPos = (data.base ? data.base.solver(0) : 0) + delta;
            const curVel = data.base ? data.base.getV(0) : 0;
            if (Math.abs(curPos) >= CFG.arriveEpsilon || Math.abs(curVel) >= CFG.arriveEpsilon) {
                data.base = _createWaveComponent(
                    curPos,
                    curVel,
                    elapsedSec,
                    stiffness,
                    damping,
                    mass
                );
            } else {
                data.base = null;
            }
        } else if (
            data.pending.length > 0 &&
            Math.abs(data.pending[data.pending.length - 1].tRelease - tRelease) < 0.008
        ) {
            const last = data.pending[data.pending.length - 1];
            const mergedAmp = last.amp + delta;
            if (Math.abs(mergedAmp) >= CFG.arriveEpsilon) {
                data.pending[data.pending.length - 1] = _createWaveComponent(
                    mergedAmp,
                    0,
                    last.tRelease,
                    stiffness,
                    damping,
                    mass
                );
            } else {
                data.pending.pop();
            }
        } else {
            data.pending.push(
                _createWaveComponent(
                    delta,
                    0,
                    tRelease,
                    stiffness,
                    damping,
                    mass
                )
            );
        }
    }

    function applyLineWave(
        line,
        data,
        delta,
        totalDelayMs,
        nowTimeline,
        sharedIdleBakeCache,
        stiffness,
        damping,
        mass,
        collapsePending
    ) {
        const totalDelaySec = totalDelayMs / 1000;
        const hasRunningAnim =
            activeLines.has(line) &&
            data.anim &&
            data.anim.playState === 'running';

        let elapsedSec = 0;
        if (hasRunningAnim) {
            const rawCurrent = data.anim.currentTime;
            const animCurrentMs = rawCurrent !== null ? Number(rawCurrent) : NaN;
            elapsedSec = Number.isFinite(animCurrentMs) && animCurrentMs >= 0
                ? animCurrentMs / 1000
                : Math.max(0, (nowTimeline - data.tOriginMs) / 1000);

            let shouldCollapse = collapsePending;
            if (!shouldCollapse && data.pending.length > 0) {
                for (let i = 0; i < data.pending.length; i++) {
                    const c = data.pending[i];
                    if (c.tRelease > elapsedSec + 0.0005 && c.amp * delta < 0) {
                        shouldCollapse = true;
                        break;
                    }
                }
            }

            data.stiffness = stiffness;
            data.damping = damping;
            data.mass = mass;

            if (shouldCollapse) {
                const curPos = _evalLinePos(data, elapsedSec) + delta;
                const curVel = _evalLineVel(data, elapsedSec);
                data.base = null;
                data.pending.length = 0;
                if (Math.abs(curPos) >= CFG.arriveEpsilon || Math.abs(curVel) >= CFG.arriveEpsilon) {
                    if (Math.abs(curVel) >= CFG.arriveEpsilon || totalDelaySec <= 0.0005) {
                        data.base = _createWaveComponent(curPos, curVel, elapsedSec, stiffness, damping, mass);
                    } else {
                        data.pending.push(
                            _createWaveComponent(curPos, 0, elapsedSec + totalDelaySec, stiffness, damping, mass)
                        );
                    }
                }
            } else {
                _foldReleasedWaves(data, elapsedSec);
                _pushWaveComponent(data, delta, elapsedSec, totalDelaySec, stiffness, damping, mass);
            }
        } else {
            if (data.anim) {
                const stale = data.anim;
                data.anim = null;
                stale.cancel();
            }
            data.base = null;
            data.pending.length = 0;
            data.tOriginMs = nowTimeline;
            data.stiffness = stiffness;
            data.damping = damping;
            data.mass = mass;
            _pushWaveComponent(data, delta, 0, totalDelaySec, stiffness, damping, mass);
        }

        if (!data.base && data.pending.length === 0) {
            if (data.anim) {
                const old = data.anim;
                data.anim = null;
                old.cancel();
            }
            retireLine(line, data);
            return;
        }

        let baked = null;
        if (!hasRunningAnim && sharedIdleBakeCache && totalDelayMs === sharedIdleBakeCache.delayMs) {
            if (!sharedIdleBakeCache.baked) {
                sharedIdleBakeCache.baked = _bakeSuperposition(data, 0);
            }
            baked = sharedIdleBakeCache.baked;
        } else {
            baked = _bakeSuperposition(data, elapsedSec);
        }

        if (hasRunningAnim && data.anim?.effect && typeof data.anim.effect.setKeyframes === 'function') {
            data.anim.effect.setKeyframes(baked.frames);
            data.anim.effect.updateTiming({
                duration: baked.durationMs,
                delay: 0,
                easing: 'linear',
                fill: 'backwards',
            });
            activeLines.add(line);
            return;
        }

        const anim = line.animate(baked.frames, {
            duration: baked.durationMs,
            delay: 0,
            easing: 'linear',
            fill: 'backwards',
        });
        try {
            anim.startTime = nowTimeline;
        } catch (_) {}

        data.anim = anim;
        activeLines.add(line);

        anim.finished
            .then(() => {
                if (data.anim === anim) retireLine(line, data);
            })
            .catch(() => {});
    }

    function _computeScrollRange(lines, ref, delta, viewportH) {
        const baseAbovePx = viewportH * 0.55;
        const baseBelowPx = viewportH * 0.75;
        const extraAbovePx = CFG.deltaAdaptiveEnabled && delta > 0 ? delta : 0;
        const extraBelowPx = CFG.deltaAdaptiveEnabled && delta < 0 ? -delta : 0;

        let start = ref;
        let accAbove = 0;
        const needAboveBase = baseAbovePx + extraAbovePx;
        while (start > 0 && (accAbove < needAboveBase || ref - start < CFG.lookBehindMin)) {
            if (accAbove === 0 && ref - start >= CFG.lookBehindMax) break;
            start--;
            const h = _getLineFullHeight(lines[start]);
            if (h > 0) accAbove += h;
        }
        const shortfallAbove = Math.max(0, baseAbovePx - accAbove);

        let end = ref + 1;
        let accBelow = 0;
        const needBelow = baseBelowPx + shortfallAbove + extraBelowPx;
        while (end < lines.length && (accBelow < needBelow || end - ref - 1 < CFG.lookAheadMin)) {
            if (accBelow === 0 && end - ref - 1 >= CFG.lookAheadMax) break;
            const h = _getLineFullHeight(lines[end]);
            if (h > 0) accBelow += h;
            end++;
        }
        const shortfallBelow = Math.max(0, baseBelowPx - accBelow);
        if (shortfallBelow > 0 && start > 0 && accAbove > 0) {
            const needMoreAbove = needAboveBase + shortfallBelow;
            while (start > 0 && accAbove < needMoreAbove) {
                start--;
                const h = _getLineFullHeight(lines[start]);
                if (h > 0) accAbove += h;
            }
        }
        return { start, end };
    }

    function applyStagger(delta) {
        if (!isScriptEnabled || Math.abs(delta) < CFG.minDelta) return;

        const lines = getLines();
        if (!lines.length) return;

        const viewportH = _getEffectiveViewportHeight() || (_measureVisibleLines() * CFG.avgLineHeightFallback);
        const absDelta = Math.abs(delta);

        // Snap song-switch initial scroll positioning instead of sweeping new lines across the viewport.
        if (Date.now() - attachedAt < CFG.attachSnapWindowMs) {
            const isInitialReset = initialScrollTop > CFG.minDelta && delta < 0;
            const isInitialLargeJump = absDelta >= viewportH * 0.5;
            if (isInitialReset || isInitialLargeJump) {
                initialScrollTop = 0;
                cancelActiveSprings();
                return;
            }
            initialScrollTop = 0;
        }

        const ref = getRefIndex(lines);
        const avgH = _estimateAvgLineHeight(lines, ref);
        const isLargeJump = absDelta >= viewportH * CFG.largeJumpViewportRatio;
        const scaleThreshold = avgH * CFG.staggerScaleLines;
        const stepMs = isLargeJump
            ? 0
            : (absDelta > scaleThreshold ? CFG.staggerStep * (scaleThreshold / absDelta) : CFG.staggerStep);
        const baseDelayMs = (isLargeJump || delta < -avgH * 2) ? 0 : CFG.scrollDelay;
        const stiffness = CFG.stiffness;
        const mass = CFG.mass;
        // Slight margin above 2*sqrt(k*m) guarantees _solveSpringPair takes the critically damped branch.
        const damping = isLargeJump ? Math.ceil(2 * Math.sqrt(stiffness * mass) * 100) / 100 : CFG.damping;
        const collapsePending = isLargeJump;

        const { start, end } = _computeScrollRange(lines, ref, delta, viewportH);
        const nowTimeline = Number(document.timeline?.currentTime) || performance.now();
        const sharedIdleBakeCache = { delayMs: baseDelayMs, baked: null };

        const visited = new Set();

        for (let i = start; i < end; i++) {
            const line = lines[i];
            visited.add(line);
            const staggerMs = stepMs > 0
                ? (delta >= 0
                    ? (i > ref ? (i - ref) * stepMs : 0)
                    : (i < ref ? (ref - i) * stepMs : 0))
                : 0;
            const totalDelayMs = baseDelayMs + staggerMs;
            const data = getOrCreateLineState(line);
            applyLineWave(
                line,
                data,
                delta,
                totalDelayMs,
                nowTimeline,
                sharedIdleBakeCache,
                stiffness,
                damping,
                mass,
                collapsePending
            );
        }

        // Also update any line still settling outside [start, end) so it absorbs
        // the scrollTop shift seamlessly without jumping on screen.
        for (const line of Array.from(activeLines)) {
            if (visited.has(line)) continue;
            if (!line.isConnected || isLargeJump) {
                const data = lineState.get(line);
                if (data) {
                    if (data.anim) {
                        const old = data.anim;
                        data.anim = null;
                        old.cancel();
                    }
                    retireLine(line, data);
                }
                continue;
            }
            const data = getOrCreateLineState(line);
            applyLineWave(
                line,
                data,
                delta,
                baseDelayMs,
                nowTimeline,
                sharedIdleBakeCache,
                stiffness,
                damping,
                mass,
                collapsePending
            );
        }
    }

    function handleNewDelta(delta) {
        if (!isScriptEnabled || isNoSyncMode || Math.abs(delta) < CFG.minDelta) return;
        applyStagger(delta);
    }

    function applyScrollReset(delta) {
        if (lastScrollTop !== null) lastScrollTop += delta;
        handleNewDelta(delta);
        lastFlipTime = Date.now();
    }

    function installStyleObserver(el) {
        styleObserver?.disconnect();

        let lastTransform = el.style.transform || '';

        styleObserver = new MutationObserver(() => {
            if (!isScriptEnabled || suppressTransform) return;

            const transformVal = el.style.transform;
            if (transformVal === lastTransform) return;

            if (!transformVal || transformVal === 'none') {
                if (pendingDelta !== 0) {
                    lastTransform = transformVal;
                    const delta = pendingDelta;
                    pendingDelta = 0;

                    suppressTransform = true;
                    if (el.style.transition !== 'none') el.style.transition = 'none';
                    if (el.style.transform !== 'none') el.style.transform = 'none';
                    lastTransform = 'none';
                    suppressTransform = false;

                    applyScrollReset(delta);
                } else {
                    lastTransform = transformVal;
                }
                return;
            }

            lastTransform = transformVal;
            const y = parseTranslateY(transformVal);

            if (Math.abs(y) > CFG.minDelta) {
                const delta = y;
                pendingDelta = 0;
                suppressTransform = true;
                if (el.style.transition !== 'none') el.style.transition = 'none';
                if (el.style.transform !== 'none') el.style.transform = 'none';
                lastTransform = 'none';
                suppressTransform = false;

                applyScrollReset(delta);
            } else if (pendingDelta !== 0) {
                const delta = pendingDelta;
                pendingDelta = 0;

                suppressTransform = true;
                if (el.style.transition !== 'none') el.style.transition = 'none';
                if (el.style.transform !== 'none') el.style.transform = 'none';
                lastTransform = 'none';
                suppressTransform = false;

                applyScrollReset(delta);
            }
        });

        styleObserver.observe(el, {
            attributes: true,
            attributeFilter: ['style'],
        });

        console.info('[GlassyFlow Super] Style observer installed on', el);
    }

    let scrollParent = null;
    let scrollHandler = null;
    let lastScrollTop = null;

    function installScrollFallback(el) {
        removeScrollFallback();
        scrollParent = findScrollParent(el);
        if (!scrollParent) return;
        lastScrollTop = scrollParent.scrollTop;

        scrollHandler = () => {
            if (!isScriptEnabled || isNoSyncMode) {
                lastScrollTop = null;
                return;
            }
            if (pendingDelta !== 0 || Date.now() - lastFlipTime < 150) return;

            const cur = scrollParent.scrollTop;
            if (lastScrollTop === null) {
                lastScrollTop = cur;
                return;
            }
            const delta = cur - lastScrollTop;
            lastScrollTop = cur;

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
        lastScrollTop = null;
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

    function isWebglContainer(el) {
        return Boolean(
            (el && el.classList && el.classList.contains('brs-layout')) ||
            document.documentElement?.hasAttribute('blyrics-webgl-lyrics')
        );
    }

    function detachForWebgl() {
        if (noSyncRetryTimer !== null) {
            clearTimeout(noSyncRetryTimer);
            noSyncRetryTimer = null;
        }
        setScrollOverride(false);
        styleObserver?.disconnect();
        _linesObserver?.disconnect();
        removeScrollFallback();
        cleanupAllSprings();
        if (container) container.classList.remove('blyrics--gf-managed');
        container = null;
    }

    function attach(el) {
        if (isWebglContainer(el)) {
            detachForWebgl();
            return;
        }
        if (el === container) return;
        console.info('[GlassyFlow Super] Attaching to new container', el);
        cleanupAllSprings();

        container = el;
        pendingDelta = 0;
        attachedAt = Date.now();
        tabRenderer =
            el.closest('ytmusic-tab-renderer[page-type="MUSIC_PAGE_TYPE_TRACK_LYRICS"]') ||
            el.closest('ytmusic-tab-renderer') ||
            document.querySelector('ytmusic-tab-renderer[page-type="MUSIC_PAGE_TYPE_TRACK_LYRICS"]');

        installStyleObserver(el);
        _installLinesObserver(el);
        installScrollFallback(el);
        initialScrollTop = lastScrollTop ?? 0;
        startNoSyncDetection(el);

        if (!isNoSyncMode) {
            el.classList.add('blyrics--gf-managed');
            setScrollOverride(true);
        }
    }

    function _findContainer() {
        const wrapper = document.getElementById('blyrics-wrapper');
        if (!wrapper) return null;
        const first = wrapper.firstElementChild;
        if (first && first.classList.contains('blyrics-container')) return first;
        return wrapper.querySelector('.blyrics-container');
    }

    function _bindDomObserver() {
        if (!domObserver) return;
        domObserver.disconnect();
        const wrapper = document.getElementById('blyrics-wrapper');
        let target = wrapper;
        let subtree = false;
        if (!target) {
            target = document.querySelector('ytmusic-tab-renderer[page-type="MUSIC_PAGE_TYPE_TRACK_LYRICS"]') ||
                document.querySelector('ytmusic-tab-renderer') ||
                document.body;
            subtree = target === document.body;
        }
        _domObserverTarget = target;
        domObserver.observe(target, { childList: true, subtree });
    }

    function boot() {
        console.info('[GlassyFlow Super] Booting superposition compositor spring scroll...');
        document.documentElement?.setAttribute('data-glassyflow-enabled', 'true');
        const existing = document.querySelector('.blyrics-container');
        if (existing) attach(existing);

        domObserver?.disconnect();
        let domCheckQueued = false;
        domObserver = new MutationObserver(() => {
            if (domCheckQueued) return;
            domCheckQueued = true;
            queueMicrotask(() => {
                domCheckQueued = false;
                const wrapper = document.getElementById('blyrics-wrapper');
                if (wrapper && _domObserverTarget !== wrapper) {
                    _bindDomObserver();
                }
                const el = _findContainer();
                if (el && el !== container) {
                    console.info('[GlassyFlow Super] New container detected (song change)');
                    attach(el);
                }
            });
        });
        _bindDomObserver();
    }

    function _resetGeometry() {
        _linesCache.lines = null;
        if (_lineGeomRO) {
            for (const target of _observedLines) _lineGeomRO.unobserve(target);
        }
        _observedLines.clear();
        _lineGeom = new WeakMap();
        if (_vpRO && _vpEl) _vpRO.unobserve(_vpEl);
        _vpEl = null;
        _vp = { h: 0, top: 0, bottom: 0, innerH: 0 };
        _viewportCache.ts = 0;
        _avgLineHeightCache.ts = 0;
    }

    function cancelActiveSprings() {
        for (const line of activeLines) {
            const data = lineState.get(line);
            if (data) {
                if (data.anim) {
                    const anim = data.anim;
                    data.anim = null;
                    anim.cancel();
                }
                data.base = null;
                data.pending.length = 0;
                data.tOriginMs = 0;
            }
            if (line.style.translate) line.style.translate = '';
        }
        activeLines.clear();
    }

    function cleanupAllSprings() {
        cancelActiveSprings();
        lastScrollTop = null;
        _resetGeometry();
    }

    function setNoSyncState(enabled) {
        if (isNoSyncMode === enabled) return;
        isNoSyncMode = enabled;
        if (enabled) {
            setScrollOverride(false);
            cleanupAllSprings();
            if (container) container.classList.remove('blyrics--gf-managed');
            console.info('[GlassyFlow Super] No-sync detected — spring scroll disabled.');
        } else {
            setScrollOverride(true);
            if (container) container.classList.add('blyrics--gf-managed');
            console.info('[GlassyFlow Super] Synced lyrics detected — spring scroll re-enabled.');
        }
    }

    function startNoSyncDetection(el) {
        if (noSyncRetryTimer !== null) {
            clearTimeout(noSyncRetryTimer);
            noSyncRetryTimer = null;
        }
        isNoSyncMode = false;

        const _check = () => {
            if (!el.isConnected || el !== container) return;
            const lines = el.querySelectorAll('.blyrics--line');
            if (lines.length === 0) {
                noSyncRetryTimer = setTimeout(_check, 500);
                return;
            }
            const hasSynced = el.querySelector('.blyrics--line[data-duration]:not([data-duration="0"])');
            setNoSyncState(!hasSynced);
        };
        _check();
    }

    window.addEventListener('yt-navigate-finish', () => {
        pendingDelta = 0;
        _linesCache.lines = null;
        if (noSyncRetryTimer !== null) {
            clearTimeout(noSyncRetryTimer);
            noSyncRetryTimer = null;
        }
        styleObserver?.disconnect();
        removeScrollFallback();
        cleanupAllSprings();
        container = null;
        boot();
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }

    window.addEventListener('resize', () => {
        isScriptEnabled = false;
        pendingDelta = 0;
        setScrollOverride(false);
        cleanupAllSprings();
        if (container) container.classList.remove('blyrics--gf-managed');

        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            isScriptEnabled = true;
            lastScrollTop = null;
            if (isWebglContainer(container)) {
                detachForWebgl();
                return;
            }
            if (container && !isNoSyncMode) {
                setScrollOverride(true);
                container.classList.add('blyrics--gf-managed');
            }
            console.info('[GlassyFlow Super] Re-enabled after resize.');
        }, 1500);
    });
})();
