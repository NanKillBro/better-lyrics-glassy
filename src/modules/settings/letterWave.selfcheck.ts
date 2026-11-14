import { strict as assert } from "node:assert";
import { migrateLetterWavePref } from "@modules/settings/letterWave";

assert.equal(migrateLetterWavePref({}), "off");
assert.equal(migrateLetterWavePref({ isLetterWaveEnabled: false }), "off");
assert.equal(migrateLetterWavePref({ isLetterWaveEnabled: true }), "on");
assert.equal(migrateLetterWavePref({ letterWavePref: "auto", isLetterWaveEnabled: true }), "auto");
assert.equal(migrateLetterWavePref({ letterWavePref: "on", isLetterWaveEnabled: false }), "on");
assert.equal(migrateLetterWavePref({ letterWavePref: "off", isLetterWaveEnabled: true }), "off");
assert.equal(migrateLetterWavePref({ letterWavePref: "bogus" }), "off");
assert.equal(migrateLetterWavePref({ letterWavePref: "bogus", isLetterWaveEnabled: true }), "on");
