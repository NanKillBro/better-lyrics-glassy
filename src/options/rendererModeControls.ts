import { versionedStylesheetUrl } from "@core/extensionStylesheet";
import {
  LEGACY_RENDERER_CSS_PATH,
  RENDERER_MODE_DEFAULTS,
  syncRendererModeStylesheets,
} from "@modules/ui/rendererMode";

export { RENDERER_MODE_DEFAULTS };

export interface RendererModeOptions {
  isWebglLyricsEnabled: boolean;
}

function getInput(): HTMLInputElement | null {
  return document.getElementById("isWebglLyricsEnabled") as HTMLInputElement | null;
}

/**
 * Syncs renderer mode attribute and legacy stylesheet on the Options page (for `#support-stage`).
 */
export function syncOptionsRendererModeStyles(options: RendererModeOptions): void {
  void syncRendererModeStylesheets(
    document,
    options.isWebglLyricsEnabled,
    versionedStylesheetUrl(LEGACY_RENDERER_CSS_PATH)
  );
}

export function readRendererModeForm(): RendererModeOptions {
  return {
    isWebglLyricsEnabled: getInput()?.checked ?? false,
  };
}

export function writeRendererModeForm(items: RendererModeOptions): void {
  const webgl = getInput();
  if (webgl) webgl.checked = items.isWebglLyricsEnabled;
  syncOptionsRendererModeStyles(items);
}
