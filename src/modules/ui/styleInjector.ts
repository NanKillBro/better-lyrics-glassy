import { GENERAL_ERROR_LOG, LOG_PREFIX } from "@constants";
import { decompressString, isCompressed } from "@core/compression";
import { compileRicsToStyles, getLocalStorage, getSyncStorage, loadChunkedStyles } from "@core/storage";
import { setThemeSettings } from "@modules/settings/themeOptions";
import { log } from "@utils";
import { clearAnimationStyleCache } from "./animationEngine";

let hasSubscribedToStyles = false;

function parseBlyricsConfig(cssContent: string): Map<string, string> {
  const configMap = new Map<string, string>();

  const commentRegex = /\/\*([\s\S]*?)\*\//g;
  const configRegex = /(blyrics-[\w-]+)\s*=\s*([^;]+);/g;

  let commentMatch;

  while ((commentMatch = commentRegex.exec(cssContent)) !== null) {
    const commentContent = commentMatch[1];
    let configMatch;

    while ((configMatch = configRegex.exec(commentContent)) !== null) {
      const key = configMatch[1];
      let value = configMatch[2].trim();
      configMap.set(key, value);
    }
  }

  return configMap;
}

export function applyCustomStyles(css: string): void {
  let config = parseBlyricsConfig(css);
  setThemeSettings(config);

  let styleTag = document.getElementById("blyrics-custom-style");
  if (styleTag) {
    styleTag.textContent = css;
  } else {
    styleTag = document.createElement("style");
    styleTag.id = "blyrics-custom-style";
    styleTag.textContent = css;
    document.head.appendChild(styleTag);
  }
  clearAnimationStyleCache();
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
      log(LOG_PREFIX, `No custom CSS found (attempt ${retryContext.attempt + 1}/${retryContext.maxAttempts}), retrying in ${delay}ms`);
      setTimeout(() => {
        getAndApplyCustomStyles({ ...retryContext, attempt: nextAttempt });
      }, delay);
    }
  } catch (error) {
    log(GENERAL_ERROR_LOG, error);
    try {
      const { activePearTheme } = await getLocalStorage<{ activePearTheme?: string }>(["activePearTheme"]);
      if (activePearTheme === "glassy-merge-theme") {
        const existing = document.getElementById("blyrics-custom-style");
        if (existing) {
          existing.remove();
        }
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
        log(LOG_PREFIX, `All fallbacks failed (attempt ${retryContext.attempt + 1}/${retryContext.maxAttempts}), retrying in ${delay}ms`);
        setTimeout(() => {
          getAndApplyCustomStyles({ ...retryContext, attempt: nextAttempt });
        }, delay);
      }
    } catch (fallbackError) {
      log(GENERAL_ERROR_LOG, fallbackError);
    }
  }
}

async function handleStoreThemeChange(key: string, change: { oldValue?: any; newValue?: any }): Promise<void> {
  const themeId = key.replace("storeTheme:", "");
  const { activeStoreTheme } = await getSyncStorage<{ activeStoreTheme?: string }>(["activeStoreTheme"]);

  if (activeStoreTheme !== themeId) return;

  const theme = change.newValue;
  if (!theme?.css) return;

  if (change.oldValue?.css === theme.css && change.oldValue?.version === theme.version) return;

  log(LOG_PREFIX, "Store theme updated:", theme.title || themeId);
  applyCustomStyles(compileRicsToStyles(theme.css));
}

export function subscribeToCustomStyles(): void {
  if (hasSubscribedToStyles) {
    return;
  }
  hasSubscribedToStyles = true;

  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area === "local" && changes.customCSS) {
      if (changes.customCSS.newValue) {
        let css = changes.customCSS.newValue as string;
        if (isCompressed(css)) {
          css = decompressStyles(css);
        }
        applyCustomStyles(compileRicsToStyles(css));
      }
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

