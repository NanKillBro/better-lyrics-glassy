export declare function clamp(value: number, min: number, max: number): number;
export declare function positiveModulo(value: number, divisor: number): number;
/**
 * Whether the page renders with Gecko (Firefox). Detects the engine by a feature only it ships, so
 * spoofed user agents and Firefox forks resolve the same way.
 */
export declare function isGecko(): boolean;
export declare function roundedMs(value: number): number;
/**
 * Converts CSS duration value to milliseconds.
 *
 * @returns Duration in milliseconds
 */
export declare function toMs(cssDuration: string): number;
/**
 * Forces a reflow/repaint of the element by accessing its offsetHeight.
 *
 * @param elt - Element to reflow
 */
export declare function reflow(elt: HTMLElement): void;
/**
 * Returns layout position/dimensions without including transient CSS transforms.
 * This is important for lyric scroll math because line-scale and per-line scroll
 * animations are transform based.
 */
export declare function getRelativeLayoutBounds(parent: HTMLElement, child: HTMLElement): DOMRect;
