import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const legacyLyricsCssPath = require.resolve("@braccato/core-legacy/styles/lyrics.css");
const LEGACY_CSS_START = "@property --lyric-transition-amount-start {";
const LEGACY_CSS_END = "/* text-decoration skips inline-block letters";
const LEGACY_OUTPUT_PATH = "css/blyrics/lyrics-legacy.css";

function extractLegacyRendererStyles() {
  const css = readFileSync(legacyLyricsCssPath, "utf8");
  const start = css.indexOf(LEGACY_CSS_START);
  const end = start === -1 ? -1 : css.indexOf(LEGACY_CSS_END, start);
  if (start === -1 || end === -1) {
    throw new Error(
      "[BetterLyrics] Failed to extract legacy word-highlight CSS slice from @braccato/core-legacy/styles/lyrics.css"
    );
  }
  return Buffer.from(css.slice(start, end), "utf8");
}

export const emitLegacyRendererCss = {
  apply(compiler) {
    compiler.hooks.thisCompilation.tap("EmitLegacyRendererCss", compilation => {
      compilation.fileDependencies.add(legacyLyricsCssPath);
    });

    compiler.hooks.emit.tap("EmitLegacyRendererCss", compilation => {
      const contents = extractLegacyRendererStyles();
      compilation.emitAsset(LEGACY_OUTPUT_PATH, {
        source: () => contents,
        size: () => contents.length,
      });
    });
  },
};
