import { versionedStylesheetUrl } from "@core/extensionStylesheet";
import {
  LEGACY_RENDERER_CSS_PATH,
  RENDERER_MODE_DEFAULTS,
  syncRendererModeStylesheets,
} from "@modules/ui/rendererMode";

export { RENDERER_MODE_DEFAULTS };

export interface RendererModeOptions {
  isCompositeLyricsEnabled: boolean;
}

function getInput(): HTMLInputElement | null {
  return document.getElementById("isCompositeLyricsEnabled") as HTMLInputElement | null;
}

/**
 * Syncs renderer mode attribute and legacy stylesheet on the Options page (for `#support-stage`).
 */
export function syncOptionsRendererModeStyles(options: RendererModeOptions): void {
  void syncRendererModeStylesheets(
    document,
    options.isCompositeLyricsEnabled,
    versionedStylesheetUrl(LEGACY_RENDERER_CSS_PATH)
  );
}

export function readRendererModeForm(): RendererModeOptions {
  return {
    isCompositeLyricsEnabled: getInput()?.checked ?? false,
  };
}

export function writeRendererModeForm(items: RendererModeOptions): void {
  const composite = getInput();
  if (composite) composite.checked = items.isCompositeLyricsEnabled;
  syncOptionsRendererModeStyles(items);
}
