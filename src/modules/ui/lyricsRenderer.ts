import {
  createLyricsRenderer as createModernLyricsRenderer,
  resetPlaybackClock as resetModernPlaybackClock,
  resumeAllAutoscroll as resumeModernAutoscroll,
  type LyricsRenderer,
  type LyricsRendererOptions,
} from "@braccato/core";
import {
  createLyricsRenderer as createLegacyLyricsRenderer,
  resetPlaybackClock as resetLegacyPlaybackClock,
  resumeAllAutoscroll as resumeLegacyAutoscroll,
} from "@braccato/core-legacy";
import { BIDI_SENSITIVE_CLASS, WORD_CLASS, WORD_GROUP_CLASS } from "@braccato/core/constants";
import { testJoiningScript } from "@braccato/core/text";
import {
  injectRomanization as injectModernRomanization,
  injectTranslation as injectModernTranslation,
  type LineData,
  type LyricPart,
} from "@braccato/core";
import {
  injectRomanization as injectLegacyRomanization,
  injectTranslation as injectLegacyTranslation,
} from "@braccato/core-legacy";
import {
  lyricBuildSettingsKey as getModernBuildSettingsKey,
  parseThemeConfig as parseModernThemeConfig,
  registerThemeSetting as registerModernThemeSetting,
  setThemeSettings as setModernThemeSettings,
} from "@braccato/core/themeSettings";
import {
  lyricBuildSettingsKey as getLegacyBuildSettingsKey,
  parseThemeConfig as parseLegacyThemeConfig,
  registerThemeSetting as registerLegacyThemeSetting,
  setThemeSettings as setLegacyThemeSettings,
} from "@braccato/core-legacy/themeSettings";
import { readRendererMode } from "@modules/ui/rendererMode";

type AnimateMethod = Element["animate"];
type AnimateKeyframes = Parameters<AnimateMethod>[0];
type AnimateOptions = Parameters<AnimateMethod>[1];
export type { LineData, LyricsRenderer };

/**
 * Injects a romanized line through the active renderer package (`@braccato/core`
 * when composite lyrics are active, `@braccato/core-legacy` otherwise) so
 * timed romanization DOM matches the running engine.
 */
export function injectRomanization(
  doc: Document,
  lyricElement: HTMLElement,
  lineData: LineData,
  text: string,
  timedRomanization?: LyricPart[] | null
): void {
  const modeDoc = doc ?? lyricElement.ownerDocument;
  if (readRendererMode(modeDoc)) {
    injectModernRomanization(doc, lyricElement, lineData, text, timedRomanization);
    return;
  }
  injectLegacyRomanization(
    doc,
    lyricElement,
    lineData as unknown as Parameters<typeof injectLegacyRomanization>[2],
    text,
    timedRomanization
  );
}

/**
 * Injects a translated line through the active renderer package so decoration
 * bookkeeping stays bound to the active engine instance.
 */
export function injectTranslation(
  doc: Document,
  lyricElement: HTMLElement,
  text: string,
  language?: string | null
): void {
  const modeDoc = doc ?? lyricElement.ownerDocument;
  if (readRendererMode(modeDoc)) {
    injectModernTranslation(doc, lyricElement, text, language);
    return;
  }
  injectLegacyTranslation(doc, lyricElement, text, language);
}

type WindowWithElement = { Element?: { prototype?: object } };
type WobblePartData = LyricsRenderer["lines"][number]["parts"][number] & {
  imageLayers?: { highlight?: HTMLElement };
};
export type WobbleLineData = { parts: WobblePartData[] };

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

let lastAppliedThemeCss: string | null = null;

function syncOtherThemeSettings(activeIsComposite: boolean, css: string): void {
  if (activeIsComposite) {
    setLegacyThemeSettings(parseLegacyThemeConfig(css));
  } else {
    setModernThemeSettings(parseModernThemeConfig(css));
  }
}

/**
 * Registers a custom `blyrics-*` theme setting on both modern (`1.21.0`) and legacy (`1.20.0`)
 * theme registries so mode switches observe the same build configuration.
 */
export function registerThemeSetting(
  key: string,
  defaultValue: number | boolean | string,
  requiresLyricReload = false
) {
  registerLegacyThemeSetting(key, defaultValue, requiresLyricReload);
  return registerModernThemeSetting(key, defaultValue, requiresLyricReload);
}

/**
 * Reads the active engine's build-setting signature for `doc`.
 */
export function lyricBuildSettingsKey(doc?: Document): string {
  return readRendererMode(doc) ? getModernBuildSettingsKey() : getLegacyBuildSettingsKey();
}

/**
 * Resets the shared playback clock across both renderer engines.
 */
export function resetPlaybackClock(): void {
  resetModernPlaybackClock();
  resetLegacyPlaybackClock();
}

/**
 * Resumes autoscroll across both renderer engines.
 */
export function resumeAllAutoscroll(): void {
  resumeModernAutoscroll();
  resumeLegacyAutoscroll();
}

/**
 * Creates a delegating lyrics renderer selecting legacy `@braccato/core-legacy` (`1.20.0`, default)
 * or composite `@braccato/core` (`1.21.0`) from `options.document`.
 */
export function createLyricsRenderer(options: LyricsRendererOptions): LyricsRenderer {
  installWordWobblePatch(options.window);

  let destroyed = false;
  let activeComposite = readRendererMode(options.document);
  let currentMount = options.mount;
  let appliedThemeCss = lastAppliedThemeCss;

  const buildInnerRenderer = (composite: boolean): LyricsRenderer => {
    const nextOptions: LyricsRendererOptions =
      currentMount && currentMount !== options.mount ? { ...options, mount: currentMount } : options;
    return composite ? createModernLyricsRenderer(nextOptions) : createLegacyLyricsRenderer(nextOptions);
  };

  let inner = buildInnerRenderer(activeComposite);

  const syncEngineMode = (applySavedTheme: boolean): boolean => {
    if (destroyed) return false;
    const nextComposite = readRendererMode(options.document);
    if (nextComposite === activeComposite) {
      return false;
    }

    inner.destroy();
    activeComposite = nextComposite;
    inner = buildInnerRenderer(activeComposite);
    if (applySavedTheme && appliedThemeCss !== null) {
      inner.setTheme(appliedThemeCss);
    }
    return true;
  };

  const decorateLines = (): void => {
    retargetPerWordWobble(inner.lines);
  };

  return {
    get container() {
      return inner.container;
    },
    get lines() {
      return inner.lines;
    },
    get syncType() {
      return inner.syncType;
    },
    setLyrics(lyrics, setOptions) {
      if (destroyed) {
        inner.setLyrics(lyrics, setOptions);
        return;
      }
      if (setOptions?.mount) {
        currentMount = setOptions.mount;
      }
      syncEngineMode(true);
      const effectiveOptions =
        currentMount && !setOptions?.mount ? { ...setOptions, mount: currentMount } : setOptions;
      inner.setLyrics(lyrics, effectiveOptions);
      decorateLines();
    },
    setLanguage(language) {
      inner.setLanguage(language);
    },
    setTheme(css) {
      if (destroyed) return false;
      appliedThemeCss = css;
      lastAppliedThemeCss = css;
      const switched = syncEngineMode(false);
      const changed = inner.setTheme(css);
      syncOtherThemeSettings(activeComposite, css);
      return switched || changed;
    },
    tick(currentTimeS, tickOptions) {
      decorateLines();
      return inner.tick(currentTimeS, tickOptions);
    },
    relayout(measureLines) {
      inner.relayout(measureLines);
    },
    clear() {
      inner.clear();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      inner.destroy();
    },
    noteUserScroll() {
      inner.noteUserScroll();
    },
    noteVisibilityChange() {
      inner.noteVisibilityChange();
    },
    resumeAutoscroll() {
      inner.resumeAutoscroll();
    },
    clearOnScreenLyrics() {
      return inner.clearOnScreenLyrics();
    },
    scheduleLyricPositionUpdate(isTicking, retick) {
      inner.scheduleLyricPositionUpdate(isTicking, retick);
    },
    retickFromPlaybackClock(buildTickOptions) {
      decorateLines();
      return inner.retickFromPlaybackClock(buildTickOptions);
    },
  };
}
