export { resetPlaybackClock, resumeAllAutoscroll } from "./engine.js";
export { injectRomanization, injectTranslation, type LineData, removeRomanization, removeTranslation, } from "./inject.js";
export { createLyricsRenderer } from "./renderer.js";
export type { Lyric, LyricsRenderer, LyricsRendererHost, TickOptions } from "./types.js";
/** @public */
export type { AnimationTickStatus } from "./engine.js";
/** @public */
export type { PartData } from "./inject.js";
/** @public */
export type { LyricPart, LyricsRendererDebugSink, LyricsRendererOptions, LyricSyncType } from "./types.js";
/** @public */
export type { SetLyricsOptions } from "./view.js";
/** @public */
export type { LyricsLayout } from "./types.js";
/** @public */
export type { StageBox } from "./stage.js";
