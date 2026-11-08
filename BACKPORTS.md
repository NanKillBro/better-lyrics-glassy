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

---

## Batch 4

Evaluation range: upstream `1b8dd13e..8c2f405d` (807 commits, merged as v3.0.0 into `dev` at `1224a0a6`), plus the two dev-only Electron fixes `92989194` and `1224a0a6`. Batch 3 ended at `1b8dd13e`, so there is no overlap.

### Backported

1. **Log and Treat Failed YT Lyrics Fetches as Missing (`83062ff8`, `5b73e67a`)** — adapted
   - Wraps the `yt-lyrics` promise in a `.catch` that logs and resolves `null`, so the provider loop's existing `ytLyrics !== null` guard skips the match check instead of rejecting the whole fetch.
   - Kept this engine's `log(LOG_PREFIX, ...)` / `processLyrics(lyrics, true, signal)` / `lyricsTimer` lines; dropped `document` and `retainParsedLyrics` (absent here).
2. **Skip YT Match Check and YT Wait for Unison Hits (`c74f5e03`, `cc182ae6`)** — clean
   - `videoId`-sourced hits no longer run the string-similarity check against YT lyrics.
3. **Wrap No-Lyrics Actions in Narrow Panels (`02008338`)** — clean
   - One `flex-wrap: wrap` line on `.blyrics-no-lyrics-button-container`.
4. **Skip the Player-Bar Frost at the Default Background Blur (PR-1013: `8c2f405d`)** — clean
   - Adds the `@container style(--blyrics-background-blur: 100px)` query to `public/css/ytmusic/general.css` and documents it in `STYLING-SKILL.md`.
   - Kept this engine's existing `#layout[player-ui-state="PLAYER_PAGE_OPEN"]` / `[blyrics-stylized]` selectors; the container query only targets the player-page bar background, so a theme that changes the blur keeps the frost.
5. **Remove 1px Video Edge and Hide Fullscreen Media Buttons (PR-995: `930149fa`)** — adapted
   - `fullscreen.css`: transparent `.html5-video-player`, `object-fit: cover` + black background on `video.html5-main-video` in video mode, and hiding the fullscreen media buttons via `#song-media-window > * { visibility: hidden }` (the window itself stays `visible`; hiding it removed YTM's fullscreen tap catcher, so one tap hit `<video>` and ran both YTM's pause and the player's delayed play). Selectors rewritten as `:not([blyrics-dfs])` (no `[blyrics-karaoke]` in this engine); the existing DFS `object-fit: cover` on `#song-image`/`#thumbnail img` is untouched.
   - `public/script.js`: aspect-ratio writes are deduped by comparing the current inline custom property before `setProperty`/`removeProperty`. The upstream explicit calls on resize/tick were not added because this engine already refreshes the variable from its `ResizeObserver`, the video `resize` listener, and the video-change branch of the tick.
   - Local `TICK_MS` / `cachedDuration` / `cachedAudioTrackData` / `PAUSED_TICK_LIMIT` perf patch preserved.
6. **Reveal the Fullscreen Player Bar When No Lyrics Are Found (`2b523125`)** — adapted
   - `dom.ts`: `setupFullscreenPlayerBarReveal()` attaches the dock-proximity listener once; `evaluateDockProximity()` now calls `setPlayerBarShown(barNear)` when the dock is absent. Setup moved out of `mountDock()` and teardown removed from `unmountDock()`, so the bottom-hover reveal still works without lyrics/dock.
   - Dropped the disposable cleanup closure: this engine's `index.ts` has no dispose path, so the function returns `void` and is called once from `modify()`. The now-unreachable `disconnectLayoutAttrObserver()` / `removeDockProximityListener()` helpers were deleted.
7. **Follow the Actual Video-Mode Attribute (`f9b398fa`)** — adapted
   - `observer.ts`: `setUpAvButtonListener()` → `setUpVideoModeListener()`, observing `#player-page[video-mode]` instead of `#av-id > ytmusic-av-toggle[is-video-playback-mode-selected]`, so album videos that leave the A/V preference off still render in video mode. Dropped the `syncKaraoke()` call (no karaoke module).
8. **Request Artwork at Display Resolution with a 1440px Floor (`c38b11af`, `dff2c3d4`, `0f4aae2b`)** — adapted, squashed into one commit
   - `ARTWORK_MIN_SIZE_PX = 1440` in `constants.ts`; `getContainerSize()` now returns `Math.max(width * devicePixelRatio, ARTWORK_MIN_SIZE_PX)` instead of the flat 544 floor. Upstream's `containerSizeFor()` helper does not exist here; the change is inlined in `getContainerSize()`.
9. **Keep Traditional/Simplified Chinese Translations Apart (`e8fe8404`, `f4e21180`)** — adapted
   - `utils.ts`: `findBestLanguageMatch()` compares exact tags first, then `Intl.Locale().maximize()` script, with a memo cache. `injectLyrics.ts`: the two translation match sites use it (`item.translations` keys and `item.translation.lang`); the script-vs-source check at `injectLyrics.ts:678` is left on `langCodesMatch`.
   - Adds `src/core/utils.selfcheck.ts` with a `chrome.runtime` manifest stub + dynamic import (this engine's `constants.ts`/`storage.ts` module graph reads `chrome` at import time).
10. **Guard Unsupported `chrome.windows` in the Auth Background (`92989194`)** — adapted (dev-only)
    - `backgroundAuth.ts`: `closeAuthWindow()` uses optional chaining and replaces the three `chrome.windows.remove` sites; `openConsentPopup()` bails with a `console.warn(LOG_PREFIX_AUTH, ...)` when `chrome.windows.create` is absent; `chrome.windows.onRemoved` is optional-chained. `popupShell.ts` from the upstream commit does not exist here.
11. **Create the Theme-Update Alarm on Background Start (`1224a0a6`)** — clean (dev-only)
    - `src/options/background.ts`: `setupThemeUpdateAlarm()` runs at module bottom before `initBackgroundAuth()`, because Electron does not emit `onInstalled`/`onStartup`.

### Skipped (deferred — portable only by reimplementation)

- **Cache clearing with no music tab (`7d6de67b`, `928f6b81`, `d7b1821f`)**: this engine's `clearTransientLyrics()` uses `chrome.tabs.query`/`sendMessage` and returns early with `updateCacheInfo(null)`; needs a rewrite around `clearCache()`.
- **Unison preview debounce (`92d1f8fc`)**: this engine has no `LYRICS_FILE_READING_EVENT`; reimplement later.
- **Identity write serialization (`0c8b7e77`)**: this engine caches a plain `KeyIdentity` object, not a promise; no import-count/commit queue to hook.
- **Editor load/save ordering (`72aa9060`, `249989f3`)**: editor core is class-based here; the `codeEditor.ts` split is absent.
- **Provider pin per song (`eda1abfd`, `7b718398`, `aeb4c4e3`, `fcca3e3e`)**: needs a new `providerPin` module and storage contract.
- **Stylized-Latin script fixes (`e678aca2`, `4278eee7`, `4e928078`)**: depend on the new `nonLatinScript` module.
- **Chinese-script matching in the Unison picker/captions (`334a1b02`)**: depends on `options/unison/languages.ts`.

### Skipped (not portable)

- **WAAPI/Braccato engine**: `87d93c70fb2d5a3cc29ded8c629d0130cf2afeac` and descendants, `dc4f5305`, `42170935`, `83835c14`.
- **Karaoke**: all `karaoke` commits (`91ae98f1`, `5bae810d`, `5c23fdc9`, `9fca4b03`, …).
- **Picture-in-Picture**: `08cd1af3`, `1c5fd5b0`, `56f3ab20`, `b55bb805`, `692ce365`, …
- **Video quality**: `59636b0d`, `b3698132`, `50a8db11`, `133d7703`, …
- **3.0 options/popup redesign**: `039312a3` onward (design tokens, shared primitives, custom dropdowns, popup shell, update notice, About page).
- **Unison revisions/editor/multi-language series**: `869a6b92`, `33ed4002`, `06178693`, `8892a78d`, revision diff UI, language-name module.
- **Storage stats UI**: `087d6381`, `3d5fb1d3`, `509b94e4`, `02ea2ee2`, `315f8b6c`, `c662f743`, `7209aaeb`, `66414fc0` (this engine already listens to `local`/`cacheInfo`).
- **HDR theme (`5cef0a5f`)**.
- **`951d3e26`**: depends on `summarizeLyricCache`/`getStorageBreakdown`, absent here.
- **`98b32986`**: `clearCache()` already removes only `blyrics_` keys and honours `PROTECTED_STORAGE_KEYS`.
- **`75a31336`, `a94166be`**: no identity-backup/import internals here.
- **`84851825`**: this engine's locale layout has `pt`, not `pt_BR`/`pt_PT`.
- **`6c0bfd04`, `a2b249e9`**: depend on `core/extensionStylesheet.ts` and the PiP browser controller, both absent.
- **`464b6631`**: this engine's footer hover uses `transform: none`, not the upstream scale rule, so the alignment fix does not apply.
- **i18n syncs, dependency bumps, releases, CI, docs, auto-fix/bot commits**.

### Batch 4 verification

- `npm run typecheck` — passed (2026-10-19).
- `npx tsx src/core/constants.selfcheck.ts`, `providerList.selfcheck.ts`, `themeBuildResolver.selfcheck.ts`, `utils.selfcheck.ts` — all passed.
- `npm run build:ci` — Vite build succeeded with no errors/warnings; the trailing sourcemap-upload step fails without `SOURCEMAPS_API_KEY` (environment-only, unrelated).
- Electron 42.5.0 / Chromium 148.0.7778.271 (`xvfb-run`, `session.extensions.loadExtension`):
  - MV3 service worker registers and runs (the `chrome.windows` guards hold; `typeof chrome.windows === "undefined"`).
  - `theme-update-check` alarm is present, so the background-start `setupThemeUpdateAlarm()` works without `onInstalled`/`onStartup`.
  - `options_ui/page.html` and `pages/unison.html` load with no console errors; ISRC autofill produced `USABC1234567` from a TTML `<ttm:meta key="isrc">`.
  - `@container style(--blyrics-background-blur: 100px)` and `Intl.Locale#maximize()` work.
  - Live `music.youtube.com/watch` page: `#player-page` carries `video-mode`, the extension set `blyrics-video-mode`, and `#song-media-window` does not contain `video.html5-main-video` (so the fullscreen `visibility: hidden` rule cannot hide the video).
- Manual QA matrix still pending: YT fetch failure, Unison hit, narrow-panel wrap, frost skip, video edge in fullscreen, no-lyrics fullscreen bar, high-DPI artwork, zh-TW/zh-CN translations.

---

## Batch 5

Evaluation range: upstream `8c2f405d..c6e12997` (41 commits on `upstream/master`, up to 2026-11-06), evaluated from `extensions-src/better-lyrics-glassy-dev` at `b290efbd`. 9 upstream items backported as 7 commits; 32 skipped. Branch `backport/batch-5` based on `master` @ `8a655642`.

### Backported

1. **Read BiniLyrics Timing from the TTML (PR 1044: `8b52c070`)** — adapted
   - Drops the `results.timingType` reassignment so the TTML content alone decides whether the result fills `binimum-richsynced` or `binimum-synced`; this engine's `fillTtml` already sets `isWordSynced` from the parsed lines. Source link points at `binimum.org`.
2. **Keep Click-to-Pause in Fullscreen (PR 1036: `10cc8638`)** — adapted
   - `fullscreen.css`: hides only `#song-media-window .top-row-buttons` instead of the Batch 4 adaptation's `#song-media-window > *`; the window and its tap catcher stay visible, so one tap does not pause and immediately resume. Replaces the earlier broad child-hiding rule.
3. **Size the Player-Bar Video Correctly in Mobile Mode (PR 1023: `272d7c16`)** — clean
   - Adds `:not([is-mweb-modernization-enabled])` to the video-mode aspect-ratio selectors and the height-cap rule.
4. **Pause the Engine When the Tab Panel Is Hidden (PR 1039: `028724fa`)** — adapted
   - `animationEngine.ts`: resolves the tab renderer once, then requires `checkVisibility({ visibilityProperty: true })` before the synced tick and in the passive-scroll loop. The tab-renderer lookup moved above the visibility guard to reuse it.
5. **Let Touch Scroll the Sources List (PR 1028: `68d18f61`)** — adapted
   - Adds a 200ms touch-only Sortable delay to the provider list and dock-control picker. Dropped the mobile page-fit hunks: this options page is a fixed 600px desktop layout (`options.css` `html { width: 600px }`), so the `100dvh`/viewport changes do not apply.
6. **Keep Submit Autodetect in Sync and Prefill from Pasted TTML (PR 1025 `5cc81fb1`, PR 1026 `18be3208`, PR 1029 `9e29c56c`)** — adapted, squashed into one commit
   - New `src/options/unison/detectedField.ts` tracks whether a value is user-owned or still follows detection; language, format, ISRC, song, artist, album, video ID and duration update with the lyrics without overwriting a user edit (clearing a field hands it back to detection).
   - New `src/options/unison/ttmlMetadata.ts` reads `ttm:title`, Composer/AMLL `meta` (`artists`, `album`, `isrc`, `ytVideoId`, `musicName`) and the body `dur`; adapted to this engine's `console.warn(LOG_PREFIX_UNISON, ...)` logger.
   - `unisonPage.ts` replaces the always-first-wins `autoDetect*` functions with `runLyricsChecks()`, marks URL-prefilled metadata as user-owned, and accepts clock-form durations (`3:12.345` → 192) in `parseDurationInput`.
   - Added `detectedField.selfcheck.ts` and `ttmlMetadata.selfcheck.ts` (the latter stubs `chrome.runtime.getManifest` for this engine's `@constants` module-scope read).
7. **Add the Spicy Lyrics Provider (PR 1022: `f77dcc2d`)** — adapted, provider core only
   - `unified.ts`: handles `provider === "spicy"`, fills `spicy-richsynced`/`spicy-synced` through `fillTtml` with `SPICY_LYRICS_URL`; attribution/contributor credits and the karaoke/PiP credit UI are left out.
   - Adds both keys to `PROVIDER_CONFIGS` (richsynced priority 2, synced priority 9), `sourceKeyToFillFn`, `MANAGED_KEYS`, both options defaults and `options_provider_spicylyrics` (en).
   - Also cherry-picks the small `event === "done"` slice of `b5772f5e`: marks every managed key filled and resolves its waiters when the stream reports all providers done. In the sequential loop this caps the cost of a provider that has no result (including Spicy on a song without Spicy lyrics); it does not change provider ordering or rendering.
   - Verification: old `fillTtml` parsed a real 25 KB Better Lyrics TTML sample with the `spicy-*` keys into 36 word-synced lines (language `en`). Live `spicy` stream events still need a real YT Music session.

### Skipped (32)

- **Progressive provider pipeline (`b5772f5e`, PR 1043)**: not compatible with this engine as a cherry-pick. It needs `mainView` plus `processLyrics(doc, ..., replacing)`, `createLyricsWrapper(keepContents)` and `cleanup(keepView)` for in-place upgrades, none of which exist here (`injectLyrics.ts:171` rewrites the DOM directly). It expects the Unison provider to stream shared/personal stages and keep one `blyrics_<id>_unison` entry for four keys, while `unison.ts:111` is a single fetch that fills all four. It also uses `providerPin.ts` (`resolvePin`/`keepsPin`), where this engine still has `AppState.manualProviderKey` + `availableProviderKeys` (`lyrics.ts:352`). The pure `selection.ts` is portable, but without the renderer and Unison rewrites a port would rebuild the view (flicker, scroll/animation reset) and fire duplicate Unison lookups. Batch 5 changes do not conflict; the commit stays out.
- **Auth partner origins (`9aca76ab` PR 1046, `f81109dc` PR 1049)**: adds OpenLyryc/composer to `externally_connectable`, CSP and auth-partner metadata; this engine has no `partners.ts` (it uses `approvedOrigins.ts`) and expanding third-party auth trust was left out.
- **Unison cache count by sync type (`cbee8b0e`, PR 1051)**: depends on `summarizeLyricCache`/storage breakdown UI absent here.
- **Identity download from the background page (`5a2b2d12`, PR 1040)**: this engine exports identity with an anchor and has no `identityBackup` module.
- **Downloads permission inside the export click (`ebac53b6`, PR 1017)**: same anchor-based export, no `chrome.downloads` path.
- **Gamification profile links (`2140d89a`, PR 1035)**: no `gamificationRender` in this engine.
- **Always-on fullscreen controls (`eab223c3`, PR 1021)**: the `#blyrics-fs-controls` strip and tri-state display switches are absent here.
- **Offer detected metadata back in the form (`0ef9bc0f`, PR 1031)**: the hint bar needs new locale strings and CSS; `detectedField.ts` already carries the `offer`/`use` API if the UI is added later.
- **Deps/i18n/release/auto-fix/docs**: braccato and npm bumps, Crowdin syncs, release/canary commits, Biome/Knip auto-fixes, README/funding/docs changes.

### Batch 5 verification (2026-11-08)

- `npm run typecheck` — passed.
- `npx tsx` selfchecks — `constants`, `providerList`, `themeBuildResolver`, `utils`, `detectedField`, `ttmlMetadata` all passed.
- `npm run build:ci` — Vite build succeeded with no errors/warnings; the trailing sourcemap upload fails without `SOURCEMAPS_API_KEY` (environment-only).
- Electron 42.5.0 options smoke on a fresh profile: progressive checkbox present and unchecked, `yt-captions` unchecked/disabled, exactly one `d_yt-captions` entry after saving, toggle persists `isProgressiveLyricsEnabled: true`, 0 console errors. Dev engine smoke: 18 provider rows, one disabled `yt-captions` row, one Spicy row, 0 console errors.
- Spicy provider parser check: `fillTtml` parsed the real `api.betterlyrics.org` TTML sample into 36 word-synced lines under the `spicy-*` keys; live stream-event QA pending.
- Electron 42.5.0 / Chromium 148 (`xvfb-run`, `session.extensions.loadExtension(dist/chrome)`):
  - `options_ui/page.html` and `pages/unison.html?submit=true` load with 0 console errors; the options controls (including the provider list and blur toggles) are present.
  - Pasting a TTML with `ttm:title`, Composer `artists`/`album`/`isrc`/`ytVideoId`, `xml:lang="en"` and `body dur="3:12.345"` fills song, artist (`Artist One, Artist Two`), album, isrc (`USUM71900001`), videoId, duration (`192`), format (`ttml`) and language (`en`).
  - Typing a user song value then editing the lyrics keeps the user value, confirming the user-owned guard.
- Manual QA still pending: BiniLyrics timing from TTML, fullscreen click-to-pause, mobile-mode video sizing, tab-hidden tick pause.

### Local changes after Batch 5 (not upstream)

1. **Disable YouTube Captions by default (`77b0a05d`)** — both engines (`better-lyrics-glassy`, `better-lyrics-glassy-dev` `eb5780eb`)
   - Runtime defaults in `providers/shared.ts` now mark `yt-captions` with `d_` through `defaultDisabledProviders`; the options fallback and default-order lists use `d_yt-captions` too. The provider stays visible in the sources list and can be enabled. Existing `preferredProviderList` storage wins.
2. **Fix disabled-default provider merging (`840016db`, dev `8de7d2fa`)**
   - `mergePreferredProviders` stripped the stored id's `d_` prefix but compared the default key as-is, so `d_yt-captions` was inserted twice. Both sides are stripped now; two selfcheck cases cover disabled defaults.
3. **Opt-in progressive lyrics loading (`7b33ff63`)** — old engine only
   - New `selection.ts` (port of upstream's pure selection, 150 ms quiet window), concurrent provider tasks in `createLyrics`, classic `processLyrics` re-injection on display/upgrade, YT-match withdrawal, `hasShownLyrics` not-found fallback, dock refresh only when late providers were added.
   - `getLyrics` dedupes concurrent calls per source with a `WeakMap` in-flight promise; the Unison filler does the same so four Unison keys still make one request.
    - `AppState.isProgressiveLyricsEnabled` (default false), Performance-tab checkbox **Load lyrics progressively**, `loadPerformanceSettings()` listener and a synchronous copy from the `updateSettings` message.
    - Full mechanics, risks and verification: `AI_Library/glassy-music-nankill/progressive-lyrics.md`.

---

## Batch 6

Evaluation range: upstream `c6e12997..205c4751` (6 commits on `upstream/master`, up to 2026-11-08), evaluated from `extensions-src/better-lyrics-glassy-dev` at `45f2875e`. 1 upstream item backported; 5 skipped. Branch `backport/batch-6` based on `master` @ `31f140c4`.

### Backported

1. **Gate ThemeSong Compatibility Without a Root `:has()` (PR 1056: `7c53e77a`)** — adapted
   - `themesong.css`: replaces `@supports (selector(:root:has(#ThemeSong-MainContainer))) { :root:has(…) { … } }` with `:root:is([blyrics-themesong], #ThemeSong-MainContainer)`, removing a root-anchored `:has()` that Blink re-evaluates on DOM mutations, including the lyric engine's per-frame DOM writes.
   - Adds `THEMESONG_ACTIVE_ATTR` / `THEMESONG_CONTAINER_ID` to `src/core/constants.ts` and `src/modules/ui/themeSongCompat.ts`; a `MutationObserver` on `<body>`'s direct children toggles the root attribute. ThemeSong appends `#ThemeSong-MainContainer` directly to `<body>`, so the direct-child observer is sufficient.
   - Dropped the `progressBar.ts` repaint hunk (no `modules/ui/playerControls` in this engine) and the observer-dispose wiring (this entrypoint has no reinjection cleanup). Kept the local `& #layout` selector optimization.
   - `STYLING.md` §15 documents the attribute gate.

### Skipped (5)

- **Unison background-group preview (PR 1055: `742a83bd`)**: this engine's `unisonPage.ts` `parseTtmlLines()` already emits one preview line per `x-bg` group, verified with the upstream selfcheck TTML sample; the other half bumps `@braccato/core` 1.20.0 / parsers 0.4.1, which is out of scope.
- **Release 3.0.2.2 (`24a5805d`)**, **lockfile auto-fix (`4c775435`)**, **long-word docs (`c91777a2`, `205c4751`)**: release metadata, dependency-lock noise, and documentation for the new renderer's `.blyrics-word-group-long` / `blyrics-long-word-wrap-threshold`, which this engine does not have.
- Dev-local `eb5780eb` / `8de7d2fa` are mirrored here as `77b0a05d` / `840016db`; `45f2875e` is only the matching merge.

### Batch 6 verification (2026-11-08)

- `npm run typecheck` — passed.
- `npx tsx` selfchecks — `constants`, `providerList`, `themeBuildResolver`, `utils`, `detectedField`, `ttmlMetadata` all passed.
- `npm run build:ci` — Vite build succeeded with no errors/warnings; the trailing sourcemap upload fails without `SOURCEMAPS_API_KEY` (environment-only).
- Electron 44.9.1 live `https://music.youtube.com/` smoke (`xvfb-run`, `session.extensions.loadExtension(dist/chrome)`): the content script loaded; `html[blyrics-themesong]` was absent initially; appending `#ThemeSong-MainContainer` to `<body>` set the attribute and made `--blyrics-text-color` resolve to the injected `--ts-primary-text-color` (`rgb(1, 2, 3)`); removing the container cleared both. No extension console errors observed.
- Pending user QA: layout with the real ThemeSong extension in fullscreen/player-page and miniplayer.
