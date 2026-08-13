import { ANIMATING_CLASS } from "@braccato/core/constants";
import { AppState } from "@core/appState";
import { mainView } from "@modules/ui/mainLyricsView";

/**
 * GlassyFlow Bridge Module
 *
 * Re-implements custom theme CSS animation delay variables (--blyrics-swipe-delay and --blyrics-anim-delay)
 * by observing class changes on rendered lyric elements.
 *
 * This provides themes (e.g. GlassyFlow, mergetheme, Big Blurry Slow Lyrics for TV) with exact time delays
 * until lyric playback, allowing CSS transitions to calculate precise animation start delays.
 */

let isMonkeyPatched = false;

function getCSSDurationInMs(element: HTMLElement, property: string): number {
  const val = getComputedStyle(element).getPropertyValue(property).trim();
  if (!val) return 0;
  if (val.endsWith("ms")) return parseFloat(val) || 0;
  if (val.endsWith("s")) return (parseFloat(val) || 0) * 1000;
  return parseFloat(val) || 0;
}

export function initGlassyFlowBridge(): void {
  if (isMonkeyPatched) return;
  isMonkeyPatched = true;

  const originalTick = mainView.tick;
  
  mainView.tick = function (currentTimeS, options) {
    if (mainView.container && mainView.lines.length > 0) {
      // 1. Calculate actualTime exactly like Braccato does
      let actualTime = currentTimeS;
      if (mainView.syncType === "richsync") {
        actualTime -= options.richsyncOffsetTrim ?? 0;
        actualTime += getCSSDurationInMs(mainView.container, "--blyrics-richsync-timing-offset") / 1000;
      } else {
        actualTime -= options.lineOffsetTrim ?? 0;
        actualTime += getCSSDurationInMs(mainView.container, "--blyrics-timing-offset") / 1000;
      }
      actualTime -= (options.globalLyricOffset ?? 0) + (options.lyricOffset ?? 0);

      // 2. Pre-set CSS variables for lines before Braccato adds the animating class.
      // Braccato sets ANIMATING_CLASS when `actualTime + 2 >= line.time`.
      // We look ahead 4 seconds to ensure variables are present BEFORE the class is added.
      for (const line of mainView.lines) {
        if (!line.lyricElement.classList.contains(ANIMATING_CLASS)) {
          if (line.time - actualTime < 4 && line.time - actualTime > -2) {
            const children = [line, ...line.parts];
            for (const part of children) {
              const timeDelta = actualTime - part.time;
              part.lyricElement.style.setProperty("--blyrics-swipe-delay", `${-timeDelta - part.duration * 0.1}s`);
              part.lyricElement.style.setProperty("--blyrics-anim-delay", `${-timeDelta}s`);
            }
          }
        }
      }
    }

    // 3. Run original tick. The browser will batch style changes and use the pre-set variables.
    return originalTick.call(this, currentTimeS, options);
  };
}
