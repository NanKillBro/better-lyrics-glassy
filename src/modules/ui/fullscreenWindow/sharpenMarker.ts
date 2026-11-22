export const SHARPEN_LEAD_BEFORE_SWEEP_S = 0.3;
const FALLBACK_SHARPEN_LEAD_S = 0.3;
const DISCONTINUITY_JUMP_S = 0.45;
const REVERSE_SEEK_TOLERANCE_S = 0.1;
const BELOW_CLASS_COUNT = 6;

export interface SharpenTargetSnapshot {
  readonly index: number;
  readonly indices: readonly number[];
  readonly noSync: boolean;
  readonly isOutro: boolean;
}

export interface SharpenLineDescriptor {
  readonly isActive: boolean;
  readonly isAnimating: boolean;
  readonly animDelayS: number | null;
  readonly durationS: number;
  readonly startTimeS: number;
}

interface TrackedLineSchedule {
  readonly wasAnimating: boolean;
  readonly wasSharpened: boolean;
  readonly animDelayS: number | null;
  readonly sharpenAtTimeS: number | null;
}

function readAnimDelayS(el: HTMLElement): number | null {
  const raw = el.style.getPropertyValue("--blyrics-anim-delay").trim();
  if (!raw) return null;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Computes which lyric lines should be sharp right now, mirroring `mergetheme.js`:
 * `.blyrics--animating` + `.blyrics--active` open ~1.2-2s early on the scroll/pre-arm clocks,
 * whereas `--blyrics-anim-delay` counts down to the engine's offset line time so subtracting
 * `SHARPEN_LEAD_BEFORE_SWEEP_S` (0.3s, matching `NANKILL_SHARPEN_LEAD_S` in `mergetheme.js`)
 * synchronizes visual sharpening per line while preserving overlapping active/singing lines.
 */
export class SharpenTimelineState {
  private lastTimeS: number | null = null;
  private sharpenedIndices: number[] = [];
  private trackedLines: TrackedLineSchedule[] = [];

  reset(): void {
    this.lastTimeS = null;
    this.sharpenedIndices = [];
    this.trackedLines = [];
  }

  evaluate(
    timeS: number,
    lines: readonly SharpenLineDescriptor[],
    forceImmediate = false,
  ): SharpenTargetSnapshot {
    if (lines.length === 0) {
      this.reset();
      return { index: -1, indices: [], noSync: false, isOutro: false };
    }

    const noSync = lines.every((line) => !(line.durationS > 0));
    if (noSync) {
      this.reset();
      return { index: -1, indices: [], noSync: true, isOutro: false };
    }

    const discontinuous =
      forceImmediate ||
      this.lastTimeS === null ||
      timeS < this.lastTimeS - REVERSE_SEEK_TOLERANCE_S ||
      timeS - this.lastTimeS > DISCONTINUITY_JUMP_S;

    if (forceImmediate || lines.length !== this.trackedLines.length) {
      this.trackedLines = [];
    }

    const activeIndices: number[] = [];
    const triggeredIndices: number[] = [];
    const nextTracked: TrackedLineSchedule[] = new Array(lines.length);

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (line.isActive) activeIndices.push(i);

      let sharpenAtTimeS: number | null = null;
      let isSharpened = false;
      if (line.isAnimating) {
        const prev = this.trackedLines[i];
        if (prev && prev.wasAnimating && prev.wasSharpened && !discontinuous) {
          sharpenAtTimeS = prev.sharpenAtTimeS;
          isSharpened = true;
        } else {
          if (line.animDelayS !== null) {
            if (prev && prev.wasAnimating && prev.animDelayS === line.animDelayS) {
              sharpenAtTimeS = prev.sharpenAtTimeS;
            } else {
              sharpenAtTimeS = timeS + line.animDelayS - SHARPEN_LEAD_BEFORE_SWEEP_S;
            }
          } else {
            sharpenAtTimeS = line.startTimeS - FALLBACK_SHARPEN_LEAD_S;
          }
          if (sharpenAtTimeS !== null && timeS + 1e-6 >= sharpenAtTimeS) {
            isSharpened = true;
          }
        }
      }

      if (isSharpened) {
        triggeredIndices.push(i);
      }

      nextTracked[i] = {
        wasAnimating: line.isAnimating,
        wasSharpened: isSharpened,
        animDelayS: line.isAnimating ? line.animDelayS : null,
        sharpenAtTimeS,
      };
    }

    this.trackedLines = nextTracked;

    const lastLine = lines[lines.length - 1];
    const lastEndS = lastLine.startTimeS + (lastLine.durationS > 0 ? lastLine.durationS : 0);
    const isOutro =
      activeIndices.length === 0 &&
      triggeredIndices.length === 0 &&
      Number.isFinite(lastEndS) &&
      lastEndS > 0 &&
      timeS > lastEndS;

    if (isOutro) {
      this.sharpenedIndices = [];
    } else if (triggeredIndices.length > 0) {
      this.sharpenedIndices = triggeredIndices;
    } else if (discontinuous || this.sharpenedIndices.some((idx) => idx >= lines.length)) {
      // On seek/attach with no line inside its sharpen window yet, avoid prematurely lighting a
      // future `.blyrics--active` line in the 1.2s scroll lookahead; pick started/spanning lines.
      const spanningIndices: number[] = [];
      let latestStartedIndex = -1;
      for (let i = 0; i < lines.length; i += 1) {
        const entry = lines[i];
        if (entry.startTimeS <= timeS + FALLBACK_SHARPEN_LEAD_S) {
          latestStartedIndex = i;
          const entryEndS = entry.startTimeS + (entry.durationS > 0 ? entry.durationS : 0);
          if (entryEndS + 0.05 > timeS) {
            spanningIndices.push(i);
          }
        }
      }
      if (spanningIndices.length > 0) {
        this.sharpenedIndices = spanningIndices;
      } else if (latestStartedIndex >= 0) {
        this.sharpenedIndices = [latestStartedIndex];
      } else {
        const startedActive = activeIndices.filter(
          (i) => lines[i].startTimeS <= timeS + FALLBACK_SHARPEN_LEAD_S,
        );
        this.sharpenedIndices = startedActive;
      }
    }

    this.lastTimeS = timeS;
    const indices = [...this.sharpenedIndices];
    return {
      index: indices[0] ?? -1,
      indices,
      noSync: false,
      isOutro,
    };
  }
}

export class SharpenMarker {
  private readonly state = new SharpenTimelineState();
  private lastContainer: HTMLElement | null = null;
  private lastAppliedKey = "";

  reset(): void {
    this.state.reset();
    this.lastAppliedKey = "";
  }

  sync(mount: HTMLElement, timeS: number, forceImmediate = false): void {
    const container = mount.querySelector<HTMLElement>(".blyrics-container");
    if (!container) {
      this.lastContainer = null;
      this.reset();
      return;
    }

    if (container !== this.lastContainer) {
      this.lastContainer = container;
      this.reset();
      forceImmediate = true;
    }

    const lineElements: HTMLElement[] = [];
    const descriptors: SharpenLineDescriptor[] = [];
    for (const child of container.children) {
      if (!(child instanceof HTMLElement) || !child.classList.contains("blyrics--line")) continue;
      lineElements.push(child);
      descriptors.push({
        isActive: child.classList.contains("blyrics--active"),
        isAnimating: child.classList.contains("blyrics--animating"),
        animDelayS: readAnimDelayS(child),
        durationS: Number(child.dataset.duration) || 0,
        startTimeS: Number(child.dataset.time) || 0,
      });
    }

    const snapshot = this.state.evaluate(timeS, descriptors, forceImmediate);
    const key = `${lineElements.length}:${snapshot.noSync ? "1" : "0"}:${snapshot.indices.join(",")}:${snapshot.isOutro ? "1" : "0"}`;
    if (key === this.lastAppliedKey) return;
    this.lastAppliedKey = key;

    container.classList.toggle("blyrics--no-sync", snapshot.noSync);

    const sharpenedSet = new Set(snapshot.indices);
    const firstAnchor = snapshot.indices[0] ?? -1;
    const lastAnchor = snapshot.indices[snapshot.indices.length - 1] ?? -1;

    for (let i = 0; i < lineElements.length; i += 1) {
      const line = lineElements[i];
      const wantBehind =
        !snapshot.noSync && (snapshot.isOutro || (firstAnchor >= 0 && i < firstAnchor));
      const wantSharpen = !snapshot.noSync && sharpenedSet.has(i);
      const wantBelowRank =
        snapshot.noSync || snapshot.isOutro
          ? 0
          : lastAnchor >= 0
            ? i > lastAnchor
              ? Math.min(BELOW_CLASS_COUNT, i - lastAnchor)
              : 0
            : Math.min(BELOW_CLASS_COUNT, i + 1);

      line.classList.toggle("blyrics--gf-behind", wantBehind);
      line.classList.toggle("blyrics--gf-sharpen", wantSharpen);
      for (let level = 1; level <= BELOW_CLASS_COUNT; level += 1) {
        line.classList.toggle(`blyrics--gf-below-${level}`, level === wantBelowRank);
      }
    }
  }
}
