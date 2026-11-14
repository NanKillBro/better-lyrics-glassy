import assert from "node:assert/strict";
import { BIDI_SENSITIVE_CLASS, LONG_WORD_GROUP_CLASS, WORD_CLASS, WORD_GROUP_CLASS } from "@braccato/core/constants";
import {
  installWordWobblePatch,
  normalizeWordWobbleAnimateArgs,
  retargetPerWordWobble,
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
        imageLayers: { glow: wifeGlowHighlight, glowLetters: [], highlight: wifeGlowHighlight },
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
  assert.deepEqual(line.parts[2].wobbleElements, [longGroup], "long word group stays untouched");
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

console.log("lyricsRenderer selfcheck passed");
