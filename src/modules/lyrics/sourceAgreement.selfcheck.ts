import assert from "node:assert/strict";

if (!(globalThis as Record<string, unknown>).chrome) {
  (globalThis as Record<string, unknown>).chrome = {
    runtime: {
      getManifest: () => ({ externally_connectable: {} }),
    },
  };
}

const { agreeingKeys, lyricsMatch } = await import("@/modules/lyrics/sourceAgreement");

const A = "alpha beta gamma delta";
const B = "completely unrelated words here";
const C = "another entirely different line";
const D = "one more text without overlap";

assert.equal(lyricsMatch(A, A), true, "identical text matches");
assert.equal(lyricsMatch(A, B), false, "unrelated text does not match");

{
  const agreed = agreeingKeys([
    { key: "a", source: "x", text: A },
    { key: "b", source: "y", text: A },
    { key: "c", source: "z", text: A },
    { key: "d", source: "w", text: B },
  ]);
  assert.deepEqual(agreed, ["a", "b", "c"], "a majority of three of four is allowed");
}

{
  const agreed = agreeingKeys([
    { key: "a", source: "x", text: A },
    { key: "b", source: "y", text: A },
    { key: "c", source: "z", text: B },
    { key: "d", source: "w", text: C },
  ]);
  assert.deepEqual(agreed, [], "two of four is not more than half");
}

{
  const agreed = agreeingKeys([
    { key: "a", source: "x", text: A },
    { key: "b", source: "y", text: A },
    { key: "c", source: "z", text: B },
  ]);
  assert.deepEqual(agreed, ["a", "b"], "two of three is more than half");
}

{
  const agreed = agreeingKeys([
    { key: "a1", source: "x", text: A },
    { key: "a2", source: "x", text: A },
    { key: "b", source: "y", text: A },
    { key: "c", source: "z", text: B },
  ]);
  assert.deepEqual(agreed, ["a1", "a2", "b"], "variants of one source count once but all of them pass");
}

{
  const agreed = agreeingKeys([
    { key: "a1", source: "x", text: B },
    { key: "a2", source: "x", text: A },
    { key: "b", source: "y", text: A },
  ]);
  assert.deepEqual(agreed, [], "a source is judged by its first entry");
}

{
  const agreed = agreeingKeys([
    { key: "a", source: "v", text: A },
    { key: "b", source: "w", text: C },
    { key: "c", source: "x", text: A },
    { key: "d", source: "y", text: D },
    { key: "e", source: "z", text: A },
  ]);
  assert.deepEqual(agreed, ["a", "c", "e"], "the best agreeing group wins in a larger field");
}

{
  const agreed = agreeingKeys([
    { key: "c", source: "z", text: B },
    { key: "b", source: "y", text: A },
    { key: "a", source: "x", text: A },
  ]);
  assert.deepEqual(agreed, ["b", "a"], "results keep the given best-first order");
}

{
  assert.deepEqual(agreeingKeys([{ key: "a", source: "x", text: A }]), [], "a single source cannot vouch for itself");
  assert.deepEqual(
    agreeingKeys([
      { key: "a1", source: "x", text: A },
      { key: "a2", source: "x", text: A },
    ]),
    [],
    "variants of one source are still a single voice"
  );
}

console.log("source agreement self-check passed");
