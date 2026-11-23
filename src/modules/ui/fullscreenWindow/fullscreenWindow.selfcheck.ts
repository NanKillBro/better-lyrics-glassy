import { strict as assert } from "node:assert";
import type { Lyric } from "@braccato/core";
import { createVideoQualityBoostCoordinator } from "@modules/settings/videoQuality";
import { JSDOM } from "jsdom";
import { hasSameRenderedLyrics } from "@modules/ui/fullscreenWindow/lyricsEquality";
import type { FullscreenLyricsPayload, FullscreenTrackInfo } from "@modules/ui/fullscreenWindow/messages";
import {
  SHARPEN_LEAD_BEFORE_SWEEP_S,
  type SharpenLineDescriptor,
  SharpenTimelineState,
} from "@modules/ui/fullscreenWindow/sharpenMarker";
import {
  buildTrackKey,
  isUsableArtworkUrl,
  readMainAlbumColors,
  readMainSongInfo,
} from "@modules/ui/fullscreenWindow/trackInfo";

function makeLine(
  isActive: boolean,
  startTimeS: number,
  durationS = 4,
  opts: { isAnimating?: boolean; animDelayS?: number | null } = {},
): SharpenLineDescriptor {
  return {
    isActive,
    isAnimating: opts.isAnimating ?? false,
    animDelayS: opts.animDelayS ?? null,
    startTimeS,
    durationS,
  };
}

{
  const state = new SharpenTimelineState();
  // Initial attachment mid-song sharpens line 1 immediately, even while line 2 is pre-armed
  // in `.blyrics--active` / `.blyrics--animating` with a future `--blyrics-anim-delay`.
  const first = state.evaluate(10.0, [
    makeLine(false, 5),
    makeLine(true, 10, 4, { isAnimating: true, animDelayS: -0.15 }),
    makeLine(false, 15),
  ]);
  assert.equal(first.noSync, false);
  assert.equal(first.index, 1);

  // At T - 1.2s (13.8s), Better Lyrics flips `.blyrics--active` and pre-arms `--blyrics-anim-delay`
  // for sweep at 14.85s (delay = 1.05s). Sharpen holds line 1 until 14.85 - 0.30 = 14.55s,
  // matching `mergetheme.js`'s `NANKILL_SHARPEN_LEAD_S = 0.3` and GlassyFlow's 240ms scroll start.
  const preArmLines = [
    makeLine(false, 5),
    makeLine(true, 10, 4, { isAnimating: true, animDelayS: -0.15 }),
    makeLine(true, 15, 4, { isAnimating: true, animDelayS: 1.05 }),
  ];
  assert.equal(state.evaluate(13.8, preArmLines).index, 1);
  assert.equal(
    state.evaluate(14.5, [
      makeLine(false, 5),
      makeLine(false, 10, 4, { isAnimating: false }),
      makeLine(true, 15, 4, { isAnimating: true, animDelayS: 1.05 }),
    ]).index,
    1,
  );
  assert.equal(
    state.evaluate(14.54, [
      makeLine(false, 5),
      makeLine(false, 10),
      makeLine(true, 15, 4, { isAnimating: true, animDelayS: 1.05 }),
    ]).index,
    1,
  );
  assert.equal(
    state.evaluate(14.85 - SHARPEN_LEAD_BEFORE_SWEEP_S, [
      makeLine(false, 5),
      makeLine(false, 10),
      makeLine(true, 15, 4, { isAnimating: true, animDelayS: 1.05 }),
    ]).index,
    2,
  );

  // A seek jump switches to the started line immediately without lighting a far-ahead active line.
  assert.equal(
    state.evaluate(30.0, [
      makeLine(true, 5, 4, { isAnimating: true, animDelayS: -25.15 }),
      makeLine(false, 10),
      makeLine(false, 15),
    ]).index,
    0,
  );
}

{
  // Backward seek during pre-arm lookahead should drop back to the earlier started line.
  const state = new SharpenTimelineState();
  assert.equal(
    state.evaluate(14.8, [
      makeLine(false, 5),
      makeLine(false, 10),
      makeLine(true, 15, 4, { isAnimating: true, animDelayS: 0.05 }),
    ]).index,
    2,
  );
  assert.equal(
    state.evaluate(13.9, [
      makeLine(false, 5),
      makeLine(true, 10),
      makeLine(true, 15, 4, { isAnimating: true, animDelayS: 0.95 }),
    ]).index,
    1,
  );
}

{
  // Overlapping / duet lines keep all still-singing lines sharpened simultaneously.
  const state = new SharpenTimelineState();
  assert.deepEqual(
    state.evaluate(10.0, [
      makeLine(false, 5, 4),
      makeLine(true, 10, 6, { isAnimating: true, animDelayS: -0.15 }),
      makeLine(false, 12, 4),
      makeLine(false, 18, 4),
    ]).indices,
    [1],
  );
  // At 10.8s, line 2 pre-arms (sweep 11.85s -> sharpen 11.55s): line 1 stays alone until 11.55s.
  assert.deepEqual(
    state.evaluate(10.8, [
      makeLine(false, 5, 4),
      makeLine(true, 10, 6, { isAnimating: true, animDelayS: -0.15 }),
      makeLine(true, 12, 4, { isAnimating: true, animDelayS: 1.05 }),
      makeLine(false, 18, 4),
    ]).indices,
    [1],
  );
  // Once line 2 enters its sharpen window while line 1 is still singing, both stay sharp together.
  assert.deepEqual(
    state.evaluate(11.6, [
      makeLine(false, 5, 4),
      makeLine(true, 10, 6, { isAnimating: true, animDelayS: -0.15 }),
      makeLine(true, 12, 4, { isAnimating: true, animDelayS: 1.05 }),
      makeLine(false, 18, 4),
    ]).indices,
    [1, 2],
  );
  assert.deepEqual(
    state.evaluate(13.0, [
      makeLine(false, 5, 4),
      makeLine(true, 10, 6, { isAnimating: true, animDelayS: -0.15 }),
      makeLine(true, 12, 4, { isAnimating: true, animDelayS: 1.05 }),
      makeLine(false, 18, 4),
    ]).indices,
    [1, 2],
  );
  // Once line 1 finishes animating, sharpen narrows cleanly to line 2.
  assert.deepEqual(
    state.evaluate(16.1, [
      makeLine(false, 5, 4),
      makeLine(false, 10, 6, { isAnimating: false }),
      makeLine(true, 12, 4, { isAnimating: true, animDelayS: 1.05 }),
      makeLine(false, 18, 4),
    ]).indices,
    [2],
  );

  // Seek directly into an overlapping region with null animDelayS recovers all spanning lines.
  const seekState = new SharpenTimelineState();
  assert.deepEqual(
    seekState.evaluate(13.0, [
      makeLine(false, 5, 4),
      makeLine(true, 10, 6, { isAnimating: true }),
      makeLine(true, 12, 4, { isAnimating: true }),
      makeLine(false, 18, 4),
    ]).indices,
    [1, 2],
  );

  // Simultaneous lines starting at the exact same timestamp sharpen together.
  const duetState = new SharpenTimelineState();
  assert.deepEqual(
    duetState.evaluate(20.5, [
      makeLine(true, 20, 4, { isAnimating: true, animDelayS: -0.65 }),
      makeLine(true, 20, 4, { isAnimating: true, animDelayS: -0.65 }),
    ]).indices,
    [0, 1],
  );
}

{
  // After the last line's full duration ends, `isOutro` triggers cleanly with `index: -1`.
  const state = new SharpenTimelineState();
  assert.equal(
    state.evaluate(11.0, [makeLine(true, 10, 3, { isAnimating: true, animDelayS: -1.15 })]).index,
    0,
  );
  const outro = state.evaluate(13.5, [makeLine(false, 10, 3, { isAnimating: false })]);
  assert.equal(outro.isOutro, true);
  assert.equal(outro.index, -1);
}

{
  // Unsynced lyrics (`durationS === 0` everywhere) mark `noSync` so lines are unblurred.
  const state = new SharpenTimelineState();
  const res = state.evaluate(5, [makeLine(false, 0, 0), makeLine(false, 0, 0)]);
  assert.equal(res.noSync, true);
  assert.equal(res.index, -1);
}

{
  const baseLine: Lyric = {
    startTimeMs: 1000,
    words: "hello",
    durationMs: 2000,
    parts: [],
    romanization: "",
    timedRomanization: [],
  };
  const payloadA: FullscreenLyricsPayload = {
    lyrics: [baseLine],
    noLyrics: false,
    syncType: "richsync",
    language: "en",
    songwriters: ["Writer A"],
    decorations: { translations: new Map(), romanizations: new Map() } as FullscreenLyricsPayload["decorations"],
    title: "Song",
    artist: "Artist",
    providerKey: "p",
    globalLyricOffset: 0,
    lyricOffset: 0,
    richsyncOffsetTrim: 0,
    lineOffsetTrim: 0,
    passiveScrollEnabled: false,
    suppressZeroTimeUntil: 0,
  };
  const payloadB: FullscreenLyricsPayload = {
    ...payloadA,
    language: "ja",
    lyricOffset: 150,
  };
  const payloadC: FullscreenLyricsPayload = {
    ...payloadA,
    lyrics: [{ ...baseLine, words: "changed" }],
  };
  assert.equal(hasSameRenderedLyrics(payloadA, payloadB), true);
  assert.equal(hasSameRenderedLyrics(payloadA, payloadC), false);
}

{
  // Quality boost stays enabled while either PiP or Fullscreen Window requests it, without duplicate events.
  const events: boolean[] = [];
  const boost = createVideoQualityBoostCoordinator((wanted) => events.push(wanted));
  assert.equal(boost.isBoosted, false);

  boost.setSource("fullscreen", true);
  assert.equal(boost.isBoosted, true);
  assert.deepEqual(events, [true]);

  boost.setSource("pip", true);
  boost.setSource("fullscreen", false);
  assert.equal(boost.isBoosted, true);
  assert.deepEqual(events, [true]);

  boost.setSource("pip", false);
  assert.equal(boost.isBoosted, false);
  assert.deepEqual(events, [true, false]);
}

{
  // Song info mirrors `#blyrics-song-info` verbatim in Video mode, Song mode, and with/without album,
  // and fallback ignores trailing player-bar bullet segments (`views` / `title`).
  const videoDom = new JSDOM(`<!doctype html><html><body>
    <ytmusic-player-bar>
      <yt-formatted-string class="title">Bar Title Ignored</yt-formatted-string>
      <yt-formatted-string class="byline">League of Legends • 58 Tr lượt xem</yt-formatted-string>
    </ytmusic-player-bar>
    <div id="blyrics-song-info">
      <p id="blyrics-title">K/DA - FIRESTARTER ft. MIYEON and SOYEON of i-dle (Official Music Video)</p>
      <p id="blyrics-artist"><a class="blyrics-song-link" href="https://music.youtube.com/channel/UC2">League of Legends</a></p>
    </div>
  </body></html>`);
  assert.deepEqual(readMainSongInfo(videoDom.window.document), {
    title: "K/DA - FIRESTARTER ft. MIYEON and SOYEON of i-dle (Official Music Video)",
    artist: "League of Legends",
    album: "",
  });

  const songDom = new JSDOM(`<!doctype html><html><body>
    <ytmusic-player-bar>
      <yt-formatted-string class="title">FIRESTARTER</yt-formatted-string>
      <yt-formatted-string class="byline">K/DA • FIRESTARTER</yt-formatted-string>
    </ytmusic-player-bar>
    <div id="blyrics-song-info">
      <p id="blyrics-title">FIRESTARTER</p>
      <p id="blyrics-artist"><a class="blyrics-song-link" href="c/1">K/DA</a>, <a class="blyrics-song-link" href="c/2">i-dle</a> và <a class="blyrics-song-link" href="c/3">Mimi Webb</a></p>
    </div>
  </body></html>`);
  assert.deepEqual(readMainSongInfo(songDom.window.document), {
    title: "FIRESTARTER",
    artist: "K/DA, i-dle và Mimi Webb",
    album: "",
  });

  const albumDom = new JSDOM(`<!doctype html><html><body>
    <div id="blyrics-song-info">
      <p id="blyrics-title">Song Title</p>
      <p id="blyrics-artist"><a class="blyrics-song-link" href="c/1">Artist A</a><span id="blyrics-album"> · <a class="blyrics-song-link" href="browse/b1">Album X</a></span></p>
    </div>
  </body></html>`);
  assert.deepEqual(readMainSongInfo(albumDom.window.document), {
    title: "Song Title",
    artist: "Artist A",
    album: "Album X",
  });

  const fallbackDom = new JSDOM(`<!doctype html><html><body>
    <ytmusic-player-bar>
      <yt-formatted-string class="title">Raw Video Title</yt-formatted-string>
      <yt-formatted-string class="byline"><a href="channel/UC1">Artist One</a> và <a href="channel/UC2">Artist Two</a> • 58 Tr lượt xem</yt-formatted-string>
    </ytmusic-player-bar>
  </body></html>`);
  const prevAnchor = globalThis.HTMLAnchorElement;
  globalThis.HTMLAnchorElement = fallbackDom.window.HTMLAnchorElement;
  try {
    assert.deepEqual(readMainSongInfo(fallbackDom.window.document), {
      title: "Raw Video Title",
      artist: "Artist One và Artist Two",
      album: "",
    });
  } finally {
    globalThis.HTMLAnchorElement = prevAnchor;
  }

  songDom.window.document.documentElement.style.setProperty("--ytmusic-album-color", "120, 80, 40");
  songDom.window.document.documentElement.style.setProperty("--ytmusic-album-color-dark", "68, 45, 22");
  songDom.window.document.documentElement.style.setProperty("--ytmusic-album-color-ratio", "80%");
  const colors = readMainAlbumColors(songDom.window.document);
  assert.deepEqual(colors, { albumColor: "120, 80, 40", albumColorDark: "68, 45, 22", albumColorRatio: "80%" });

  const baseTrack: FullscreenTrackInfo = {
    videoId: "v1",
    title: "FIRESTARTER",
    artist: "K/DA",
    album: "",
    artworkUrl: "https://example.com/art.jpg",
    animatedArtworkUrl: null,
    ...colors,
  };
  assert.notEqual(buildTrackKey(baseTrack), buildTrackKey({ ...baseTrack, albumColorDark: "10, 20, 30" }));
  assert.notEqual(buildTrackKey(baseTrack), buildTrackKey({ ...baseTrack, album: "Album X" }));
}

{
  assert.equal(isUsableArtworkUrl("https://example.com/art.jpg"), true);
  assert.equal(isUsableArtworkUrl("data:image/gif;base64,R0lGODlhAQABAAAAACw="), false);
  assert.equal(isUsableArtworkUrl(""), false);
  assert.equal(isUsableArtworkUrl(null), false);
}
