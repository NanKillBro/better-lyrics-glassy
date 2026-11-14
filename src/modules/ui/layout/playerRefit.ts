import { type ObserverHandle, observeResize } from "@modules/ui/layout/layoutWidth";

const PANEL_SETTLE_MS = 1000;

let activeRefit: ObserverHandle | null = null;

/**
 * Removes stale inline padding from `#main-panel` and dispatches a `resize`
 * event as `#side-panel` settles after a layout or playback-mode transition.
 */
export function refitPlayerPanel(doc: Document = document): void {
  const mainPanel = doc.querySelector<HTMLElement>("ytmusic-player-page #main-panel");
  const sidePanel = doc.querySelector<HTMLElement>("ytmusic-player-page #side-panel");
  const win = doc.defaultView;
  if (!mainPanel || !sidePanel || !win) return;

  disposePlayerPanelRefit();

  const observer = observeResize([sidePanel], () => {
    mainPanel.style.removeProperty("padding");
    win.dispatchEvent(new win.Event("resize"));
  });

  const timerId = win.setTimeout(() => {
    if (activeRefit === handle) disposePlayerPanelRefit();
  }, PANEL_SETTLE_MS);

  const handle: ObserverHandle = {
    destroy: () => {
      win.clearTimeout(timerId);
      observer.destroy();
    },
  };
  activeRefit = handle;
}

/**
 * Cancels any pending player-panel refit observer and settle timer.
 */
export function disposePlayerPanelRefit(): void {
  activeRefit?.destroy();
  activeRefit = null;
}
