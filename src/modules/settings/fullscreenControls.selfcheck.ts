import { strict as assert } from "node:assert";
import { migrateFullscreenControlsPref } from "@modules/settings/fullscreenControls";

assert.equal(migrateFullscreenControlsPref({}), "off");
assert.equal(migrateFullscreenControlsPref({ isFullscreenControlsEnabled: true }), "off");
assert.equal(migrateFullscreenControlsPref({ isFullscreenControlsEnabled: false }), "off");
assert.equal(migrateFullscreenControlsPref({ fullscreenControlsPref: "on", isFullscreenControlsEnabled: false }), "on");
assert.equal(migrateFullscreenControlsPref({ fullscreenControlsPref: "auto", isFullscreenControlsEnabled: false }), "auto");
assert.equal(migrateFullscreenControlsPref({ fullscreenControlsPref: "off" }), "off");
assert.equal(migrateFullscreenControlsPref({ fullscreenControlsPref: "bogus" }), "off");
assert.equal(
  migrateFullscreenControlsPref({ fullscreenControlsPref: "bogus", isFullscreenControlsEnabled: false }),
  "off"
);
