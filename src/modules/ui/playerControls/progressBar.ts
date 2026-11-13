import { PROGRESS_PAINT_STEPS_PER_DEVICE_PX } from "@constants";
import { measureWidth, observeLayoutWidth } from "@modules/ui/layout/layoutWidth";
import { clamp01, easeOutCubic, interpolate, pctFromClientX, type PlaybackSnapshot } from "./playhead";
import { formatRemaining, formatTime } from "./timeFormat";

type EndTimeMode = "total" | "remaining";

interface ProgressBarOptions {
  doc: Document;
  getSnapshot: () => PlaybackSnapshot | null;
  onSeek: (seconds: number) => void;
  initialEndMode?: EndTimeMode;
  onEndModeChange?: (mode: EndTimeMode) => void;
}

export interface ProgressBarHandle {
  element: HTMLElement;
  destroy: () => void;
}

const GLIDE_MS = 260;
const SEEK_LATCH_TOLERANCE_S = 1;
const SEEK_LATCH_TIMEOUT_MS = 2000;
const JUMP_GLIDE_THRESHOLD_S = 0.75;
const OPTIMIZED_STEADY_INTERVAL_MS = 66;
const OPTIMIZED_IDLE_INTERVAL_MS = 250;

let optimizedProgressBarEnabled = false;
const activeProgressBars = new Set<{ syncMode: () => void }>();

export function syncProgressBarOptimizationState(enabled = optimizedProgressBarEnabled): void {
  optimizedProgressBarEnabled = enabled;
  for (const instance of activeProgressBars) {
    instance.syncMode();
  }
}

export function createProgressBar(options: ProgressBarOptions): ProgressBarHandle {
  const { doc, getSnapshot, onSeek, initialEndMode, onEndModeChange } = options;
  const win = doc.defaultView ?? window;

  const element = doc.createElement("div");
  element.className = "blyrics-progress";

  const bar = doc.createElement("div");
  bar.className = "blyrics-progress__bar";
  const fillClip = doc.createElement("div");
  fillClip.className = "blyrics-progress__fill-clip";
  const fill = doc.createElement("div");
  fill.className = "blyrics-progress__fill";
  fillClip.appendChild(fill);
  const knob = doc.createElement("div");
  knob.className = "blyrics-progress__knob";
  const dot = doc.createElement("span");
  dot.className = "blyrics-progress__knob-dot";
  knob.appendChild(dot);
  bar.append(fillClip, knob);

  const times = doc.createElement("div");
  times.className = "blyrics-progress__times";
  const elapsed = doc.createElement("span");
  elapsed.className = "blyrics-progress__elapsed";
  const endTime = doc.createElement("button");
  endTime.type = "button";
  endTime.className = "blyrics-progress__end";
  endTime.dataset.mode = initialEndMode ?? "total";
  times.append(elapsed, endTime);

  element.append(bar, times);

  let barWidth = 0;
  let dragging = false;
  let displayedS: number | null = null;
  let gliding = false;
  let glideFrom = 0;
  let glideStart = 0;
  let glideTarget = 0;
  let glideTracksLive = false;
  let scrubValue = 0;
  let pendingSeekS: number | null = null;
  let pendingSeekWall = 0;
  let frame = 0;
  let timer = 0;
  let running = false;

  const syncContainStyle = (): void => {
    if (optimizedProgressBarEnabled) {
      element.style.contain = "layout style paint";
      bar.style.contain = "layout style paint";
    } else {
      element.style.removeProperty("contain");
      bar.style.removeProperty("contain");
    }
  };
  syncContainStyle();

  const cancelScheduled = (): void => {
    if (frame !== 0) {
      win.cancelAnimationFrame(frame);
      frame = 0;
    }
    if (timer !== 0) {
      win.clearTimeout(timer);
      timer = 0;
    }
  };

  const isControlsHiddenInOptimizedMode = (): boolean => {
    if (doc.documentElement?.hasAttribute("blyrics-no-fs-controls")) return true;
    const layout = doc.getElementById("layout");
    if (layout && !layout.hasAttribute("player-fullscreened")) return true;
    return false;
  };

  const barWidthObservation = observeLayoutWidth(
    () => bar,
    width => {
      barWidth = width ?? 0;
    }
  );

  const positionFor = (clientX: number): number => {
    const rect = bar.getBoundingClientRect();
    return pctFromClientX(rect.left, rect.width, clientX);
  };

  let paintedFill = "";
  let paintedKnob = "";

  const setText = (node: HTMLElement, text: string): void => {
    if (node.textContent !== text) node.textContent = text;
  };

  const paint = (currentS: number, durationS: number): void => {
    const pct = durationS > 0 ? clamp01(currentS / durationS) : 0;
    const stepsPerDevicePx =
      optimizedProgressBarEnabled && !dragging && !gliding ? 1 : PROGRESS_PAINT_STEPS_PER_DEVICE_PX;
    const step = 1 / (stepsPerDevicePx * (win.devicePixelRatio || 1));
    const knobPx = Math.round((pct * barWidth) / step) * step;
    const fillValue = `scaleX(${barWidth > 0 ? knobPx / barWidth : pct})`;
    const knobValue = `translateX(${knobPx}px)`;
    if (fillValue !== paintedFill) {
      fill.style.transform = fillValue;
      paintedFill = fillValue;
    }
    if (knobValue !== paintedKnob) {
      knob.style.transform = knobValue;
      paintedKnob = knobValue;
    }
    setText(elapsed, formatTime(currentS));
    setText(
      endTime,
      endTime.dataset.mode === "remaining" ? formatRemaining(currentS, durationS) : formatTime(durationS)
    );
  };

  const liveTarget = (snapshot: PlaybackSnapshot | null, now: number): number => {
    const live = interpolate(snapshot, win.Date.now());
    if (pendingSeekS === null) return live;
    if (Math.abs(live - pendingSeekS) < SEEK_LATCH_TOLERANCE_S || now - pendingSeekWall > SEEK_LATCH_TIMEOUT_MS) {
      pendingSeekS = null;
      return live;
    }
    return pendingSeekS;
  };

  const scheduleNext = (snapshot: PlaybackSnapshot | null): void => {
    if (!running) return;
    if (!optimizedProgressBarEnabled || dragging || gliding) {
      frame = win.requestAnimationFrame(tick);
      return;
    }
    const idle = isControlsHiddenInOptimizedMode() || !snapshot || !snapshot.isPlaying;
    const delayMs = idle ? OPTIMIZED_IDLE_INTERVAL_MS : OPTIMIZED_STEADY_INTERVAL_MS;
    timer = win.setTimeout(tick, delayMs) as unknown as number;
  };

  const tick = (): void => {
    frame = 0;
    timer = 0;
    const snapshot = getSnapshot();
    const durationS = snapshot?.durationS ?? 0;
    const now = win.performance.now();

    if (optimizedProgressBarEnabled && !dragging && !gliding && isControlsHiddenInOptimizedMode()) {
      scheduleNext(snapshot);
      return;
    }

    if (gliding) {
      const target = glideTracksLive ? liveTarget(snapshot, now) : glideTarget;
      const k = clamp01((now - glideStart) / GLIDE_MS);
      displayedS = glideFrom + (target - glideFrom) * easeOutCubic(k);
      if (k >= 1) {
        gliding = false;
        displayedS = target;
      }
    } else if (dragging) {
      displayedS = scrubValue;
    } else {
      const target = liveTarget(snapshot, now);
      if (displayedS === null || Math.abs(target - displayedS) <= JUMP_GLIDE_THRESHOLD_S) {
        displayedS = target;
      } else {
        gliding = true;
        glideTracksLive = true;
        glideFrom = displayedS;
        glideStart = now;
      }
    }

    paint(displayedS ?? 0, durationS);
    scheduleNext(snapshot);
  };

  const start = (): void => {
    if (running) return;
    running = true;
    barWidth = measureWidth(bar) ?? barWidth;
    scheduleNext(getSnapshot());
  };

  const stop = (): void => {
    if (!running) return;
    running = false;
    cancelScheduled();
    gliding = false;
    displayedS = null;
  };

  const instanceController = {
    syncMode(): void {
      syncContainStyle();
      if (!running) return;
      cancelScheduled();
      tick();
    },
  };
  activeProgressBars.add(instanceController);

  const onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    pendingSeekS = null;
    const durationS = getSnapshot()?.durationS ?? 0;
    dragging = true;
    bar.classList.add("dragging");
    bar.setPointerCapture(event.pointerId);
    const clicked = positionFor(event.clientX) * durationS;
    glideFrom = displayedS ?? interpolate(getSnapshot() ?? null, win.Date.now());
    glideTarget = clicked;
    glideTracksLive = false;
    scrubValue = clicked;
    glideStart = win.performance.now();
    gliding = true;
    if (running && timer !== 0) {
      cancelScheduled();
      frame = win.requestAnimationFrame(tick);
    }
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (!dragging) return;
    gliding = false;
    const durationS = getSnapshot()?.durationS ?? 0;
    scrubValue = positionFor(event.clientX) * durationS;
  };

  const onPointerUp = (event: PointerEvent): void => {
    if (!dragging) return;
    dragging = false;
    bar.classList.remove("dragging");
    if (bar.hasPointerCapture(event.pointerId)) bar.releasePointerCapture(event.pointerId);
    const durationS = getSnapshot()?.durationS ?? 0;
    const target = gliding ? glideTarget : scrubValue;
    const seekS = clamp01(durationS > 0 ? target / durationS : 0) * durationS;
    pendingSeekS = seekS;
    pendingSeekWall = win.performance.now();
    onSeek(seekS);
  };

  const onEndClick = (): void => {
    const first = endTime.getBoundingClientRect();
    const nextMode: EndTimeMode = endTime.dataset.mode === "remaining" ? "total" : "remaining";
    endTime.dataset.mode = nextMode;
    onEndModeChange?.(nextMode);
    const snapshot = getSnapshot();
    paint(interpolate(snapshot ?? null, win.Date.now()), snapshot?.durationS ?? 0);
    const last = endTime.getBoundingClientRect();
    const dx = first.right - last.right;
    const scale = last.width > 0 ? first.width / last.width : 1;
    endTime.animate(
      [
        { transform: `translateX(${dx}px) scale(${scale})`, opacity: 0 },
        { transform: "none", opacity: 1 },
      ],
      { duration: 420, easing: "cubic-bezier(0.22, 1, 0.36, 1)" }
    );
  };

  bar.addEventListener("pointerdown", onPointerDown);
  bar.addEventListener("pointermove", onPointerMove);
  bar.addEventListener("pointerup", onPointerUp);
  bar.addEventListener("pointercancel", onPointerUp);
  endTime.addEventListener("click", onEndClick);

  const visibilityObserver = new win.IntersectionObserver(entries => {
    if (entries.some(entry => entry.isIntersecting)) start();
    else stop();
  });
  visibilityObserver.observe(element);

  return {
    element,
    destroy(): void {
      stop();
      activeProgressBars.delete(instanceController);
      barWidthObservation.destroy();
      visibilityObserver.disconnect();
    },
  };
}
