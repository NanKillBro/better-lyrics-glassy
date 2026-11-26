/** @public */
export declare class Setting {
    readonly type: "number" | "boolean" | "string";
    value: number | boolean | string;
    readonly defaultValue: number | boolean | string;
    readonly requiresLyricReload: boolean;
    private manuallySet;
    constructor(type: "number" | "boolean" | "string", value: number | boolean | string, defaultValue: number | boolean | string, requiresLyricReload: boolean);
    getNumberValue(): number;
    getBooleanValue(): boolean;
    getStringValue(): string;
    isManuallySet(): boolean;
    setManuallySet(manuallySet: boolean): void;
}
/**
 * The `blyrics-*` configuration a compiled stylesheet declares, in declaration order, last one
 * winning. Lives here rather than beside the renderer because it depends on nothing and its only
 * consumer is `setThemeSettings`: a consumer that compiles a theme somewhere the renderer does not
 * run can read the settings out of it without pulling the engine in.
 */
export declare function parseThemeConfig(css: string): Map<string, string>;
export declare function registerThemeSetting(key: string, defaultValue: number | boolean | string, requiresLyricReload?: boolean): Setting;
export declare function setThemeSettings(map: Map<string, string>): boolean;
/**
 * The values of every setting that changes how lines are built, as one comparable string. Two builds
 * that answer the same here built their lines the same way, so a line built under one can stand in
 * for the same line built under the other.
 */
export declare function lyricBuildSettingsKey(): string;
