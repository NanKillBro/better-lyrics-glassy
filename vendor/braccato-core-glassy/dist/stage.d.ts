export type StageItemKind = "line" | "blank" | "instrumental" | "credits";
export type StageRole = "current" | "previous" | "queued" | "gone";
export interface StageItem {
    kind: StageItemKind;
    /** Seconds. */
    start: number;
    /** Seconds. The credits hold the stage until the song ends, so theirs is infinite. */
    end: number;
}
export declare const STAGE_LEAD_S = 0.5;
export declare const STAGE_HANDOFF_S = 0.12;
export declare const STAGE_OVERLAP_S = 0.15;
export declare function overlapsPrevious(items: readonly StageItem[], index: number): boolean;
export declare function stageEnterTimes(items: readonly StageItem[]): number[];
export declare function planStage(items: readonly StageItem[], timeS: number): StageRole[];
export interface StageMetrics {
    height: number;
    left: number;
    width: number;
    /** Where the item scales from horizontally: 0 left, 0.5 centre, 1 right. */
    originX: number;
}
export interface StageGeometry {
    stageHeight: number;
    gap: number;
    activeScale: number;
}
export interface StagePlacement {
    y: number;
    visible: boolean;
}
export interface StageBox {
    x: number;
    y: number;
    width: number;
    height: number;
}
export interface StageSpanRect {
    x: number;
    width: number;
}
/**
 * A wrapped `fit-content` box fills the width offered, so the plate follows the text instead. The rects
 * miss printed `::before` labels, so the span is widened to what the alignment guarantees.
 */
export declare function stageTextSpan(offsetLeft: number, offsetWidth: number, box: StageSpanRect, textRects: Iterable<StageSpanRect>, padding: {
    left: number;
    right: number;
}, originX: number): {
    left: number;
    width: number;
};
/** Where a line waits below the floor, and where it rises from as it enters. */
export declare function queuedStageY(stageHeight: number, height: number, gap: number): number;
export declare function layoutStage(roles: readonly StageRole[], items: readonly StageItem[], metrics: readonly StageMetrics[], previousY: readonly (number | null)[], geometry: StageGeometry): {
    placements: StagePlacement[];
    box: StageBox | null;
};
