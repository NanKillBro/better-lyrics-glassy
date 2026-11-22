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
import { parseThemeConfig as parseLegacyThemeConfig, setThemeSettings as setLegacyThemeSettings } from "@braccato/core-legacy/themeSettings";
import { parseThemeConfig as parseModernThemeConfig, setThemeSettings as setModernThemeSettings } from "@braccato/core/themeSettings";
import { COMPOSITE_LYRICS_ATTR, readRendererMode } from "@modules/ui/rendererMode";
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
  const onceWrapped = FakeElement.prototype.animate;
  installWordWobblePatch(fakeWindow);
  assert.equal(FakeElement.prototype.animate, onceWrapped, "patch is idempotent per prototype");

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

// 4. retargetPerWordWobble retargets grouped syllables onto each word span while keeping unsafe groups intact
{
  const housewifeGroup = makeFakeElement([WORD_GROUP_CLASS], { content: "housewife" });
  const housewifeHighlightGroup = makeFakeElement([WORD_GROUP_CLASS], { content: "housewife" });
  const houseSpan = makeFakeElement([WORD_CLASS], { parentElement: housewifeGroup, content: "house" });
  const houseHighlight = makeFakeElement([WORD_CLASS], { content: "house" });
  const wifeSpan = makeFakeElement([WORD_CLASS], { parentElement: housewifeGroup, content: "wife" });
  const wifeHighlight = makeFakeElement([WORD_CLASS], { content: "wife" });
  const wifeGlowHighlight = makeFakeElement([WORD_CLASS], { content: "wife" });

  const longGroup = makeFakeElement([WORD_GROUP_CLASS, LONG_WORD_GROUP_CLASS], { content: "superlongcompound" });
  const longSpan = makeFakeElement([WORD_CLASS], { parentElement: longGroup, content: "superlongcompound" });
  const longHighlight = makeFakeElement([WORD_CLASS], { content: "superlongcompound" });

  const bidiGroup = makeFakeElement([WORD_GROUP_CLASS], { bidiSensitive: true, content: "مرحبا" });
  const bidiSpan = makeFakeElement([WORD_CLASS], { parentElement: bidiGroup, content: "مرحبا" });
  const bidiHighlight = makeFakeElement([WORD_CLASS], { content: "مرحبا" });

  const line: WobbleLineData = {
    parts: [
      {
        time: 61.832,
        duration: 0.4,
        lyricElement: houseSpan,
        highlightElement: houseHighlight,
        wobbleElements: [housewifeGroup, housewifeHighlightGroup],
        animations: [],
        wordState: "upcoming",
      },
      {
        time: 62.232,
        duration: 1.015,
        lyricElement: wifeSpan,
        highlightElement: wifeHighlight,
        imageLayers: { highlight: wifeGlowHighlight },
        wobbleElements: [],
        animations: [],
        wordState: "upcoming",
      },
      {
        time: 63,
        duration: 0.5,
        lyricElement: longSpan,
        highlightElement: longHighlight,
        wobbleElements: [longGroup],
        animations: [],
        wordState: "upcoming",
      },
      {
        time: 64,
        duration: 0.5,
        lyricElement: bidiSpan,
        highlightElement: bidiHighlight,
        wobbleElements: [bidiGroup],
        animations: [],
        wordState: "upcoming",
      },
    ],
  };

  retargetPerWordWobble([line]);

  assert.deepEqual(line.parts[0].wobbleElements, [houseSpan, houseHighlight]);
  assert.deepEqual(line.parts[1].wobbleElements, [wifeSpan, wifeHighlight, wifeGlowHighlight]);
  assert.deepEqual(line.parts[2].wobbleElements, [longSpan, longHighlight], "long word group retargets like any other");
  assert.deepEqual(line.parts[3].wobbleElements, [bidiGroup], "bidi-sensitive group stays untouched");

  // Simulate async timed romanization appending new parts to the same line
  const romGroup = makeFakeElement([WORD_GROUP_CLASS], { content: "kanji" });
  const romSpan = makeFakeElement([WORD_CLASS], { parentElement: romGroup, content: "kan" });
  const romHighlight = makeFakeElement([WORD_CLASS], { content: "kan" });
  line.parts.push({
    time: 61.832,
    duration: 0.4,
    lyricElement: romSpan,
    highlightElement: romHighlight,
    wobbleElements: [],
    animations: [],
    wordState: "upcoming",
  });

  retargetPerWordWobble([line]);
  assert.deepEqual(line.parts[4].wobbleElements, [romSpan, romHighlight]);
}

// 5. Dual-registry theme settings stay synchronized across modern and legacy docs
{
  const flag = registerThemeSetting("blyrics-selfcheck-dual-flag", false, true);
  assert.equal(flag.getBooleanValue(), false);
  const css = "/* blyrics-selfcheck-dual-flag = true; */";
  setModernThemeSettings(parseModernThemeConfig(css));
  setLegacyThemeSettings(parseLegacyThemeConfig(css));
  assert.equal(flag.getBooleanValue(), true);
  const legacyDoc = { documentElement: { hasAttribute: () => false } } as unknown as Document;
  const compositeDoc = { documentElement: { hasAttribute: (a: string) => a === COMPOSITE_LYRICS_ATTR } } as unknown as Document;
  assert.equal(readRendererMode(legacyDoc), false);
  assert.equal(readRendererMode(compositeDoc), true);
  const sortedSettings = (d: Document) => lyricBuildSettingsKey(d).split(";").sort().join(";");
  assert.equal(sortedSettings(compositeDoc), sortedSettings(legacyDoc));
  assert.ok(lyricBuildSettingsKey(legacyDoc).includes("blyrics-selfcheck-dual-flag=true"));
}

// 6. Mode-aware injectRomanization and injectTranslation delegate by document mode
{
  const makeMiniDoc = (composite: boolean) => {
    const createNode = (tagName: string, text?: string): Record<string, unknown> => {
      const classes = new Set<string>();
      const attrs = new Map<string, string>();
      const styles = new Map<string, string>();
      const children: Array<Record<string, unknown>> = [];
      let textValue = text ?? "";
      const node: Record<string, unknown> = {
        tagName: tagName.toUpperCase(),
        nodeType: tagName === "#text" ? 3 : 1,
        children,
        childNodes: children,
        parentNode: null as unknown,
        parentElement: null as unknown,
        ownerDocument: null as unknown,
        dataset: {} as Record<string, string>,
        dir: "",
        get className() {
          return Array.from(classes).join(" ");
        },
        classList: {
          add: (...tokens: string[]) => tokens.forEach(t => classes.add(t)),
          contains: (t: string) => classes.has(t),
          remove: (...tokens: string[]) => tokens.forEach(t => classes.delete(t)),
        },
        style: {
          setProperty: (k: string, v: string) => styles.set(k, v),
          getPropertyValue: (k: string) => styles.get(k) ?? "",
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

    const doc: Record<string, unknown> = {
      documentElement: { hasAttribute: (attr: string) => composite && attr === COMPOSITE_LYRICS_ATTR },
      createElement: (tag: string) => {
        const el = createNode(tag);
        el.ownerDocument = doc;
        return el;
      },
      createTextNode: (t: string) => {
        const txt = createNode("#text", t);
        txt.ownerDocument = doc;
        return txt;
      },
    };
    return { doc: doc as unknown as Document, createNode };
  };

  const makeLine = (createNode: (tag: string) => Record<string, unknown>, doc: Document) => {
    const lyricEl = createNode("div");
    lyricEl.ownerDocument = doc;
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
    return { lyricEl: lyricEl as unknown as HTMLElement, line };
  };

  const timedParts = [{ startTimeMs: 1000, durationMs: 1500, words: "konnichiwa", isBackground: false }];

  const legacyEnv = makeMiniDoc(false);
  const legacyTarget = makeLine(legacyEnv.createNode, legacyEnv.doc);
  injectRomanization(legacyEnv.doc, legacyTarget.lyricEl, legacyTarget.line, "konnichiwa", timedParts);
  injectTranslation(legacyEnv.doc, legacyTarget.lyricEl, "hello", "en");
  assert.ok(legacyTarget.lyricEl.querySelector(`.${ROMANIZED_LYRICS_CLASS}`), "legacy timed romanization mounted");
  assert.ok(legacyTarget.lyricEl.querySelector(`.${TRANSLATED_LYRICS_CLASS}`), "legacy translation mounted");
  assert.equal(legacyTarget.lyricEl.querySelector(`.${SWEEP_CELL_CLASS}`), null, "legacy mode must not emit 1.21.6 sweep DOM");
  assert.equal(legacyTarget.line.parts.length, 1);
  assert.equal(legacyTarget.line.parts[0].sweep, undefined);

  const compositeEnv = makeMiniDoc(true);
  const compositeTarget = makeLine(compositeEnv.createNode, compositeEnv.doc);
  injectRomanization(compositeEnv.doc, compositeTarget.lyricEl, compositeTarget.line, "konnichiwa", timedParts);
  injectTranslation(compositeEnv.doc, compositeTarget.lyricEl, "hello", "en");
  assert.ok(compositeTarget.lyricEl.querySelector(`.${ROMANIZED_LYRICS_CLASS}`), "composite timed romanization mounted");
  assert.ok(compositeTarget.lyricEl.querySelector(`.${TRANSLATED_LYRICS_CLASS}`), "composite translation mounted");
  assert.ok(compositeTarget.lyricEl.querySelector(`.${SWEEP_CELL_CLASS}`), "composite mode emits 1.21.6 sweep DOM");
  assert.equal(compositeTarget.line.parts.length, 1);
  assert.ok(Array.isArray(compositeTarget.line.parts[0].sweep), "composite mode populates PartData.sweep");
}

console.log("lyricsRenderer selfcheck passed");
