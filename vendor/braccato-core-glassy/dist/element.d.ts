import type { StageBox } from "./stage.js";
import type { Lyric, LyricsLayout, LyricsRenderer, LyricsRendererHost, LyricSyncType, TickOptions } from "./types.js";
import type { SetLyricsOptions } from "./view.js";
/**
 * What a tick carries beyond the clock. `isPlaying` is not among them: `playing` is the property
 * that says so, and one question with two answers has no rule for choosing between them.
 *
 * @public
 */
export type ElementTickOptions = Omit<TickOptions, "isPlaying">;
/**
 * How the lines are built, beyond the lines themselves. The mount is not among them: the element is
 * the mount.
 *
 * @public
 */
export type ElementLyricsOptions = Partial<SetLyricsOptions>;
/** @public */
export type ElementErrorPhase = "connect" | "conflict" | "layout" | "lyrics" | "source" | "theme";
/** @public */
export interface ElementErrorDetail {
    /** What the element was doing. Nothing thrown by a tick is reported here: see the README. */
    phase: ElementErrorPhase;
    error: Error;
}
/**
 * What the element is doing, and why it is not doing what it was asked. Every `braccato:error` is
 * dispatched a microtask after the fact so that a listener added straight after the element was
 * inserted still hears it; this is the answer for a consumer that added one later than that, or
 * never.
 *
 * @public
 */
export type ElementStatus = "idle" | "rendering" | "theme-conflict" | "unsynced-on-stage" | "no-browsing-context";
/** @public */
export interface LyricsLoadedDetail {
    lineCount: number;
    syncType: LyricSyncType;
}
/** @public */
export interface LineClickDetail {
    /** Where the click asked the player to go, in seconds. */
    timeS: number;
}
/** @public */
export interface StageLayoutDetail {
    /** Around the lines being sung, in the container's coordinates, or null when nothing sung is on stage. */
    box: StageBox | null;
}
/** @public */
export interface ScrollStateDetail {
    /** Whether the user has scrolled away, so autoscroll is waiting rather than following the song. */
    userScrolling: boolean;
}
/**
 * Mounts a lyrics view into itself. The renderer is built when the element is connected and
 * destroyed when it is disconnected, so an element that is moved around the page rebuilds rather
 * than going quiet, and every property may be written before either has happened.
 *
 * `dir` is not among the properties, and that is the point: `HTMLElement` already reflects it, the
 * lines this module builds carry `dir="auto"` and resolve their own direction from their text, and a
 * property here would be a second opinion about a question the platform has already answered.
 */
export declare class BraccatoLyricsElement extends HTMLElement {
    #private;
    static readonly observedAttributes: string[];
    /**
     * The song. An empty array clears the view, so a consumer between songs has a way to say so.
     */
    get lyrics(): Lyric[] | null;
    set lyrics(lyrics: Lyric[] | null);
    /**
     * How the lines are built, beyond the lines themselves: whether a loader is still covering the
     * view, and whether these lyrics are a "not found" placeholder rather than a song. The second one
     * is what keeps passive scrolling off a one line message it would otherwise drift for the length
     * of the song.
     *
     * Read by the next build rather than causing one, so a consumer writes it beside `lyrics` rather
     * than instead of it, and writing both renders once.
     */
    get lyricsOptions(): ElementLyricsOptions;
    set lyricsOptions(options: ElementLyricsOptions);
    /**
     * The media element the lyrics follow, as a CSS selector resolved in this element's own document
     * or as the element itself. Setting it binds and null unbinds, and while it is bound the element
     * reads the clock rather than being told it: `currentTime` and `playing` become what it reports.
     *
     * Bound only while connected, the way the renderer is built only while connected, and a selector
     * is resolved again every time it is written and every time the element connects.
     */
    get source(): HTMLMediaElement | string | null;
    set source(source: HTMLMediaElement | string | null);
    /**
     * The media element `source` resolved to. Null whenever nothing is being followed, which is the
     * answer for a selector that matched nothing and for an element that is not connected.
     */
    get mediaElement(): HTMLMediaElement | null;
    /**
     * Playback position in seconds, not milliseconds: the module ticks in seconds, and converting here
     * would leave the element and the renderer underneath it disagreeing about what a number means.
     * Writing it renders the view again, so whoever owns the clock drives the lyrics by writing this.
     *
     * While a media element is bound it is the one that owns the clock, so a write is dropped and this
     * keeps reporting what the binding last read. Dropped rather than reported: a consumer who left
     * their own frame loop running would otherwise be told about it sixty times a second.
     */
    get currentTime(): number;
    set currentTime(currentTimeS: number);
    /** An output rather than an input while a media element is bound, exactly as `currentTime` is. */
    get playing(): boolean;
    set playing(playing: boolean);
    /**
     * The rest of a tick: the user offsets the clock is matched against, whether passive scrolling is
     * switched on for unsynced lyrics, and the timestamp of the player snapshot the clock came from.
     *
     * That last one matters beyond this element. The playback clock the module compares a tick
     * against is module scope, so an element sharing a realm with another view has to be given the
     * same snapshot timestamps that view is, or every tick reads as a jump away from the other one.
     *
     * Read by the next tick rather than causing one, so a consumer that writes these and the clock on
     * the same frame renders the view once rather than twice.
     */
    get tickOptions(): ElementTickOptions;
    set tickOptions(options: ElementTickOptions);
    /**
     * A compiled stylesheet. Its `blyrics-*` comments configure the module and the sheet itself goes
     * into this element's document. An empty one puts every setting back to its default, and is
     * applied like any other: the settings are module scope, so an element that applied nothing would
     * render against whatever the last theme in that bundle left behind. What that costs is that
     * connecting an element nobody gave a theme empties the theme element already in its document.
     */
    get theme(): string;
    set theme(css: string);
    /**
     * Overrides for anything the renderer asks of its surroundings. Every member has a default, so a
     * consumer with nothing to say leaves this alone. Writing it while connected rebuilds the view:
     * the renderer is handed its host once, when it is created.
     */
    get host(): Partial<LyricsRendererHost>;
    set host(overrides: Partial<LyricsRendererHost>);
    /**
     * `"stage"` shows only the lines being sung, for subtitles over a video, and fills the nearest
     * positioned ancestor. Anything else scrolls. Writing it while connected rebuilds the view: the
     * renderer is handed its layout once, when it is created.
     */
    get layout(): LyricsLayout;
    set layout(layout: LyricsLayout);
    /**
     * The renderer underneath, for a consumer who outgrows the element. Null while disconnected, and a
     * different one after every reconnection.
     */
    get renderer(): LyricsRenderer | null;
    /**
     * What the element is doing, asked rather than listened for. `theme-conflict` is the one that says
     * the view is on the screen but not necessarily the way it was asked for: the theme settings are
     * module scope, so a document with two elements holding different themes renders both against
     * whichever was applied last.
     *
     * A `source` that named nothing to follow is deliberately not one of these. The element is still
     * rendering, and a status saying otherwise would trade one true answer for another. What a
     * consumer who was not listening for the error reads instead is `mediaElement`, which is null
     * while `source` still holds the selector it could not resolve.
     */
    get status(): ElementStatus;
    connectedCallback(): void;
    disconnectedCallback(): void;
    attributeChangedCallback(name: string, _oldValue: string | null, newValue: string | null): void;
}
