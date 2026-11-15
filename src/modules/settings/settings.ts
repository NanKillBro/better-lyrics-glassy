import {
  DISABLE_EFFECTS_STYLE_ID,
  DOCK_CLASS,
  DOCK_CONTROL_ORDER_DEFAULT,
  DOCK_DEFAULT_POSITION,
  FULLSCREEN_CONTROLS_DISABLED_ATTR,
  FULLSCREEN_CONTROLS_PINNED_ATTR,
  LYRICS_DISABLED_ATTR,
} from "@constants";
import { AppState, refreshCurrentSong, reloadLyrics } from "@core/appState";
import { compileRicsToStyles, getStorage } from "@core/storage";
import { configureLogging, logContent } from "@core/logger";
import { syncKaraoke } from "@modules/karaoke/karaokeView";
import { loadKaraokeSettings } from "@modules/karaoke/settings";
import { migrateFullscreenControlsPref } from "@modules/settings/fullscreenControls";
import { applyRendererModeSettings } from "@modules/settings/rendererModeSettings";
import { clearCache as clearTranslationCache } from "@modules/lyrics/translation";
import { mountDock, mountVotingSegment, reloadAlbumArt, syncAdCheckState, unmountDock, updateDockPosition } from "@modules/ui/dom";
import { applyGlobalOffsets } from "@modules/ui/lyricsDock/offset";
import { RENDERER_MODE_DEFAULTS } from "@modules/ui/rendererMode";
import { mainView } from "@modules/ui/mainLyricsView";
import { isPlayerFullscreened, onFullscreenChange } from "@modules/ui/observer";
import { publishSecondaryViews } from "@modules/ui/secondaryViews";
import { applyCustomStyles, getAndApplyCustomStyles } from "@modules/ui/styleInjector";
import { resetScrollHostCache } from "@modules/ui/lyricsHost";
import { syncProgressBarOptimizationState } from "@modules/ui/playerControls/progressBar";
import { disposeVisibilityCache, invalidateViewVisibilityCache } from "@modules/ui/visibilityCache";

let hasInitializedMessageListener = false;

type EnableDisableCallback = () => void;

/**
 * Handles settings initialization and applies user preferences.
 * Sets up fullscreen behavior, animations, and other settings.
 */
export function applyLoggingSetting(): void {
  getStorage({ isLogsEnabled: true }, items => {
    configureLogging(items.isLogsEnabled !== false);
  });
}

export function handleSettings(): void {
  onFullScreenDisabled(
    () => {
      const layout = document.getElementById("layout");
      const playerPage = document.getElementById("player-page");

      if (layout && playerPage) {
        layout.setAttribute(LYRICS_DISABLED_ATTR, "");
        playerPage.setAttribute(LYRICS_DISABLED_ATTR, "");
      }
      syncKaraoke();
    },
    () => {
      const layout = document.getElementById("layout");
      const playerPage = document.getElementById("player-page");

      if (layout && playerPage) {
        layout.removeAttribute(LYRICS_DISABLED_ATTR);
        playerPage.removeAttribute(LYRICS_DISABLED_ATTR);
      }
      syncKaraoke();
    }
  );

  applyFullscreenControlsPref();

  getStorage({ isStylizedAnimationsEnabled: true }, items => {
    void applyStylizedAnimationsSetting(items.isStylizedAnimationsEnabled !== false);
  });

  loadLyricsBlurSetting();
  loadUnblurUpcomingLyricsSetting();
  loadPerformanceSettings();
}

export function onAutoSwitchEnabled(enableAutoSwitch: EnableDisableCallback): void {
  getStorage({ isAutoSwitchEnabled: false }, items => {
    if (items.isAutoSwitchEnabled) {
      enableAutoSwitch();
    }
  });
}

export function onFullScreenDisabled(
  disableFullScreen: EnableDisableCallback,
  enableFullScreen: EnableDisableCallback
): void {
  getStorage({ isFullScreenDisabled: false }, items => {
    if (items.isFullScreenDisabled) {
      disableFullScreen();
    } else {
      enableFullScreen();
    }
  });
}

export function onAlbumArtEnabled(enableAlbumArt: EnableDisableCallback, disableAlbumArt: EnableDisableCallback): void {
  getStorage({ isAlbumArtEnabled: true }, items => {
    if (items.isAlbumArtEnabled) {
      enableAlbumArt();
    } else {
      disableAlbumArt();
    }
  });
}

function applyFullscreenControlsPref(): void {
  getStorage(["fullscreenControlsPref", "isFullscreenControlsEnabled"], items => {
    const pref = migrateFullscreenControlsPref(items);
    const root = document.documentElement;
    root.toggleAttribute(FULLSCREEN_CONTROLS_DISABLED_ATTR, pref === "off");
    root.toggleAttribute(FULLSCREEN_CONTROLS_PINNED_ATTR, pref === "on");
  });
}

const LYRICS_BLUR_DISABLED_ATTR = "blyrics-disable-lyrics-blur";

function applyLyricsBlurSetting(disabled: boolean): void {
  document.documentElement.toggleAttribute(LYRICS_BLUR_DISABLED_ATTR, disabled);
}

function loadLyricsBlurSetting(): void {
  getStorage({ isLyricsBlurDisabled: false }, items => {
    applyLyricsBlurSetting(items.isLyricsBlurDisabled === true);
  });
}

const UNBLUR_UPCOMING_LYRICS_ATTR = "blyrics-unblur-upcoming";

function applyUnblurUpcomingLyricsSetting(enabled: boolean): void {
  document.documentElement.toggleAttribute(UNBLUR_UPCOMING_LYRICS_ATTR, enabled);
}

function loadUnblurUpcomingLyricsSetting(): void {
  getStorage({ isUnblurUpcomingLyricsEnabled: false }, items => {
    applyUnblurUpcomingLyricsSetting(items.isUnblurUpcomingLyricsEnabled === true);
  });
}

let stylizedAnimationsGeneration = 0;

async function applyStylizedAnimationsSetting(enabled: boolean): Promise<void> {
  const generation = ++stylizedAnimationsGeneration;
  if (enabled) {
    document.getElementById(DISABLE_EFFECTS_STYLE_ID)?.remove();
    return;
  }

  if (document.getElementById(DISABLE_EFFECTS_STYLE_ID)) return;

  const cssText = await fetch(chrome.runtime.getURL("css/disablestylizedanimations.css")).then(res => res.text());
  if (generation !== stylizedAnimationsGeneration) return;
  if (document.getElementById(DISABLE_EFFECTS_STYLE_ID)) return;

  const styleElem = document.createElement("style");
  styleElem.id = DISABLE_EFFECTS_STYLE_ID;
  styleElem.textContent = cssText;
  document.head.appendChild(styleElem);
}

function applyVisibilityCacheSetting(enabled: boolean): void {
  if (AppState.isVisibilityCacheEnabled === enabled) return;
  AppState.isVisibilityCacheEnabled = enabled;
  if (enabled) {
    invalidateViewVisibilityCache();
  } else {
    disposeVisibilityCache();
  }
}

function applyAdCheckSetting(enabled: boolean): void {
  if (AppState.isAdCheckEnabled === enabled) return;
  AppState.isAdCheckEnabled = enabled;
  syncAdCheckState();
}

function applyOptimizedScrollHostSetting(enabled: boolean): void {
  if (AppState.isOptimizedScrollHostEnabled === enabled) return;
  AppState.isOptimizedScrollHostEnabled = enabled;
  if (!enabled) {
    resetScrollHostCache();
  }
}

function applyOptimizedProgressBarSetting(enabled: boolean): void {
  if (AppState.isOptimizedProgressBarEnabled === enabled) return;
  AppState.isOptimizedProgressBarEnabled = enabled;
  syncProgressBarOptimizationState(enabled);
}

function applyFastPipArtworkSetting(enabled: boolean): void {
  if (AppState.isFastPipArtworkEnabled === enabled) return;
  AppState.isFastPipArtworkEnabled = enabled;
}

export function loadPerformanceSettings(): void {
  getStorage(
    {
      isVisibilityCacheEnabled: false,
      isAdCheckEnabled: false,
      isOptimizedScrollHostEnabled: false,
      isOptimizedProgressBarEnabled: false,
      isFastPipArtworkEnabled: false,
      ...RENDERER_MODE_DEFAULTS,
    },
    items => {
      applyVisibilityCacheSetting(items.isVisibilityCacheEnabled === true);
      applyAdCheckSetting(items.isAdCheckEnabled === true);
      applyOptimizedScrollHostSetting(items.isOptimizedScrollHostEnabled === true);
      applyOptimizedProgressBarSetting(items.isOptimizedProgressBarEnabled === true);
      applyFastPipArtworkSetting(items.isFastPipArtworkEnabled === true);
      void applyRendererModeSettings(items);
    }
  );
}

export function initPerformanceSettingsListener(): () => void {
  const storageChanged = chrome?.storage?.onChanged;
  if (!storageChanged) return () => undefined;

  const onStorageChanged = (changes: Record<string, chrome.storage.StorageChange>, areaName: string): void => {
    if (areaName !== "local") return;
    if ("isVisibilityCacheEnabled" in changes) {
      applyVisibilityCacheSetting(changes.isVisibilityCacheEnabled.newValue === true);
    }
    if ("isAdCheckEnabled" in changes) {
      applyAdCheckSetting(changes.isAdCheckEnabled.newValue === true);
    }
    if ("isOptimizedScrollHostEnabled" in changes) {
      applyOptimizedScrollHostSetting(changes.isOptimizedScrollHostEnabled.newValue === true);
    }
    if ("isOptimizedProgressBarEnabled" in changes) {
      applyOptimizedProgressBarSetting(changes.isOptimizedProgressBarEnabled.newValue === true);
    }
    if ("isFastPipArtworkEnabled" in changes) {
      applyFastPipArtworkSetting(changes.isFastPipArtworkEnabled.newValue === true);
    }
    if ("isCompositeLyricsEnabled" in changes) {
      void applyRendererModeSettings({ isCompositeLyricsEnabled: changes.isCompositeLyricsEnabled.newValue });
    }
    if ("isStylizedAnimationsEnabled" in changes) {
      void applyStylizedAnimationsSetting(changes.isStylizedAnimationsEnabled.newValue !== false);
    }
    if ("isLyricsBlurDisabled" in changes) {
      applyLyricsBlurSetting(changes.isLyricsBlurDisabled.newValue === true);
    }
  };

  storageChanged.addListener(onStorageChanged);
  return () => storageChanged.removeListener(onStorageChanged);
}

function onAutoHideCursor(
  enableCursorAutoHide: EnableDisableCallback,
  disableCursorAutoHide: EnableDisableCallback
): void {
  getStorage({ isCursorAutoHideEnabled: true }, items => {
    if (items.isCursorAutoHideEnabled) {
      enableCursorAutoHide();
    } else {
      disableCursorAutoHide();
    }
  });
}

let mouseTimer: number | null = null;
let cursorEventListener: ((this: Document, ev: MouseEvent) => any) | null = null;
let cursorAutoHideSettingEnabled = false;
let fullscreenCursorHandlersRegistered = false;
let cursorVisible = true;

function detachCursorListener(): void {
  if (mouseTimer) {
    window.clearTimeout(mouseTimer);
    mouseTimer = null;
  }
  if (cursorEventListener) {
    document.removeEventListener("mousemove", cursorEventListener);
    cursorEventListener = null;
  }
  document.getElementById("layout")?.removeAttribute("cursor-hidden");
  cursorVisible = true;
}

function attachCursorListener(): void {
  if (cursorEventListener) return;

  cursorVisible = true;
  document.getElementById("layout")?.removeAttribute("cursor-hidden");

  function disappearCursor(): void {
    mouseTimer = null;
    if (cursorVisible) {
      document.getElementById("layout")?.setAttribute("cursor-hidden", "");
    }
    cursorVisible = false;
  }

  function handleMouseMove(): void {
    if (mouseTimer) {
      window.clearTimeout(mouseTimer);
    }
    if (!cursorVisible) {
      document.getElementById("layout")?.removeAttribute("cursor-hidden");
      cursorVisible = true;
    }
    mouseTimer = window.setTimeout(disappearCursor, 3000);
  }

  cursorEventListener = handleMouseMove;
  document.addEventListener("mousemove", handleMouseMove);
  mouseTimer = window.setTimeout(disappearCursor, 3000);
}

function syncCursorListener(): void {
  if (cursorAutoHideSettingEnabled && isPlayerFullscreened()) {
    attachCursorListener();
  } else {
    detachCursorListener();
  }
}

export function hideCursorOnIdle(): void {
  if (!fullscreenCursorHandlersRegistered) {
    fullscreenCursorHandlersRegistered = true;
    onFullscreenChange(syncCursorListener, syncCursorListener);
  }

  onAutoHideCursor(
    () => {
      cursorAutoHideSettingEnabled = true;
      syncCursorListener();
    },
    () => {
      cursorAutoHideSettingEnabled = false;
      syncCursorListener();
    }
  );
}

export function listenForPopupMessages(): void {
  if (hasInitializedMessageListener) {
    return;
  }
  hasInitializedMessageListener = true;

  chrome.runtime.onMessage.addListener((request, _, sendResponse) => {
    logContent("Received message:", request.action);
    if (request.action === "applyStyles") {
      logContent("Processing applyStyles, RICS length:", request.ricsSource?.length);
      if (request.ricsSource) {
        logContent("Compiling RICS and applying styles");
        const compiledCSS = compileRicsToStyles(request.ricsSource);
        applyCustomStyles(compiledCSS);
        mainView.relayout();
        logContent("Styles applied successfully");
      } else {
        logContent("Loading styles from storage");
        getAndApplyCustomStyles().then(() => {
          mainView.relayout();
          logContent("Styles loaded from storage and applied");
        });
      }
    } else if (request.action === "updateSettings") {
      clearTranslationCache();
      applyLoggingSetting();
      hideCursorOnIdle();
      handleSettings();
      loadTranslationSettings();
      loadLyricOffsetSettings();
      loadPassiveScrollSetting();
      loadKaraokeSettings(syncKaraoke);
      loadDockSettings(() => {
        syncDock();
        hideDockOnIdleInFullscreen();
      });
      AppState.shouldInjectAlbumArt = "Unknown";
      onAlbumArtEnabled(
        () => {
          AppState.shouldInjectAlbumArt = true;
          reloadAlbumArt();
        },
        () => {
          AppState.shouldInjectAlbumArt = false;
          reloadAlbumArt();
        }
      );
      getAndApplyCustomStyles();
      if (request.settings) {
        void applyRendererModeSettings(request.settings).then(() => {
          reloadLyrics();
        });
      } else {
        reloadLyrics();
      }
    } else if (request.action === "reloadLyrics") {
      reloadLyrics();
      sendResponse({ success: true });
    } else if (request.action === "refreshLyrics") {
      refreshCurrentSong().then(
        () => sendResponse({ success: true }),
        error => {
          logContent("refreshLyrics failed:", error);
          sendResponse({ success: false });
        }
      );
      return true;
    }
  });
}

export function loadPassiveScrollSetting(): void {
  getStorage({ isPassiveScrollEnabled: true }, items => {
    AppState.isPassiveScrollEnabled = items.isPassiveScrollEnabled;
    // The side panel reads this off AppState every tick. The floating window only sees the copy
    // that rode over on the last payload, so a change reaches it on a republish or not at all.
    publishSecondaryViews();
  });
}

// Keeps only known control keys, drops duplicates, and appends any missing ones so the
// dock always has the full set regardless of stale or partial stored orders.
function normalizeDockControlsOrder(stored: unknown): string[] {
  const known = DOCK_CONTROL_ORDER_DEFAULT as readonly string[];
  const order = Array.isArray(stored) ? stored.filter(key => typeof key === "string" && known.includes(key)) : [];
  const unique = [...new Set(order)];
  for (const key of known) {
    if (!unique.includes(key)) unique.push(key);
  }
  return unique;
}

export function loadDockSettings(callback?: () => void): void {
  getStorage(
    [
      "isControlsDockEnabled",
      "isControlsDockAutoHideInFullscreenEnabled",
      "isUnisonPinnedDockEnabled",
      "isUnisonAutoHideInFullscreenEnabled",
      "isDockSourceEnabled",
      "isDockTranslateEnabled",
      "isDockRomanizeEnabled",
      "isDockOffsetEnabled",
      "isDockRefreshEnabled",
      "isDockPictureInPictureEnabled",
      "dockControlsOrder",
    ],
    items => {
      AppState.isControlsDockEnabled = items.isControlsDockEnabled ?? items.isUnisonPinnedDockEnabled ?? true;
      AppState.controlsDockPosition = DOCK_DEFAULT_POSITION;
      AppState.isControlsDockAutoHideInFullscreenEnabled =
        items.isControlsDockAutoHideInFullscreenEnabled ?? items.isUnisonAutoHideInFullscreenEnabled ?? true;
      AppState.isDockSourceEnabled = items.isDockSourceEnabled ?? true;
      AppState.isDockTranslateEnabled = items.isDockTranslateEnabled ?? true;
      AppState.isDockRomanizeEnabled = items.isDockRomanizeEnabled ?? true;
      AppState.isDockOffsetEnabled = items.isDockOffsetEnabled ?? true;
      AppState.isDockRefreshEnabled = items.isDockRefreshEnabled ?? true;
      AppState.isDockPictureInPictureEnabled = items.isDockPictureInPictureEnabled ?? true;
      AppState.dockControlsOrder = normalizeDockControlsOrder(items.dockControlsOrder);
      callback?.();
    }
  );
}

function syncDock(): void {
  if (!AppState.isControlsDockEnabled) {
    unmountDock();
    return;
  }
  mountDock(AppState.controlsDockPosition);
  updateDockPosition(AppState.controlsDockPosition);
  if (AppState.currentUnisonData) {
    mountVotingSegment(AppState.currentUnisonData);
  }
}

const DOCK_IDLE_HIDDEN_CLASS = `${DOCK_CLASS}--idle-hidden`;

let dockIdleTimer: number | null = null;
let dockMouseListener: ((this: Document, ev: MouseEvent) => any) | null = null;
let wakeDockIdleFn: (() => void) | null = null;

// Re-shows the dock and restarts the idle timer, for non-mouse interactions (keyboard
// offset shortcuts) that should keep the dock visible in fullscreen.
export function wakeDockIdle(): void {
  wakeDockIdleFn?.();
}

function setDockIdleHidden(hidden: boolean): void {
  for (const dock of Array.from(document.getElementsByClassName(DOCK_CLASS))) {
    dock.classList.toggle(DOCK_IDLE_HIDDEN_CLASS, hidden);
  }
}

export function hideDockOnIdleInFullscreen(): void {
  if (dockMouseListener) {
    document.removeEventListener("mousemove", dockMouseListener);
    dockMouseListener = null;
  }
  if (dockIdleTimer) {
    window.clearTimeout(dockIdleTimer);
    dockIdleTimer = null;
  }
  setDockIdleHidden(false);
  wakeDockIdleFn = null;

  if (!AppState.isControlsDockAutoHideInFullscreenEnabled) return;

  let dockVisible = true;

  function hideDock() {
    dockIdleTimer = null;
    if (!dockVisible) return;
    if (!document.getElementById("layout")?.hasAttribute("player-fullscreened")) return;
    // Keep it up while the cursor is engaging the dock (clicking without moving the
    // mouse would otherwise let this idle timer hide the dock mid-interaction).
    if (document.querySelector(`.${DOCK_CLASS}__inner--expanded`)) {
      dockIdleTimer = window.setTimeout(hideDock, 3000);
      return;
    }
    setDockIdleHidden(true);
    dockVisible = false;
  }

  function handleMouseMove() {
    if (dockIdleTimer) window.clearTimeout(dockIdleTimer);
    if (!dockVisible) {
      setDockIdleHidden(false);
      dockVisible = true;
    }
    dockIdleTimer = window.setTimeout(hideDock, 3000);
  }

  wakeDockIdleFn = handleMouseMove;
  dockMouseListener = handleMouseMove;
  document.addEventListener("mousemove", handleMouseMove);
}

/**
 * Loads translation and romanization settings from storage and updates AppState.
 */
export function loadTranslationSettings(): void {
  getStorage(
    {
      isTranslateEnabled: false,
      isRomanizationEnabled: false,
      translationLanguage: "en",
      romanizationDisabledLanguages: [],
      translationDisabledLanguages: [],
    },
    items => {
      AppState.isTranslateEnabled = items.isTranslateEnabled;
      AppState.isRomanizationEnabled = items.isRomanizationEnabled;
      AppState.translationLanguage = items.translationLanguage || "en";
      AppState.romanizationDisabledLanguages = items.romanizationDisabledLanguages || [];
      AppState.translationDisabledLanguages = items.translationDisabledLanguages || [];
    }
  );
}

export function loadEndTimeModeSetting(): void {
  getStorage({ endTimeMode: "total" }, items => {
    AppState.endTimeMode = items.endTimeMode === "remaining" ? "remaining" : "total";
  });
}

/**
 * Loads the global and per-sync-type lyric offsets from storage into AppState.
 */
export function loadLyricOffsetSettings(): void {
  getStorage(
    {
      globalLyricOffset: 0,
      richsyncOffsetTrim: 0,
      lineOffsetTrim: 0,
    },
    items => {
      applyGlobalOffsets({
        globalLyricOffset: items.globalLyricOffset || 0,
        richsyncOffsetTrim: items.richsyncOffsetTrim || 0,
        lineOffsetTrim: items.lineOffsetTrim || 0,
      });
    }
  );
}
