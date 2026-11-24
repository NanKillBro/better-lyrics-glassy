import assert from "node:assert/strict";
import {
  BIDI_SENSITIVE_CLASS,
  LONG_WORD_GROUP_CLASS,
  ROMANIZED_LYRICS_CLASS,
  SWEEP_CELL_CLASS,
  TRANSLATED_LYRICS_CLASS,
  WORD_CLASS,
  WORD_GROUP_CLASS,
} from "@braccato/core/constants";
import {
  parseThemeConfig as parseLegacyThemeConfig,
  setThemeSettings as setLegacyThemeSettings,
} from "@braccato/core-legacy/themeSettings";
import {
  parseThemeConfig as parseWebglThemeConfig,
  setThemeSettings as setWebglThemeSettings,
} from "@braccato/core/themeSettings";
import {
  injectRomanization,
  injectTranslation,
  installWordWobblePatch,
  lyricBuildSettingsKey,
  normalizeWordWobbleAnimateArgs,
  registerThemeSetting,
  retargetPerWordWobble,
  type LineData,
  type WobbleLineData,
} from "@modules/ui/lyricsRenderer";
import { readRendererMode, WEBGL_LYRICS_ATTR } from "@modules/ui/rendererMode";

function makeTargetWithClass(className: string | null) {
  return {
    classList: {
      contains: (token: string) => className !== null && token === className,
    },
  };
}

function makeFakeElement(
  classes: string[],
  options: {
    parentElement?: HTMLElement | null;
    bidiSensitive?: boolean;
    content?: string;
    textContent?: string;
  } = {}
): HTMLElement {
  const classSet = new Set(classes);
  return {
    classList: {
      contains: (token: string) => classSet.has(token),
    },
    parentElement: options.parentElement ?? null,
    closest: (selector: string) =>
      selector === `.${BIDI_SENSITIVE_CLASS}` && options.bidiSensitive ? ({} as Element) : null,
    dataset: options.content !== undefined ? { content: options.content } : {},
    textContent: options.textContent ?? "",
  } as unknown as HTMLElement;
}

// 1. Rewrites un-eased core word-wobble calls without mutating inputs
{
  const f0: Keyframe = { transform: "scaleX(1)" };
  const f1: Keyframe = { transform: "translateX(0.05em) scaleX(1.025)", offset: 0.125, easing: "ease-in-out" };
  const f2: Keyframe = { transform: "translateX(0) scaleX(1)", offset: 0.75 };
  const f3: Keyframe = { transform: "scaleX(1)", easing: "ease-out" };
  const keyframes = [f0, f1, f2, f3];
  const options: KeyframeAnimationOptions = { duration: 1000, easing: "ease", fill: "forwards" };

  for (const cls of [WORD_GROUP_CLASS, WORD_CLASS]) {
    const out = normalizeWordWobbleAnimateArgs(makeTargetWithClass(cls), keyframes, options);
    assert.notEqual(out.keyframes, keyframes);
    assert.notEqual(out.options, options);
    assert.equal((out.keyframes as Keyframe[])[0].easing, "ease");
    assert.equal((out.keyframes as Keyframe[])[1].easing, "ease-in-out");
    assert.equal((out.keyframes as Keyframe[])[2].easing, "ease");
    assert.equal((out.keyframes as Keyframe[])[3].easing, "ease-out");
    assert.equal((out.options as KeyframeAnimationOptions).easing, "linear");
  }
  assert.equal(f0.easing, undefined, "input keyframe not mutated");
  assert.equal(options.easing, "ease", "input options not mutated");
}

// 2. Passes through already-fixed calls and non-word-group elements untouched
{
  const fixedKeyframes = [
    { transform: "scaleX(1)", easing: "ease" },
    { transform: "translateX(0.05em) scaleX(1.025)", offset: 0.125, easing: "ease-in-out" },
    { transform: "translateX(0) scaleX(1)", offset: 0.75, easing: "ease" },
    { transform: "scaleX(1)", easing: "ease-out" },
  ];
  const fixedOptions: KeyframeAnimationOptions = { duration: 1000, easing: "linear", fill: "forwards" };
  const unchanged = normalizeWordWobbleAnimateArgs(makeTargetWithClass(WORD_GROUP_CLASS), fixedKeyframes, fixedOptions);
  assert.equal(unchanged.keyframes, fixedKeyframes);
  assert.equal(unchanged.options, fixedOptions);

  const nonWordKeyframes = [
    { transform: "scaleX(1)" },
    { transform: "scaleX(1.025)", offset: 0.125, easing: "ease-in-out" },
    { transform: "scaleX(1)", offset: 0.75 },
    { transform: "scaleX(1)", easing: "ease-out" },
  ];
  const nonWordOptions: KeyframeAnimationOptions = { duration: 1000, easing: "ease", fill: "forwards" };
  const ignored = normalizeWordWobbleAnimateArgs(makeTargetWithClass(null), nonWordKeyframes, nonWordOptions);
  assert.equal(ignored.keyframes, nonWordKeyframes);
  assert.equal(ignored.options, nonWordOptions);
}

// 3. installWordWobblePatch is idempotent and intercepts Element.prototype.animate cleanly
{
  const recorded: Array<{ keyframes: Keyframe[]; options: KeyframeAnimationOptions }> = [];
  class FakeElement {
    classList: { contains: (token: string) => boolean };
    constructor(hasWordGroup: boolean) {
      this.classList = { contains: (token: string) => hasWordGroup && token === WORD_GROUP_CLASS };
    }
    animate(keyframes: Keyframe[], options: KeyframeAnimationOptions): Animation {
      recorded.push({ keyframes, options });
      return {} as Animation;
    }
  }
  const fakeWindow = { Element: FakeElement };
  installWordWobblePatch(fakeWindow);
  installWordWobblePatch(fakeWindow);

  const wordGroup = new FakeElement(true);
  wordGroup.animate(
    [
      { transform: "scaleX(1)" },
      { transform: "translateX(0.05em) scaleX(1.025)", offset: 0.125, easing: "ease-in-out" },
      { transform: "translateX(0) scaleX(1)", offset: 0.75 },
      { transform: "scaleX(1)", easing: "ease-out" },
    ],
    { duration: 1000, easing: "ease", fill: "forwards" }
  );
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].keyframes[0].easing, "ease");
  assert.equal(recorded[0].keyframes[2].easing, "ease");
  assert.equal(recorded[0].options.easing, "linear");
}

// 4. retargetPerWordWobble splits grouped words to per-syllable targets, preserving bidi & joining scripts
{
  const latinGroup = makeFakeElement([WORD_GROUP_CLASS], { content: "hello" });
  const syl1 = makeFakeElement([WORD_CLASS], { parentElement: latinGroup });
  const syl1Hi = makeFakeElement([WORD_CLASS], { parentElement: latinGroup });
  const longGroup = makeFakeElement([WORD_GROUP_CLASS, LONG_WORD_GROUP_CLASS], { content: "superlongword" });
  const longPart = makeFakeElement([WORD_CLASS], { parentElement: longGroup });
  const longPartHi = makeFakeElement([WORD_CLASS], { parentElement: longGroup });
  const arabicGroup = makeFakeElement([WORD_GROUP_CLASS], { content: "مرحبا" });
  const arabicPart = makeFakeElement([WORD_CLASS], { parentElement: arabicGroup });
  const arabicPartHi = makeFakeElement([WORD_CLASS], { parentElement: arabicGroup });
  const bidiGroup = makeFakeElement([WORD_GROUP_CLASS], { content: "test", bidiSensitive: true });
  const bidiPart = makeFakeElement([WORD_CLASS], { parentElement: bidiGroup });
  const bidiPartHi = makeFakeElement([WORD_CLASS], { parentElement: bidiGroup });

  const lines: WobbleLineData[] = [
    {
      parts: [
        { lyricElement: syl1, highlightElement: syl1Hi, wobbleElements: [latinGroup] },
        { lyricElement: longPart, highlightElement: longPartHi, wobbleElements: [longGroup] },
        { lyricElement: arabicPart, highlightElement: arabicPartHi, wobbleElements: [arabicGroup] },
        { lyricElement: bidiPart, highlightElement: bidiPartHi, wobbleElements: [bidiGroup] },
      ],
    },
  ];

  retargetPerWordWobble(lines);
  assert.deepEqual(lines[0].parts[0].wobbleElements, [syl1, syl1Hi]);
  assert.deepEqual(lines[0].parts[1].wobbleElements, [longPart, longPartHi]);
  assert.deepEqual(lines[0].parts[2].wobbleElements, [arabicGroup], "Arabic joining group kept");
  assert.deepEqual(lines[0].parts[3].wobbleElements, [bidiGroup], "bidi-sensitive group kept");
}

// 5. Renderer mode & dual themeSettings registry sync
{
  const legacyDoc = { documentElement: { hasAttribute: () => false } } as unknown as Document;
  const webglDoc = {
    documentElement: { hasAttribute: (attr: string) => attr === WEBGL_LYRICS_ATTR },
  } as unknown as Document;

  assert.equal(readRendererMode(legacyDoc), false);
  assert.equal(readRendererMode(webglDoc), true);

  registerThemeSetting("blyrics-selfcheck-flag", false, true);
  setLegacyThemeSettings(parseLegacyThemeConfig("/* blyrics-selfcheck-flag = true; */"));
  setWebglThemeSettings(parseWebglThemeConfig("/* blyrics-selfcheck-flag = true; */"));
  assert.ok(lyricBuildSettingsKey(legacyDoc).includes("blyrics-selfcheck-flag=true"));
  assert.ok(lyricBuildSettingsKey(webglDoc).includes("blyrics-selfcheck-flag=true"));
  setLegacyThemeSettings(parseLegacyThemeConfig("/* blyrics-selfcheck-flag = false; */"));
  setWebglThemeSettings(parseWebglThemeConfig("/* blyrics-selfcheck-flag = false; */"));
  assert.ok(lyricBuildSettingsKey(legacyDoc).includes("blyrics-selfcheck-flag=false"));
  assert.ok(lyricBuildSettingsKey(webglDoc).includes("blyrics-selfcheck-flag=false"));
}

// 6. Legacy mode decoration injection mounts 1.20.0 DOM without sweep cells
{
  const createNode = (tag: string, text = ""): Record<string, unknown> => {
    const classSet = new Set<string>();
    const attrs = new Map<string, string>();
    const children: Array<Record<string, unknown>> = [];
    let textValue = text;
    const node: Record<string, unknown> = {
      nodeType: tag === "#text" ? 3 : 1,
      tagName: tag.toUpperCase(),
      children,
      childNodes: children,
      dataset: {},
      style: { setProperty: () => {}, removeProperty: () => {}, getPropertyValue: () => "" },
      classList: {
        add: (...cls: string[]) => cls.forEach(c => classSet.add(c)),
        remove: (...cls: string[]) => cls.forEach(c => classSet.delete(c)),
        contains: (c: string) => classSet.has(c),
      },
      get className() {
        return Array.from(classSet).join(" ");
      },
      set className(v: string) {
        classSet.clear();
        for (const t of String(v).split(/\s+/).filter(Boolean)) classSet.add(t);
      },
      setAttribute: (k: string, v: string) => attrs.set(k, v),
      getAttribute: (k: string) => attrs.get(k) ?? null,
      hasAttribute: (k: string) => attrs.has(k),
      get textContent(): string {
        if (this.nodeType === 3) return textValue;
        return children.map(c => String(c.textContent ?? "")).join("");
      },
      set textContent(v: string) {
        textValue = String(v);
        children.length = 0;
      },
      appendChild(child: Record<string, unknown>) {
        child.parentNode = node;
        child.parentElement = node;
        children.push(child);
        return child;
      },
      insertBefore(newChild: Record<string, unknown>, refChild: Record<string, unknown> | null) {
        newChild.parentNode = node;
        newChild.parentElement = node;
        const idx = refChild ? children.indexOf(refChild) : -1;
        if (idx >= 0) children.splice(idx, 0, newChild);
        else children.push(newChild);
        return newChild;
      },
      remove() {
        const parent = node.parentElement as { children?: Array<Record<string, unknown>> } | null;
        if (!parent?.children) return;
        const idx = parent.children.indexOf(node);
        if (idx >= 0) parent.children.splice(idx, 1);
      },
      querySelector(selector: string): Record<string, unknown> | null {
        const wanted = selector.startsWith(".") ? selector.slice(1) : null;
        for (const child of children) {
          if (child.nodeType !== 1) continue;
          if (wanted && (child.classList as { contains: (t: string) => boolean }).contains(wanted)) return child;
          const nested = (child.querySelector as (s: string) => Record<string, unknown> | null)(selector);
          if (nested) return nested;
        }
        return null;
      },
      closest: () => null,
    };
    return node;
  };

  const legacyDoc: Record<string, unknown> = {
    documentElement: { hasAttribute: () => false },
    createElement: (tag: string) => {
      const el = createNode(tag);
      el.ownerDocument = legacyDoc;
      return el;
    },
    createTextNode: (t: string) => {
      const txt = createNode("#text", t);
      txt.ownerDocument = legacyDoc;
      return txt;
    },
  };

  const lyricEl = createNode("div");
  lyricEl.ownerDocument = legacyDoc;
  const line: LineData = {
    time: 1,
    duration: 3,
    lyricElement: lyricEl as unknown as HTMLElement,
    animations: [],
    parts: [],
    isScrolled: false,
    isAnimationPlayStatePlaying: false,
    accumulatedOffsetMs: 0,
    isAnimating: false,
    lastAnimSetupAt: 0,
    isSelected: false,
    height: -1,
    position: -1,
    decorations: new Map(),
  };

  const timedParts = [{ startTimeMs: 1000, durationMs: 1500, words: "konnichiwa", isBackground: false }];
  injectRomanization(legacyDoc as unknown as Document, lyricEl as unknown as HTMLElement, line, "konnichiwa", timedParts);
  injectTranslation(legacyDoc as unknown as Document, lyricEl as unknown as HTMLElement, "hello", "en");
  assert.ok((lyricEl.querySelector as (s: string) => unknown)(`.${ROMANIZED_LYRICS_CLASS}`));
  assert.ok((lyricEl.querySelector as (s: string) => unknown)(`.${TRANSLATED_LYRICS_CLASS}`));
  assert.equal((lyricEl.querySelector as (s: string) => unknown)(`.${SWEEP_CELL_CLASS}`), null);
  assert.equal(line.parts.length, 1);
}

console.log("lyricsRenderer selfcheck passed");
