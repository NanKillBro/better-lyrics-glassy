export const WEBGL_LYRICS_ATTR = "blyrics-webgl-lyrics" as const;
export const LEGACY_RENDERER_STYLE_ID = "blyrics-style-legacy" as const;
export const LEGACY_RENDERER_CSS_PATH = "css/blyrics/lyrics-legacy.css" as const;

export const RENDERER_MODE_DEFAULTS = {
  isWebglLyricsEnabled: false,
} as const;

export interface RendererModeSyncOptions {
  readonly anchorHref?: string;
  readonly beforeId?: string;
  readonly timeoutMs?: number;
}

const LEGACY_SWIPE_PROPERTIES: readonly PropertyDefinition[] = [
  { name: "--lyric-transition-amount-start", syntax: "<number>", inherits: true, initialValue: "-0.2" },
  { name: "--lyric-transition-amount-end", syntax: "<number>", inherits: true, initialValue: "-0.1" },
];

const PIP_MARQUEE_PROPERTIES: readonly PropertyDefinition[] = [
  { name: "--blyrics-pip-marquee-shift", syntax: "<length>", inherits: true, initialValue: "0px" },
  { name: "--blyrics-pip-marquee-fade-start", syntax: "<length>", inherits: true, initialValue: "0px" },
  { name: "--blyrics-pip-marquee-fade-end", syntax: "<length>", inherits: true, initialValue: "0px" },
  { name: "--blyrics-pip-marquee-alpha", syntax: "<number>", inherits: true, initialValue: "1" },
];

const LEGACY_ANCHOR_SELECTORS = ['link[id="blyrics-style-css/blyrics"]', 'link[href*="css/blyrics/lyrics.css"]'] as const;

/**
 * Returns whether WebGL2 (`@braccato/core@2.0.0-beta.4`) rendering is active on `doc`.
 */
export function readRendererMode(doc: Document | null | undefined): boolean {
  return doc?.documentElement?.hasAttribute?.(WEBGL_LYRICS_ATTR) === true;
}

/**
 * Resolves once a stylesheet `<link>` finishes loading, errors, or reaches `timeoutMs`.
 */
export function whenStylesheetSettled(link: HTMLLinkElement, timeoutMs = 500): Promise<void> {
  if (link.sheet) return Promise.resolve();
  return new Promise(resolve => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      resolve();
    };
    link.addEventListener("load", finish, { once: true });
    link.addEventListener("error", finish, { once: true });
    if (timeoutMs > 0) {
      globalThis.setTimeout(finish, timeoutMs);
    }
  });
}

function registerAnimatableProperties(pipWindow: Window, properties: readonly PropertyDefinition[]): void {
  const { CSS: pipCss } = pipWindow as Window & typeof globalThis;
  for (const definition of properties) {
    try {
      pipCss?.registerProperty?.(definition);
    } catch {
      // Chromium rejects duplicate property registrations already parsed from same-origin sheets.
    }
  }
}

function findAnchorLink(head: HTMLHeadElement, anchorHref?: string): HTMLLinkElement | null {
  if (anchorHref) {
    for (const el of Array.from(head.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'))) {
      if (el.href === anchorHref || el.getAttribute("href") === anchorHref) {
        return el;
      }
    }
  }
  for (const selector of LEGACY_ANCHOR_SELECTORS) {
    const match = head.querySelector(selector);
    if (match) return match as HTMLLinkElement;
  }
  return null;
}

function syncLegacyStylesheet(
  doc: Document,
  enabled: boolean,
  href: string | null,
  options?: RendererModeSyncOptions
): { changed: boolean; settled?: Promise<void> } {
  const existing = doc.getElementById(LEGACY_RENDERER_STYLE_ID);
  if (!enabled || !href) {
    if (!existing) return { changed: false };
    existing.remove();
    return { changed: true };
  }

  if (existing && (existing.getAttribute("href") === href || (existing as HTMLLinkElement).href === href)) {
    const anchor = doc.head ? findAnchorLink(doc.head, options?.anchorHref) : null;
    if (
      anchor &&
      typeof anchor.after === "function" &&
      typeof anchor.compareDocumentPosition === "function" &&
      (anchor.compareDocumentPosition(existing) & 2) !== 0
    ) {
      anchor.after(existing);
    }
    const settled = (existing as HTMLLinkElement).sheet
      ? undefined
      : whenStylesheetSettled(existing as HTMLLinkElement, options?.timeoutMs ?? 500);
    return { changed: false, settled };
  }

  existing?.remove();
  if (!doc.head || typeof doc.createElement !== "function") {
    return { changed: false };
  }

  const link = doc.createElement("link");
  link.rel = "stylesheet";
  link.id = LEGACY_RENDERER_STYLE_ID;
  link.href = href;
  const settled = whenStylesheetSettled(link, options?.timeoutMs ?? 500);

  const anchor = findAnchorLink(doc.head, options?.anchorHref);
  if (anchor && typeof anchor.after === "function") {
    anchor.after(link);
  } else {
    const beforeEl = options?.beforeId ? doc.getElementById(options.beforeId) : null;
    if (beforeEl && beforeEl.parentNode === doc.head) {
      doc.head.insertBefore(link, beforeEl);
    } else {
      doc.head.appendChild(link);
    }
  }
  return { changed: true, settled };
}

function syncStylesheetInternal(
  doc: Document,
  webgl: boolean,
  legacyHref: string | null,
  options?: RendererModeSyncOptions
): { changed: boolean; settled?: Promise<void> } {
  const prevWebgl = readRendererMode(doc);
  doc.documentElement?.toggleAttribute?.(WEBGL_LYRICS_ATTR, webgl);
  const legacy = syncLegacyStylesheet(doc, !webgl, legacyHref, options);
  return {
    changed: prevWebgl !== webgl || legacy.changed,
    settled: legacy.settled,
  };
}

/**
 * Sets `WEBGL_LYRICS_ATTR` and dynamically loads or removes the legacy `1.20.0` stylesheet on `doc`.
 */
export async function syncRendererModeStylesheets(
  doc: Document,
  webgl: boolean,
  legacyHref: string | null,
  options?: RendererModeSyncOptions
): Promise<void> {
  const { settled } = syncStylesheetInternal(doc, webgl, legacyHref, options);
  if (settled) await settled;
}

function readLinkHref(doc: Document, id: string): string | null {
  const el = doc.getElementById(id);
  return el && "href" in el && typeof (el as HTMLLinkElement).href === "string" ? (el as HTMLLinkElement).href : null;
}

/**
 * Registers baseline Document PiP `@property` custom properties on `pipWindow` for Gecko `pageWorld`.
 */
export function registerPipBaseProperties(pipWindow: Window): void {
  registerAnimatableProperties(pipWindow, PIP_MARQUEE_PROPERTIES);
}

/**
 * Mirrors opener WebGL mode attribute, Gecko `@property` definitions, and legacy stylesheet
 * into `pipWindow` without touching extension-only APIs.
 */
export function syncPipRendererMode(
  pipWindow: Window,
  openerDoc: Document,
  baseLyricsHref: string,
  customStyleId: string
): { changed: boolean; settled?: Promise<void> } {
  const webgl = readRendererMode(openerDoc);
  if (!webgl) {
    registerAnimatableProperties(pipWindow, LEGACY_SWIPE_PROPERTIES);
  }
  return syncStylesheetInternal(
    pipWindow.document,
    webgl,
    readLinkHref(openerDoc, LEGACY_RENDERER_STYLE_ID),
    { anchorHref: baseLyricsHref, beforeId: customStyleId }
  );
}

/**
 * Observes WebGL renderer attribute changes on `doc.documentElement`.
 */
export function observeRendererModeChange(doc: Document, onChange: () => void): MutationObserver {
  const observer = new MutationObserver(onChange);
  observer.observe(doc.documentElement, {
    attributes: true,
    attributeFilter: [WEBGL_LYRICS_ATTR],
  });
  return observer;
}
