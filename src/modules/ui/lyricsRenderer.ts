import {
  canvasFor,
  createLyricsRenderer as createWebglLyricsRenderer,
  injectRomanization as injectWebglRomanization,
  injectTranslation as injectWebglTranslation,
  isLoaded,
  type LineData,
  type LyricPart,
  type LyricsRenderer,
  type LyricsRendererOptions,
  loadSync,
  ownsLine,
  resetPlaybackClock as resetWebglPlaybackClock,
  resumeAllAutoscroll as resumeWebglAutoscroll,
  snapshotCanvas,
} from "@braccato/core";
import {
  createLyricsRenderer as createLegacyLyricsRenderer,
  injectRomanization as injectLegacyRomanization,
  injectTranslation as injectLegacyTranslation,
  resetPlaybackClock as resetLegacyPlaybackClock,
  resumeAllAutoscroll as resumeLegacyAutoscroll,
} from "@braccato/core-legacy";
import { BIDI_SENSITIVE_CLASS, WORD_CLASS, WORD_GROUP_CLASS } from "@braccato/core/constants";
import { testJoiningScript } from "@braccato/core/text";
import {
  lyricBuildSettingsKey as getWebglBuildSettingsKey,
  parseThemeConfig as parseWebglThemeConfig,
  registerThemeSetting as registerWebglThemeSetting,
  setThemeSettings as setWebglThemeSettings,
} from "@braccato/core/themeSettings";
import {
  lyricBuildSettingsKey as getLegacyBuildSettingsKey,
  parseThemeConfig as parseLegacyThemeConfig,
  registerThemeSetting as registerLegacyThemeSetting,
  setThemeSettings as setLegacyThemeSettings,
} from "@braccato/core-legacy/themeSettings";
import {
  ERROR_CLASS,
  LYRICS_CLASS,
  RENDERER_UNAVAILABLE_CLASS,
  RENDERER_UNAVAILABLE_HINT_CLASS,
  RENDERER_UNAVAILABLE_LOG,
  RENDERER_WASM_LOAD_FAILED_LOG,
} from "@constants";
import { getBrowserVendor } from "@core/browser";
import { t } from "@core/i18n";
import { logCore } from "@core/logger";
import { readRendererMode } from "@modules/ui/rendererMode";

export type { LineData, LyricsRenderer };
export type LyricsView = LyricsRenderer & {
  relayoutChangedLines?: (changedIndices: readonly number[]) => void;
};

// -- Loading the WebGL2 renderer --------------------------

let wasmDataUrl: string | null = null;
let loadFailed = false;

/**
 * Stores the inlined WebAssembly data URL without compiling it eagerly; WASM compilation runs
 * lazily on the first WebGL2 view mount so legacy 1.20.0 mode pays zero decode/compile cost.
 */
export function provideRendererWasm(dataUrl: string): void {
  wasmDataUrl ??= dataUrl;
}

function decodeDataUrl(dataUrl: string): Uint8Array {
  const binary = atob(dataUrl.slice(dataUrl.indexOf(",") + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function ensureLoaded(): boolean {
  if (isLoaded()) return true;
  if (wasmDataUrl === null || loadFailed) return false;
  try {
    loadSync(decodeDataUrl(wasmDataUrl));
    return true;
  } catch (error) {
    loadFailed = true;
    logCore(RENDERER_WASM_LOAD_FAILED_LOG, error);
    return false;
  }
}

const webgl2InDocument = new WeakMap<Document, boolean>();

function hasWebgl2(doc: Document): boolean {
  let has = webgl2InDocument.get(doc);
  if (has === undefined) {
    const context = doc.createElement("canvas").getContext("webgl2");
    has = context !== null;
    context?.getExtension("WEBGL_lose_context")?.loseContext();
    webgl2InDocument.set(doc, has);
  }
  return has;
}

function hardwareAccelerationHint(): string {
  switch (getBrowserVendor()) {
    case "firefox":
      return t("lyrics_rendererUnavailableHintFirefox");
    case "edge":
      return t("lyrics_rendererUnavailableHintEdge");
    default:
      return t("lyrics_rendererUnavailableHintChromium");
  }
}

function createUnavailableView(doc: Document, defaultMount?: HTMLElement): LyricsRenderer {
  let container: HTMLElement | null = null;
  return {
    setLyrics(_lyrics, lyricsOptions) {
      const mount = lyricsOptions?.mount ?? defaultMount;
      if (!mount) return;
      container = doc.createElement("div");
      container.className = LYRICS_CLASS;
      const message = doc.createElement("div");
      message.className = `${ERROR_CLASS} ${RENDERER_UNAVAILABLE_CLASS}`;
      message.textContent = t("lyrics_rendererUnavailable");
      const hint = doc.createElement("p");
      hint.className = RENDERER_UNAVAILABLE_HINT_CLASS;
      hint.textContent = hardwareAccelerationHint();
      container.replaceChildren(message, hint);
      mount.replaceChildren(container);
    },
    setLanguage() {},
    setTheme: () => false,
    tick: () => "ok",
    relayout() {},
    clear() {
      container?.remove();
      container = null;
    },
    destroy() {
      container?.remove();
      container = null;
    },
    noteUserScroll() {},
    noteVisibilityChange() {},
    resumeAutoscroll() {},
    clearOnScreenLyrics: () => false,
    scheduleLyricPositionUpdate() {},
    retickFromPlaybackClock: () => "ok",
    get container() {
      return container;
    },
    lines: [],
    syncType: "none",
    renderer: null,
  };
}

// -- Legacy 1.20.0 word-wobble easing & per-syllable target patch --------------------------

type AnimateMethod = Element["animate"];
type AnimateKeyframes = Parameters<AnimateMethod>[0];
type AnimateOptions = Parameters<AnimateMethod>[1];
type WindowWithElement = { Element?: { prototype?: object } };
type WobblePartData = {
  lyricElement?: HTMLElement;
  highlightElement?: HTMLElement;
  wobbleElements: HTMLElement[];
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
 * Normalizes `@braccato/core-legacy`'s word-wobble WAAPI arguments to match legacy CSS
 * `@keyframes blyrics-wobble` easing inheritance.
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
 * Retargets word-wobble animations in legacy `1.20.0` mode from `.blyrics-word-group` to each
 * timed `.blyrics--word` part so multi-syllable words wobble syllable-by-syllable.
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

// -- Dual theme settings & song-wide operations --------------------------

let lastAppliedThemeCss: string | null = null;

/**
 * Registers a custom `blyrics-*` theme setting on both WebGL2 (`2.0.0-beta.4`) and legacy (`1.20.0`)
 * theme registries so mode switches observe the same build configuration.
 */
export function registerThemeSetting(
  key: string,
  defaultValue: number | boolean | string,
  requiresLyricReload = false
) {
  registerLegacyThemeSetting(key, defaultValue, requiresLyricReload);
  return registerWebglThemeSetting(key, defaultValue, requiresLyricReload);
}

export function lyricBuildSettingsKey(doc?: Document): string {
  return readRendererMode(doc) ? getWebglBuildSettingsKey() : getLegacyBuildSettingsKey();
}

export function resetPlaybackClock(): void {
  resetLegacyPlaybackClock();
  if (isLoaded()) resetWebglPlaybackClock();
}

export function resumeAllAutoscroll(): void {
  resumeLegacyAutoscroll();
  if (isLoaded()) resumeWebglAutoscroll();
}

// -- Mode-aware decorations --------------------------

export function injectTranslation(doc: Document, lyricElement: HTMLElement, text: string, language?: string | null) {
  const modeDoc = doc ?? lyricElement.ownerDocument;
  if (readRendererMode(modeDoc)) {
    if (isLoaded() && ownsLine(lyricElement)) injectWebglTranslation(doc, lyricElement, text, language);
    return;
  }
  injectLegacyTranslation(doc, lyricElement, text, language);
}

export function injectRomanization(
  doc: Document,
  lyricElement: HTMLElement,
  lineData: LineData,
  text: string,
  timedRomanization: LyricPart[] | null = null
) {
  const modeDoc = doc ?? lyricElement.ownerDocument;
  if (readRendererMode(modeDoc)) {
    if (isLoaded() && ownsLine(lyricElement)) {
      injectWebglRomanization(doc, lyricElement, lineData, text, timedRomanization);
    }
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

// -- What a view shows --------------------------

export function rendererCanvas(container: HTMLElement): HTMLCanvasElement | null {
  return isLoaded() ? canvasFor(container) : null;
}

export function copyRendererCanvases(source: HTMLElement, clone: HTMLElement): void {
  if (!isLoaded()) return;
  const originals = source.querySelectorAll("canvas");
  const copies = clone.querySelectorAll("canvas");
  originals.forEach((canvas, index) => {
    const snapshot = snapshotCanvas(canvas);
    if (snapshot) copies[index]?.replaceWith(snapshot);
  });
}

// -- The delegating 2-mode view --------------------------

function buildLegacyAdapter(options: LyricsRendererOptions): LyricsView {
  const legacy = createLegacyLyricsRenderer(
    options as unknown as Parameters<typeof createLegacyLyricsRenderer>[0]
  );
  return Object.assign(legacy, { renderer: null }) as unknown as LyricsView;
}

/**
 * Creates a delegating lyrics view selecting legacy `@braccato/core-legacy` (`1.20.0`, default)
 * or WebGL2 `@braccato/core` (`2.0.0-beta.4`, opt-in via `blyrics-webgl-lyrics`) from `options.document`.
 */
export function createLyricsView(options: LyricsRendererOptions): LyricsView {
  installWordWobblePatch(options.window);

  let destroyed = false;
  let activeWebgl = readRendererMode(options.document);
  let active: LyricsView | null = activeWebgl ? null : buildLegacyAdapter(options);
  let currentMount = options.mount;
  let appliedThemeCss = lastAppliedThemeCss;

  const effectiveOptions = (): LyricsRendererOptions =>
    currentMount && currentMount !== options.mount ? { ...options, mount: currentMount } : options;

  const ensureActive = (applySavedTheme: boolean): LyricsView => {
    const nextWebgl = readRendererMode(options.document);
    if (active !== null && nextWebgl !== activeWebgl) {
      active.destroy();
      active = null;
      activeWebgl = nextWebgl;
    } else if (active === null) {
      activeWebgl = nextWebgl;
    }

    if (active === null) {
      if (activeWebgl) {
        if (ensureLoaded() && hasWebgl2(options.document)) {
          active = createWebglLyricsRenderer(effectiveOptions());
        } else {
          logCore(RENDERER_UNAVAILABLE_LOG);
          active = createUnavailableView(options.document, currentMount);
        }
      } else {
        active = buildLegacyAdapter(effectiveOptions());
      }
      if (applySavedTheme && appliedThemeCss !== null) {
        active.setTheme(appliedThemeCss);
      }
    }
    return active;
  };

  const decorateLegacyLines = (): void => {
    if (!activeWebgl && active) {
      retargetPerWordWobble(active.lines as unknown as readonly WobbleLineData[]);
    }
  };

  return {
    setLyrics(lyrics, lyricsOptions) {
      if (destroyed) {
        active?.setLyrics(lyrics, lyricsOptions);
        return;
      }
      if (lyricsOptions?.mount) {
        currentMount = lyricsOptions.mount;
      }
      const view = ensureActive(true);
      const nextLyricsOptions =
        currentMount && !lyricsOptions?.mount ? { ...lyricsOptions, mount: currentMount } : lyricsOptions;
      if (activeWebgl) {
        try {
          view.setLyrics(lyrics, nextLyricsOptions);
        } catch (error) {
          if (!String(error).toLowerCase().includes("webgl2")) throw error;
          logCore(RENDERER_UNAVAILABLE_LOG, error);
          active?.destroy();
          active = createUnavailableView(options.document, currentMount);
          active.setLyrics(lyrics, nextLyricsOptions);
        }
      } else {
        view.setLyrics(lyrics, nextLyricsOptions);
        decorateLegacyLines();
      }
    },
    setLanguage: language => active?.setLanguage(language),
    setTheme(css) {
      if (destroyed) return false;
      appliedThemeCss = css;
      lastAppliedThemeCss = css;
      const nextWebgl = readRendererMode(options.document);
      let switched = false;
      if (nextWebgl !== activeWebgl) {
        active?.destroy();
        active = nextWebgl ? null : buildLegacyAdapter(effectiveOptions());
        activeWebgl = nextWebgl;
        switched = true;
      }
      if (activeWebgl) {
        const settingsChanged = setWebglThemeSettings(parseWebglThemeConfig(css));
        setLegacyThemeSettings(parseLegacyThemeConfig(css));
        const rendererChanged = active?.setTheme(css) ?? false;
        return switched || settingsChanged || rendererChanged;
      }
      const rendererChanged = active?.setTheme(css) ?? false;
      setWebglThemeSettings(parseWebglThemeConfig(css));
      return switched || rendererChanged;
    },
    tick(currentTimeS, tickOptions) {
      decorateLegacyLines();
      return active?.tick(currentTimeS, tickOptions) ?? "lyrics-missing";
    },
    relayout: measureLines => active?.relayout(measureLines),
    relayoutChangedLines(changedIndices) {
      if (!active) return;
      if (!activeWebgl && typeof active.relayoutChangedLines === "function") {
        active.relayoutChangedLines(changedIndices);
      } else {
        active.relayout(true);
      }
    },
    clear: () => active?.clear(),
    destroy() {
      if (destroyed) return;
      destroyed = true;
      active?.destroy();
      active = null;
    },
    noteUserScroll: () => active?.noteUserScroll(),
    noteVisibilityChange: () => active?.noteVisibilityChange(),
    resumeAutoscroll: () => active?.resumeAutoscroll(),
    clearOnScreenLyrics: () => active?.clearOnScreenLyrics() ?? false,
    scheduleLyricPositionUpdate: (isTicking, retick) => active?.scheduleLyricPositionUpdate(isTicking, retick),
    retickFromPlaybackClock(buildOptions) {
      decorateLegacyLines();
      return active?.retickFromPlaybackClock(buildOptions) ?? "lyrics-missing";
    },
    get container() {
      return active?.container ?? null;
    },
    get lines() {
      return active?.lines ?? [];
    },
    get syncType() {
      return active?.syncType ?? "none";
    },
    get renderer() {
      return active?.renderer ?? null;
    },
  };
}
