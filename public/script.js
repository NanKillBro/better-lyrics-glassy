/**
 * @fileoverview YouTube Music player integration script for BetterLyrics.
 * Handles real-time player state monitoring and event dispatching.
 */

/**
 * Interval ID for the lyrics tick timer.
 * @type {number|null|undefined}
 */
let tickLyricsInterval;

/**
 * Last recorded player time to detect changes.
 * @type {number}
 */
let lastPlayerTime = 0;

/**
 * Last recorded player timestamp to interpolate time.
 * @type {number}
 */
let lastPlayerTimestamp = 0;

let lastSentPlaying = null;
let pausedTickCounter = 0;

let cachedContentRect = null;
let playerResizeObserver = null;
let lastVideoId = null;
let observedVideoElement = null;
let tickMs = 20;

const PLAYER_METADATA_CACHE_TTL_MS = 500;
let playerMetadataCacheEnabled = false;
let cachedPlayerMetadata = null;
let playerMetadataSettleUntil = 0;

/**
 * Reads the configured lyrics tick interval (milliseconds) from the
 * `blyrics-tick-ms` attribute set by the isolated content script and
 * restarts the tick interval when it changes.
 */
const syncTickMs = () => {
  const value = Number(document.documentElement.getAttribute("blyrics-tick-ms"));
  const next = Number.isFinite(value) && value >= 20 && value <= 200 ? value : 20;
  if (next === tickMs) {
    return;
  }
  tickMs = next;
  if (tickLyricsInterval) {
    startLyricsTick();
  }
};

syncTickMs();
new MutationObserver(syncTickMs).observe(document.documentElement, {
  attributes: true,
  attributeFilter: ["blyrics-tick-ms"],
});

/**
 * Reads the opt-in metadata-cache flag set by the isolated content script.
 * Only audio-track and duration reads are cached; the 20 ms timing clock and
 * video identity reads stay unchanged.
 */
const syncPlayerMetadataCache = () => {
  const enabled = document.documentElement.getAttribute("blyrics-player-metadata-cache") === "true";
  if (enabled === playerMetadataCacheEnabled) {
    return;
  }
  playerMetadataCacheEnabled = enabled;
  cachedPlayerMetadata = null;
  playerMetadataSettleUntil = 0;
};

syncPlayerMetadataCache();
new MutationObserver(syncPlayerMetadataCache).observe(document.documentElement, {
  attributes: true,
  attributeFilter: ["blyrics-player-metadata-cache"],
});

/**
 * Reads the audio-track and duration metadata for the current track. Duration
 * prefers the fixed track length from the player response, then the seekable
 * progress duration, then the video element duration.
 * @param {HTMLElement} player
 */
const readPlayerMetadata = player => {
  const audioTrackData = player.getAudioTrack();
  const playerResponse = typeof player.getPlayerResponse === "function" ? player.getPlayerResponse() : null;
  const progressState = typeof player.getProgressState === "function" ? player.getProgressState() : null;
  const metadataDuration = Number(playerResponse?.videoDetails?.lengthSeconds);
  const seekableDuration = progressState?.duration;
  let duration = player.getDuration();
  if (Number.isFinite(seekableDuration) && seekableDuration > 0) duration = seekableDuration;
  if (Number.isFinite(metadataDuration) && metadataDuration > 0) duration = metadataDuration;
  return { audioTrackData, duration };
};

const readAndCachePlayerMetadata = (player, now) => {
  const metadata = readPlayerMetadata(player);
  cachedPlayerMetadata = Number.isFinite(metadata.duration) && metadata.duration > 0 ? { at: now, ...metadata } : null;
  return metadata;
};

/**
 * Writes the video's intrinsic aspect ratio (from the <video> element's
 * videoWidth/videoHeight) to a CSS variable so styles can resize the player
 * to match it (eliminating black bars). Removes the variable when no real
 * video frame is available so CSS falls back to its default.
 * @param {HTMLVideoElement | null} video
 */
const updateVideoAspectRatioVar = video => {
  const style = document.documentElement.style;
  if (video && video.videoWidth > 0 && video.videoHeight > 0) {
    const ratio = `${video.videoWidth} / ${video.videoHeight}`;
    if (style.getPropertyValue("--blyrics-video-aspect-ratio") !== ratio) {
      style.setProperty("--blyrics-video-aspect-ratio", ratio);
    }
  } else if (style.getPropertyValue("--blyrics-video-aspect-ratio")) {
    style.removeProperty("--blyrics-video-aspect-ratio");
  }
};

const handleVideoResize = () => updateVideoAspectRatioVar(observedVideoElement);

/**
 * Finds the <video> inside the player and (re)attaches a resize listener so
 * we react to intrinsic-dimension changes (loadedmetadata, quality switches).
 * @param {HTMLElement} player
 */
const attachVideoListener = player => {
  const video = player && player.querySelector("video");
  if (video !== observedVideoElement) {
    if (observedVideoElement) {
      observedVideoElement.removeEventListener("resize", handleVideoResize);
    }
    observedVideoElement = video || null;
    if (observedVideoElement) {
      observedVideoElement.addEventListener("resize", handleVideoResize);
    }
  }
  updateVideoAspectRatioVar(observedVideoElement);
};

/**
 * Sets up a ResizeObserver on the player element to cache the content rect.
 * This avoids querying the DOM layout every 20ms which causes performance drops.
 * @param {HTMLElement} player
 */
const setupResizeObserver = player => {
  if (playerResizeObserver) {
    playerResizeObserver.disconnect();
  }

  playerResizeObserver = new ResizeObserver(() => {
    if (player && typeof player.getVideoContentRect === "function") {
      cachedContentRect = player.getVideoContentRect();
    }
    attachVideoListener(player);
  });

  playerResizeObserver.observe(player);
  attachVideoListener(player);
};
// ------------------------------------------

/**
 * Starts the lyrics tick interval to monitor YouTube Music player state.
 * Dispatches custom events with player information every 20ms for real-time sync.
 * Automatically stops the previous interval if one exists.
 */
const startLyricsTick = () => {
  stopLyricsTick();

  let player = document.getElementById("movie_player");
  if (player) {
    setupResizeObserver(player);
  }

  tickLyricsInterval = setInterval(function () {
    if (!player || !player.isConnected) {
      player = document.getElementById("movie_player");
      if (player) {
        setupResizeObserver(player);
      }
    } else {
      try {
        const now = Date.now();

        const { video_id, title, author } = player.getVideoData();

        // Update the cached rect when the video changes, as aspect ratios might shift
        if (video_id !== lastVideoId) {
          lastVideoId = video_id;
          cachedPlayerMetadata = null;
          playerMetadataSettleUntil = now + PLAYER_METADATA_CACHE_TTL_MS;
          if (typeof player.getVideoContentRect === "function") {
            cachedContentRect = player.getVideoContentRect();
          }
          attachVideoListener(player);
        }

        let audioTrackData;
        let duration;
        if (!playerMetadataCacheEnabled) {
          ({ audioTrackData, duration } = readPlayerMetadata(player));
        } else if (now < playerMetadataSettleUntil) {
          // Read per tick briefly after a song change so the cache cannot keep
          // the previous track's duration while the player updates.
          ({ audioTrackData, duration } = readAndCachePlayerMetadata(player, now));
        } else if (cachedPlayerMetadata && now - cachedPlayerMetadata.at < PLAYER_METADATA_CACHE_TTL_MS) {
          ({ audioTrackData, duration } = cachedPlayerMetadata);
        } else {
          ({ audioTrackData, duration } = readAndCachePlayerMetadata(player, now));
        }
        const { isPlaying, isBuffering } = player.getPlayerStateObject();

        // Use the cached contentRect. Fallback if it hasn't been cached yet.
        let contentRect = cachedContentRect;
        if (!contentRect && typeof player.getVideoContentRect === "function") {
          contentRect = player.getVideoContentRect();
          cachedContentRect = contentRect;
        }

        const currentTime = player.getCurrentTime();
        const playing = isPlaying && !isBuffering;

        // Throttle events when paused: only send every ~500ms instead of every 20ms
        if (!playing) {
          pausedTickCounter++;
          const stateChanged = lastSentPlaying !== playing;
          const timeChanged = currentTime !== lastPlayerTime;
          if (!stateChanged && !timeChanged && pausedTickCounter < Math.max(1, Math.round(500 / tickMs))) {
            return;
          }
          pausedTickCounter = 0;
        }
        lastSentPlaying = playing;

        // Extrapolate the current time
        if (currentTime !== lastPlayerTime || !playing) {
          lastPlayerTime = currentTime;
          lastPlayerTimestamp = now;
        }

        const timeDiff = (now - lastPlayerTimestamp) / 1000;
        const time = currentTime + timeDiff;

        document.dispatchEvent(
          new CustomEvent("blyrics-send-player-time", {
            detail: {
              currentTime: time,
              videoId: video_id,
              song: title,
              artist: author,
              duration: duration,
              audioTrackData: audioTrackData,
              browserTime: now,
              playing: playing,
              contentRect,
            },
          })
        );
      } catch (e) {
        console.log(e);
        stopLyricsTick();
      }
    }
  }, tickMs);
};

/**
 * Stops the lyrics tick interval, clears the timer, and cleans up observers.
 * Called when the page is unloaded or when an error occurs.
 */
const stopLyricsTick = () => {
  if (tickLyricsInterval) {
    clearInterval(tickLyricsInterval);
    tickLyricsInterval = null;
  }

  if (playerResizeObserver) {
    playerResizeObserver.disconnect();
    playerResizeObserver = null;
  }

  if (observedVideoElement) {
    observedVideoElement.removeEventListener("resize", handleVideoResize);
    observedVideoElement = null;
  }
};

window.addEventListener("unload", stopLyricsTick);

document.addEventListener("blyrics-seek-to", event => {
  const player = document.getElementById("movie_player");
  const seekTime = event.detail ?? 0;
  if (player && seekTime >= 0) {
    player.seekTo(seekTime, true);
    player.playVideo();
  }
});

startLyricsTick();
