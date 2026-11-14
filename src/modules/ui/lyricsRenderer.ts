import {
  createLyricsRenderer as createBaseLyricsRenderer,
  type LyricsRenderer,
  type LyricsRendererOptions,
} from "@braccato/core";
import { BIDI_SENSITIVE_CLASS, LONG_WORD_GROUP_CLASS, WORD_CLASS, WORD_GROUP_CLASS } from "@braccato/core/constants";
import { testJoiningScript } from "@braccato/core/text";

type AnimateMethod = Element["animate"];
type AnimateKeyframes = Parameters<AnimateMethod>[0];
type AnimateOptions = Parameters<AnimateMethod>[1];
type WindowWithElement = { Element?: { prototype?: object } };
export type WobbleLineData = Pick<LyricsRenderer["lines"][number], "parts">;
type WobblePartData = WobbleLineData["parts"][number];

const patchedPrototypes = new WeakSet<object>();
const normalizedLineState = new WeakMap<WobbleLineData, { length: number; lastPart: WobblePartData | undefined }>();

function isWobbleTransformFrame(frame: unknown): frame is Keyframe & { transform: string } {
  return typeof frame === "object" && frame !== null && typeof (frame as Keyframe).transform === "string";
}

function isWobbleTargetElement(target: unknown): boolean {
  const el = target as { classList?: { contains?: (token: string) => boolean } } | null;
  const classList = el?.classList;
  if (!classList || typeof classList.contains !== "function") {
    return false;
  }
  return classList.contains(WORD_GROUP_CLASS) || classList.contains(WORD_CLASS);
}

/**
 * Normalizes `@braccato/core`'s word-wobble WAAPI arguments to match legacy CSS
 * `@keyframes blyrics-wobble` easing inheritance.
 *
 * Core omits per-keyframe easing on keyframe 0 and passes `--blyrics-word-wobble-easing`
 * as the timeline-level `options.easing`, leaving 0 -> peak linear and compressing the
 * settle segment. Moving non-linear timing onto keyframes 0 and 2 with `"linear"` timeline
 * easing restores exact CSS segment curves while no-oping once upstream fixes it.
 */
export function normalizeWordWobbleAnimateArgs(
  target: unknown,
  keyframes: AnimateKeyframes,
  options?: AnimateOptions
): { keyframes: AnimateKeyframes; options: AnimateOptions | undefined } {
  if (!isWobbleTargetElement(target)) {
    return { keyframes, options };
  }
  if (!Array.isArray(keyframes) || keyframes.length !== 4) {
    return { keyframes, options };
  }
  if (
    typeof options !== "object" ||
    options === null ||
    options.fill !== "forwards" ||
    typeof options.easing !== "string" ||
    options.easing.length === 0 ||
    options.easing === "linear"
  ) {
    return { keyframes, options };
  }

  const [f0, f1, f2, f3] = keyframes;
  if (
    !isWobbleTransformFrame(f0) ||
    !isWobbleTransformFrame(f1) ||
    !isWobbleTransformFrame(f2) ||
    !isWobbleTransformFrame(f3) ||
    f0.offset !== undefined ||
    f0.easing !== undefined ||
    typeof f1.offset !== "number" ||
    typeof f2.offset !== "number" ||
    f2.easing !== undefined ||
    f3.offset !== undefined
  ) {
    return { keyframes, options };
  }

  const segmentEasing = options.easing;
  return {
    keyframes: [{ ...f0, easing: segmentEasing }, f1, { ...f2, easing: segmentEasing }, f3],
    options: { ...options, easing: "linear" },
  };
}

/**
 * Installs the idempotent WAAPI word-wobble normalization hook on `win.Element.prototype`.
 */
export function installWordWobblePatch(win: Window | WindowWithElement | null | undefined): void {
  const proto = (win as WindowWithElement | null | undefined)?.Element?.prototype as
    | { animate?: AnimateMethod }
    | undefined;
  if (!proto || patchedPrototypes.has(proto) || typeof proto.animate !== "function") {
    return;
  }
  const desc = Object.getOwnPropertyDescriptor(proto, "animate");
  if (desc && desc.writable === false && !desc.set) {
    return;
  }

  const originalAnimate = proto.animate;
  patchedPrototypes.add(proto);
  proto.animate = function patchedAnimate(
    this: Element,
    keyframes: AnimateKeyframes,
    options?: AnimateOptions
  ): Animation {
    const normalized = normalizeWordWobbleAnimateArgs(this, keyframes, options);
    return originalAnimate.call(this, normalized.keyframes, normalized.options);
  };
}

function shouldKeepGroupWobble(group: HTMLElement | null): boolean {
  if (!group || !group.classList?.contains?.(WORD_GROUP_CLASS)) {
    return true;
  }
  if (group.classList.contains(LONG_WORD_GROUP_CLASS)) {
    return true;
  }
  if (typeof group.closest === "function" && group.closest(`.${BIDI_SENSITIVE_CLASS}`) !== null) {
    return true;
  }
  return testJoiningScript(group.dataset?.content ?? group.textContent ?? "");
}

/**
 * Retargets word-wobble animations from `.blyrics-word-group` (which only fires on the first
 * syllable of a grouped word in `@braccato/core`) to each timed `.blyrics--word` part so
 * multi-syllable words wobble syllable-by-syllable in sequence.
 */
export function retargetPerWordWobble(lines: readonly WobbleLineData[]): void {
  for (const line of lines) {
    const parts = line.parts;
    const length = parts.length;
    const lastPart = length > 0 ? parts[length - 1] : undefined;
    const prev = normalizedLineState.get(line);
    if (prev && prev.length === length && prev.lastPart === lastPart) {
      continue;
    }
    normalizedLineState.set(line, { length, lastPart });

    for (const part of parts) {
      if (!part.lyricElement || !part.highlightElement) {
        continue;
      }
      if (part.wobbleElements[0] === part.lyricElement && part.wobbleElements[1] === part.highlightElement) {
        continue;
      }
      if (shouldKeepGroupWobble(part.lyricElement.parentElement)) {
        continue;
      }
      const targets: HTMLElement[] = [part.lyricElement, part.highlightElement];
      if (part.imageLayers?.highlight) {
        targets.push(part.imageLayers.highlight);
      }
      part.wobbleElements = targets;
    }
  }
}

/**
 * Creates a `@braccato/core` lyrics renderer with legacy CSS word-wobble easing parity
 * and per-word/per-syllable wobble targets applied.
 */
export function createLyricsRenderer(options: LyricsRendererOptions): LyricsRenderer {
  installWordWobblePatch(options.window);
  const renderer = createBaseLyricsRenderer(options);
  const originalSetLyrics = renderer.setLyrics;
  const originalTick = renderer.tick;
  const originalRetick = renderer.retickFromPlaybackClock;

  renderer.setLyrics = function setLyricsWithPerWordWobble(lyrics, setOptions) {
    originalSetLyrics.call(this, lyrics, setOptions);
    retargetPerWordWobble(renderer.lines);
  };
  renderer.tick = function tickWithPerWordWobble(currentTimeS, tickOptions) {
    retargetPerWordWobble(renderer.lines);
    return originalTick.call(this, currentTimeS, tickOptions);
  };
  renderer.retickFromPlaybackClock = function retickWithPerWordWobble(buildTickOptions) {
    retargetPerWordWobble(renderer.lines);
    return originalRetick.call(this, buildTickOptions);
  };

  return renderer;
}
