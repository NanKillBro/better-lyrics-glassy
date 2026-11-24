import { AppState, reloadLyrics } from "@core/appState";
import { versionedStylesheetUrl } from "@core/extensionStylesheet";
import { rebuildKaraoke } from "@modules/karaoke/karaokeView";
import {
  LEGACY_RENDERER_CSS_PATH,
  LEGACY_RENDERER_STYLE_ID,
  RENDERER_MODE_DEFAULTS,
  syncRendererModeStylesheets,
  WEBGL_LYRICS_ATTR,
} from "@modules/ui/rendererMode";

let rendererModeGeneration = 0;

/**
 * Applies WebGL mode attribute and legacy stylesheet state to `doc` using extension URLs.
 */
export async function syncRendererModeDocument(doc: Document, webgl: boolean): Promise<void> {
  await syncRendererModeStylesheets(doc, webgl, versionedStylesheetUrl(LEGACY_RENDERER_CSS_PATH));
}

/**
 * Loads `isWebglLyricsEnabled` into `AppState` and synchronizes stylesheets on `doc`.
 */
export async function syncRendererModeFromStorage(doc: Document): Promise<void> {
  const items =
    typeof chrome !== "undefined" && chrome?.storage?.local?.get
      ? await chrome.storage.local.get(RENDERER_MODE_DEFAULTS).catch(() => RENDERER_MODE_DEFAULTS)
      : RENDERER_MODE_DEFAULTS;
  const webgl = items?.isWebglLyricsEnabled === true;
  AppState.isWebglLyricsEnabled = webgl;
  await syncRendererModeDocument(doc, webgl);
}

/**
 * Updates `AppState`, syncs mode stylesheets, and rebuilds active main/karaoke lyrics on change.
 */
export async function applyRendererModeSettings(partial: {
  readonly isWebglLyricsEnabled?: unknown;
}): Promise<void> {
  if (!("isWebglLyricsEnabled" in partial)) return;

  const nextWebgl = partial.isWebglLyricsEnabled === true;
  const stateChanged = AppState.isWebglLyricsEnabled !== nextWebgl;
  const root = document.documentElement;
  const domOutOfSync =
    root.hasAttribute(WEBGL_LYRICS_ATTR) !== nextWebgl ||
    Boolean(document.getElementById(LEGACY_RENDERER_STYLE_ID)) !== !nextWebgl;

  if (!stateChanged && !domOutOfSync) return;

  const generation = ++rendererModeGeneration;
  AppState.isWebglLyricsEnabled = nextWebgl;
  await syncRendererModeDocument(document, nextWebgl);
  if (generation !== rendererModeGeneration) return;

  if (stateChanged && (AppState.areLyricsLoaded || AppState.lyricData !== null)) {
    rebuildKaraoke();
    reloadLyrics();
  }
}
