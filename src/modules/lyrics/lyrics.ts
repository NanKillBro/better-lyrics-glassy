/**
 * @fileoverview Main lyrics handling module for
 * Manages lyrics fetching, caching, processing, and rendering.
 */

import { FETCH_LYRICS_LOG, LOG_PREFIX, LYRICS_TAB_HIDDEN_LOG, SERVER_ERROR_LOG, TAB_HEADER_CLASS } from "@constants";
import { AppState, type PlayerDetails } from "@core/appState";
import { t } from "@core/i18n";
import { type LyricsData, processLyrics } from "@modules/lyrics/injectLyrics";
import { registerThemeSetting } from "@modules/settings/themeOptions";
import { animEngineState } from "@modules/ui/animationEngine";
import { flushLoader, refreshDockSources, renderLoader } from "@modules/ui/dom";
import { log } from "@utils";
import { LyricsLoadTimer } from "./lyricsLoadTimings";
import type { Lyric, LyricSourceKey, LyricSourceResult, ProviderParameters } from "./providers/shared";
import { getLyrics, newSourceMap, providerPriority } from "./providers/shared";
import type { YTLyricSourceResult } from "./providers/yt";
import { getSongAlbum, getSongMetadata, type SegmentMap } from "./requestSniffer/requestSniffer";
import { createSelection } from "./selection";
import { agreeingKeys, lyricsMatch } from "./sourceAgreement";
import { clearCache as clearTranslationCache } from "./translation";

const hideInstrumentalOnly = registerThemeSetting("blyrics-hide-instrumental-only", true, true);

function isInstrumentalOnly(lyrics: Lyric[]): boolean {
  if (!lyrics || lyrics.length === 0) return false;
  const meaningfulLyrics = lyrics.filter(l => l.words && l.words.trim().length > 0);
  if (meaningfulLyrics.length === 0) return true;
  const instrumentalPattern = /^(\[|\(|\♪|\s)*(instrumental(\s*only)?|music)(\]|\)|\♪|\s)*$/i;
  return meaningfulLyrics.every(l => instrumentalPattern.test(l.words.trim()) || l.isInstrumental === true);
}

function lyricText(lyrics: Lyric[]): string {
  let text = "";
  lyrics.forEach(lyric => {
    text += lyric.words + "\n";
  });
  return text;
}

function isCheckedAgainstYt(provider: LyricSourceKey): boolean {
  return !provider.startsWith("unison") && provider !== "yt-lyrics";
}

function normalizeArtist(artist: string): string {
  return artist.trim().replace(", & ", ", ");
}

export type LyricSourceResultWithMeta = LyricSourceResult & {
  song: string;
  artist: string;
  album: string;
  duration: number;
  videoId: string;
  segmentMap: SegmentMap | null;
  providerKey?: string;
};

export function applySegmentMapToLyrics(lyricData: LyricsData | null, segmentMap: SegmentMap) {
  if (segmentMap && lyricData) {
    lyricData.isMusicVideoSynced = !lyricData.isMusicVideoSynced;
    // We're sync lyrics using segment map
    const allZero = lyricData.syncType === "none";

    if (!allZero) {
      for (let lyric of lyricData.lines) {
        lyric.accumulatedOffsetMs = 1000000; // Force resync by setting to a very large value
        let lastTimeChange = 0;
        for (let segment of segmentMap.segment) {
          let lyricTimeMs = lyric.time * 1000;
          if (lyricTimeMs >= segment.counterpartVideoStartTimeMilliseconds) {
            lastTimeChange = segment.primaryVideoStartTimeMilliseconds - segment.counterpartVideoStartTimeMilliseconds;
            if (lyricTimeMs <= segment.counterpartVideoStartTimeMilliseconds + segment.durationMilliseconds) {
              break;
            }
          }
        }

        let changeS = lastTimeChange / 1000;
        lyric.time = lyric.time + changeS;
        lyric.lyricElement.dataset.time = String(lyric.time);
        lyric.parts.forEach(part => {
          part.time = part.time + changeS;
          part.lyricElement.dataset.time = String(part.time);
        });
      }
    }
  }
}

/**
 * Main function to create and inject lyrics for the current song.
 * Handles caching, API requests, and fallback mechanisms.
 *
 * @param detail - Song and player details
 * @param signal - signal to cancel injection
 */
export async function createLyrics(detail: PlayerDetails, signal: AbortSignal): Promise<void> {
  let song = detail.song;
  let artist = detail.artist;
  let videoId = detail.videoId;
  let duration = Number(detail.duration);
  const audioTrackData = detail.audioTrackData;
  const isMusicVideo = detail.contentRect.width !== 0 && detail.contentRect.height !== 0;

  if (!videoId) {
    log(SERVER_ERROR_LOG, "Invalid video id");
    return;
  }

  let shouldCleanupLoader = false;
  const lyricsTimer = new LyricsLoadTimer();

  try {
    // We should get recalled if we were executed without a valid song/artist and aren't able to get lyrics

    lyricsTimer.begin("song-metadata(initial)");
    let matchingSong = await getSongMetadata(videoId, 1, signal);
    lyricsTimer.end("song-metadata(initial)");
    let swappedVideoId = false;
    let isAVSwitch =
      (matchingSong &&
        matchingSong.counterpartVideoId &&
        matchingSong.counterpartVideoId === AppState.lastLoadedVideoId) ||
      AppState.lastLoadedVideoId === videoId;

    let segmentMap = matchingSong?.segmentMap || null;

    const isSoftReload = AppState.lastLoadedVideoId === videoId && AppState.lyricData != null;

    if (isAVSwitch && segmentMap) {
      applySegmentMapToLyrics(AppState.lyricData, segmentMap);
      AppState.suppressZeroTime = Date.now() + 5000;
      AppState.areLyricsTicking = true; // Keep lyrics ticking while new lyrics are fetched.
      log(LOG_PREFIX, "Switching between audio/video: Skipping Loader", segmentMap);
    } else if (isSoftReload) {
      // Same-song reload (provider switch or translation/romanization toggle): keep the
      // current lyrics on screen and swap them in once the new ones are ready, no loader.
      AppState.suppressZeroTime = Date.now() + 5000;
      AppState.areLyricsTicking = true;
      log(LOG_PREFIX, "Soft reload: keeping current lyrics, skipping loader");
    } else {
      log(LOG_PREFIX, "Not Switching between audio/video", isAVSwitch, segmentMap);
      renderLoader();
      shouldCleanupLoader = true;
      clearTranslationCache();
      lyricsTimer.begin("song-metadata(settled)");
      matchingSong = await getSongMetadata(videoId, 250, signal);
      lyricsTimer.end("song-metadata(settled)");
      segmentMap = matchingSong?.segmentMap || null;
      AppState.areLyricsLoaded = false;
      AppState.areLyricsTicking = false;
      AppState.suppressZeroTime = 0;
      animEngineState.lastEventCreationTime = -1;
      animEngineState.lastPlayState = false;
      animEngineState.lastTime = 0;
    }

    if (matchingSong) {
      song = matchingSong.title;
      artist = matchingSong.artist || artist;

      if (isMusicVideo && matchingSong.counterpartVideoId && matchingSong.segmentMap) {
        log(LOG_PREFIX, "Switching VideoId to Audio Id");
        swappedVideoId = true;
        videoId = matchingSong.counterpartVideoId;
      }
    }

    const tabSelector = document.getElementsByClassName(TAB_HEADER_CLASS)[1];
    console.assert(tabSelector != null);
    if (tabSelector.getAttribute("aria-selected") !== "true") {
      AppState.areLyricsLoaded = false;
      AppState.areLyricsTicking = false;
      AppState.lyricInjectionFailed = true;
      log(LYRICS_TAB_HIDDEN_LOG);
      return;
    }

    song = song.trim();
    artist = normalizeArtist(artist);
    lyricsTimer.begin("song-album");
    let album = await getSongAlbum(videoId, signal);
    lyricsTimer.end("song-album");
    if (!album) {
      album = "";
    }

    // Check for empty strings after trimming
    if (!song || !artist) {
      log(SERVER_ERROR_LOG, "Empty song or artist name");
      return;
    }

    if (signal.aborted) {
      return;
    }

    log(FETCH_LYRICS_LOG, song, artist);

    let lyrics: LyricSourceResult | null = null;
    let sourceMap = newSourceMap();

    // We depend on the cubey lyrics to fetch certain metadata, so we always call it even if it isn't the top priority
    let providerParameters: ProviderParameters = {
      song,
      artist,
      duration,
      videoId,
      audioTrackData,
      album,
      sourceMap,
      alwaysFetchMetadata: swappedVideoId,
      signal,
    };
    let ytLyricsEarlyInjectAbortController = new AbortController();

    const ytLyricsStart = performance.now();
    let ytLyricsPromise = getLyrics(providerParameters, "yt-lyrics")
      .then(lyrics => {
        lyricsTimer.add("yt-lyrics", performance.now() - ytLyricsStart, true);
        if (!AppState.areLyricsLoaded && lyrics && !signal.aborted) {
          if (!ytLyricsEarlyInjectAbortController.signal.aborted) {
            log(LOG_PREFIX, "Temporarily Using YT Music Lyrics while we wait for synced lyrics to load");
            let lyricsWithMeta = {
              ...lyrics,
              song: providerParameters.song,
              artist: providerParameters.artist,
              duration: providerParameters.duration,
              videoId: providerParameters.videoId,
              album: providerParameters.album || "",
              segmentMap: null,
            };

            processLyrics(lyricsWithMeta, true, signal);
          }
        }
        return lyrics;
      })
      .catch(err => {
        log(err);
        return null;
      });

    try {
      lyricsTimer.begin("provider:metadata");
      let meta = await getLyrics(providerParameters, "metadata");
      lyricsTimer.end("provider:metadata");
      if (meta && meta.album && meta.album.length > 0) {
        providerParameters.album = meta.album;
      }
      if (meta && meta.song && meta.song.length > 0 && song !== meta.song) {
        log(LOG_PREFIX, "Using '" + meta.song + "' for song instead of '" + song + "'");
        providerParameters.song = meta.song;
      }

      if (meta && meta.artist && meta.artist.length > 0 && artist !== meta.artist) {
        log(LOG_PREFIX, "Using '" + meta.artist + "' for artist instead of '" + artist + "'");
        providerParameters.artist = meta.artist;
      }

      if (meta && meta.duration && duration !== meta.duration) {
        log(LOG_PREFIX, "Using '" + meta.duration + "' for duration instead of '" + duration + "'");
        providerParameters.duration = meta.duration;
      }
    } catch (err) {
      log(err);
    }

    let selectedProvider: LyricSourceKey | undefined;

    const pinnedProvider = AppState.manualProviderKey;
    const orderedProviders =
      pinnedProvider && providerPriority.includes(pinnedProvider)
        ? [pinnedProvider, ...providerPriority.filter(provider => provider !== pinnedProvider)]
        : providerPriority;

    const withLyricsMeta = (
      sourceLyrics: LyricSourceResult,
      providerKey?: LyricSourceKey
    ): LyricSourceResultWithMeta => ({
      song: providerParameters.song,
      artist: providerParameters.artist,
      album: providerParameters.album || "",
      duration: providerParameters.duration,
      videoId: providerParameters.videoId,
      segmentMap: isMusicVideo === (sourceLyrics.musicVideoSynced === true) ? null : segmentMap,
      providerKey,
      ...sourceLyrics,
    });

    const recordAvailableProvider = (provider: LyricSourceKey, sourceLyrics: LyricSourceResult | null): void => {
      if (!sourceLyrics?.lyrics || sourceLyrics.lyrics.length === 0) return;
      const known = new Set([...AppState.availableProviderKeys, provider]);
      AppState.availableProviderKeys = providerPriority.filter(key => known.has(key));
    };

    let timerCompleted = false;
    let availableAtLastDisplay = -1;
    const completeTimer = (provider: LyricSourceKey | undefined): void => {
      if (timerCompleted) return;
      timerCompleted = true;
      const source = provider ? providerParameters.sourceMap[provider]?.lyricSourceResult : null;
      lyricsTimer.complete({
        source: source?.source ?? "Unknown",
        provider,
        fromCache: provider ? providerParameters.sourceMap[provider]?.lastLoadFromCache : undefined,
      });
    };

    const showLyrics = (provider: LyricSourceKey | undefined, sourceLyrics: LyricSourceResult): void => {
      if (signal.aborted) return;
      ytLyricsEarlyInjectAbortController.abort("Lyrics are ready");
      hasShownLyrics = true;
      AppState.currentInjectionId++;
      selectedProvider = provider;
      AppState.lastLoadedVideoId = detail.videoId;
      log(LOG_PREFIX, "Got Lyrics from " + sourceLyrics.source);
      lyricsTimer.begin("process-lyrics");
      try {
        processLyrics(withLyricsMeta(sourceLyrics, provider), false, signal);
      } catch (err) {
        log(err);
      }
      lyricsTimer.end("process-lyrics");
      availableAtLastDisplay = AppState.availableProviderKeys.length;
      completeTimer(provider);
      shouldCleanupLoader = false;
    };

    const showNotFound = (): void => {
      if (signal.aborted) return;
      ytLyricsEarlyInjectAbortController.abort("No lyrics found");
      AppState.currentInjectionId++;
      selectedProvider = undefined;
      AppState.lastLoadedVideoId = detail.videoId;
      lyricsTimer.begin("process-lyrics");
      try {
        processLyrics(
          withLyricsMeta({
            lyrics: [
              {
                startTimeMs: 0,
                words: t("lyrics_notFound"),
                durationMs: 0,
              },
            ],
            source: "Unknown",
            sourceHref: "",
            musicVideoSynced: false,
            cacheAllowed: false,
          }),
          false,
          signal
        );
      } catch (err) {
        log(err);
      }
      lyricsTimer.end("process-lyrics");
      availableAtLastDisplay = AppState.availableProviderKeys.length;
      completeTimer(undefined);
      shouldCleanupLoader = false;
    };

    let progressiveHandled = false;
    let hasShownLyrics = false;

    if (AppState.isProgressiveLyricsEnabled) {
      progressiveHandled = true;
      log(LOG_PREFIX, `Progressive lyrics loading active: asking ${orderedProviders.length} providers concurrently`);
      const selection = createSelection<LyricSourceKey, LyricSourceResult>({
        order: orderedProviders,
        display: (provider, sourceLyrics) => showLyrics(provider, sourceLyrics),
        displayNone: showNotFound,
      });

      const ytMismatches = new Map<LyricSourceKey, LyricSourceResult>();
      let hasYtMatch = false;

      // A source the listener picked by hand is shown whatever the checks say; they only withhold the rest.
      const withhold = (provider: LyricSourceKey): boolean => {
        if (provider === pinnedProvider) return false;
        selection.report(provider, { kind: "rejected" });
        return true;
      };

      const run = async (provider: LyricSourceKey): Promise<void> => {
        if (signal.aborted) {
          selection.report(provider, { kind: "rejected" });
          return;
        }

        try {
          lyricsTimer.begin(`provider:${provider}`);
          const sourceLyrics = await getLyrics(providerParameters, provider);
          lyricsTimer.end(`provider:${provider}`);

          if (signal.aborted) {
            selection.report(provider, { kind: "rejected" });
            return;
          }
          if (!sourceLyrics?.lyrics || sourceLyrics.lyrics.length === 0) {
            selection.report(provider, { kind: "rejected" });
            return;
          }

          recordAvailableProvider(provider, sourceLyrics);

          if (hideInstrumentalOnly.getBooleanValue() && isInstrumentalOnly(sourceLyrics.lyrics) && withhold(provider)) {
            return;
          }

          // Show it now; withdraw it if YouTube's own lyrics say it is a different song. Unison
          // matches on the video id, so it skips this check in the sequential path too.
          selection.report(provider, { kind: "displayable", result: sourceLyrics });
          if (!isCheckedAgainstYt(provider)) return;

          const ytLyrics = (await ytLyricsPromise) as YTLyricSourceResult | null;
          if (signal.aborted || ytLyrics === null) return;

          if (lyricsMatch(lyricText(sourceLyrics.lyrics), ytLyrics.text)) {
            hasYtMatch = true;
            return;
          }
          ytMismatches.set(provider, sourceLyrics);
          const withheld = withhold(provider);
          log(
            `Got lyrics from ${sourceLyrics.source}, but they don't match YT lyrics. ` +
              (withheld ? "Rejecting." : "Keeping them, as this source was picked manually.")
          );
        } catch (err) {
          log(err);
          lyricsTimer.end(`provider:${provider}`);
          selection.report(provider, { kind: "rejected" });
        }
      };

      // When no source matches YouTube's lyrics, the fault is more likely YouTube's (a truncated or
      // wrong entry) than every source's, provided most of them agree with each other.
      const reinstateAgreeingSources = (): void => {
        if (signal.aborted || hasYtMatch) return;
        const mismatched = orderedProviders.flatMap(key => {
          const result = ytMismatches.get(key);
          return result?.lyrics ? [{ key, source: result.source, text: lyricText(result.lyrics), result }] : [];
        });
        const agreed = new Set(agreeingKeys(mismatched));
        if (agreed.size === 0) return;
        log(`No source matched YT lyrics, but most agree with each other. Allowing: ${[...agreed].join(", ")}`);
        for (const { key, result } of mismatched) {
          if (agreed.has(key)) selection.report(key, { kind: "displayable", result });
        }
      };

      const ytChecked = orderedProviders.filter(isCheckedAgainstYt);
      const ytUnchecked = orderedProviders.filter(provider => !isCheckedAgainstYt(provider));
      await Promise.allSettled([
        Promise.allSettled(ytChecked.map(run)).then(reinstateAgreeingSources),
        ...ytUnchecked.map(run),
      ]);
      if (signal.aborted) {
        selection.dispose();
        return;
      }
      if (!hasShownLyrics) showNotFound();
      if (AppState.availableProviderKeys.length !== availableAtLastDisplay) refreshDockSources();
      selection.dispose();
    } else {
      const ytMismatches = new Map<LyricSourceKey, LyricSourceResult>();

      const bestAgreeingSource = (): { key: LyricSourceKey; result: LyricSourceResult } | null => {
        const mismatched = orderedProviders.flatMap(key => {
          const result = ytMismatches.get(key);
          return result?.lyrics ? [{ key, source: result.source, text: lyricText(result.lyrics), result }] : [];
        });
        const agreed = new Set(agreeingKeys(mismatched));
        if (agreed.size === 0) return null;
        const pick = mismatched.find(entry => agreed.has(entry.key));
        if (!pick) return null;
        log(`No source matched YT lyrics, but most agree with each other. Allowing: ${[...agreed].join(", ")}`);
        return { key: pick.key, result: pick.result };
      };

      for (let provider of orderedProviders) {
        if (signal.aborted) {
          return;
        }

        try {
          lyricsTimer.begin(`provider:${provider}`);
          let sourceLyrics = await getLyrics(providerParameters, provider);
          lyricsTimer.end(`provider:${provider}`);

          if (sourceLyrics && sourceLyrics.lyrics && sourceLyrics.lyrics.length > 0) {
            const manuallyPicked = provider === pinnedProvider;
            if (hideInstrumentalOnly.getBooleanValue() && isInstrumentalOnly(sourceLyrics.lyrics) && !manuallyPicked) {
              continue;
            }
            ytLyricsEarlyInjectAbortController.abort("Lyrics are ready"); // May not be ideal when the check fails, but this should be rare anyways
            let ytLyrics = isCheckedAgainstYt(provider) ? ((await ytLyricsPromise) as YTLyricSourceResult) : null;

            if (ytLyrics !== null && !lyricsMatch(lyricText(sourceLyrics.lyrics), ytLyrics.text)) {
              ytMismatches.set(provider, sourceLyrics);
              if (!manuallyPicked) {
                log(`Got lyrics from ${sourceLyrics.source}, but they don't match YT lyrics. Rejecting.`);
                continue;
              }
              log(
                `Got lyrics from ${sourceLyrics.source}, but they don't match YT lyrics. Keeping them, as this source was picked manually.`
              );
            }

            // The YT stub normally wins by priority, but a majority of independent sources is the
            // stronger signal when YouTube's own entry is truncated or wrong.
            if (provider === "yt-lyrics" && !manuallyPicked) {
              const agreed = bestAgreeingSource();
              if (agreed) {
                lyrics = agreed.result;
                selectedProvider = agreed.key;
                break;
              }
            }

            lyrics = sourceLyrics;
            selectedProvider = provider;
            break;
          }
        } catch (err) {
          log(err);
        }
      }

      if (!lyrics && !signal.aborted) {
        const agreed = bestAgreeingSource();
        if (agreed) {
          lyrics = agreed.result;
          selectedProvider = agreed.key;
        }
      }
    }

    if (!progressiveHandled) {
      if (!lyrics) {
        lyrics = {
          lyrics: [
            {
              startTimeMs: 0,
              words: t("lyrics_notFound"),
              durationMs: 0,
            },
          ],
          source: "Unknown",
          sourceHref: "",
          musicVideoSynced: false,
          cacheAllowed: false,
        };
      }

      if (!lyrics.lyrics) {
        throw new Error("Lyrics.lyrics is null or undefined. Report this bug");
      }

      if (isMusicVideo === (lyrics.musicVideoSynced === true)) {
        segmentMap = null; // The timing matches, we don't need to apply a segment map!
      }

      log(LOG_PREFIX, "Got Lyrics from " + lyrics.source);

      // Preserve song and artist information in the lyrics data for the "Add Lyrics" button
      const data: LyricSourceResultWithMeta = withLyricsMeta(lyrics, selectedProvider);

      // Record which providers actually returned lyrics for this song so the dock's source
      // dropdown and cycling only offer real choices instead of empties that fall back.
      // Union with what is already known: pinning a provider wins the loop early before the
      // rest of the stream lands, so a fresh filter alone would shrink the list each switch.
      const collected = providerPriority.filter(key => {
        const result = sourceMap[key]?.lyricSourceResult;
        return !!result && "lyrics" in result && Array.isArray(result.lyrics) && result.lyrics.length > 0;
      });
      const known = new Set([...AppState.availableProviderKeys, ...collected]);
      AppState.availableProviderKeys = providerPriority.filter(key => known.has(key));

      AppState.lastLoadedVideoId = detail.videoId;
      if (signal.aborted) {
        return;
      }
      lyricsTimer.begin("process-lyrics");
      processLyrics(data, false, signal);
      lyricsTimer.end("process-lyrics");
      lyricsTimer.complete({
        source: lyrics.source,
        provider: selectedProvider,
        fromCache: selectedProvider
          ? providerParameters.sourceMap[selectedProvider as keyof typeof providerParameters.sourceMap]
              ?.lastLoadFromCache
          : undefined,
      });
      shouldCleanupLoader = false;
    }
  } finally {
    lyricsTimer.incomplete();
    if (shouldCleanupLoader) {
      flushLoader();
    }
  }
}

/**
 * Warms caches so lyric fetching is faster
 *
 * @param detail - Song and player details
 * @param isMusicVideo
 */
export async function preFetchLyrics(
  detail: Pick<PlayerDetails, "song" | "artist" | "videoId" | "duration">,
  isMusicVideo: boolean
): Promise<void> {
  log(LOG_PREFIX, "Prefetching next song", detail, isMusicVideo);
  const prefetchStart = performance.now();
  let song = detail.song;
  let artist = detail.artist;
  let videoId = detail.videoId;
  let duration = Number(detail.duration);
  let signal = new AbortController().signal; // create a signal to pass to other funcs, not used

  let matchingSong = await getSongMetadata(videoId, 250, signal);
  let swappedVideoId = false;

  if (matchingSong) {
    song = matchingSong.title;
    artist = matchingSong.artist || artist;

    if (isMusicVideo && matchingSong.counterpartVideoId && matchingSong.segmentMap) {
      swappedVideoId = true;
      videoId = matchingSong.counterpartVideoId;
    }
  }

  song = song.trim();
  artist = normalizeArtist(artist);
  let album = await getSongAlbum(videoId, signal);
  if (!album) {
    album = "";
  }

  log(LOG_PREFIX, "Prefetching for: ", song, artist);

  let sourceMap = newSourceMap();
  // We depend on the cubey lyrics to fetch certain metadata, so we always call it even if it isn't the top priority
  let providerParameters: ProviderParameters = {
    song,
    artist,
    duration,
    videoId,
    audioTrackData: null,
    album,
    sourceMap,
    alwaysFetchMetadata: swappedVideoId,
    signal,
  };

  try {
    let meta = await getLyrics(providerParameters, "metadata");
    if (meta && meta.album && meta.album.length > 0 && album !== meta.album) {
      providerParameters.album = meta.album;
    }
    if (meta && meta.song && meta.song.length > 0 && song !== meta.song) {
      providerParameters.song = meta.song;
    }

    if (meta && meta.artist && meta.artist.length > 0 && artist !== meta.artist) {
      providerParameters.artist = meta.artist;
    }

    if (meta && meta.duration && duration !== meta.duration) {
      providerParameters.duration = meta.duration;
    }
  } catch (err) {
    log(err);
  }

  for (let provider of providerPriority) {
    if (signal.aborted) {
      return;
    }

    try {
      let sourceLyrics = await getLyrics(providerParameters, provider);

      if (sourceLyrics && sourceLyrics.lyrics && sourceLyrics.lyrics.length > 0) {
        break;
      }
    } catch (err) {
      log(err);
    }
  }

  log(LOG_PREFIX, `Prefetch completed in ${Math.round(performance.now() - prefetchStart)}ms`);
}
