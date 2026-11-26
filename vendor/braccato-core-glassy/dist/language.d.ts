interface LyricText {
    words: string;
    isInstrumental?: boolean;
}
export declare function normalizeLanguage(language?: string | null): string;
export declare function resolveLyricLanguages(lyrics: readonly LyricText[], sourceLanguage?: string | null): string[];
/** Tags only lyric content, leaving the host UI and source footer in their own language. */
export declare function applyLyricLanguage(element: HTMLElement, language?: string | null): void;
export {};
