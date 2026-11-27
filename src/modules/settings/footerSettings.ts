import { FOOTER_CLASS } from "@constants";

export interface FooterSettings {
  isFooterEnabled: boolean;
  isFooterGeniusEnabled: boolean;
  isFooterSubmitToUnisonEnabled: boolean;
  isFooterRequestSyncedEnabled: boolean;
  isFooterDiscordEnabled: boolean;
  isFooterUnisonCreditEnabled: boolean;
}

export const FOOTER_SETTINGS_DEFAULTS: FooterSettings = {
  isFooterEnabled: true,
  isFooterGeniusEnabled: true,
  isFooterSubmitToUnisonEnabled: true,
  isFooterRequestSyncedEnabled: true,
  isFooterDiscordEnabled: true,
  isFooterUnisonCreditEnabled: true,
};

export const FOOTER_SETTING_KEYS = Object.keys(FOOTER_SETTINGS_DEFAULTS) as readonly (keyof FooterSettings)[];

export const FOOTER_ITEM_ATTR = "data-blyrics-footer-item" as const;
export const FOOTER_EMPTY_ATTR = "data-footer-empty" as const;

export const FOOTER_ITEM_KEYS = {
  source: "source",
  genius: "genius",
  submitUnison: "submit-unison",
  requestSynced: "request-synced",
  shaders: "shaders",
  discord: "discord",
  unisonCredit: "unison-credit",
} as const;

const FOOTER_HIDDEN_ATTR = "blyrics-hide-footer";
const GLASSY_THEME_LOCK_ATTRIBUTE = "data-bls-glassy-lock";
const MERGETHEME_SOURCE_CLONE_ATTR = "data-nankill-source-clone";

const ITEM_VISIBILITY_RULES: readonly {
  settingKey: keyof Omit<FooterSettings, "isFooterEnabled">;
  itemKey: string;
  hiddenAttr: string;
}[] = [
  {
    settingKey: "isFooterGeniusEnabled",
    itemKey: FOOTER_ITEM_KEYS.genius,
    hiddenAttr: "blyrics-hide-footer-genius",
  },
  {
    settingKey: "isFooterSubmitToUnisonEnabled",
    itemKey: FOOTER_ITEM_KEYS.submitUnison,
    hiddenAttr: "blyrics-hide-footer-submit-unison",
  },
  {
    settingKey: "isFooterRequestSyncedEnabled",
    itemKey: FOOTER_ITEM_KEYS.requestSynced,
    hiddenAttr: "blyrics-hide-footer-request-synced",
  },
  {
    settingKey: "isFooterDiscordEnabled",
    itemKey: FOOTER_ITEM_KEYS.discord,
    hiddenAttr: "blyrics-hide-footer-discord",
  },
  {
    settingKey: "isFooterUnisonCreditEnabled",
    itemKey: FOOTER_ITEM_KEYS.unisonCredit,
    hiddenAttr: "blyrics-hide-footer-unison-credit",
  },
];

const ITEM_SETTING_MAP = new Map<string, keyof Omit<FooterSettings, "isFooterEnabled">>(
  ITEM_VISIBILITY_RULES.map(rule => [rule.itemKey, rule.settingKey])
);

export function normalizeFooterSettings(raw: Partial<Record<keyof FooterSettings, unknown>>): FooterSettings {
  return {
    isFooterEnabled: raw.isFooterEnabled !== false,
    isFooterGeniusEnabled: raw.isFooterGeniusEnabled !== false,
    isFooterSubmitToUnisonEnabled: raw.isFooterSubmitToUnisonEnabled !== false,
    isFooterRequestSyncedEnabled: raw.isFooterRequestSyncedEnabled !== false,
    isFooterDiscordEnabled: raw.isFooterDiscordEnabled !== false,
    isFooterUnisonCreditEnabled: raw.isFooterUnisonCreditEnabled !== false,
  };
}

function toggleRootAttribute(root: Element, attr: string, force: boolean): boolean {
  const prev = root.hasAttribute(attr);
  root.toggleAttribute(attr, force);
  return prev !== force;
}

/** Applies root attributes controlling footer and per-item visibility. */
export function syncFooterVisibilityAttributes(doc: Document, settings: FooterSettings): boolean {
  const root = doc.documentElement;
  if (!root) return false;

  let changed = toggleRootAttribute(root, FOOTER_HIDDEN_ATTR, !settings.isFooterEnabled);
  for (const rule of ITEM_VISIBILITY_RULES) {
    if (toggleRootAttribute(root, rule.hiddenAttr, !settings[rule.settingKey])) {
      changed = true;
    }
  }
  return changed;
}

function isFooterChildVisible(child: Element, doc: Document, settings: FooterSettings): boolean {
  if (!settings.isFooterEnabled) return false;
  const itemKey = child.getAttribute(FOOTER_ITEM_ATTR);
  if (itemKey === FOOTER_ITEM_KEYS.source) {
    // Glassy Merge Theme docks the primary source pill to the tab bar and hides clones in place.
    return (
      child.getAttribute(MERGETHEME_SOURCE_CLONE_ATTR) !== "1" &&
      doc.documentElement?.hasAttribute(GLASSY_THEME_LOCK_ATTRIBUTE) !== true
    );
  }
  const settingKey = itemKey ? ITEM_SETTING_MAP.get(itemKey) : undefined;
  return settingKey ? settings[settingKey] : true;
}

/** Marks `.blyrics-footer` empty when no visible bottom footer items remain so layout padding collapses. */
export function syncEmptyFooterAttribute(doc: Document, settings: FooterSettings): boolean {
  const footer = doc.getElementsByClassName(FOOTER_CLASS)[0] ?? null;
  if (!footer) return false;

  let hasVisible = false;
  if (settings.isFooterEnabled) {
    for (const child of Array.from(footer.children)) {
      if (isFooterChildVisible(child, doc, settings)) {
        hasVisible = true;
        break;
      }
    }
  }

  const prev = footer.getAttribute(FOOTER_EMPTY_ATTR) === "true";
  if (hasVisible) {
    footer.removeAttribute(FOOTER_EMPTY_ATTR);
    return prev;
  }
  footer.setAttribute(FOOTER_EMPTY_ATTR, "true");
  return !prev;
}
