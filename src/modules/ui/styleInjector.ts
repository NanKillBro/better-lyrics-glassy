import { reloadLyrics } from "@core/appState";
import { decompressString, isCompressed } from "@core/compression";
import {
  compileRicsToStyles,
  getAppliedStoreThemeId,
  getLocalStorage,
  getSyncStorage,
  loadChunkedStyles,
} from "@core/storage";
import { mainView } from "./mainLyricsView";
import { publishPictureInPictureLyrics } from "./pictureInPicture/lyricsPublisher";
import { logCore, logError } from "@core/logger";
import { migrateLetterWavePref, type LetterWavePref } from "@modules/settings/letterWave";

let hasSubscribedToStyles = false;
let letterWavePref: LetterWavePref = "on";

// Position decides precedence: parseThemeConfig is last-wins. "auto" sits before
// the theme so the theme can override it (today's behaviour); "on"/"off" sit
// after, so the user's choice is the last word.
function withLetterWaveSetting(css: string): string {
  switch (letterWavePref) {
    case "on":
      return `${css}\n/* blyrics-letter-wave = true; */`;
    case "off":
      return `${css}\n/* blyrics-letter-wave = false; */`;
    default:
      return `/* blyrics-letter-wave = false; */\n${css}`;
  }
}

/**
 * Hands a compiled theme to the side panel's view, which parses the `blyrics-*` config out of it,
 * applies the stylesheet to this document and reports whether the lines have to be built again.
 * Everything before this point is the extension's: where the theme was stored, whether it was
 * compressed, and compiling the RICS source it is written in.
 */
export function applyCustomStyles(css: string): void {
  const needsLyricReload = mainView.setTheme(withLetterWaveSetting(css));
  publishPictureInPictureLyrics();

  if (needsLyricReload) {
    reloadLyrics();
  }
}

interface CSSStorageData {
  cssStorageType?: "sync" | "local" | "chunked";
  customCSS?: string;
  cssCompressed?: boolean;
}

function decompressStyles(css: string): string {
  return decompressString(css);
}

export async function getAndApplyCustomStyles(retryContext?: { attempt: number; maxAttempts: number; delays: number[] }): Promise<void> {
  const raw = await getSyncStorage<{ letterWavePref?: string; isLetterWaveEnabled?: boolean }>([
    "letterWavePref",
    "isLetterWaveEnabled",
  ]);
  letterWavePref = migrateLetterWavePref(raw);

  try {
    const syncData = await getSyncStorage<CSSStorageData & { activePearTheme?: string }>([
      "cssStorageType",
      "customCSS",
      "cssCompressed",
      "activePearTheme",
    ]);

    const activePearTheme = syncData.activePearTheme;
    if (activePearTheme === "glassy-merge-theme") {
      const existing = document.getElementById("blyrics-custom-style");
      if (existing) {
        existing.remove();
      }
      applyCustomStyles("");
      return;
    }

    let css: string | null = null;
    let compressed = false;

    if (syncData.cssStorageType === "chunked") {
      css = await loadChunkedStyles();
      compressed = syncData.cssCompressed || false;
    } else if (syncData.cssStorageType === "local") {
      const localData = await getLocalStorage<CSSStorageData>(["customCSS", "cssCompressed"]);
      css = localData.customCSS ?? null;
      compressed = localData.cssCompressed || false;
    } else {
      css = syncData.customCSS ?? null;
      compressed = syncData.cssCompressed || false;
    }

    if (css) {
      if (compressed || isCompressed(css)) {
        css = decompressStyles(css);
      }
      applyCustomStyles(compileRicsToStyles(css));
      return; // Successfully applied, no retry needed
    }

    // No CSS found - schedule retry if we have attempts remaining
    if (retryContext && retryContext.attempt < retryContext.maxAttempts) {
      const nextAttempt = retryContext.attempt + 1;
      const delay = retryContext.delays[retryContext.attempt] || 5000;
      logCore(`No custom CSS found (attempt ${retryContext.attempt + 1}/${retryContext.maxAttempts}), retrying in ${delay}ms`);
      setTimeout(() => {
        getAndApplyCustomStyles({ ...retryContext, attempt: nextAttempt });
      }, delay);
    } else {
      applyCustomStyles("");
    }
  } catch (error) {
    logError(error);
    try {
      const { activePearTheme } = await getLocalStorage<{ activePearTheme?: string }>(["activePearTheme"]);
      if (activePearTheme === "glassy-merge-theme") {
        const existing = document.getElementById("blyrics-custom-style");
        if (existing) {
          existing.remove();
        }
        applyCustomStyles("");
        return;
      }

      const chunkedStyles = await loadChunkedStyles();
      if (chunkedStyles) {
        const syncCompressedData = await getSyncStorage<CSSStorageData>(["cssCompressed"]);
        let css = chunkedStyles;
        if (syncCompressedData.cssCompressed || isCompressed(css)) {
          css = decompressStyles(css);
        }
        applyCustomStyles(compileRicsToStyles(css));
        return;
      }

      const localData = await getLocalStorage<CSSStorageData>(["customCSS", "cssCompressed"]);
      if (localData.customCSS) {
        let css = localData.customCSS;
        if (localData.cssCompressed || isCompressed(css)) {
          css = decompressStyles(css);
        }
        applyCustomStyles(compileRicsToStyles(css));
        return;
      }

      const syncData = await getSyncStorage<CSSStorageData>(["customCSS", "cssCompressed"]);
      if (syncData.customCSS) {
        let css = syncData.customCSS;
        if (syncData.cssCompressed || isCompressed(css)) {
          css = decompressStyles(css);
        }
        applyCustomStyles(compileRicsToStyles(css));
        return;
      }

      // All fallbacks failed, schedule retry if available
      if (retryContext && retryContext.attempt < retryContext.maxAttempts) {
        const nextAttempt = retryContext.attempt + 1;
        const delay = retryContext.delays[retryContext.attempt] || 5000;
        logCore(`All fallbacks failed (attempt ${retryContext.attempt + 1}/${retryContext.maxAttempts}), retrying in ${delay}ms`);
        setTimeout(() => {
          getAndApplyCustomStyles({ ...retryContext, attempt: nextAttempt });
        }, delay);
      }
    } catch (fallbackError) {
      logError(fallbackError);
    }
  }
}

async function handleStoreThemeChange(key: string, change: { oldValue?: any; newValue?: any }): Promise<void> {
  const themeId = key.replace("storeTheme:", "");

  if ((await getAppliedStoreThemeId()) !== themeId) return;

  const theme = change.newValue;
  if (!theme?.css) return;

  if (change.oldValue?.css === theme.css && change.oldValue?.version === theme.version) return;

  logCore("Store theme updated:", theme.title || themeId);
  applyCustomStyles(compileRicsToStyles(theme.css));
}

export function subscribeToCustomStyles(): void {
  if (hasSubscribedToStyles) {
    return;
  }
  hasSubscribedToStyles = true;

  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area === "local" && (changes.customCSS || changes.letterWavePref || changes.activePearTheme)) {
      await getAndApplyCustomStyles();
    }

    if (area === "local") {
      for (const key of Object.keys(changes)) {
        if (key.startsWith("storeTheme:")) {
          await handleStoreThemeChange(key, changes[key]);
        }
      }
    }
  });

  // Initial load with retry mechanism for Electron environments
  // where chrome.storage may not be ready immediately
  getAndApplyCustomStyles({
    attempt: 0,
    maxAttempts: 5,
    delays: [1000, 3000, 5000, 10000, 15000],
  });
}

