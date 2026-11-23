import type { FullscreenLyricsPayload } from "@modules/ui/fullscreenWindow/messages";

export function hasSameStringArray(
  left: readonly string[] | undefined,
  right: readonly string[] | undefined,
): boolean {
  const a = left ?? [];
  const b = right ?? [];
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Compares rendered lyric line structure and songwriters so metadata-only updates (translations,
 * romanizations, language, decorations) reuse existing DOM lines via `relayout()` instead of tearing
 * down active sweeps and GlassyFlow transforms.
 */
export function hasSameRenderedLyrics(
  previous: FullscreenLyricsPayload | null,
  next: FullscreenLyricsPayload | null,
): boolean {
  if (!previous || !next) return false;
  if (Boolean(previous.noLyrics) !== Boolean(next.noLyrics)) return false;
  if ((previous.syncType ?? "none") !== (next.syncType ?? "none")) return false;
  const a = previous.lyrics ?? [];
  const b = next.lyrics ?? [];
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i].startTimeMs !== b[i].startTimeMs || a[i].words !== b[i].words) return false;
  }
  return hasSameStringArray(previous.songwriters, next.songwriters);
}
