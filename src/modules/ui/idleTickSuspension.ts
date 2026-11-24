import { TAB_HEADER_CLASS } from "@constants";
import { AppState } from "@core/appState";

export interface AnimationLoopConditions {
  idleSuspensionEnabled: boolean;
  isPlaying: boolean;
  isDocumentVisible: boolean;
  isPictureInPictureOpen: boolean;
  areLyricsTicking: boolean;
  isKaraokeActive: boolean;
  isMainViewVisible: boolean;
}

let syncAnimationLoopCallback: (() => void) | null = null;

export function registerAnimationLoopSync(callback: (() => void) | null): void {
  syncAnimationLoopCallback = callback;
}

export function requestAnimationLoopSync(): void {
  syncAnimationLoopCallback?.();
}

export function isLyricsTabSelected(doc: Document | null | undefined = typeof document !== "undefined" ? document : null): boolean {
  const tabSelector = doc?.getElementsByClassName(TAB_HEADER_CLASS)[1];
  return tabSelector?.getAttribute("aria-selected") === "true";
}

export function shouldEnableMainLyricsTicking(tabSelector?: Element | null): boolean {
  if (!AppState.isIdleTickSuspensionEnabled) return true;
  if (tabSelector !== undefined) {
    return tabSelector?.getAttribute("aria-selected") === "true";
  }
  return isLyricsTabSelected();
}

export function shouldTreatDocumentAsHidden(
  doc: Pick<Document, "visibilityState"> | null | undefined = typeof document !== "undefined" ? document : null
): boolean {
  if (!AppState.isIdleTickSuspensionEnabled) return false;
  if (!doc) return false;
  // Document PiP openers report "hidden" even while visible on screen.
  return doc.visibilityState !== "visible" && !AppState.isPictureInPictureOpen;
}

export function shouldRunAnimationLoop(c: AnimationLoopConditions): boolean {
  if (!c.idleSuspensionEnabled) return true;
  if (!c.isPlaying) return false;
  if (!c.isDocumentVisible && !c.isPictureInPictureOpen) return false;
  if (c.isKaraokeActive) return true;
  return c.areLyricsTicking && c.isMainViewVisible;
}
