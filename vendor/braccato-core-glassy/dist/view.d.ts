import { type AnimationEngineInstance } from "./engine.js";
import { type LineData } from "./inject.js";
import type { Lyric } from "./types.js";
export interface SetLyricsOptions {
    /** BCP 47 language of the original lyrics. Kana/Hangul provide a fallback when omitted. */
    language?: string | null;
    /**
     * Whether the loader is still covering the view. Recorded on the container for CSS to key on.
     */
    loaderVisible: boolean;
    /**
     * These lyrics are a "not found" placeholder rather than a real result.
     */
    noLyrics: boolean;
    /** Who wrote the song, shown after the last line. */
    songwriters?: readonly string[];
    /**
     * Which song these lyrics are for. Lyrics given with the key the view on screen was given are
     * swapped into it, so lines the two share stay as they were; without a key, or with another one,
     * the view is built anew.
     */
    songKey?: string;
}
/**
 * Replaces whatever the mount holds with a container built from these lyrics, and hands the render
 * records, the container and its measured size to the engine that animates them.
 *
 * @param engine - Instance that owns the document to build in and the host to seek through
 * @param mount - Element whose children the built container replaces
 * @param lyrics - Lines to render, left untouched
 * @param options - What the container records for CSS to key on
 */
export declare function setLyrics(engine: AnimationEngineInstance, mount: HTMLElement, lyrics: Lyric[], options: SetLyricsOptions): void;
/**
 * Where each line of a swap was before it, in the container's coordinates, and how tall it was: a
 * kept line's own place, and for a line built in place of one, the place of the line it replaced.
 */
export type SwapPositions = Map<LineData, {
    position: number;
    height: number;
    offset: number;
}>;
/**
 * Swaps these lyrics into the view already on screen, rebuilding only the lines that differ, and
 * answers where each line was before so the caller can carry the view across the change. Answers
 * null without touching anything when the view cannot be swapped, and the caller builds it whole.
 *
 * Nothing about where the reader is goes back to the start of a song: the scroll, a pause the reader
 * scrolled into, and the scrolls the engine is waiting to swallow are all the song's before.
 */
export declare function swapLyrics(engine: AnimationEngineInstance, mount: HTMLElement, lyrics: Lyric[], options: SetLyricsOptions): SwapPositions | null;
