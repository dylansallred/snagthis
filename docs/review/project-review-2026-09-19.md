**VidSnag project review and product plan — September 19, 2026**

**Recommendation: keep the project and most of the local changes, but do not merge the working tree unchanged or call the current build ready for everyday users.** The workspace has a useful engine and a coherent desktop foundation. The immediate work is to make detection, file ownership, connection security, completion and recovery trustworthy, then simplify the interface.

This review follows your chosen direction: **everyday users, minimal setup, free and open source**. Six agents helped with branch review, engine/API, extension/security, desktop/release, competitors and design concepts. Application source, existing local changes, branches and commits were left unchanged. New review material is under `work/project-review-2026-09-19/`.

**Comparison with the default branch**

There is no `master` branch locally or on the origin queried during this review. The default is `main`. Local HEAD and remote main both point to `268fbd8d5446ed1e4984f54acfd201e2a4bd7c8c`. There are no committed changes on this checkout ahead of main: you are editing main itself.

The initial working tree had 12 modified functional files, 3 modified Finder metadata files, plus untracked `network.ts`, `AGENTS.md` and another Finder metadata file. Keep the local connection normalization and useful media request-context changes with corrections. Drop the broad HTTPS downgrade. Do not merge stale branches wholesale: the redesign and most YouTube work were already squash-merged.

The [change review](/Users/dylanallred/Documents/GitHub/M3u8-Downloader-chrome-plugin/work/project-review-2026-09-19/change-review.md) contains each branch comparison, each change decision, and a proposed split into focused commits. In particular, the new `network.ts` must accompany its tracked importing files.

**What was actually tested**

One smoke-test attempt was run:

```
node work/project-review-2026-09-19/smoke.cjs
```

The test generated a four-second H.264/AAC MP4 and fragmented-MP4 HLS fixture with real FFmpeg. It prepared isolated app data and a local fixture/renderer server, then Playwright's Electron launch failed with **“Process failed to launch!”** under Node 23.11.0.

The actual desktop UI, job creation, download engine, output playback, History and Settings checks were not reached. This is an automation-launch failure with an undiagnosed cause, not proof that the application itself cannot start. No end-to-end success is claimed. No second test, full-suite run, dependency upgrade or repeated verification loop was performed. See the [recorded result](/Users/dylanallred/Documents/GitHub/M3u8-Downloader-chrome-plugin/work/project-review-2026-09-19/smoke-results.json) and [smoke scenario](/Users/dylanallred/Documents/GitHub/M3u8-Downloader-chrome-plugin/work/project-review-2026-09-19/smoke.cjs).

All functional findings below come from source review, not runtime reproduction. Competitors were researched through their official pages; their apps were not tested.

**The project’s end goal**

> VidSnag helps anyone save a supported web video as a complete, playable local file, then find it again—with clear progress and understandable recovery.

The product promise should be: choose the video, choose quality when useful, save it, and know where it went. Saved files remain until the user explicitly removes them. No terminal commands, API keys, account creation or thread settings are necessary for a first download.

The extension should identify and hand off the video. The desktop should own durable downloading, recovery and the library. Keep the existing Electron/React, local API and independent engine architecture. A rewrite or another service layer would add work without resolving the current defects.

**What is already implemented**

| Area | Existing implementation | Practical limit |
|---|---|---|
| Browser capture | MV3 extension, fetch/XHR media signals, badge/list, title editing, preview, desktop handoff | Small manifests, relative URLs, native media detection and stale navigation entries need fixes |
| YouTube | Synthetic page detection, title/channel metadata, yt-dlp job path | Requires working bundled/detected yt-dlp; no broad site-support verification was performed |
| Direct downloads | HTTP(S), redirects, retries, temporary outputs | Not exercised in this smoke attempt |
| HLS | Segment workers, retries, segment diagnostics, concat/remux and an intended advanced FFmpeg path | Advanced output-format defect; encryption/live and URL classification gaps |
| Queue | Persistence, order/rename, pause/resume, cancel/retry, bulk controls, parallel jobs/workers | Finalization ownership and restart-resume semantics are inconsistent |
| Library/history | Thumbnails, search/filter, preview, play/reveal and metadata | Loaded list capped at 200; dangerous deletion semantics; retention surprise |
| Enrichment | TMDB, episode/title inference, Plex naming, SubDL subtitles and embedding | Optional power-user features; should not dominate first run |
| Distribution | Electron installers, updater IPC, GitHub release workflow, bundled tool scripts | Release validation and setup recovery need improvement |
| Maintenance | Logs, diagnostics and support-export backend | Some documented UI was removed; exports need redaction before easy sharing |
| Development | npm workspaces, existing unit/integration/E2E tests, lint/typecheck/build scripts, CI | Current AGENTS says there are no tests and names removed directories |

Useful foundations include job-specific temporary folders, segment completeness checks, direct-output rename, optional metadata failures separated from downloads, protocol versioning and reusable Radix components.

**Findings to address before a public release**

Priority P1 means a significant file-loss, privacy or core-functionality concern. P2 means an important reliability or usability defect. These are review priorities, not measured production incident rates.

| Priority | Finding | Evidence and concrete next change |
|---|---|---|
| P1 | **“Clear History” deletes downloaded media.** There is no confirmation or recoverable Trash action. | [HistoryToolbar:45](/Users/dylanallred/Documents/GitHub/M3u8-Downloader-chrome-plugin/apps/desktop/src/components/history/HistoryToolbar.tsx:45), [history route:359](/Users/dylanallred/Documents/GitHub/M3u8-Downloader-chrome-plugin/packages/downloader-api/src/routes/history.js:359). Separate “Remove from library” from “Move file to Trash”; make bulk file deletion explicit. |
| P1 | **Saved files in the default internal folder are automatically deleted after 14 days.** Paused temporary segments can disappear after 3 hours. | [Retention defaults:5](/Users/dylanallred/Documents/GitHub/M3u8-Downloader-chrome-plugin/packages/downloader-engine/src/config/index.js:5), [cleanup:93](/Users/dylanallred/Documents/GitHub/M3u8-Downloader-chrome-plugin/packages/downloader-engine/src/services/CleanupService.js:93), [completed cleanup:142](/Users/dylanallred/Documents/GitHub/M3u8-Downloader-chrome-plugin/packages/downloader-engine/src/services/CleanupService.js:142). Cleanup runs at startup and hourly. External relocated outputs are outside this cleanup root. Retain completed files by default and consult queue ownership before deleting temporary work. |
| P1 | **The local API has no effective authorization boundary.** It accepts all extension origins, opaque null origins and hostname string prefixes. WebSocket connections bypass those checks. | [HTTP origin checks:216](/Users/dylanallred/Documents/GitHub/M3u8-Downloader-chrome-plugin/packages/downloader-api/src/createApiServer.js:216), [WebSocket setup:1570](/Users/dylanallred/Documents/GitHub/M3u8-Downloader-chrome-plugin/packages/downloader-api/src/createApiServer.js:1570). Add installation-scoped authorization and exact origin/host validation for HTTP and WebSocket. Loopback binding alone is insufficient; actual browser access also depends on browser local-network restrictions. |
| P1 | **Private queue data is inside the public asset directory.** Queue JSON can contain captured authorization headers and signed URLs. | [Static downloads mount:247](/Users/dylanallred/Documents/GitHub/M3u8-Downloader-chrome-plugin/packages/downloader-api/src/createApiServer.js:247), [persisted fields:319](/Users/dylanallred/Documents/GitHub/M3u8-Downloader-chrome-plugin/packages/downloader-engine/src/core/QueueManager.js:319). Move private state outside served assets and use authorized, scoped media routes. |
| P1 | **Uncommitted code retries arbitrary TLS failures over plain HTTP with original headers.** It also logs full URLs. | [PlaylistUtils:119](/Users/dylanallred/Documents/GitHub/M3u8-Downloader-chrome-plugin/packages/downloader-engine/src/core/PlaylistUtils.js:119). Drop this hunk. The narrow correction of an accidental HTTPS scheme on a known loopback API is a separate change worth retaining. |
| P1 | **Small HLS manifests are discarded by detection.** A known response length under 100 KB is rejected even for a playlist. | [media-detector:90](/Users/dylanallred/Documents/GitHub/M3u8-Downloader-chrome-plugin/apps/extension/js/media-detector.js:90). Exempt manifests from the minimum video-file size rule. |
| P1 | **FFmpeg output files end in .part without specifying the MP4 format.** This affects native advanced HLS and compatibility normalization. | [Native output:728](/Users/dylanallred/Documents/GitHub/M3u8-Downloader-chrome-plugin/packages/downloader-engine/src/core/JobProcessor.js:728), [native args:164](/Users/dylanallred/Documents/GitHub/M3u8-Downloader-chrome-plugin/packages/downloader-engine/src/core/HlsNativeDownload.js:164), [normalization output:369](/Users/dylanallred/Documents/GitHub/M3u8-Downloader-chrome-plugin/packages/downloader-engine/src/core/VideoConverter.js:369). Specify the output muxer. Expected format-inference failure is supported by [FFmpeg documentation](https://ffmpeg.org/ffmpeg.html#Main-options), which states output format is inferred from the extension; it was not reproduced here. |
| P1 | **Pause/resume during finalization can launch competing runners for one job.** Finalizing is omitted from active/start/resume guards. | [QueueManager:550](/Users/dylanallred/Documents/GitHub/M3u8-Downloader-chrome-plugin/packages/downloader-engine/src/core/QueueManager.js:550), [pause/resume:669](/Users/dylanallred/Documents/GitHub/M3u8-Downloader-chrome-plugin/packages/downloader-engine/src/core/QueueManager.js:669). Preserve one runner’s ownership until it exits, including conversion; do not release the slot merely because pause was requested. |
| P2 | **Detected HLS type is discarded and dispatch depends on .m3u8 in the URL.** An extensionless manifest is treated as a direct file. | [validated mediaType:1251](/Users/dylanallred/Documents/GitHub/M3u8-Downloader-chrome-plugin/packages/downloader-api/src/createApiServer.js:1251), [handoff:1363](/Users/dylanallred/Documents/GitHub/M3u8-Downloader-chrome-plugin/packages/downloader-api/src/createApiServer.js:1363), [dispatch:587](/Users/dylanallred/Documents/GitHub/M3u8-Downloader-chrome-plugin/packages/downloader-engine/src/core/QueueManager.js:587). Persist a media type and use a shared dispatch decision. |
| P2 | **Restart does not preserve partial HLS progress.** Loading resets the resume flag; the engine then removes old segment storage. Queue writes overwrite JSON directly. | [QueueManager:97](/Users/dylanallred/Documents/GitHub/M3u8-Downloader-chrome-plugin/packages/downloader-engine/src/core/QueueManager.js:97), [save:423](/Users/dylanallred/Documents/GitHub/M3u8-Downloader-chrome-plugin/packages/downloader-engine/src/core/QueueManager.js:423), [JobProcessor:1329](/Users/dylanallred/Documents/GitHub/M3u8-Downloader-chrome-plugin/packages/downloader-engine/src/core/JobProcessor.js:1329). Restore validated checkpoints; serialize and atomically replace the queue file. Queue write corruption is a risk inferred from implementation, not observed here. |
| P2 | **History/search silently covers only the first 200 loaded files.** | [history index:13](/Users/dylanallred/Documents/GitHub/M3u8-Downloader-chrome-plugin/packages/downloader-api/src/services/historyIndex.js:13), [desktop request:52](/Users/dylanallred/Documents/GitHub/M3u8-Downloader-chrome-plugin/apps/desktop/src/lib/api.ts:52). Use the existing pagination contract and search across the full library. |
| P2 | **First run lacks a clear way to download.** The desktop has no Paste Link flow, and an empty queue says no items match the filter. | [QueueView:94](/Users/dylanallred/Documents/GitHub/M3u8-Downloader-chrome-plugin/apps/desktop/src/components/queue/QueueView.tsx:94). Add a first-download empty state, paste-link flow, chosen folder and extension readiness. |
| P2 | **Connection/action failures have incomplete recovery UI.** Compatibility warnings lead to Settings without an explanation; queue actions often do not show errors. API startup precedes window creation. | [SettingsView:20](/Users/dylanallred/Documents/GitHub/M3u8-Downloader-chrome-plugin/apps/desktop/src/components/settings/SettingsView.tsx:20), [useQueue:173](/Users/dylanallred/Documents/GitHub/M3u8-Downloader-chrome-plugin/apps/desktop/src/hooks/useQueue.ts:173), [startup:1181](/Users/dylanallred/Documents/GitHub/M3u8-Downloader-chrome-plugin/apps/desktop/electron/main.js:1181). Render connection state, pending actions and actionable errors; create a recoverable startup shell. |
| P2 | **Support exports can include API keys and raw queue URLs/headers.** Controls are currently absent from the renderer, but IPC remains. | [export:995](/Users/dylanallred/Documents/GitHub/M3u8-Downloader-chrome-plugin/apps/desktop/electron/main.js:995). Redact by default and show export contents before sharing. |
| P2 | **Release artifacts publish before post-build verification.** Stapling failure defaults to a warning and the check targets the app bundle, not the shipped DMG. | [release workflow:64](/Users/dylanallred/Documents/GitHub/M3u8-Downloader-chrome-plugin/.github/workflows/release.yml:64). Stage artifacts, validate exactly what users receive, then publish; reconcile README promises. |

Further bounded improvements belong in the same workstreams: resolve relative fetch/XHR URLs; reset detections on navigation; serialize per-tab storage updates; detect native video resources; stream direct previews instead of loading whole files into a Blob; allow extension focus to recreate a closed macOS window; give settings controls accessible names and thumbnails keyboard actions.

Conventional AES-128 TS HLS is not recognized as an advanced case, and the basic path has no key/IV processing. Basic live playlists are treated as a finite snapshot, not a recording session. DASH-like resources are recognized by the extension but that does not establish a functioning DASH engine. Document these support limits rather than equating detection with download support.

Electron already uses context isolation and disables renderer Node integration. Retain those protections; review sandboxing, navigation guards, external URL schemes and IPC sender validation. No remote-code-execution chain was established in this review.

**The product experience to build**

The recommended path is **Install → Save → Follow progress → Play/find → Recover when needed**.

| Surface | Default experience | Details available when needed |
|---|---|---|
| First launch | “Save your first video,” Paste Link, Connect browser, sensible Videos/VidSnag destination | Change destination and connection troubleshooting |
| Extension | One recognizable video with title, source, available quality and “Save video” | Other captures, audio/language choices, source diagnostics |
| Downloads | Thumbnail/title, “Downloading,” amount/speed/time when known, Pause; “Preparing your video” during finalization | Segment details, codec/container information, technical logs |
| Recovery | Specific cause and next action: expired link → reopen source; connection lost → reconnect; disk full → change destination | Redacted error details; distinguish restarting from genuinely resuming |
| Library | Search, Play, Show in folder, Open source, saved date and missing-file state | Rename and explicit file removal; later simple collections |
| Settings | Destination, quality default, subtitle language, appearance, notifications | Thread counts, external tools, diagnostics and optional metadata integrations |

Keep the orange VidSnag identity and make light/system/dark appearance deliberate. Use legible text, calm spacing, visible keyboard focus, labeled controls, reduced-motion support and one primary action per task. Connection status should come from real readiness/heartbeat information. Hide protocol numbers and loopback ports behind details.

Quality selection must reflect actual discovered formats; do not invent a 1080p choice when unavailable. Estimated sizes and time remaining should say “Unknown” when unavailable. A completion badge should distinguish a merely downloaded file from a file whose expected streams/duration were checked. Verification reduces risk but should not claim perfect playback guarantees.

The design concepts show sample content and proposed behavior, not screenshots of the current app. The desktop concept includes Downloads, Library, Settings, paste-link and recovery interactions. The extension concept demonstrates quality selection, ready/offline state and an acknowledged handoff.

**A phased implementation plan**

These are proposed future release milestones, not additional work performed during this review. Sequence is more useful than calendar estimates until the launch failure and downloader defects are resolved.

| Phase | Work | Proposed release outcome |
|---|---|---|
| 1 — Make existing behavior trustworthy | Safe file retention/deletion; remove HTTP downgrade; authorize local bridge/assets/WebSocket; fix manifest size/type and MP4 muxer; own job runners through finalization; redact exports | A supported save cannot silently delete older files, leak queue credentials through asset serving, or claim a broken conversion succeeded |
| 2 — Deliver the first-download journey | Desktop Paste Link; clear extension install/connect flow; sane output defaults; real format selection; grouped detections; explicit startup/errors; packaged tool checks | A new user can install, save a supported video and open the resulting file without a terminal or external API account |
| 3 — Make daily use polished | Downloads/Library/Settings redesign; full-library search/pagination; keyboard/accessibility; missing-file states; notification and theme settings; validate-then-publish releases | Users understand progress, find saved videos and control their files consistently |
| 4 — Make recovery and convenience distinctive | Restore validated progress across restart; safe source refresh for expired links; duplicate warnings; multi-link paste; optional quality/subtitle presets | Common interruptions have a clear path forward, with completed work reused only when source identity still matches |

Implementation should preserve module boundaries but consolidate duplicated job construction. Add shared types for source identity, media kind, discovered formats, selected tracks, output policy and error codes. Use one lifecycle across engine/API/UI. Keep queue JSON initially: serialized atomic writes and a validated checkpoint are sufficient; a database, extra caching layer or microservices are not a prerequisite.

Prioritize reproducible fixtures in the existing test infrastructure when implementing: an actual short media file makes a stronger check than asserting FFmpeg argument strings or using an arbitrary byte buffer named .mp4. The first follow-up validation should resolve the Electron launch harness and exercise one real save-to-playback path. Broader release checks belong to the future implementation/CI workflow, not repeated tests in this review.

For an open-source release, add a clear repository license after reviewing inherited code provenance and bundled dependencies, third-party notices, contributor/setup instructions, privacy documentation and a support template that does not request raw credentials. There is no top-level license/contribution/privacy/security document in the reviewed tree. There are also **604 tracked node_modules paths and 24 tracked .DS_Store files** despite ignore rules; remove those from future tracked source in a dedicated housekeeping change. Update AGENTS and README to the current workspace and actual UI. No history rewrite is proposed here.

**Competitors and what to learn from them**

Official product pages were reviewed on September 19, 2026. The table describes documented capabilities, not a hands-on performance comparison. Pricing categories are included only to explain the market; no exact price is needed for the free/open-source direction.

| Product | Relevant offering | Lesson for VidSnag |
|---|---|---|
| [Video DownloadHelper](https://downloadhelper.net/) | Browser video/audio capture, including HLS/DASH; free and premium options. Current homepage says no external software required. | Do not assume its old companion-app setup is still the main competitive weakness. Browser simplicity is expected. |
| [Downie](https://software.charliemonroe.net/downie/) | Paid macOS app with browser handoff, guided extraction and postprocessing | Strong reference for focused native desktop UX; browser handoff is already established |
| [4K Video Downloader+](https://www.4kdownload.com/products/videodownloader-42) | Multi-platform app with playlists/channels, subtitles, quality presets and automatic channel downloads; free limits and paid plans | Quality presets and batching are useful but not unique |
| [JDownloader](https://jdownloader.org/download/index) | Free cross-platform download manager with broad download-management scope | Avoid broadening VidSnag into a general manager before the video journey works |
| [yt-dlp](https://github.com/yt-dlp/yt-dlp) | Open-source CLI with extensive site extraction, format selection, subtitles and automation | Use its mature extraction ecosystem where appropriate; make it accessible through a clear UI |
| [FetchV](https://fetchv.net/) | Browser-local HLS/direct capture, preview, resolution selection and recording features, also documented in its [Chrome listing](https://chromewebstore.google.com/detail/fetchv-video-downloader-f/nfmmmhanepmpifddlkkmihkalkoekpfd) | The closest baseline for this project. Local processing and HLS alone do not distinguish VidSnag. |

The strongest initial positioning is **“Free, open-source video saving that you can understand and trust.”** Make the supporting evidence visible: a recognizable source, clear supported-format choices, a verified output where possible, reliable resume and a library that respects user files.

Reliable recovery could become the signature feature: “This link expired; reopen the page to refresh it” is much more useful than repeated generic failures. Remember source URL and selected tracks, and preserve reusable work without treating a new URL as automatically equivalent. This is an opportunity to execute well, not a proven feature exclusive to VidSnag.

Keep optional Plex/TMDB tools under Advanced. Defer cloud sync, AI editing, social features, channel subscriptions, general file downloads and a universal “download anything” promise. For this audience, the next product improvement is a dependable first save and understandable recovery, followed by a small useful library.

