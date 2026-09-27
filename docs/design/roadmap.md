# SnagThis historical migration plan — 2026-09-19

This document preserves the original migration plan and its rationale. The new repository and product implementation now exist; these milestones are **not the current backlog or a current status report**. Use the [current design spec](ui-design-spec.md) for approved interface behavior and [release readiness](../release-readiness.md) for current verification evidence and remaining release requirements.

Unless explicitly identified as a later owner decision, measurements, gaps, estimates, proposed tools, and words such as “today,” “currently,” or “unsupported” below describe the predecessor at planning time. For example, the missing `/v1` controls, unsupported AES-128, proposed Vitest stack, and broken Electron harness are historical observations or proposals, not claims about the current implementation. Milestone completion is not maintained here. Provenance decisions are recorded in [PROVENANCE.md](../PROVENANCE.md).

Written 2026-09-19. Design section references below, such as §4, refer to the spec as it existed when this plan was written; its structure and requirements have since evolved.
Background: the predecessor project review from 2026-09-19 (defects referenced as "review P1/P2"). The original report is a local archive; the relevant decisions are recorded below.

Owner decision, 2026-09-19: **GPL-3.0-only**, so distributed derivatives remain open source under the license's terms. The license choice in R0.6 is resolved.

Contents: **1** start from scratch or reuse? · **2** R0 new repo · **3** gap analysis · **4** milestones M0–M4 (UI) · **5** testing strategy · **6** site compatibility programme C0–C3 · **7** order · **8** risks.

The original milestones were ordered by dependency rather than assigned dates. Their relative estimates (S ≈ a day or two, M ≈ several days, L ≈ a week or more) assumed one developer and are retained as planning history.

## 1. Start from scratch or reuse?

**Original recommendation: create a new repository with clean history and port the code module by module. Preserve the engine and rewrite the visible UI.** A from-scratch rewrite would have spent weeks re-learning HLS edge cases the predecessor engine already handled (segment retry, resume, fMP4, remux, yt-dlp path). The proposed work addressed its UI, known defects, and repository hygiene.

The predecessor review recorded a 2.4 GB `.git` directory, 604 tracked `node_modules` paths, 24 tracked `.DS_Store` files, and no licence. Its README/AGENTS/CLAUDE described missing directories (`FetchTVPlugin/`, `local-downloader/`), and its project name/history still said "M3u8-Downloader-chrome-plugin". These measurements motivated a fresh repository; they do not describe this SnagThis checkout. Preserving the predecessor was part of the plan, not authorization to archive or change it now.

Predecessor measurements on `main` @ `268fbd8`, with the original port decisions:

| Module | Size | Decision | What happens to it |
|---|---|---|---|
| `packages/downloader-engine` | 5.7k LOC (`JobProcessor` 2.0k, `QueueManager` 1.0k, `VideoConverter` 1.0k) | **Port as-is, then fix** | Copy with its tests. Land the review's P1 fixes as the first commits in the new repo (muxer `-f mp4` on `.part` outputs, finalization runner ownership, drop HTTPS→HTTP downgrade, 14-day auto-delete, atomic queue writes). Do not refactor `JobProcessor` during the port; split it only when M3 has to touch it. |
| `packages/downloader-api` | 5.1k LOC (`createApiServer.js` 1.9k) | **Port with surgery** | Keep routes and validation. Fix while porting: installation-scoped auth token + exact origin checks for HTTP and WebSocket; move `queue.json` out of the statically served downloads folder; history delete semantics (M0). |
| `packages/contracts` | 26 LOC | **Keep and grow** | Becomes the home of shared types, the row formatting module (M0.4), job payload schema incl. `selection` (M3), error codes. |
| `apps/desktop/electron` | 1.2k LOC | **Port** | Updater, IPC, notifications, bundled-tool scripts (`fetch-ffmpeg.cjs`, `fetch-yt-dlp.cjs`) all carry over. Add `snagthis://`, `trashItem`, login item. |
| `apps/desktop/src` — `components/ui/*`, `hooks/*`, `lib/*`, `types/*`, `globals.css` | ~2k LOC | **Port** | Radix primitives, API client, queue/history hooks and tokens are what the new UI is built from. |
| `apps/desktop/src` — `components/queue|history|settings|layout` | ~2.4k LOC | **Rewrite** | Replaced by `VideoRow`, `FillThumb`, `VideoList`, `RowDetails`, `TopBar`, `SettingsSheet` (spec §11). Only `SegmentHeatmap.tsx` is kept. |
| `apps/extension/js` (detector + content script) | 1.3k LOC | **Port after provenance check** | See below. Fix small-manifest rule, relative URLs, reset on navigation. |
| `apps/extension/service-worker.js` | 1.0k LOC | **Port** | Storage, sessions, header capture stay. |
| `apps/extension/popup.js` | 1.8k LOC | **Split: keep ~⅓, rewrite ~⅔** | Title/episode inference (lines ~479–1260, covered by `extension-title-inference.test.js`) moves to `popup/titles.js` unchanged. `renderMedia()` and the rest are rewritten against `RowModel`. |
| `apps/extension/player.*`, `vendor/hls.min.js` | 0.4k LOC | **Port** | Becomes right-click → Preview. |
| `tests/*`, `playwright.config.js`, `.github/workflows/*`, `scripts/release-*.sh`, `eslint.config.js` | 7 test files + e2e | **Port** | All existing tests must pass in the new repo before any UI work starts. |
| `docs/design/*` | this folder | **Move** | Becomes the new repo's `docs/design/`. |
| Git history, tracked `node_modules`, `.DS_Store`, `work/`, `logs/`, `playwright-report/`, `test-results/`, `apps/desktop/bin/*` binaries, `dist*` | — | **Leave behind** | Binaries are fetched by script; reports are build output. |

**Provenance check (do this before choosing a licence).** The project appears to have begun from the FetchV extension (the old docs call the extension "FetchV" / `FetchTVPlugin/`) and identifiers such as `fetchv-page-detector` remain in `media-detector.js` / `content.js`. No open-source licence for FetchV has been established — confirm before relying on any inherited file. For each ported extension file, decide: written for this project → port; inherited → rewrite from the behaviour spec rather than copy (the detector and content script together are ~1.3k lines, so a clean rewrite is a few days, not weeks). Record the outcome in `docs/PROVENANCE.md`. Same check for anything in `vendor/` (hls.js is Apache-2.0: fine, keep its licence file).

## 2. R0 — Original repository creation plan (M)

| # | Task | Done when |
|---|---|---|
| R0.1 | Create `snagthis` (GitHub, private until R0.9). `git init`, default branch `main`, branch protection: PR + green CI required. | Empty repo with protection on. |
| R0.2 | Skeleton before any code: `.gitignore` (node_modules, dist*, `.DS_Store`, bin/, logs/, reports, `compat/results/`), `.editorconfig`, `.nvmrc` pinned to the Node LTS the Electron version supports (the old repo's e2e failed to launch under Node 23 — pin and test), npm workspaces root `package.json`. | `git status` clean after `npm install` and a full build. |
| R0.3 | Same layout so every path in the design spec stays valid: `apps/extension`, `apps/desktop`, `packages/{contracts,downloader-engine,downloader-api}`, `tests/`, `compat/`, `docs/`. | Tree matches. |
| R0.4 | Port module by module in dependency order — contracts → engine → api → desktop/electron → desktop/src (kept parts) → extension — **one commit per module**, message `Port <module> from M3u8-Downloader-chrome-plugin@268fbd8`. Uncommitted work in the old tree (`network.ts`, request-context changes) is ported only where the project review said keep; the HTTPS→HTTP downgrade hunk is dropped. | `npm test`, `npm run lint`, `npm run typecheck:desktop` green in the new repo. |
| R0.5 | Provenance audit (above) → `docs/PROVENANCE.md`; rename leftover `fetchv-*` identifiers. | No file of unknown origin remains. |
| R0.6 | Licence + notices: pick the licence (GPL-3.0 if you want forks to stay open — and it is the safe choice alongside bundled GPL builds of ffmpeg; MIT if you want maximum reuse and ship LGPL ffmpeg builds). Add `LICENSE`, `THIRD_PARTY_NOTICES.md` (ffmpeg, yt-dlp, hls.js, Electron, Radix, Inter). | Files present; ffmpeg build variant matches the licence choice. |
| R0.7 | CI on day one (port `ci.yml`): lint, typecheck, unit + integration tests, extension CSS build, desktop build. Release workflow ported but changed to **validate the artefact before publishing** (review P2). | A PR cannot merge red. |
| R0.8 | Land the engine/API P1 fixes listed in §1 as the first real PRs, each with a fixture test. | Review P1 table is closed or explicitly deferred in an issue. |
| R0.9 | Docs: new `README.md` (what it is, install, how the two halves connect), `CONTRIBUTING.md`, `SECURITY.md`, `PRIVACY.md` (no telemetry, what the extension reads), fresh `CLAUDE.md`/`AGENTS.md` generated from the real tree. Move `docs/design/`. Archive the old repo read-only with a pointer. | A newcomer can clone, run `npm install && npm run dev`, and load the extension from the README alone. |

**Exit:** new repo builds, all ported tests pass, P1 defects fixed, nothing visible has changed yet. M0 starts here.

## 3. Predecessor gaps at planning time

| Design needs | Today | Gap |
|---|---|---|
| One row component, one list | `ActiveDownloadCard`, `QueueJobCard`, `HistoryItemCard`; separate Queue / History / Settings views behind a Navbar | Desktop restructure (M1) |
| Colour-fill thumbnail | Queue jobs only have thumbnails for YouTube/TMDB (`thumbnailUrls`), others get one after conversion (`generateThumbnailFromMp4`) | Placeholder works now (M1); early frame grab (M3) |
| Popup rows with thumbnail, live progress, Play | Popup sends `POST /v1/jobs` and forgets; no thumbnails; no progress; `renderMedia()` builds ~400 lines of DOM per item | Popup rewrite (M2) |
| "Open SnagThis" when the app is closed | `POST /v1/app/focus` only works when the app is already running; no `snagthis://` protocol | Protocol handler (M2) |
| Quality / audio / subtitle menu | Popup only guesses resolution from the URL (`extractResolution`); engine has no variant-selection input; master playlists are only inspected in `HlsNativeDownload.js` | Variant discovery + selection end to end (M3) |
| Remove from list vs. Move to Trash | `DELETE /api/history` deletes every file; per-item delete unlinks the file | Safety work (M0) |
| Whole-library search | History loads first 200 items | Server-side search/pagination (M1) |
| Five-row settings + Advanced | Three settings cards + queue settings bar; no `preferredQuality`, `subtitleLanguage`, `notifyOnComplete`, `launchAtLogin` | Settings sheet (M1), new settings (M1/M3) |

## 4. Original UI milestones

File paths are identical in the old and new repo (R0.3).

### M0 — Safe ground (S–M)

The unified list puts "remove" next to saved files, so deletion semantics must be fixed **before** the new UI ships. Also lands the shared pieces both surfaces import.

| # | Task | Where | Done when |
|---|---|---|---|
| 0.1 | Per-item remove gets a mode: `DELETE /api/history/:fileName?mode=list\|trash`. `list` drops the index entry only; `trash` goes through a new IPC `moveHistoryFileToTrash` → `shell.trashItem`. | `packages/downloader-api/src/routes/history.js`, `apps/desktop/electron/main.js`, `preload`, `types/desktop-bridge.ts` | Integration test: `mode=list` leaves the file on disk; `trash` moves it; neither unlinks. |
| 0.2 | Make `DELETE /api/history` (bulk, deletes files) unreachable from UI; keep the route but require `?confirm=delete-files`. | same route, `HistoryToolbar.tsx` | Test: bare `DELETE /api/history` → 400. |
| 0.3 | Stop auto-deleting completed files after 14 days (review P1). | `packages/downloader-engine/src/config/index.js`, `CleanupService.js` | Test with a 15-day-old fixture file survives cleanup. |
| 0.4 | Shared row formatting module: `toRowModel()`, `formatEta`, `formatSize`, `formatWhen`, problem-sentence classifier (§3.1–3.3, §11). Plain JS + JSDoc types so the popup can import it without a build step. | `packages/contracts/src/rows.js` | Unit tests cover every line of the tables in §3.1–3.3 (add to root `npm test`). |
| 0.5 | Token parity: add `--color-primary-hover`; copy the `@theme` block into the extension's `src/input.css`. | `apps/desktop/src/globals.css`, `apps/extension/src/input.css` | A script or test diffs the two `@theme` blocks. |

**Exit:** `npm test` green; no code path deletes a user's file without an explicit "Move file to Trash".

### M1 — Desktop: one list (L)

Pure front-end restructure on existing APIs. Thumbnails that don't exist yet use the striped placeholder, which is fully specified (§4), so nothing here waits on the engine.

| # | Task | Where | Done when |
|---|---|---|---|
| 1.1 | `FillThumb` | `apps/desktop/src/components/list/FillThumb.tsx` | Renders all four rows of the §4 state table; honours reduced motion; placeholder → image swap keeps `--p`. |
| 1.2 | `VideoRow` using `RowModel`; one visible action; hover/focus-within extras; right-click menu via existing `dropdown-menu`. | `components/list/VideoRow.tsx` | Visual match to the current `ui-design-spec.md` at 820px, including the approved progress lane. |
| 1.3 | `VideoList`: merge `useQueue` + `useHistory` → ordered `RowModel[]` (§6 ordering); completed queue jobs are de-duplicated against history by `jobId`. Drag-reorder for waiting rows. | `components/list/VideoList.tsx`, hooks | A job moving queued → downloading → saved never duplicates or flickers between positions. |
| 1.4 | `TopBar`: paste field (uses existing `POST /api/jobs`), tabs, search. ⌘V handling. Multi-URL paste. | `components/layout/TopBar.tsx`; delete `Navbar`, `QueueToolbar`, `QueueSummaryBar`, `HistoryToolbar` | Pasting a URL creates a row without leaving the list. |
| 1.5 | Server-side search + pagination for saved items (review P2: 200 cap). Infinite scroll in `Saved`/`All`. | `packages/downloader-api/src/services/historyIndex.js`, `routes/history.js`, `lib/api.ts`, `useHistory.ts` | Library fixture of 500 files: search finds item #450. |
| 1.6 | `RowDetails` with existing `SegmentHeatmap` (§7); inline rename; Cancel / Remove… dialog wired to 0.1. | `components/list/RowDetails.tsx` | Only one panel open at a time; heatmap hidden for direct downloads and saved rows. |
| 1.7 | `SettingsSheet` (§8): five rows + Advanced containing today's `DesktopSettingsCard`, queue settings, `UpdaterCard`, diagnostics. Add `notifyOnComplete` (gates the existing `new Notification` in `main.js`) and `launchAtLogin` (`app.setLoginItemSettings`). | `components/settings/*`, `types/settings.ts`, `electron/main.js` | Every setting reachable today is still reachable. |
| 1.8 | Footer + first-launch state (§6, §6.1). "Extension has connected" flag persisted from the first authenticated `/v1/*` request. | `App.tsx`, api server | Fresh profile shows first-launch; after the extension connects once, the button disappears. |
| 1.9 | Keyboard map + a11y pass (§10). | list components | Playwright: full download lifecycle driven by keyboard only. |
| 1.10 | Update/replace desktop e2e tests for the new structure. | `tests/`, `playwright.config.js` | `npm run test:e2e` green (note: the review hit an Electron launch failure under Node 23 — resolve that harness issue first). |

**Exit:** desktop app ships with the new UI on today's engine. Queue/History/Settings views and their components are deleted, not hidden.

### M2 — Popup: same row, live (M–L)

| # | Task | Where | Done when |
|---|---|---|---|
| 2.1 | Replace `popup.html` structure (§5) and split `popup.js`: keep title-inference helpers (they have tests) in `popup/titles.js`; new `popup/render.js` builds rows from `RowModel` using the M0 module. | `apps/extension/` | `tests/extension-title-inference.test.js` still passes untouched. |
| 2.2 | Live state: persist `mediaItemId → jobId` in `chrome.storage.session`; poll `GET /v1/queue` every 1s while open; map job → row state; Pause/Resume/Play from the popup. Needs `/v1` equivalents of pause/resume (today only `/api/queue/:id/pause` exists) and a `/v1/jobs/:id/open`. | `popup/state.js`, `createApiServer.js` | Start a download, close and reopen the popup: the row shows current progress. |
| 2.3 | Thumbnails at detection time (§5.3): poster → og:image → canvas frame → none. Pass the chosen URL/data-URL in the job payload as `thumbnailUrl` so the desktop row shows the same image immediately. | `js/content.js`, `service-worker.js`, `buildJobPayload()`, `routes/jobs.js` | On a page with `<video poster>`, popup and desktop show the poster before any bytes download. |
| 2.4 | Offline / not-installed / version-mismatch banner (§5.4). Register `snagthis://` protocol in the desktop app (`app.setAsDefaultProtocolClient`, `protocols` in electron-builder config) so **Open SnagThis** can launch a closed app. | `popup/`, `apps/desktop/electron/main.js`, `apps/desktop/package.json` | With the app quit, clicking Open SnagThis launches it and the banner clears within ~3s. |
| 2.5 | Empty state, "No video?" help, footer badge, settings sheet (popup subset; **Change** deep-links to the app). | `popup/` | Matches the current popup states in `ui-design-spec.md`. |
| 2.6 | Reset detections on navigation; per-row Hide; remove "Clear Media". Include the review's detection fixes that change what rows appear: small-manifest rule (review P1), relative URL resolution. | `js/media-detector.js`, `service-worker.js` | A 40 KB `.m3u8` is detected; navigating away clears the list. |
| 2.7 | Popup Playwright test against a local fixture page + stub API. | `tests/` | Detected → Downloading → Saved asserted on row text and `--p`. |

**Exit:** extension release whose popup matches the desktop row for row. Quality is still plain text (whatever `extractResolution` finds) — no menu yet.

### M3 — Quality menu and early thumbnails (L, engine work)

The only milestone that changes the download engine. Until it ships, the quality text-button is not rendered (§5.2 says: only when more than one real variant exists).

| # | Task | Where | Done when |
|---|---|---|---|
| 3.1 | Variant discovery in the extension: when a master playlist is detected, fetch and parse `#EXT-X-STREAM-INF` (resolution, bandwidth) and `#EXT-X-MEDIA` (audio, subtitles); compute size estimates; collapse master + variant detections into one media item (§5.2 collapse rule). | `service-worker.js`, new `js/hls-variants.js` | Fixture master playlist with 3 variants yields one row and a 3-item menu. Unit tests for the parser. |
| 3.2 | Job payload + engine accept a selection: `selection: { variantUrl?, height?, audioLang?, subtitleLang?, audioOnly? }`. `JobProcessor` downloads the chosen variant instead of auto-picking; native-HLS path maps it to ffmpeg `-map`. | `packages/contracts`, `routes/jobs.js`, `JobProcessor.js`, `HlsNativeDownload.js` | Fixture: requesting 480p produces a 480p file (ffprobe assertion). |
| 3.3 | YouTube path: map selection to yt-dlp format selectors. | yt-dlp job path | Requesting 720p yields ≤ 720p. |
| 3.4 | Quality menu UI in popup; desktop paste flow shows the same menu inline while "Checking link…" resolves, defaulting to Preferred quality. Settings: `preferredQuality`, `subtitleLanguage`. | popup, `TopBar`, `SettingsSheet` | Keyboard-operable; default honours the setting. |
| 3.5 | Early local preview: use the first playable downloaded excerpt to create a silent, roughly ten-second loop and select a nonblack poster. Replace generic site artwork or page screenshots; preserve YouTube artwork. Publish assets through queue updates and repair saved-video posters when preparing their previews. | `JobProcessor.js`, `VideoConverter.js`, `QueueManager.buildThumbnailUrls` | A playable local excerpt provides the preview during downloading, without another source transfer; image updates do not reset row progress. |

**Owner field revisions, 2026-09-19:**

- Smooth ETA from recent transfer rates, resetting between video/audio stages and attempts.
- Extend bounded parallel piece scheduling and delayed retries to native HLS; require complete selected-track coverage before saving. A failed piece must release its worker so later pieces can download during backoff.
- Replace thumbnail progress with the selected **A+B: Leading edge + Soft sweep** row background. Duration sits beside the title; no hover labels cover the video.
- Generate silent, roughly ten-second desktop previews from the first usable downloaded media as well as completed files. In Chrome, preview the detected source directly before sending a download to the desktop; a running or paired desktop must not be required for that preview. This later owner clarification permits the small source-preview transfer in the extension. Loop only on hover/focus and respect reduced motion.
- Show measured active connections beside the per-download limit in Details. Clearly state when an external downloader does not report its live count. Cancelled media processes must exit and release their queue slot.
- Use compact borderless desktop menus, pointer-aware focus styling, concise expandable details and a Saved check badge. Strengthen the active row glow while keeping thumbnails unobscured.
- Sample seekable preview sources around 35% of their duration; try alternate scenes when black. YouTube can use the already-playing page video without seeking or interrupting it.

**Exit:** the full approved design is live.

### M4 — Field check and polish (S–M)

| # | Task | Done when |
|---|---|---|
| 4.1 | Hallway test with 3–5 people: download a video, change quality, pause, find the file, recover an expired link. Watch specifically: do they understand the row background progress and hover/focus video preview? do they find the quality menu? do they find "⋯"? | Notes recorded in `docs/design/` |
| 4.2 | Evaluate the owner-selected A+B row background motion (§4) in 4.1; retain the clean video thumbnail. Add the 1px quality-button border only if field evidence calls for it. | Decision recorded either way |
| 4.3 | Move new strings into `_locales` / a desktop strings module. | No hard-coded UI strings in row/format code |
| 4.4 | Update README / AGENTS.md / CLAUDE.md (they still describe `FetchTVPlugin/` and `local-downloader/`). | Docs match the repo |

## 5. Original testing strategy

Principle from the project review: **assert on real media, not on argument strings.** A test that produces a file and checks it with `ffprobe` is worth ten that check what was passed to ffmpeg.

| Layer | Tooling | What it covers | Runs |
|---|---|---|---|
| L1 Unit | `node --test` (already used) | Row formatting + problem classifier (M0.4), HLS master-playlist parser (M3.1), title inference (existing), URL/media-type classification, detection-collapse rule | every PR, < 10 s |
| L2 Engine fixtures | `node --test` + a local **fixture server** + real ffmpeg/ffprobe | Whole downloads against generated media (table below) | every PR, ~1–2 min |
| L3 API integration | existing `api.integration.test.js`, extended | Auth token / origin rejection, `/v1/*` contract used by the extension, remove-vs-trash semantics (M0.1–0.2), history search pagination (M1.5), WebSocket auth | every PR |
| L4 Desktop components | Vitest + Testing Library (new) | `toRowModel` → `VideoRow` renders the exact copy in spec §3.1–3.3; `FillThumb` state table §4; list ordering and de-dupe (M1.3); keyboard map | every PR |
| L5 Visual regression | Playwright screenshots of a dev-only "gallery" route that renders every row state; baseline = the approved mock-ups | Catches drift from the spec (spacing, colours, stray badges) | every PR, desktop Chromium only |
| L6 Extension e2e | Playwright `launchPersistentContext` with `--load-extension`, **fixture pages** (below), a stub or real local API; popup opened at `chrome-extension://<id>/popup.html?tab=<id>` | Detection, collapse, thumbnail capture order, Download → live progress → Saved, offline banner, navigation reset | every PR |
| L7 Desktop e2e | Playwright Electron (fix the launch failure first: pinned Node, `executablePath`, isolated `userData`) | Paste link → row → pause/resume → Finishing → Saved → Play/Show in folder → Remove (list vs. trash) → restart app and state survives | nightly + before release |
| L8 Full loop | L6 + L7 together | fixture page → extension → real desktop API → file on disk → `ffprobe` duration/streams/height | nightly + before release |
| L9 Release smoke | Packaged app on macOS + Windows runners | Installs, launches, bundled ffmpeg/yt-dlp found, one fixture download completes, `snagthis://` registered | on release tag, **before** publishing |

### 5.1 Fixture server (`tests/fixtures/server.js`)

Generates a 10-second test pattern with ffmpeg once per run and serves it in every shape the engine must handle. Each row is one L2 test asserting with `ffprobe`: container is MP4, duration within ±1 s, expected video height, expected audio/subtitle streams.

| Fixture | Exercises |
|---|---|
| HLS, MPEG-TS segments | baseline path, concat + remux |
| HLS, fMP4 segments + init section | native path, the `.part` muxer fix |
| Master playlist: 1080/720/480 + separate audio rendition + WebVTT subtitles | variant discovery and `selection` (M3) |
| Manifest under 100 KB, no `.m3u8` extension, `application/vnd.apple.mpegurl` content-type | small-manifest and media-type dispatch defects |
| Relative segment URLs, manifest behind a 302 | URL resolution |
| Segments named `.jpg` / `.png` / no extension | disguised segments |
| AES-128 with key URL | standard HLS encryption (currently unsupported → test documents behaviour, then drives the fix) |
| Requires `Referer` / `Origin` / a cookie | header capture hand-off from extension to engine |
| Signed URLs that return 403 after N seconds | "Link expired" classification + resume after refresh |
| Every 7th segment 503s twice; one segment 404s forever | retry, exhaustion, "Connection lost at {pct}%" |
| Throttled to 200 KB/s | pause/resume mid-flight, restart-resume, `etaSeconds` sanity |
| Live playlist (sliding window) | documented as unsupported: must fail cleanly with the right sentence |
| Direct MP4 with and without Range support | direct path, resume |
| Widevine-style `#EXT-X-KEY:METHOD=SAMPLE-AES` + `KEYFORMAT` | must be detected and reported as "This video can't be downloaded"; never attempted |

### 5.2 Fixture pages (`tests/fixtures/pages/`)

One HTML page per **embedding technique**, all backed by the fixture server, used by L6:

`<video src>` direct · `<video>` + hls.js · player inside a **cross-origin iframe** · iframe inside an iframe · manifest requested only after a click on a custom play button · manifest URL assembled from base64 at runtime · blob:/MSE playback with manifest fetched via `fetch` vs. `XMLHttpRequest` · page with `<video poster>` / `og:image` / neither (thumbnail order, spec §5.3) · page that loads a master and then its variants (must collapse to one row) · page with two unrelated videos (must stay two rows) · SPA route change without reload (detections must reset).

### 5.3 Proposed definition of done at planning time

L1–L6 green; if it touches the engine, a fixture that failed before and passes after; if it touches UI, the gallery screenshots reviewed; no new string outside the strings module.

## 6. Site compatibility programme

Goal: know, with evidence, **which sites work, which stage fails on the ones that don't, and fix failures by technique rather than by site.** Real sites change weekly, so this never gates a PR; it runs on demand and on a schedule and produces a published matrix.

### 6.1 Scope note

The harness below works on any URL you put in the list, and the list is yours to maintain. I have **not** gone through fmhy.net and compiled its streaming sites into the target list: most of the movie/TV streaming sites indexed there serve content without the rights-holders' permission, and I'm not going to enumerate or tune the downloader against specific ones. What I've done instead is organise the work by **player technique** (§6.4) — those sites overwhelmingly use a small set of embed players and delivery tricks, and every one of those tricks is reproduced in the fixture server and fixture pages above, so fixes are generic and testable offline. Two hard limits regardless of site: no DRM circumvention (Widevine/PlayReady/FairPlay streams are detected and declined), and no bypassing of logins or paywalls.

### 6.2 Seed list (sites that permit downloading or exist for testing)

Verify each URL when adding it; record the licence/permission in the entry.

| Category | Entries |
|---|---|
| Public test streams | Apple "bipbop" advanced fMP4 + TS examples; Mux `test-streams.mux.dev`; Bitmovin, Akamai and Unified Streaming demo streams (HLS, multi-audio, subtitles, AES-128 samples) |
| Public domain / open licence | Internet Archive (moving images), Wikimedia Commons video, Blender Studio open films, NASA video library, a PeerTube instance (HLS) |
| Creator-permitted | Vimeo videos with downloads enabled or CC licence; YouTube videos marked Creative Commons (yt-dlp path); your own uploads on any host you use |
| Embed players in the wild | Self-hosted pages using Video.js, Plyr, JW Player, Clappr, Shaka with your own or CC content — covers the player families without depending on anyone's site |

### 6.3 Harness

```
compat/
  sites.yaml            # the list (checked in)
  run.js                # npm run compat [-- --site <id>] [--tag iframe]
  results/<date>.json   # raw results (git-ignored)
  COMPATIBILITY.md      # generated matrix (checked in)
```

```yaml
# compat/sites.yaml
- id: archive-org-film
  url: https://archive.org/details/<item>
  permission: public-domain
  tags: [direct-mp4, video-tag]
  steps: []                      # optional: [{ click: "button.play" }, { waitFor: "video" }]
  expect: { rows: 1, minHeight: 480, durationSeconds: 600, tolerance: 5 }
- id: selfhost-videojs-iframe
  url: https://<your-host>/embed-test.html
  permission: own-content
  tags: [hls, iframe, referer-gated]
  steps: [{ frame: "iframe#player", click: ".vjs-big-play-button" }]
  expect: { rows: 1, variants: 3 }
```

`run.js` per site: launch Chromium with the built extension → open the URL → run `steps` → wait up to 20 s for detection → read the popup's row models → send the first row to a **headless engine in probe mode** → verify → record. It records each **stage** separately, because the failing stage is the diagnosis:

| Stage | Pass means | Typical failure → where the fix lives |
|---|---|---|
| S1 Page | loaded, steps ran | anti-automation, consent walls → harness steps |
| S2 Detected | ≥ 1 media item captured | player in cross-origin iframe, request made from a worker, non-standard content-type → `media-detector.js`, `all_frames` injection |
| S3 Right row | count matches `expect.rows`; ads/previews not offered; master+variants collapsed | collapse rule, ad filtering by duration/size → service worker |
| S4 Variants | qualities/audio/subs match `expect` | master parser (M3.1) |
| S5 Fetch outside the browser | engine can GET the manifest and first segment | missing `Referer`/`Origin`/cookies/UA, IP- or session-bound tokens → header capture + hand-off |
| S6 Probe download | first 30 s (or 8 segments / 5 MB) downloads and remuxes | disguised segments, AES-128, discontinuities, separate audio → engine |
| S7 Verify | `ffprobe`: playable, has video+audio, height as chosen | muxing → `VideoConverter` |
| S8 Full download (opt-in `--full`) | complete file, duration within tolerance | token expiry mid-download, rate limits → refresh/resume flow |

**Probe mode** is a new engine option (`probe: { seconds: 30 }`): stop after N seconds of media, finalize normally. It keeps runs fast and polite: one site at a time, one job at a time, a few MB each.

`COMPATIBILITY.md` is generated: one line per site with a ✓/✗ per stage, last-verified date, extension+app version, and the technique tags; plus a second table **by tag** (e.g. `iframe`: 9/11 passing) — that second table is what prioritises engineering work.

### 6.4 Technique checklist (what "works on most streaming sites" actually requires)

Each has a fixture (§5.1–5.2) so it can be built and regression-tested without touching a real site.

| Technique | Status today | Needed |
|---|---|---|
| Player inside cross-origin iframe(s) | partial | inject detector in all frames; attribute detections to the top tab; thumbnail/title from the top page |
| `Referer` / `Origin`-gated manifests and segments | partial (request context captured in uncommitted work) | reliable capture per request; pass to engine; engine sends on every segment request |
| Cookie / session-bound streams | unknown | optional cookie hand-off for the media host only; never stored in `queue.json` in clear (review P1) |
| Short-lived signed URLs | explicit recovery implemented | classify 403/410 → "Link expired"; **refresh flow**: reopen the page, re-detect the video, then choose **Continue previous download**. The engine validates compatibility before reusing finished pieces; recovery does not attach automatically. |
| Manifest without `.m3u8`, tiny manifests, base64 or JS-assembled URLs | fails (review P1/P2) | detect by content-type and body sniff (`#EXTM3U`), not extension or size |
| Segments disguised as `.jpg/.png/.html` or with junk prefixes | unknown | sniff TS sync byte / fMP4 box; strip prefixes before concat |
| Separate audio rendition, multiple languages | native path only | M3 selection |
| AES-128 | not supported on the basic path | fetch key with the same headers; decrypt or hand to ffmpeg |
| Ads / pre-rolls detected as videos | unknown | hide items < 60 s when a longer item exists on the same page; keep under "Show all detected streams" |
| DASH (`.mpd`) | detected, no engine | decide: route to ffmpeg/yt-dlp or mark unsupported explicitly |
| Sites yt-dlp already supports | YouTube only | generic "try yt-dlp" fallback for pasted page URLs before saying unsupported |
| DRM (Widevine etc.) | — | detect → "This video can't be downloaded". Out of scope, permanently. |

### 6.5 Milestones

| # | Task | Done when |
|---|---|---|
| C0 | Fixture server + fixture pages (§5.1–5.2) wired into L2/L6. Everything in §6.4 has a failing or passing test. | Runs in CI. **Do this right after R0 — it is the safety net for every later change.** |
| C1 | `compat/` harness, probe mode, stage recording, generated matrix; seed list (§6.2) ≥ 15 entries. | `npm run compat` produces `COMPATIBILITY.md`. |
| C2 | Work the **by-tag** table top-down: iframe detection, header hand-off, manifest sniffing, disguised segments, expiry refresh, AES-128. One PR per technique, each flipping fixture tests from red to green. | Seed list ≥ 90% through S7; every ✗ has an issue naming its stage. |
| C3 | Scheduled weekly run (GitHub Action, manual approval, results as artefact + PR updating the matrix). In-app "Report a site that didn't work" → pre-filled issue with stage results and **redacted** URLs/headers (review P2). | Regressions show up within a week without anyone testing by hand. |

## 7. Order and parallelism

```
R0 new repo ─► C0 fixtures ─► M0 safety ─┬─► M1 desktop ─┐
                    │                    └─► M2 popup  ──┼─► M3 quality + engine ─► M4 field check
                    └─► C1 harness ─► C2 technique fixes (continuous) ─► C3 scheduled runs
```

- **R0 → C0 first.** Porting and then immediately building the fixture server means every later change, UI or engine, lands on a net.
- M1 and M2 share only M0's formatting module and tokens; run them in parallel or M1 first (no API changes, proves the row).
- The compatibility track (C1–C3) is independent of the UI track and is where "does it actually pull the video" gets answered; C2 never really ends.
- M3 touches the same engine code as C2's variant/audio work — schedule them together.
- M3.5 (early thumbnails) can be pulled forward if placeholders feel too common.

## Not in this roadmap

Light theme, tray/menu-bar mode, collections, bulk actions, browsers other than Chrome, cloud sync, live-stream recording, DRM. The project review's engine/API defects are no longer "elsewhere": they are R0.4/R0.8 (fixed during the port) and C2.

## 8. Risks identified during planning

| Risk | Mitigation |
|---|---|
| Row progress is too subtle at popup width | Status line always carries `{pct}%`; evaluate the selected row motion in field checks (4.1–4.2). |
| Many sites give no poster and block canvas capture → lots of placeholders in the popup | Placeholder is a designed state, not an error; M3.5 gives the desktop a real frame quickly; popup can adopt the job's thumbnail once the desktop has one (it already polls the queue). |
| Merging queue + history causes duplicates/flicker at completion | Single `RowModel` keyed by `jobId`; de-dupe rule in 1.3 with a test that walks a job through every state. |
| Collapsing detections hides a video the user wanted | Conservative collapse rule (§5.2); "No video?" help explains; right-click → "Show all detected streams" escape hatch in the popup. |
| Variant selection touches the most fragile code (HLS paths) | M3 is last, behind fixture-based ffprobe tests; UI never shows the menu unless discovery succeeded. |
| `snagthis://` registration differs per OS / unsigned dev builds | Banner falls back to `Get the app` + manual instructions after 3s. |
| Playwright-Electron harness currently fails to launch (review) | Fix first in M1.10; until then rely on component tests + manual checklist from the mock-ups. |
| Port drags old problems into the new repo | One commit per module, tests must pass per module, P1 fixes are the first PRs (R0.8), rewrite-not-port for the visible UI. |
| Inherited FetchV code blocks an open-source licence | Provenance audit before licence choice (R0.5); detector/content script are small enough to rewrite clean. |
| Real sites change or block automation, making the matrix noisy | Matrix never gates PRs; fixtures reproduce each technique offline; stage-level results separate "site changed" (S1–S2) from "we regressed" (S5–S7). |
| Header/cookie hand-off leaks credentials | Scope to the media host, keep out of served directories and support bundles, redact in reports (R0.4 API surgery, C3). |
