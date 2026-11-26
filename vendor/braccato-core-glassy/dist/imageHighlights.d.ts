import type { PartData } from "./inject.js";
export declare const imageHighlights: import("./themeSettings.js").Setting;
export interface ImageHighlightLayers {
    glow: HTMLElement;
    glowLetters: HTMLElement[];
    /** A separate inline layout host, only for runs that can fragment. */
    highlight?: HTMLElement;
}
export declare function wrapImageHighlight(highlight: HTMLElement): ImageHighlightLayers | undefined;
/** Keep bidi ordering and inline fragments in the browser's normal text layout. An
 * absolutely positioned copy inside an inline word cannot reproduce those fragments. */
export declare function alignImageGlowRun(run: HTMLElement, parts: PartData[]): void;
/** A single CSS url(), not gradients or an arbitrary list of background layers. */
export declare function imageURL(value: string): string | null;
export declare function refreshInstrumentalImages(container: HTMLElement | null, view: Window): void;
