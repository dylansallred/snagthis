# Branch and uncommitted-change review — September 19, 2026

**Recommendation: keep the useful local connection and HLS request-context work after focused corrections. Do not commit the complete working tree unchanged, and do not merge any old branch wholesale.** The current checkout already is `main`; there is no `master` branch.

This document records a read-only source/history review. It does not authorize or implement cleanup, source edits, commits, or merges. The project-level report records the single smoke test separately.

## Repository state at review start

- `HEAD`, `main`, `origin/main`, and `dylansallred/florence` pointed to `268fbd8d5446ed1e4984f54acfd201e2a4bd7c8c` (`Document ffmpeg inspection steps`). The coordinating reviewer independently confirmed remote HEAD/main with `git ls-remote`; no remote `master` exists.
- Nothing was staged. There were 15 modified tracked files: 12 functional files and 3 `.DS_Store` files. The tracked text diff was 161 additions / 30 deletions.
- Three files were untracked: `AGENTS.md`, `apps/desktop/src/lib/network.ts`, and `packages/.DS_Store`. This inventory predates the review artifacts in `work/`.
- The repository already tracks 24 `.DS_Store` files and 604 files under root `node_modules/`. Ignore rules do not stop changes to already tracked files.

| Local branch | Behind `main` | Ahead of `main` | Decision |
|---|---:|---:|---|
| `codex/add-youtube-video-detection-download` | 39 | 9 | Substantially squash-merged; do not merge again |
| `codex/adding-actions-tests` | 42 | 0 | Fully ancestral; no outstanding commits |
| `dylansallred/add-claude-md` | 68 | 3 | Obsolete legacy branch; do not merge |
| `dylansallred/electron-ui-redesign` | 42 | 6 | Already squash-merged; nothing to port |
| `dylansallred/florence` | 0 | 0 | Identical to `main` |
| `dylansallred/london` | 68 | 0 | Fully ancestral |
| `dylansallred/washington` | 69 | 0 | Fully ancestral |

Commit counts alone overstate outstanding work. Redesign tip `94b6065` has an identical tree to main's squash commit `0687d9f` (PR #2). The first seven unique YouTube-branch commits appear in squash commit `14517e7` (PR #3). Its tip `a24d2af` differs from that squash only in the release workflow and two package-version files; main subsequently fixed version synchronization in `eefe07a` and contains newer release and updater work.

The legacy `add-claude-md` branch includes obsolete `FetchTVPlugin/` and `local-downloader/` changes, a roughly 2.49 GB downloaded MP4, a local `.env`, logs, queue data, and vendored dependencies. Its detection/header ideas exist in evolved form in the current extension. Importing that branch is not a useful path forward.

## Decisions for every uncommitted cluster

| Files / cluster | What changed | Recommendation |
|---|---|---|
| Desktop `App.tsx`, `useActiveJob.ts`, `useCompatibility.ts`, `useHistory.ts`, `useQueue.ts`, `lib/api.ts`, new `lib/network.ts` | Centralized API/WebSocket URL handling and corrected accidental HTTPS use for the HTTP loopback API | **Keep after a small correction.** Include the currently untracked helper with all six importing files; correct the IPv6 condition. |
| Extension `popup.js` | Normalized local API overrides and made the connection-error address reflect the actual target | **Keep.** Correct the IPv6 condition or explicitly support only the actual IPv4 service. |
| Extension `service-worker.js` | Removed Origin, Referer and User-Agent from the preview-session header blocklist | **Narrow to useful Referer preservation.** This sanitizer is used by `CREATE_STREAM_SESSION`, not the desktop-download submission path. The player still strips Origin/User-Agent and uses preserved Referer separately; this is not a general authentication/download fix. |
| Engine `HlsNativeDownload.js`, `JobProcessor.js`, `tests/hls-native-download.test.js` | Added missing source-page headers and a fallback browser User-Agent to HLS requests; added one unit test for that behavior | **Keep the purpose, correct fallback URL handling.** Validate source-page URLs and avoid disclosing unnecessary URL components. |
| Engine `PlaylistUtils.js`: security-filter detection | Turns recognized blocking redirects into a descriptive error | **Fix before keeping.** Use precise confirmed host matching and neutral recovery instructions. |
| Engine `PlaylistUtils.js`: TLS fallback and logging | Retries arbitrary TLS protocol errors using HTTP and logs both complete URLs | **Drop this hunk.** Do not silently weaken remote HTTPS requests. |
| Modified `.DS_Store` files and new `packages/.DS_Store` | Finder metadata | **Exclude from commits.** Repository hygiene can be a separate deliberate cleanup. |
| New `AGENTS.md` | Project instructions | **Rewrite before committing.** It describes removed folders, an old architecture, port 3000, and absence of automated tests. |

## Findings that determine the decision

1. **P1 — Automatic HTTPS downgrade replays URLs and headers without encryption.** [PlaylistUtils.js:60](/Users/dylanallred/Documents/GitHub/M3u8-Downloader-chrome-plugin/packages/downloader-engine/src/core/PlaylistUtils.js:60) enables fallback unless explicitly disabled; [the error handler at line 119](/Users/dylanallred/Documents/GitHub/M3u8-Downloader-chrome-plugin/packages/downloader-engine/src/core/PlaylistUtils.js:119) retries any `EPROTO` or matching TLS error as HTTP with unchanged headers. Existing callers do not disable it. This affects playlists, segments and direct downloads. A signed URL or Authorization header can be sent unencrypted after a TLS failure. Drop the arbitrary remote fallback; correcting a known HTTP loopback endpoint is a separate, narrow operation.

2. **P2 — The new warning logs complete signed URLs.** [PlaylistUtils.js:134](/Users/dylanallred/Documents/GitHub/M3u8-Downloader-chrome-plugin/packages/downloader-engine/src/core/PlaylistUtils.js:134) includes original and fallback URLs verbatim. [The logger persists metadata by default](/Users/dylanallred/Documents/GitHub/M3u8-Downloader-chrome-plugin/packages/downloader-engine/src/utils/logger.js:45), so query-string access tokens can enter `combined.log`. Removing fallback removes this new logging; any retained diagnostic should redact credentials and query strings.

3. **P2 — The redirect diagnosis produces false positives.** [PlaylistUtils.js:25](/Users/dylanallred/Documents/GitHub/M3u8-Downloader-chrome-plugin/packages/downloader-engine/src/core/PlaylistUtils.js:25) matches any hostname containing `cujo.io` and every `/warn.html` redirect regardless of domain. An unrelated redirect can therefore abort with an incorrect security-filter explanation. Match exact known domains/subdomains and avoid presenting disabling protection as the default recovery action.

4. **P2 — Synthesized HLS Referer forwards the entire source-page URL.** [HlsNativeDownload.js:18](/Users/dylanallred/Documents/GitHub/M3u8-Downloader-chrome-plugin/packages/downloader-engine/src/core/HlsNativeDownload.js:18) assigns `sourcePageUrl` before validating it. This can send fragments, credentials or sensitive query parameters to a media host. Preserve necessary captured context, but validate HTTP(S) fallback URLs, strip credentials/fragments and use origin-only cross-site fallback. This concern is about the new engine fallback, distinct from the browser player's existing referrer policy.

5. **P3 — IPv6 normalization is ineffective.** [network.ts:10](/Users/dylanallred/Documents/GitHub/M3u8-Downloader-chrome-plugin/apps/desktop/src/lib/network.ts:10) and [popup.js:12](/Users/dylanallred/Documents/GitHub/M3u8-Downloader-chrome-plugin/apps/extension/popup.js:12) compare `URL.hostname` with `::1`; WHATWG URL serialization includes brackets (`[::1]`). The desktop therefore misses that HTTPS loopback case, while the popup rejects it and falls back to the default IPv4 endpoint. The actual desktop service currently uses IPv4, so this is an edge case rather than the main blocker.

6. **Commit integrity — Include the new helper.** [network.ts](/Users/dylanallred/Documents/GitHub/M3u8-Downloader-chrome-plugin/apps/desktop/src/lib/network.ts) is untracked while six tracked desktop files import it. Committing only tracked modifications would produce missing imports on a fresh checkout.

The preview-header scope is confirmed by [service-worker.js:805](/Users/dylanallred/Documents/GitHub/M3u8-Downloader-chrome-plugin/apps/extension/service-worker.js:805), the [player's header blocklist](/Users/dylanallred/Documents/GitHub/M3u8-Downloader-chrome-plugin/apps/extension/player.js:31), and its [separate referrer extraction](/Users/dylanallred/Documents/GitHub/M3u8-Downloader-chrome-plugin/apps/extension/player.js:116). Preserving Origin/User-Agent in stored preview sessions does not cause the browser to replay those headers.

## Proposed commit boundaries

After addressing the findings, use two focused commits: (1) local API connection normalization, including `network.ts`; (2) HLS request context and precise network diagnostics, plus the narrow preview Referer change. Exclude the arbitrary HTTPS downgrade, Finder data and stale instructions. Keep any dependency/history cleanup separate. No merges or cleanup were performed during this review.
