import { type ImageHighlightLayers } from "./imageHighlights.js";
import { type WordState } from "./constants.js";
import type { Lyric, LyricPart, LyricSyncType } from "./types.js";
export declare let disableRichsync: import("./themeSettings.js").Setting;
export declare const hideCredits: import("./themeSettings.js").Setting;
export declare function findNearestAgent(lyrics: Lyric[], fromIndex: number): string | undefined;
export declare function isNearestLyricRtl(lyrics: Lyric[], fromIndex: number): boolean;
export declare function deriveSyncType(lyrics: Lyric[]): LyricSyncType;
export interface AnimationData {
    /**
     * Time of this part in seconds
     */
    time: number;
    /**
     * Duration of this part in seconds
     */
    duration: number;
    lyricElement: HTMLElement;
    animations: Animation[];
}
export interface PartData extends AnimationData {
    highlightElement: HTMLElement;
    imageLayers?: ImageHighlightLayers;
    letterElements?: HTMLElement[];
    highlightLetterElements?: HTMLElement[];
    wobbleElements: HTMLElement[];
    glowSuppressed?: boolean;
    wordState: WordState;
}
export type LineData = {
    parts: PartData[];
    isScrolled: boolean;
    isAnimationPlayStatePlaying: boolean;
    accumulatedOffsetMs: number;
    isAnimating: boolean;
    lastAnimSetupAt: number;
    isSelected: boolean;
    height: number;
    position: number;
    decorations: Map<HTMLElement, number>;
} & AnimationData;
export declare function newLineData(lyricElement: HTMLElement, startTimeMs: number, durationMs: number): LineData;
export declare function applyDirection(element: HTMLElement, text: string): void;
export declare function createLyricsLine(doc: Document, parts: LyricPart[], line: LineData, lyricElement: HTMLElement, options?: {
    splitBackgroundLine: boolean;
}): HTMLElement;
export declare function buildLineSyncedParts(item: Lyric): LyricPart[];
export declare function addSeekHandler(seek: (timeS: number) => void, lyricElement: HTMLElement, allZero: boolean): void;
/**
 * Takes the romanization off a line, along with any timed parts it brought. A line a swap kept goes on
 * carrying what was hung on it, so this is how a consumer drops one it no longer wants. Answers
 * whether there was one to take off.
 */
export declare function removeRomanization(lyricElement: HTMLElement, lineData: LineData): boolean;
/**
 * Takes the translation off a line. A line a swap kept goes on carrying what was hung on it, so this is
 * how a consumer drops one it no longer wants. Answers whether there was one to take off.
 */
export declare function removeTranslation(lyricElement: HTMLElement): boolean;
/**
 * Moves the translation and romanization hung on one line onto the line built in its place, with any
 * timed parts they brought, so a line rebuilt for its timing keeps what the consumer hung on it. The
 * parts are let go of whatever the old line was showing; the new line sets them up again with its own.
 */
export declare function moveDecorations(from: LineData, to: LineData): void;
export declare function injectRomanization(doc: Document, lyricElement: HTMLElement, lineData: LineData, text: string, timedRomanization?: LyricPart[] | null): void;
export declare function injectTranslation(doc: Document, lyricElement: HTMLElement, text: string, language?: string | null): void;
