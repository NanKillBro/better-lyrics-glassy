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
