import type { PlayerDetails } from "@core/appState";
import type { PictureInPictureSongMetadata, PictureInPictureViewDependencies } from "@modules/ui/pictureInPicture/types";

const PIP_ARTWORK_SIZE = 512;
export const FAST_ARTWORK_STALE_GRACE_MS = 2000;
const FAST_ARTWORK_FALLBACK_DELAY_MS = 350;
const DOM_THUMBNAIL_POLL_INTERVAL_MS = 100;

export interface SourceThumbnailCandidate {
  readonly url: string;
  readonly isSquare: boolean;
  readonly assetKey: string;
}

export interface ArtworkLoadCallbacks {
  readonly shouldWipeOnAllFailed: () => boolean;
  readonly onCommit: (url: string) => void;
  readonly onAllFailed: () => void;
}

export interface FastArtworkLoadHost {
  readonly pipWindow: Window;
  readonly sourceDocument: Document;
  readonly videoId: string;
  readonly signal: AbortSignal;
  readonly initialThumbnail?: PlayerDetails["thumbnail"];
  readonly committedCoverUrl: string | null;
  readonly fallbackArtworkUrl: string;
  readonly getVisibleVideoId: () => string | null;
  readonly getArtworkMetadata: PictureInPictureViewDependencies["getArtworkMetadata"];
  readonly onMetadataResolved: (metadata: PictureInPictureSongMetadata | null) => void;
  readonly startArtworkLoad: (url: string, callbacks: ArtworkLoadCallbacks) => void;
  readonly wipeArtworkImmediately: () => void;
}

export interface PreloadFastPipNextArtworkOptions {
  readonly currentVideoId: string;
  readonly prefetchedNext?: { readonly id: string; readonly thumbnail?: { readonly url?: string } } | null;
  readonly getSongMetadata?: (videoId: string) => Promise<{
    readonly id: string;
    readonly isVideo?: boolean;
    readonly nextVideoId?: string;
    readonly counterpartVideoId?: string | null;
    readonly thumbnail?: { readonly url?: string };
  } | null>;
  readonly getArtworkMetadata: (
    videoId: string,
    maxCheckCount?: number
  ) => Promise<{ readonly thumbnail?: { readonly url?: string } } | null>;
  readonly isPipOpen: () => boolean;
  readonly preloadImage?: (url: string) => void;
}

/** Rewrites a thumbnail URL for PiP display resolution and strips signed params on ytimg upgrades. */
export function normalizePipArtworkUrl(url: string, size = PIP_ARTWORK_SIZE): string {
  if (/w\d+-h\d+/.test(url)) return url.replace(/w\d+-h\d+/, `w${size}-h${size}`);
  return url.replace(/\/(sd|hq|mq)?default\.jpg(\?.*)?$/, "/maxresdefault.jpg");
}

/** Extracts a size/format-invariant identity key for Google artwork CDN URLs. */
export function getArtworkAssetKey(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.endsWith("googleusercontent.com") || parsed.hostname === "yt3.ggpht.com") {
      return `${parsed.origin}${parsed.pathname.split("=")[0]}`;
    }
  } catch {}
  return url;
}

export function isSquareArtworkUrl(url: string, img?: HTMLImageElement | null): boolean {
  const match = url.match(/w(\d+)-h(\d+)/);
  if (match) return match[1] === match[2];
  return Boolean(img && img.complete && img.naturalWidth > 0 && img.naturalWidth === img.naturalHeight);
}

/** Reads non-data-URI player/miniplayer artwork candidates from the source YouTube Music document. */
export function readSourceDomThumbnails(sourceDocument: Document): SourceThumbnailCandidate[] {
  const candidates: SourceThumbnailCandidate[] = [];
  for (const selector of ["#song-image img", "#thumbnail>#img"]) {
    const img = sourceDocument.querySelector<HTMLImageElement>(selector);
    const src = img?.currentSrc || img?.src || "";
    if (!src || src.startsWith("data:")) continue;
    candidates.push({
      url: src,
      isSquare: isSquareArtworkUrl(src, img),
      assetKey: getArtworkAssetKey(src),
    });
  }
  return candidates;
}

function defaultPreloadImage(url: string): void {
  const proxy = new Image();
  proxy.src = normalizePipArtworkUrl(url);
}

/** Warms the PiP square cover URL for the upcoming track without blocking track transitions. */
export async function preloadFastPipNextArtwork(options: PreloadFastPipNextArtworkOptions): Promise<void> {
  const { currentVideoId, getArtworkMetadata, isPipOpen, preloadImage = defaultPreloadImage } = options;
  if (!currentVideoId || !isPipOpen()) return;

  let next = options.prefetchedNext ?? null;
  if (!next && options.getSongMetadata) {
    const current = await options.getSongMetadata(currentVideoId);
    if (!current?.nextVideoId || !isPipOpen()) return;
    let candidate = await options.getSongMetadata(current.nextVideoId);
    if ((!candidate || candidate.isVideo) && current.counterpartVideoId) {
      const counterpart = await options.getSongMetadata(current.counterpartVideoId);
      candidate = counterpart?.nextVideoId ? await options.getSongMetadata(counterpart.nextVideoId) : null;
    }
    next = candidate;
  }

  if (!next || !isPipOpen()) return;
  const artwork = await getArtworkMetadata(next.id, 1);
  if (!isPipOpen()) return;
  const url = artwork?.thumbnail?.url ?? next.thumbnail?.url;
  if (url) preloadImage(normalizePipArtworkUrl(url));
}

/**
 * Resolves PiP artwork via fast player/DOM sources before canonical `/next` metadata arrives,
 * preventing 5s stalls from dropping the PiP card to the placeholder logo.
 */
export class FastArtworkController {
  private activeHintHandler: ((thumb: PlayerDetails["thumbnail"] | null | undefined) => void) | null = null;
  private readonly currentDomAssetKeys = new Set<string>();

  hintThumbnail(thumb: PlayerDetails["thumbnail"] | null | undefined): void {
    this.activeHintHandler?.(thumb);
  }

  reset(): void {
    this.activeHintHandler = null;
    this.currentDomAssetKeys.clear();
  }

  load(host: FastArtworkLoadHost): void {
    const { pipWindow, sourceDocument, videoId, signal } = host;

    const staleDomAssetKeys = new Set(this.currentDomAssetKeys);
    if (host.committedCoverUrl) staleDomAssetKeys.add(getArtworkAssetKey(host.committedCoverUrl));
    this.currentDomAssetKeys.clear();

    let metadataSettled = false;
    let triedMetadataUrl = false;
    let fallbackChainExhausted = false;
    let lastFailedAssetKey: string | null = null;
    let activeAttemptUrl: string | null = null;
    let committedUrl: string | null = null;
    let fastSquareCandidate: string | null = null;
    let fastFallbackCandidate: string | null = null;
    let cacheProbeTimer: number | null = null;
    let domPollTimer: number | null = null;
    let fastFallbackTimer: number | null = null;

    const clearFastTimers = (): void => {
      if (cacheProbeTimer !== null) pipWindow.clearTimeout(cacheProbeTimer);
      if (domPollTimer !== null) pipWindow.clearTimeout(domPollTimer);
      if (fastFallbackTimer !== null) pipWindow.clearTimeout(fastFallbackTimer);
      cacheProbeTimer = null;
      domPollTimer = null;
      fastFallbackTimer = null;
    };

    const startLoad = (url: string, fromCanonicalMetadata = false): void => {
      if (signal.aborted) return;
      const targetAssetKey = getArtworkAssetKey(url);
      if (committedUrl && getArtworkAssetKey(committedUrl) === targetAssetKey) return;
      if (activeAttemptUrl && getArtworkAssetKey(activeAttemptUrl) === targetAssetKey) return;
      if (fallbackChainExhausted && lastFailedAssetKey === targetAssetKey) {
        if (fromCanonicalMetadata) host.wipeArtworkImmediately();
        return;
      }

      activeAttemptUrl = url;
      fallbackChainExhausted = false;
      if (fromCanonicalMetadata) triedMetadataUrl = true;
      host.startArtworkLoad(url, {
        shouldWipeOnAllFailed: () => metadataSettled || triedMetadataUrl,
        onCommit: finalUrl => {
          committedUrl = finalUrl;
          activeAttemptUrl = null;
        },
        onAllFailed: () => {
          activeAttemptUrl = null;
          fallbackChainExhausted = true;
          lastFailedAssetKey = targetAssetKey;
        },
      });
    };

    const absorbThumbnail = (thumb: PlayerDetails["thumbnail"] | null | undefined): void => {
      if (!thumb?.url) return;
      const normalized = normalizePipArtworkUrl(thumb.url);
      fastFallbackCandidate = normalized;
      if (thumb.isSquare && !fastSquareCandidate) fastSquareCandidate = normalized;
    };

    const scanDomThumbnails = (): { freshSquare: string | null; anyCurrent: string | null } => {
      let freshSquare: string | null = null;
      let anyCurrent: string | null = null;
      for (const entry of readSourceDomThumbnails(sourceDocument)) {
        const normalized = normalizePipArtworkUrl(entry.url);
        if (!anyCurrent) anyCurrent = normalized;
        if (staleDomAssetKeys.has(entry.assetKey)) continue;
        this.currentDomAssetKeys.add(entry.assetKey);
        if (!fastFallbackCandidate) fastFallbackCandidate = normalized;
        if (entry.isSquare && !freshSquare) {
          freshSquare = normalized;
          if (!fastSquareCandidate) fastSquareCandidate = normalized;
        }
      }
      return { freshSquare, anyCurrent };
    };

    absorbThumbnail(host.initialThumbnail);
    scanDomThumbnails();

    this.activeHintHandler = thumb => {
      if (signal.aborted || metadataSettled) return;
      absorbThumbnail(thumb);
      if (!activeAttemptUrl && !committedUrl && fastSquareCandidate) {
        clearFastTimers();
        startLoad(fastSquareCandidate);
      }
    };

    signal.addEventListener(
      "abort",
      () => {
        clearFastTimers();
        this.activeHintHandler = null;
      },
      { once: true }
    );

    const scheduleDomPoll = (): void => {
      if (signal.aborted || metadataSettled || activeAttemptUrl || committedUrl || fastFallbackTimer === null) return;
      domPollTimer = pipWindow.setTimeout(() => {
        domPollTimer = null;
        if (signal.aborted || metadataSettled || activeAttemptUrl || committedUrl) return;
        const { freshSquare } = scanDomThumbnails();
        if (freshSquare) {
          clearFastTimers();
          startLoad(freshSquare);
          return;
        }
        scheduleDomPoll();
      }, DOM_THUMBNAIL_POLL_INTERVAL_MS);
    };

    cacheProbeTimer = pipWindow.setTimeout(() => {
      cacheProbeTimer = null;
      if (signal.aborted || metadataSettled || activeAttemptUrl || committedUrl) return;
      if (fastSquareCandidate) {
        clearFastTimers();
        startLoad(fastSquareCandidate);
        return;
      }
      fastFallbackTimer = pipWindow.setTimeout(() => {
        clearFastTimers();
        if (signal.aborted || metadataSettled || activeAttemptUrl || committedUrl) return;
        const { anyCurrent } = scanDomThumbnails();
        const verifiedDomFallback =
          !fastSquareCandidate && !fastFallbackCandidate && anyCurrent && host.getVisibleVideoId() === videoId
            ? anyCurrent
            : null;
        startLoad(fastSquareCandidate ?? fastFallbackCandidate ?? verifiedDomFallback ?? host.fallbackArtworkUrl);
      }, FAST_ARTWORK_FALLBACK_DELAY_MS);
      scheduleDomPoll();
    }, 0);

    void host.getArtworkMetadata(videoId, 250, signal).then(metadata => {
      if (signal.aborted) return;
      metadataSettled = true;
      this.activeHintHandler = null;
      clearFastTimers();
      host.onMetadataResolved(metadata);

      if (metadata?.thumbnail?.url) {
        startLoad(normalizePipArtworkUrl(metadata.thumbnail.url), true);
        return;
      }
      if (fallbackChainExhausted && !committedUrl) {
        host.wipeArtworkImmediately();
        return;
      }
      if (!activeAttemptUrl && !committedUrl) {
        startLoad(fastSquareCandidate ?? fastFallbackCandidate ?? host.fallbackArtworkUrl, true);
      }
    });
  }
}
