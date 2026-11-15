import {
  COMPOSITE_LYRICS_ATTR,
  LEGACY_RENDERER_CSS_PATH,
  LEGACY_RENDERER_STYLE_ID,
  RENDERER_MODE_DEFAULTS,
  syncRendererModeStylesheets,
} from "@modules/ui/rendererMode";
import { AppState, reloadLyrics } from "@core/appState";
import { versionedStylesheetUrl } from "@core/extensionStylesheet";
import { rebuildKaraoke } from "@modules/karaoke/karaokeView";

let rendererModeGeneration = 0;

/**
 * Applies composite mode attribute and legacy stylesheet state to `doc` using extension URLs.
 */
export async function syncRendererModeDocument(doc: Document, composite: boolean): Promise<void> {
  await syncRendererModeStylesheets(doc, composite, versionedStylesheetUrl(LEGACY_RENDERER_CSS_PATH));
}

/**
 * Loads `isCompositeLyricsEnabled` into `AppState` and synchronizes stylesheets on `doc`.
 */
export async function syncRendererModeFromStorage(doc: Document): Promise<void> {
  const items =
    typeof chrome !== "undefined" && chrome?.storage?.local?.get
      ? await chrome.storage.local.get(RENDERER_MODE_DEFAULTS).catch(() => RENDERER_MODE_DEFAULTS)
      : RENDERER_MODE_DEFAULTS;
  const composite = items?.isCompositeLyricsEnabled === true;
  AppState.isCompositeLyricsEnabled = composite;
  await syncRendererModeDocument(doc, composite);
}

/**
 * Updates `AppState`, syncs mode stylesheets, and rebuilds active main/karaoke lyrics on change.
 */
export async function applyRendererModeSettings(partial: {
  readonly isCompositeLyricsEnabled?: unknown;
}): Promise<void> {
  if (!("isCompositeLyricsEnabled" in partial)) return;

  const nextComposite = partial.isCompositeLyricsEnabled === true;
  const stateChanged = AppState.isCompositeLyricsEnabled !== nextComposite;
  const root = document.documentElement;
  const domOutOfSync =
    root.hasAttribute(COMPOSITE_LYRICS_ATTR) !== nextComposite ||
    Boolean(document.getElementById(LEGACY_RENDERER_STYLE_ID)) !== !nextComposite;

  if (!stateChanged && !domOutOfSync) return;

  const generation = ++rendererModeGeneration;
  AppState.isCompositeLyricsEnabled = nextComposite;
  await syncRendererModeDocument(document, nextComposite);
  if (generation !== rendererModeGeneration) return;

  if (stateChanged && (AppState.areLyricsLoaded || AppState.lyricData !== null)) {
    rebuildKaraoke();
    reloadLyrics();
  }
}
