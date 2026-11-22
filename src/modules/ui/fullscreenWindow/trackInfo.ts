import type { FullscreenTrackInfo } from "@modules/ui/fullscreenWindow/messages";
import { getBylineLinks } from "@modules/ui/playerControls/playerBarControls";

export interface SongInfoText {
  readonly title: string;
  readonly artist: string;
  readonly album: string;
}

export interface AlbumColors {
  readonly albumColor: string;
  readonly albumColorDark: string;
  readonly albumColorRatio: string;
}

function readBylineArtistFallback(doc: Document): string {
  const { artistRuns } = getBylineLinks(doc);
  if (artistRuns.length > 0) {
    return artistRuns.map(run => run.text).join("").trim();
  }
  const bylineText =
    doc.querySelector<HTMLElement>("ytmusic-player-bar yt-formatted-string.byline, ytmusic-player-bar .byline")
      ?.textContent ?? "";
  return bylineText.split(/\s*[·•]\s*/, 1)[0]?.trim() ?? "";
}

/**
 * Mirrors `#blyrics-song-info` verbatim from the main window rather than reading `AppState.lyricData`
 * (which Better Lyrics's metadata provider normalizes for lyric lookup) or splitting the player bar
 * byline (whose trailing `• ...` segment is views or track name rather than album).
 */
export function readMainSongInfo(doc: Document): SongInfoText {
  const titleEl = doc.querySelector<HTMLElement>("#blyrics-song-info #blyrics-title");
  const artistEl = doc.querySelector<HTMLElement>("#blyrics-song-info #blyrics-artist");
  const barTitleEl = doc.querySelector<HTMLElement>(
    "ytmusic-player-bar yt-formatted-string.title, ytmusic-player-bar .title"
  );
  const title = titleEl?.textContent?.trim() || barTitleEl?.textContent?.trim() || "";

  if (artistEl) {
    const albumEl = artistEl.querySelector<HTMLElement>("#blyrics-album");
    const album = albumEl?.textContent?.replace(/^\s*[·•]\s*/, "").trim() ?? "";
    let artist = "";
    for (const child of artistEl.childNodes) {
      if (child === albumEl) continue;
      artist += child.textContent ?? "";
    }
    artist = artist.trim();
    if (!artist) artist = readBylineArtistFallback(doc);
    return { title, artist, album };
  }

  return {
    title,
    artist: readBylineArtistFallback(doc),
    album: "",
  };
}

export function readMainAlbumColors(doc: Document): AlbumColors {
  const style = doc.documentElement?.style;
  if (!style) {
    return { albumColor: "", albumColorDark: "", albumColorRatio: "" };
  }
  return {
    albumColor: style.getPropertyValue("--ytmusic-album-color").trim(),
    albumColorDark: style.getPropertyValue("--ytmusic-album-color-dark").trim(),
    albumColorRatio: style.getPropertyValue("--ytmusic-album-color-ratio").trim(),
  };
}

export function buildTrackKey(track: FullscreenTrackInfo): string {
  return [
    track.videoId ?? "",
    track.title,
    track.artist,
    track.album,
    track.artworkUrl ?? "",
    track.animatedArtworkUrl ?? "",
    track.albumColor ?? "",
    track.albumColorDark ?? "",
    track.albumColorRatio ?? "",
  ].join("\0");
}
