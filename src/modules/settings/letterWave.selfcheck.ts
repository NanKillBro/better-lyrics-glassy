import { strict as assert } from "node:assert";
import {
  ensureLetterWaveSetting,
  migrateLetterWavePref,
  withLetterWaveSetting,
} from "@modules/settings/letterWave";
import { parseThemeConfig } from "@braccato/core/themeSettings";

assert.equal(migrateLetterWavePref({}), "off");
assert.equal(migrateLetterWavePref({ isLetterWaveEnabled: false }), "off");
assert.equal(migrateLetterWavePref({ isLetterWaveEnabled: true }), "on");
assert.equal(migrateLetterWavePref({ letterWavePref: "auto", isLetterWaveEnabled: true }), "auto");
assert.equal(migrateLetterWavePref({ letterWavePref: "on", isLetterWaveEnabled: false }), "on");
assert.equal(migrateLetterWavePref({ letterWavePref: "off", isLetterWaveEnabled: true }), "off");
assert.equal(migrateLetterWavePref({ letterWavePref: "bogus" }), "off");
assert.equal(migrateLetterWavePref({ letterWavePref: "bogus", isLetterWaveEnabled: true }), "on");

assert.equal(parseThemeConfig(withLetterWaveSetting("", "off")).get("blyrics-letter-wave"), "false");
assert.equal(parseThemeConfig(withLetterWaveSetting("", "on")).get("blyrics-letter-wave"), "true");
assert.equal(parseThemeConfig(withLetterWaveSetting("", "auto")).get("blyrics-letter-wave"), "false");
assert.equal(
  parseThemeConfig(withLetterWaveSetting("/* blyrics-letter-wave = true; */", "off")).get("blyrics-letter-wave"),
  "false"
);
assert.equal(
  parseThemeConfig(withLetterWaveSetting("/* blyrics-letter-wave = true; */", "auto")).get("blyrics-letter-wave"),
  "true"
);
assert.equal(parseThemeConfig(ensureLetterWaveSetting("")).get("blyrics-letter-wave"), "false");
assert.equal(
  parseThemeConfig(ensureLetterWaveSetting("/* blyrics-letter-wave = true; */")).get("blyrics-letter-wave"),
  "true"
);
