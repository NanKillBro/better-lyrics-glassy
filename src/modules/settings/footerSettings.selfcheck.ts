import { strict as assert } from "node:assert";
import { JSDOM } from "jsdom";
import { FOOTER_CLASS } from "@constants";
import {
  FOOTER_EMPTY_ATTR,
  FOOTER_ITEM_ATTR,
  FOOTER_ITEM_KEYS,
  FOOTER_SETTINGS_DEFAULTS,
  normalizeFooterSettings,
  syncEmptyFooterAttribute,
  syncFooterVisibilityAttributes,
} from "@modules/settings/footerSettings";

// Defaults and normalization
{
  const normalized = normalizeFooterSettings({});
  assert.deepEqual(normalized, FOOTER_SETTINGS_DEFAULTS);

  const partial = normalizeFooterSettings({
    isFooterEnabled: undefined,
    isFooterGeniusEnabled: false,
    isFooterDiscordEnabled: false,
  });
  assert.equal(partial.isFooterEnabled, true);
  assert.equal(partial.isFooterGeniusEnabled, false);
  assert.equal(partial.isFooterSubmitToUnisonEnabled, true);
  assert.equal(partial.isFooterRequestSyncedEnabled, true);
  assert.equal(partial.isFooterDiscordEnabled, false);
  assert.equal(partial.isFooterUnisonCreditEnabled, true);
}

function buildFooterDoc(items: string[], glassyLock = false): Document {
  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  const doc = dom.window.document;
  if (glassyLock) {
    doc.documentElement.setAttribute("data-bls-glassy-lock", "1");
  }
  const footer = doc.createElement("div");
  footer.className = FOOTER_CLASS;
  for (const key of items) {
    const child = doc.createElement("div");
    child.setAttribute(FOOTER_ITEM_ATTR, key);
    footer.appendChild(child);
  }
  doc.body.appendChild(footer);
  return doc;
}

// Root visibility attributes toggle cleanly and report changes accurately
{
  const doc = buildFooterDoc([FOOTER_ITEM_KEYS.genius, FOOTER_ITEM_KEYS.discord]);
  assert.equal(syncFooterVisibilityAttributes(doc, FOOTER_SETTINGS_DEFAULTS), false);
  assert.equal(doc.documentElement.hasAttribute("blyrics-hide-footer"), false);

  const changed = syncFooterVisibilityAttributes(doc, {
    ...FOOTER_SETTINGS_DEFAULTS,
    isFooterEnabled: false,
    isFooterGeniusEnabled: false,
    isFooterDiscordEnabled: false,
  });
  assert.equal(changed, true);
  assert.equal(doc.documentElement.hasAttribute("blyrics-hide-footer"), true);
  assert.equal(doc.documentElement.hasAttribute("blyrics-hide-footer-genius"), true);
  assert.equal(doc.documentElement.hasAttribute("blyrics-hide-footer-discord"), true);
  assert.equal(doc.documentElement.hasAttribute("blyrics-hide-footer-unison-credit"), false);

  assert.equal(
    syncFooterVisibilityAttributes(doc, {
      ...FOOTER_SETTINGS_DEFAULTS,
      isFooterEnabled: false,
      isFooterGeniusEnabled: false,
      isFooterDiscordEnabled: false,
    }),
    false
  );
}

// Empty-state tracking respects Glassy Merge Theme's docked source pill vs standalone Better Lyrics Theme
{
  const glassyDoc = buildFooterDoc(
    [FOOTER_ITEM_KEYS.source, FOOTER_ITEM_KEYS.genius, FOOTER_ITEM_KEYS.discord],
    true
  );
  const footer = glassyDoc.getElementsByClassName(FOOTER_CLASS)[0];

  assert.equal(syncEmptyFooterAttribute(glassyDoc, FOOTER_SETTINGS_DEFAULTS), false);
  assert.equal(footer.hasAttribute(FOOTER_EMPTY_ATTR), false);

  const allBottomHidden = {
    ...FOOTER_SETTINGS_DEFAULTS,
    isFooterGeniusEnabled: false,
    isFooterDiscordEnabled: false,
  };
  assert.equal(syncEmptyFooterAttribute(glassyDoc, allBottomHidden), true);
  assert.equal(footer.getAttribute(FOOTER_EMPTY_ATTR), "true");

  // Re-enabling one bottom item clears empty state
  assert.equal(
    syncEmptyFooterAttribute(glassyDoc, { ...allBottomHidden, isFooterDiscordEnabled: true }),
    true
  );
  assert.equal(footer.hasAttribute(FOOTER_EMPTY_ATTR), false);

  // Master switch off forces empty state even when items are enabled
  assert.equal(
    syncEmptyFooterAttribute(glassyDoc, { ...FOOTER_SETTINGS_DEFAULTS, isFooterEnabled: false }),
    true
  );
  assert.equal(footer.getAttribute(FOOTER_EMPTY_ATTR), "true");

  // Non-Glassy theme keeps the source pill inside `.blyrics-footer` unless master footer is disabled
  const standardDoc = buildFooterDoc([FOOTER_ITEM_KEYS.source, FOOTER_ITEM_KEYS.genius], false);
  const standardFooter = standardDoc.getElementsByClassName(FOOTER_CLASS)[0];
  assert.equal(syncEmptyFooterAttribute(standardDoc, { ...FOOTER_SETTINGS_DEFAULTS, isFooterGeniusEnabled: false }), false);
  assert.equal(standardFooter.hasAttribute(FOOTER_EMPTY_ATTR), false);
}
