import { strict as assert } from "node:assert";

if (!(globalThis as Record<string, unknown>).chrome) {
  (globalThis as Record<string, unknown>).chrome = {
    runtime: {
      getManifest: () => ({ externally_connectable: {} }),
    },
  };
}

const { LYRICS_NEGATIVE_CACHE_TTL_MS, UNISON_NEGATIVE_CACHE_TTL_MS } = await import("./constants");

assert.ok(UNISON_NEGATIVE_CACHE_TTL_MS > 0, "unison negative TTL is positive");
assert.ok(
  UNISON_NEGATIVE_CACHE_TTL_MS < LYRICS_NEGATIVE_CACHE_TTL_MS,
  "unison negative TTL must stay shorter than the general negative TTL"
);

console.log("constants selfcheck passed");
