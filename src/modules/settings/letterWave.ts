// -- Letter wave preference --------------------------------------------

export type LetterWavePref = "auto" | "on" | "off";

// Legacy boolean isLetterWaveEnabled migrates: an explicit true becomes "on", an
// intentional opt-in a theme can no longer override; everything else defaults to "off".
export function migrateLetterWavePref(raw: {
  letterWavePref?: unknown;
  isLetterWaveEnabled?: unknown;
}): LetterWavePref {
  const pref = raw.letterWavePref;
  if (pref === "auto" || pref === "on" || pref === "off") return pref;
  return raw.isLetterWaveEnabled === true ? "on" : "off";
}

// Position decides precedence: parseThemeConfig is last-wins. "auto" sits before
// the theme so the theme can override it; "on"/"off" sit after, so the user's
// choice is the last word.
export function withLetterWaveSetting(css: string, pref: LetterWavePref): string {
  switch (pref) {
    case "on":
      return `${css}\n/* blyrics-letter-wave = true; */`;
    case "off":
      return `${css}\n/* blyrics-letter-wave = false; */`;
    default:
      return `/* blyrics-letter-wave = false; */\n${css}`;
  }
}

export function ensureLetterWaveSetting(css: string, fallbackPref: LetterWavePref = "off"): string {
  return css.includes("blyrics-letter-wave") ? css : withLetterWaveSetting(css, fallbackPref);
}
