import { AppState } from "@core/appState";
import { t } from "@core/i18n";
import { translateContributorCreditLabels } from "@modules/lyrics/contributorCredit";
import { type LogSink, logCore } from "@core/logger";
import { disposePlayerPanelRefit, refitPlayerPanel } from "@modules/ui/layout/playerRefit";
import type { LyricDecorations } from "@modules/lyrics/injectLyrics";
import { currentViewLyrics } from "@modules/lyrics/viewLyrics";
import { currentTickOptions, lyricsElementAdded } from "@modules/ui/mainLyricsView";
import { getPlayerBar, isAdPlaying } from "@modules/ui/playerControls/playerBarControls";
import type { KaraokeOverlayBar } from "@modules/karaoke/overlay";
import { createKaraokeStage, type KaraokeStage } from "@modules/karaoke/stage";
import { isKaraokeActive, isKaraokeLayout, isKaraokeWanted, syncKaraokeAttribute } from "@modules/karaoke/state";

// -- The karaoke view --------------------------

const mainPageBar: KaraokeOverlayBar = {
  element: () => getPlayerBar(document),
  observeShown(onChange: (shown: boolean) => void): () => void {
    const layout = document.getElementById("layout");
    if (!layout) return () => undefined;
    const read = () => onChange(layout.hasAttribute("show-fullscreen-controls"));
    const observer = new MutationObserver(read);
    observer.observe(layout, { attributes: true, attributeFilter: ["show-fullscreen-controls"] });
    read();
    return () => observer.disconnect();
  },
};

function createMainPageStage(): KaraokeStage {
  return createKaraokeStage({
    doc: document,
    win: window,
    overlay: {
      doc: document,
      get mountParent(): HTMLElement {
        return document.body;
      },
      get writtenByLabel(): string {
        return t("lyrics_writtenBy");
      },
      bar: mainPageBar,
    },
    get contributorLabels() {
      return translateContributorCreditLabels(key => t(key));
    },
    isVisible: isKaraokeActive,
    isAdPlaying: () => AppState.isAdCheckEnabled && isAdPlaying(document),
    get log(): LogSink {
      return logCore;
    },
  });
}

let stage = createMainPageStage();

let builtFrom: object | null = null;
let builtLanguage: string | null | undefined;
let decorationSignature = "";
let wasActive = false;
let wasLayout = false;

function clearKaraokeLyrics(): void {
  stage.clear();
  builtFrom = null;
  decorationSignature = "";
}

function signatureOf(decorations: LyricDecorations): string {
  let signature = "";
  for (const [index, decoration] of Object.entries(decorations)) {
    signature += `${index}${decoration.romanization ? "r" : ""}${decoration.translation ? "t" : ""},`;
  }
  return signature;
}

function publishKaraokeLyrics(): void {
  const source = AppState.parsedLyrics;
  const lyricData = AppState.lyricData;
  if (!source || !lyricData || lyricData.isProvisional || lyricData.syncType === "none") {
    if (builtFrom !== null) clearKaraokeLyrics();
    return;
  }
  if (!isKaraokeWanted()) return;

  const view = currentViewLyrics();
  if (!view.lyrics || view.noLyrics) {
    if (builtFrom !== null) clearKaraokeLyrics();
    return;
  }

  const rebuilt = source !== builtFrom;
  if (rebuilt) {
    stage.build({
      lyrics: view.lyrics,
      language: view.language,
      songwriters: view.songwriters,
      contributors: view.contributors,
      title: lyricData.song,
      artist: lyricData.artist,
      providerKey: AppState.currentProviderKey,
    });
    builtFrom = source;
    builtLanguage = view.language;
    decorationSignature = "";
  } else if (view.language !== builtLanguage) {
    builtLanguage = view.language;
    stage.setLanguage(view.language);
  }

  const signature = signatureOf(view.decorations);
  if (!rebuilt && signature === decorationSignature) return;
  decorationSignature = signature;
  stage.applyDecorations(view.decorations, retickKaraoke);
}

// -- Ticking --------------------------

// Ticks before the side panel: on the shared clock only the first view to tick sees a seek as a jump.
export function tickKaraoke(timeS: number, wallTime: number, isPlaying: boolean): void {
  stage.tick(timeS, currentTickOptions(wallTime, isPlaying));
}

function retickKaraoke(): void {
  stage.retick((eventCreationTime, isPlaying) => currentTickOptions(eventCreationTime, isPlaying, false));
}

function relayoutKaraoke(): void {
  stage.relayout();
  retickKaraoke();
}

// -- Sync --------------------------

export function syncKaraoke(): void {
  const active = syncKaraokeAttribute();

  if (active) publishKaraokeLyrics();
  else if (!AppState.parsedLyrics && builtFrom !== null) clearKaraokeLyrics();
  stage.setVisible(active, relayoutKaraoke);

  // Each view was off the screen while the other one showed, so neither kept its measurements.
  if (active !== wasActive) {
    wasActive = active;
    if (active) relayoutKaraoke();
  }
  const layout = isKaraokeLayout();
  if (layout !== wasLayout) {
    wasLayout = layout;
    if (!layout) {
      lyricsElementAdded();
      refitPlayerPanel();
    }
  }
}

export function applyKaraokeTheme(css: string): void {
  stage.setTheme(css);
}

export function disposeKaraoke(): void {
  clearKaraokeLyrics();
  stage.destroy();
  stage = createMainPageStage();
  disposePlayerPanelRefit();
  wasActive = false;
  wasLayout = false;
}
