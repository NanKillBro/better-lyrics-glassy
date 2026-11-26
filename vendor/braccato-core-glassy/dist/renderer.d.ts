import type { LyricsRenderer, LyricsRendererHost, LyricsRendererOptions } from "./types.js";
/**
 * Fills in every host member the consumer left out, so the host is an extension point rather than a
 * cost of entry. The mount is read at call time rather than captured: `setLyrics` may be given a
 * different one, and both defaults that use it have to follow.
 *
 * Each member is resolved on its own rather than spread over the defaults. A host assembled from
 * optional pieces carries members that are present and undefined, which typecheck, and spreading
 * one of those leaves the renderer holding nothing where it expects a function.
 *
 * The invalidator comes back alongside the host because the memo behind the default scroll element
 * has no way to notice it went stale on its own.
 *
 * Exported for `renderer.selfcheck.ts` and not published from `index.ts`. A consumer reaches these
 * defaults by leaving host members out, so nothing outside needs to name them; what does need to is
 * the check that every one of them is still here and still answering.
 */
export declare function withHostDefaults(overrides: Partial<LyricsRendererHost> | undefined, rendererWindow: Window & typeof globalThis, currentMount: () => HTMLElement | null): {
    host: LyricsRendererHost;
    forgetScrollElement: () => void;
};
/**
 * Builds a lyrics view and keeps it measured. Line positions are read once, when the lines are
 * built, and everything the engine scrolls by comes from that reading, so a layout that settles
 * afterwards leaves the whole song scrolling to stale targets. Three things settle afterwards: the
 * container's own size, the document's font faces, and the window. This owns all three, because
 * both of the views in this extension went into production having missed at least one of them.
 */
export declare function createLyricsRenderer(rendererOptions: LyricsRendererOptions): LyricsRenderer;
