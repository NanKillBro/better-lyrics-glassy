import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
  applyInstrumentalStyleAttribute,
  INSTRUMENTAL_STYLE_ATTR,
  INSTRUMENTAL_STYLE_DEFAULT,
  normalizeInstrumentalStyle,
  readInstrumentalStyle,
} from "@modules/settings/instrumentalStyle";

assert.equal(INSTRUMENTAL_STYLE_DEFAULT, "dots");
assert.equal(normalizeInstrumentalStyle("dots"), "dots");
assert.equal(normalizeInstrumentalStyle("note"), "note");
assert.equal(normalizeInstrumentalStyle(undefined), "dots");
assert.equal(normalizeInstrumentalStyle("unknown"), "dots");

const dom = new JSDOM("<!doctype html><html><body></body></html>");
const doc = dom.window.document;

assert.equal(readInstrumentalStyle(doc), "dots");
assert.equal(doc.documentElement.hasAttribute(INSTRUMENTAL_STYLE_ATTR), false);

assert.equal(applyInstrumentalStyleAttribute(doc, "dots"), false);
assert.equal(applyInstrumentalStyleAttribute(doc, "note"), true);
assert.equal(readInstrumentalStyle(doc), "note");
assert.equal(doc.documentElement.getAttribute(INSTRUMENTAL_STYLE_ATTR), "note");

assert.equal(applyInstrumentalStyleAttribute(doc, "note"), false);
assert.equal(applyInstrumentalStyleAttribute(doc, "dots"), true);
assert.equal(readInstrumentalStyle(doc), "dots");
assert.equal(doc.documentElement.hasAttribute(INSTRUMENTAL_STYLE_ATTR), false);

console.log("instrumentalStyle selfcheck passed");
