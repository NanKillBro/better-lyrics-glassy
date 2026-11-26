export declare const testRtl: (text: string) => boolean;
export declare const testJoiningScript: (text: string) => boolean;
/**
 * Checks if a given string contains any non-Latin characters.
 * @param text The string to check.
 * @returns True if a non-Latin character is found, otherwise false.
 */
export declare function containsNonLatin(text: string): boolean;
declare const SCRIPT_TO_LANG: readonly [readonly [RegExp, "ja"], readonly [RegExp, "ko"], readonly [RegExp, "zh"], readonly [RegExp, "ru"], readonly [RegExp, "hi"], readonly [RegExp, "ar"], readonly [RegExp, "th"], readonly [RegExp, "el"], readonly [RegExp, "he"], readonly [RegExp, "bn"], readonly [RegExp, "ta"], readonly [RegExp, "te"], readonly [RegExp, "ml"], readonly [RegExp, "kn"], readonly [RegExp, "gu"], readonly [RegExp, "pa"], readonly [RegExp, "si"], readonly [RegExp, "my"], readonly [RegExp, "ka"], readonly [RegExp, "km"], readonly [RegExp, "lo"]];
type NonLatinLanguageCode = (typeof SCRIPT_TO_LANG)[number][1];
export declare function detectNonLatinLanguage(text: string): NonLatinLanguageCode | null;
export declare const isSameText: (a: string, b: string) => boolean;
export {};
