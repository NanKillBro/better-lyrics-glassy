import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

const INSTALLED_KEY = Symbol.for("better-lyrics.wasm-dataurl-loader");

if (!globalThis[INSTALLED_KEY]) {
  globalThis[INSTALLED_KEY] = true;
  registerHooks({
    load(url, context, nextLoad) {
      if (url.endsWith(".wasm")) {
        const bytes = readFileSync(fileURLToPath(url));
        const dataUrl = `data:application/wasm;base64,${bytes.toString("base64")}`;
        return {
          format: "module",
          shortCircuit: true,
          source: `export default ${JSON.stringify(dataUrl)};`,
        };
      }
      return nextLoad(url, context);
    },
  });
}
