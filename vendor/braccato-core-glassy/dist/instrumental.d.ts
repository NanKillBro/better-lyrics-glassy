export declare const INSTRUMENTAL_WAVE_PATH_HIGH = "M -4 3 Q 1 2 5 3 Q 10 4 14 3 Q 18 2 22 3 Q 26 4 30 3 L 30 4 L -4 4 Z";
export declare const INSTRUMENTAL_WAVE_PATH_LOW = "M -4 3 Q 1 4 5 3 Q 10 2 14 3 Q 18 4 22 3 Q 26 2 30 3 L 30 4 L -4 4 Z";
/**
 * Creates an HTML element representing an instrumental break in the lyrics.
 *
 * @param doc - Document the SVG nodes are created in
 * @param container - Element to place instrumental parts into
 * @param durationMs - Duration of the instrumental break in milliseconds
 * @returns HTMLDivElement representing the instrumental break
 */
export declare function createInstrumentalElement(doc: Document, container: HTMLDivElement, durationMs: number): HTMLDivElement;
