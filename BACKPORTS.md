# Upstream Backport Summary

This document details the upstream commits backported from better-lyrics (evaluating 117 upstream commits between 8ec28ef and 57c9dfe4, plus 50 commits between 57c9dfe and 9b3496c) into the old-engine repository (better-lyrics-glassy).

---

## 1. Backported Features & Fixes

All backported commits were selected to enhance stability, performance, accessibility, and network efficiency without touching the old animation engine.

### Tier 1: Direct Ported Commits
1. **Prewarm Auth Token on Startup (PR 686)**
   - Prewarms and renews authentication tokens in the background with deduplication, eliminating request latency on first lyric fetch.
2. **Negative Caching for Missing Lyrics (PR 713)**
   - Caches missing lyric results with `LYRICS_NEGATIVE_CACHE_TTL_MS` to prevent rapid re-fetching loops on instrumentals or unindexed songs.
3. **Fullscreen Side Panel Offset for Videos (PR 741)**
   - Correctly positions the fullscreen side panel offset during music video playback.
4. **Local Font Bundling (PR 749)**
   - Bundles Satoshi and JetBrainsMono fonts locally in the extension bundle, stopping the options popup from blocking on network font fetches.
5. **Restore Queue Up-Next Autoplay Toggle (PR 772)**
   - Fixes the up-next autoplay toggle state disappearing or resetting after switching tabs in the queue.
6. **Localization for Action Buttons (PR 782)**
   - Adds missing localization strings across all supported locales for "Create" and "Edit" buttons.
7. **Fullscreen Player Bar Bottom-Hover Reveal (PR 814)**
   - Reveals the player controls bar when hovering the bottom region in fullscreen mode.
8. **Direct Volume Slider Usability (PR 842)**
   - Allows users to drag and adjust the volume slider directly without needing to click the volume icon first.
9. **Domain Migration to betterlyrics.org (PR 843)**
   - Migrates theme store and Unison API endpoints to official `*.betterlyrics.org` subdomains.
10. **Fixed Track Duration for Player Sync (PR 850)**
    - Uses accurate metadata track length when available in `public/script.js` while keeping the old engine's 20ms sync ticking loop.

### Tier 2: Adapted Backports
11. **State-Driven Dock & Fullscreen Performance (PR 833)**
    - Eliminates expensive CSS ancestor `:has()` selectors by driving dock and fullscreen styling off explicit DOM classes and attributes (`.blyrics-has-dock`, `[blyrics-no-lyrics]`, `[blyrics-video-mode]`, `.blyrics-dock--off-page`).
12. **Native Lyrics Focus Disabling (PR 711)**
    - Prevents invisible YouTube Music native lyrics from intercepting keyboard navigation (`Tab` / screen readers) by setting `inert` and `aria-hidden="true"`.
    - Preserved `animEngineState.doneFirstInstantScroll` in `animationEngine.ts` to ensure no jumpy scrolls occur on lyrics panel opening.
13. **Language Detection Contradiction Override (PR 787)**
    - Ignores inaccurate file metadata `xml:lang` tags when the lyric script directly contradicts them (e.g. non-Latin characters marked as English), ensuring romanization and translation proceed smoothly.
14. **Unison Translation & Romanization Coalescing (PR 818)**
    - Coalesces concurrent translation and romanization requests into a single Unison `/translate` network request with in-flight deduplication and Google Translate fallback.

---

## 2. Excluded Upstream Changes (What Was NOT Backported & Why)

1. **WAAPI Animation Engine Rewrite (87d93c70fb2d and all descendants)**:
   - **Reason**: The new WAAPI (`element.animate()`) engine breaks custom animation timing, introduces layout shifts, and has regressions on desktop Electron. The old engine remains rock solid and performant.
2. **`@braccato/core` & Braccato Renderer Components**:
   - **Reason**: Tightly coupled to the WAAPI engine and conflicting with custom Pear Desktop themes and DOM hooks.
3. **Smooth Progress Bar (17de17f7 and descendants)**:
   - **Reason**: Intentionally removed in favor of Pear Desktop's native progress controls.
4. **Document Picture-in-Picture (PiP) Window**:
   - **Reason**: Pear Desktop provides native OS window management and miniplayer capabilities.
5. **Upstream Telemetry & Survey Prompts**:
   - **Reason**: Excluded to maintain a minimal, privacy-focused experience.

---

## Batch 2

Evaluation range: upstream `57c9dfe..upstream/master` at `9b3496c` (50 commits). 3 commits backported, 47 skipped.

### Backported

1. **Correct Sync Badge for Unison Lyrics (PR 864)** — adapted
   - Adds the `unison-wordsynced` provider tier (syncType `word`, priority 3) so word-synced Unison lyrics carry the correct sync badge in options and in the provider list.
   - Adds `providerList.ts` with `mergePreferredProviders` and its selfcheck; a stored custom `preferredProviderList` now gets missing default providers inserted at their natural position instead of being reset to defaults.
   - Dropped: braccato dependency bumps (README, package files) — not used by this engine. The background-vocals half of the fix lives in the braccato parser packages and is not portable.
2. **Parse Dock Icons Through a Trusted Types Policy (PR 867)** — partial
   - Wraps SVG strings passed to `DOMParser.parseFromString` in a `blyrics-svg` trusted types policy (`icons.ts`, new `trusted-types.d.ts`).
   - Dropped: the manifest/auth hunks that add the `unison.boidu.dev` origin (new-engine Unison endpoint; this engine uses betterlyrics.org per the PR 843 backport).
3. **Clear Side-Panel Background Without Lyrics (PR 899)** — clean
   - Makes `#side-panel` background/shadow transparent in fullscreen no-lyrics mode so the re-centered album art is not flanked by a stray panel box.

### Skipped (47)

- **WAAPI/Braccato-coupled**: PR 901 (songwriter credits, rendering in braccato core), PR 902 (metadata via braccato parsers 0.3.0), PR 860-adjacent CJK regional fonts (CSS is dead code without the new engine's per-line `lang` plumbing).
- **Missing UI infra**: PR 908 (fullscreen-controls overlap — feature absent here), PR 903/PR 904 (gamification avatar ring CSS absent), PR 874 (`layoutWidth`/`playerControls` absent), PR 870 (`blyrics-fs-controls` absent), PR 861 (`options/updateNotice/` absent), PR 873 (touches `layoutWidth`, `updateNotice`, `core/browser.ts` — all absent).
- **PiP (policy)**: PR 888, PR 891.
- **i18n syncs (strings for unbackported features)**: PR 896, PR 877, PR 860.
- **Bots/release/chore/ci/docs/deps**: harmonizer auto-fix/release commits, dependabot bumps, braccato chores, releases, Edge publishing, docs, ci.

---

## Batch 3

Evaluation range: upstream `9b3496c..1b8dd13e` (~130 commits; verified current 2026-09-28). 3 items backported, the rest skipped.

### Backported

1. **Render Extension Pages in Standards Mode (`af2c4c05`)** — clean
   - Adds `<!DOCTYPE html>` to `pages/marketplace.html`, `pages/unison.html`, and `pages/standalone-editor.html` (the editor also gets `height: 100%` on `<html>`), plus `display: block` on `.store-card-cover` in `src/options/store/store.css`.
2. **Expire Unison No-Lyrics Cache Entries Sooner (`ed9c0155`)** — adapted
   - Adds `UNISON_NEGATIVE_CACHE_TTL_MS = 5 * 60 * 1000` and uses it in `saveLyricsToCache` for `unison*` providers, keeping the glassy negative-cache log line. No upstream PR number (unison-revisions branch); reference hash only.
   - Adds `src/core/constants.selfcheck.ts`; adapted with a chrome manifest stub + dynamic import because this engine's `constants.ts` reads `chrome.runtime` at module scope.
3. **Judge Translation and Romanization Language Per Line (PR 868: `63632ad6`, `678e3bc3`, `6ee1328b`, `07fb2ea0`, `a4b83e2f`, `1dc4d77c`)** — adapted, squashed into one commit
   - `translation.ts`: `resolveRomanizationLanguage` / `chooseRomanizationSeparator` helpers, collision-free `0000`-based romanization separator with strict split-length check (replaces the semicolon/newline fallback), Latin-only lines skipped in romanization, script-grouped translation chunks with per-line `originalLanguage` detection, `unisonLatinFallback` cache map for Latin lines resolved after the Google pass.
   - `injectLyrics.ts`: cached translations gated per line by `originalLanguage`, batch-level source-language early return removed in favor of per-line exclusion on `result.originalLanguage`.
   - Uses this repo's vendored `containsNonLatin` / `detectNonLatinLanguage` (`lyricParseUtils.ts`), `languageMatchesAny` (`@utils`), `ROMANIZATION_LANGUAGES` (`@constants`), and `log` instead of `@braccato/core/text` + `logCore`. Dropped upstream's `recordLyricDecoration` calls and the `translationLanguage` plumbing (absent in this engine's `injectTranslation`).

### Skipped (~127)

- **Unison revisions/editor/multi-video-linking series (~90 commits)**: new UI infra (`revisions.ts`, `devFixtures.ts`, editor views, video-link API) absent in this repo.
- **PR 912 (`41d2fd6c`, `b92abb61`)**: `renderSuggestedVideoList` / other-versions toggle absent in old `unisonPage.ts`.
- **`2fe886ed` share relative time formatting**: refactor feeding the unison feature; this repo has its own `formatTimeAgo` in `store.ts`.
- **i18n syncs (PR 909 + ~25 `chore(i18n)`)**: strings for unbackported features.
- **Deps/bots/release/CI**: `66cda1d4`, `7d27af41`, `87e37ecb`, `a071d7a2`, `285ab03e` (release 3.0.0.2), `1b8dd13e` (auto-fix), `ad441650` (CI), merge commits.
