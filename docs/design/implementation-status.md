# Implementation and evidence — 2026-09-19

The approved **Workbench, simplified** interface is implemented in the new VidSnag repository. The owner selected **GPL-3.0-only**. The predecessor repository and its uncommitted files were preserved.

**Visual direction accepted, 2026-09-19:** after reviewing the implementation previews, the owner confirmed, “Yes, keep this direction.” Keep the current dark desktop and extension design as the baseline for further work.

## What changed

- Desktop: one searchable, paginated library; paste multiple links; real quality choices; aggregate Pieces progress beneath active rows, matching the extension; one visible row action; inline details; keyboard navigation; five simple settings with Advanced.
- Chrome: rewritten popup and page detector; real posters and quality discovery; background-owned submission; live pause/resume/saved status; pairing, offline recovery, preview and source refresh.
- Safety and reliability: installation pairing and authenticated HTTP/WebSocket access; private queue persistence; scoped request credentials; explicit MP4 muxing; pause/finalization ownership fixes; saved files are never deleted by age. Removing a saved entry keeps the file unless the user explicitly chooses OS Trash.
- Media: direct MP4, TS/fMP4 HLS, AES-128, selected quality, separate audio/subtitles, audio-only output, early thumbnails and bounded compatibility probes. DRM and live recording are declined clearly.
- Project: clean module-by-module port, current contributor/privacy/security documentation, dependency updates, shared display contracts, CI, compatibility reporting and gated release tooling.

## Verification

Checks were coordinated locally using Node 22.23.2. Concrete failures were corrected and only affected checks rerun. The table records the initial implementation gate; later focused checks and pending runtime work are recorded in the dated follow-ups below.

| Check | Result |
| --- | --- |
| ESLint, desktop TypeScript, production builds, desktop/extension token parity | Passed |
| Shared display/parser/title tests, preferences, engine and API integration suites | Passed after targeted corrections |
| Generated real-media suite | All 17 scenarios passed; output checked with FFprobe, including selected 480p/audio/subtitles and AES-128 |
| Browser/Electron e2e | All 7 scenarios passed across the initial run and targeted fixes |
| Real desktop lifecycle | Paste → pause/resume → playable file → restart → remove from list while retaining file |
| Full extension/desktop loop | Actual pairing → detection → 480p choice → real saved file with verified audio and duration |
| Local browser compatibility | 14/14 embedding scenarios passed through S7 |
| Public compatibility seeds | 15/15 selected public test streams passed through S7 |
| Actual preview media | Local eight-second Blender film clips load in both development previews |

The [implementation PR](https://github.com/dylansallred/vidsnag/pull/1) requires the Linux, macOS and Windows `verify` checks. Each runs the unit/integration/media suite and production builds; Linux also runs all seven browser/Electron scenarios. The PR shows the current result for its exact commit.

See [the compatibility matrix](../../compat/COMPATIBILITY.md). These are selected Mux and Apple test streams, not fifteen independent consumer websites. Direct-stream seeds run in a local player. This evidence does not establish universal site compatibility, full-length download reliability or successful DRM downloads. S8 full downloads were not requested by the compatibility run.

## Try the implementation

Run the commands in [README](../../README.md). With the renderer dev server running:

- `http://127.0.0.1:5173/?gallery=1` — representative desktop rows; Saved → Play opens a real clip.
- `?gallery=states` — all desktop states.
- `?gallery=empty` — first launch.
- `?gallery=1&details=1` and `?gallery=1&sheet=settings` — details and settings.

Serve `apps/extension` locally and open `popup.html?demo=default`. Other demo values: `states`, `quality`, `empty`, `offline`, `settings`, `problem`, `version`. In `states`, Saved → Play opens the matching local film excerpt. These demonstrations do not submit downloads or change desktop preferences.

## Remaining release work and explicit departures

- **Latest runtime loading:** loading the newest backend/extension fixes into the owner's running instances remains pending root coordination. The desktop Pieces renderer change hot-loads; its passed gallery check does not establish that the newest backend or extension worker is already running. The pasted-link desktop integration check is also pending at this documentation update.
- **M4:** the owner has accepted the visual direction. Three to five actual people must still complete the [field check](field-check.md). The conditional thumbnail-line/quality-border fallbacks remain pending that evidence.
- **Recovery:** refreshed links can be attached through “Continue previous download” or desktop Details. The implementation does not automatically attach a new detection merely because a page reopened; ambiguous matches require user choice and the engine checks playlist compatibility before reusing pieces.
- **Direct-file resume:** pausing is supported, but resuming a direct file currently restarts its transfer. HLS resume retains compatible downloaded segments. Byte-range continuation for direct files remains follow-up work.
- **Site reports:** the prefilled issue form contains redacted aggregate diagnostics. S1–S7 prompts are explicitly “not checked” unless supplied by a compatibility run; the app does not yet retain measured per-site stage traces.
- **Test tooling:** component behavior is tested in the actual Playwright gallery with shared-model unit coverage, rather than introducing an additional Vitest/Testing Library stack. Screenshots were reviewed locally; cross-machine pixel-diff baselines are not established.
- **Release artifacts:** signed/notarized macOS and signed Windows installers, bundled-tool checks and installed-artifact smoke tests must pass release CI. Local Electron success does not substitute for them. Signing credentials and a reviewed corresponding-source archive for bundled GPL tools must be provided before publication.
- **GitHub administration:** the private successor and draft PR #1 are created. `main` requires a PR and passing Linux, macOS and Windows CI checks. GitHub rejected required-reviewer protection for the private approval environment because the current billing plan does not support it; configure `compatibility-review` and `release-approval` on a supported plan or when the repository becomes public. Publication fails closed without approved environments and a matching source artifact.
- **Publication:** no public desktop release, Chrome Web Store listing or old-repository archival has been performed. Keep the original available until the successor is accepted.

## Change-review decision

Keep the corrected connection normalization and request-context work in the successor. Drop the HTTPS-to-HTTP downgrade, tracked dependency/build output and stale legacy instructions. Do not merge old branches or the predecessor's entire dirty tree wholesale. See [the original change review](../review/change-review-2026-09-19.md) and [project review](../review/project-review-2026-09-19.md).

## Site fixes and owner field check — 2026-09-19

This batch addresses problems found while using the real desktop app and Chrome extension:

- Native HLS input accepts media segments disguised with `.jpg` filenames. Piece progress comes from actual proxy requests; Details shows the resulting progress, ETA and full-width piece map, and distinguishes unavailable piece counts from measured progress.
- Cancelling failed, paused or waiting jobs now persists the cancelled state and removes the row from view. Undo remains available; cancelling cannot delete a saved file.
- Quality choices filter out manifest components that are not video variants. Titles use fresh metadata from the matching source page. After reloading the extension, the owner confirmed the live Cinejoy popup shows **Thor: Love and Thunder** with only the real **1080p and 720p** choices.
- YouTube auxiliary audio detections resolve to the canonical video URL. Authentication recovery offers an explicit **Use Chrome sign-in** action for one attempt; permission is neither automatic nor persisted.
- YouTube extraction explicitly uses the existing Node/Electron JavaScript runtime. Its FFmpeg child receives a temporary bundle of Node's trusted certificates when no custom trust store is configured; certificate verification remains enabled and the temporary file is removed afterward.
- Reloaded extension contexts retire their old content-script observers, timers and listeners. Synchronous message errors and asynchronous invalidation are handled without repeated uncaught exceptions.

One full-length owner-selected Cinejoy HLS download completed: job `mu8uu891-b7o5jy`, **5,137,662,212 bytes**. FFprobe reported **1920×1080 H.264 video, AAC audio and 7,123.872333 seconds**. The root agent opened the saved file through VidSnag's real **Play** action, which launched QuickTime, and observed playback at **1:03:01** with an actual Thor frame. This records one completed download and an observed playback sample.

All **75 focused cases passed across the initial run and the affected-test rerun**. The initial run passed 74/75; the remaining failure was test teardown racing Undo's pending queue write. After waiting for that required write, the cancellation test passed. Desktop TypeScript and ESLint also passed. Local evidence: [initial focused run](../../work/verification/site-fixes-final.log), [cancellation rerun](../../work/verification/cancel-fix-rerun.log), [static checks](../../work/verification/site-fixes-static.log).

A second live movie job, `mu8vow3b-7bjv0m`, completed under the corrected title with all **1,781 of 1,781** pieces measured complete. At 85% it reported 1,517 completed pieces and a 51-second ETA. The live gallery also confirmed that the piece canvas spans the full width beneath the details.

The exact age-restricted YouTube video `B0_13LSguRc` passed an explicit Chrome-session retry through an isolated instance of the production API. It saved a **30.03-second, 1920×1080 AV1 + AAC MP4**, 4,195,235 bytes. FFprobe checked the streams and duration, and FFmpeg decoded the complete sample's video and audio without errors. This is a bounded download check, not a full-length YouTube download. Local evidence: `work/verification/youtube-live-check.json` and `youtube-final-check.log`. All 11 affected engine cases and two extension lifecycle cases passed, with ESLint passing for those changes. The roadmap's separate 3–5 person usability check remains open.

### YouTube recovery follow-up

The owner's next ordinary download still failed the age check because it began without Chrome sign-in. The successful sample above had explicitly requested sign-in, while the desktop recovery action was buried in Details and the extension provided no route to it. Authentication failures for YouTube now show **Use Chrome sign-in** as the desktop row's primary action. The existing per-download confirmation remains required. The extension's Details explains the recovery and offers **Open VidSnag**. Bare “YouTube” metadata also no longer overrides an available actual video title.

All 14 focused row-model/title cases, desktop TypeScript and scoped ESLint passed in `work/verification/youtube-recovery-ui.log`. A native desktop screenshot confirmed the new primary action. Native automation rejected clicks with `noWindowsAvailable`, so the owner-authorized retry of the actual failed job `mu8wsfqm-6wux7w` was started through the running desktop's authenticated recovery API. It passed the age check and transferred more than 315 MB without an authentication error; the full download remains in progress. This is not a claim that the native confirmation click or a complete full-length YouTube file was verified. The concurrent Spider-Man download was preserved. Current sanitized live evidence is in `work/verification/youtube-actual-job.json`.


### Stable ETA, native retries and video previews

The owner confirmed the YouTube recovery works. The actual full job `mu8wsfqm-6wux7w` completed with **4,152,012,752 bytes**, **3840×2160 AV1 video and AAC audio**, and **6,090.176145 seconds**. These values came from FFprobe on the completed file, rather than the earlier bounded sample. Local evidence: `work/verification/youtube-full-download.json`.

The Spider-Man 4K job exposed a separate native-HLS flaw: ordinary pieces had up to 30 attempts, but FFmpeg's native path skipped failed opens without retries. Its “retrying” squares did not mean a retry was scheduled. Native HLS now uses a bounded disk spool and configured parallel workers; delayed retries release workers for other pieces. The limit remains 30 total attempts, with 0.5–8 second backoff, while expired credentials stop promptly. Full-VOD finalization requires delivery of every selected primary/audio/subtitle URI or byte range. A native partial output containing skipped pieces cannot be reused safely.

ETA now uses a time-based rate average instead of directly displaying each instantaneous estimate. Download stages reset their rate history. At this stage, the owner selected **A+B: Leading edge + Soft sweep** for both desktop and popup row backgrounds, moved duration beside the title, and rejected text overlays on the video. This initial revision waited for local clips; the subsequent owner revision below allows independent source previews in the extension. Reduced motion retained the poster and static row fill. The later Pieces selection supersedes this animation treatment on both surfaces.

The coordinated run passed **76 of 77** cases initially. The remaining preview fixture placed its poster outside the managed downloads directory; moving that fixture asset into the supported location made the targeted preview test pass without weakening its assertions. All **77 cases** therefore passed across the initial run and targeted rerun. The tests cover deferred native-piece recovery producing a complete real MP4, permanent gaps and expired credentials refusing a saved file, bounded spool cleanup, and real ten-second H.264 previews with authenticated generation and signed range playback. TypeScript, ESLint and all **five affected desktop/extension browser scenarios** passed, including actual looping playback, keyboard focus, pause/blur cleanup and reduced motion. Evidence: `work/verification/progress-preview-native.log`, `preview-clip-rerun.log`, and `progress-preview-ui.log`.

### Independent previews, useful posters and desktop refinement

The owner's later field feedback requested previews in the extension before a desktop job exists, representative scenes beyond intros, visible connection usage, stronger row glow, and simpler desktop menus/details.

- Desktop HLS previews now use already-fetched playable pieces before completion. Black scenes are rejected; the collector keeps trying newer footage. Saved-file previews sample around 35%, then other positions if needed. Available local direct/yt-dlp partial files can also supply a preview; unplayable partial containers keep their poster until usable footage exists.
- The extension can preview an observed HLS source while the desktop is offline, using bounded low-quality requests and representative scene selection. Small complete direct files are supported; large partial direct files keep their poster when safe seeking is unavailable. The generated frame replaces generic site artwork. Ready desktop clips remain reusable.
- YouTube previews locally record the already-playing page video: a short initial loop is replaced by a silent excerpt of up to ten seconds. They retain YouTube artwork and do not seek or start the page player. Paused or uncapturable videos retain the poster; this path does not promise a 35% scene because it preserves the viewer's position.
- Relative signed poster URLs resolve against the desktop service. Cancelled/stale extension job mappings no longer hide a detected row or prevent a fresh submission.
- Cancelling an external media process waits for actual exit and escalates if it ignores termination. Shared cleanup promises prevent queue slots being released before cleanup finishes. Native requests expose measured active connections; external downloaders that do not expose this number say so instead of displaying their configured limit as a measurement.
- Desktop menus are borderless with a soft shadow; mouse clicks no longer leave focus outlines. Keyboard focus remains visible. Details use compact facts, a concise folder location and an expandable technical section. Saved rows have a check badge. The header now includes the VidSnag name without the redundant native-titlebar inset.
- This intermediate revision used a brighter warm fill, glowing progress edge and moving highlight on both interfaces. It was later superseded by Pieces; the unchanged thumbnail rule keeps video clear. The extension settings icon uses the same correctly proportioned Lucide gear as the desktop.

The real desktop was restarted only after the queue became idle. Both existing saved movies—Spider-Man job `mu8y62ql-q53vsw` and Thor job `mu8vow3b-7bjv0m`—then regenerated their posters and ten-second preview assets. Both resulting posters were visually inspected and show actual nonblack movie scenes. A native desktop screenshot confirmed the repaired artwork, Saved badges, wordmark and active row glow. The desktop menu/details were also opened and visually inspected in the browser gallery. Evidence: `work/verification/saved-preview-repair.json`.

Focused media checks passed: early preview during an unfinished real HLS download, 22 media scenarios, saved-preview black-scene selection, three process-termination cases and three measured-connection cases. The preview test verifies an actual silent ten-second H.264 clip rather than just file existence. TypeScript, ESLint and all 19 affected extension unit cases passed. All four affected browser scenarios passed across the initial run and targeted corrections: desktop gallery, popup download/pause/saved lifecycle, offline YouTube capture, and independent direct/HLS previews including a long black intro. The last case exposed reverse-seek ordering and bounded-excerpt loop handling; both were corrected without enlarging the preview network budget. Evidence: `work/verification/early-preview-focused.log`, `media-fixtures-focused.log`, `process-termination-isolated.log`, `transfer-metrics-isolated.log`, `final-preview-static.log`, `final-preview-ui.log`, and `final-extension-retest.log`.

After the owner's final extension reload, the actual Chrome popup showed a real Reacher frame and the corrected settings gear. Further desktop feedback restored the Pieces map outside Technical details, added a four-state legend, changed Copy link/Open page/Cancel/Remove to accessible icon buttons, and gave the expanded surfaces clearer contrast. Size now uses downloaded / total followed by speed, with an explicit unknown-total fallback. The single affected desktop gallery case passed after these revisions.

### Native connection limit and total-size follow-up

The owner's Reacher download exposed an artificial three-to-four-request ceiling despite a configured limit of sixteen. A bounded response-header check confirmed that the source sends chunked responses without Content-Length. The native spool previously reserved the full 128 MiB maximum for every unknown-size piece against its 512 MiB overall limit.

Reservations now start at 64 KiB and grow before bytes are written. Followers wait under storage pressure while the earliest unfinished piece retains enough capacity to finish; a missing head also retains a worker for its retry. The 512 MiB overall and 128 MiB per-piece limits are unchanged. Sixteen is still a ceiling, not a promise that every source or moment uses all workers.

Native total size is estimated from actual output bytes and processed video duration after an initial sample, then replaced with the exact final file size on completion. The known-versus-estimated flag survives queue persistence and is included in queue/job updates. This supplies `downloaded / ~total · speed` without presenting an estimate as exact.

All **22 focused native scheduling/progress cases passed**, including sixteen overlapping unknown-length requests, bounded growth, retry progress under pressure, cancellation cleanup and oversized-piece rejection. The affected queue persistence/DTO case also passed, as did the revised desktop gallery case. Evidence: `work/verification/native-concurrency-total.log` and `size-dto-focused.log`. The desktop was restarted after the Reacher transfer completed and the queue was confirmed idle; the updated backend is loaded for subsequent transfers.

### Left-aligned details and readable folders

The expanded desktop panel now aligns its facts, location, icon actions and Technical details to the same left inset. Open folder joins Copy link, Open page and Remove in the compact icon group; it no longer occupies a labelled button on the far right. The affected browser gallery check passed and its saved-details screenshot was visually reviewed. Evidence: `work/verification/details-alignment.log`.

Both job-creation APIs now reserve readable video-title folders with atomic ` (2)`, ` (3)` collision suffixes. New folders can adopt a title resolved during downloading when the file completes; existing legacy folders are preserved. Explicit directory ownership keeps cancellation cleanup restricted to the job's own folder. The focused API/lifecycle check passed, covering both allocation routes, collisions, safe names, completed relocation, custom save destinations, and resume/remove cleanup. Evidence: `work/verification/job-storage-focused.log`. The idle desktop was restarted to load the change.

The popup's Download action is now an orange icon button with an accessible label and tooltip. Duration moved from the title heading to the quality/size metadata line. The extension CSS build and single affected download/pause/saved browser case passed; evidence: `work/verification/popup-controls-update.log`.

The intermittent duplicate Cinejoy rows exposed missing manifest bodies and navigation races. The page detector now reads bounded HLS bodies already received as ArrayBuffer/Blob or under a misleading image content type. Page/document identity guards reject delayed observations from a previous visit without clearing valid metadata when content arrives before a navigation commit. The single focused regression in `tests/extension-discovery-race.test.js` passed: late master/child bodies consolidate the Thor detection into one 1080p, 7,123-second movie, remove its exact `0.mp4` initialization file, and preserve an unrelated small video.

### Larger popup previews and further motion studies

The popup now uses 144 × 81 thumbnails in taller 106px rows. Quality, size, and duration use visible vertical dividers; missing values do not leave orphan separators. The focused popup browser case passed. Evidence: `work/verification/popup-thumbnail-layout.log`.

The desktop's stray saved `0.mp4` row was a copied initialization fragment in an internal `local-preview-*` folder. Library scanning now excludes those scratch folders at every depth and removes their mistaken history records without deleting files or hiding legitimate small videos. A focused real-media regression passed, and the idle desktop was restarted to load the fix. Evidence: `tests/history-preview-artifacts.test.js`.

Four interactive alternatives are available at `docs/design/prototypes/extension-motion/`: Signal, Pieces, Current, and Shelf. The comparison page shares progress/state/effects controls and uses actual Blender open-film hover excerpts. Its coordinated browser check passed for all four designs, including real video playback and pause, progress changes, saved/paused states, and popup-width layout. Evidence: `work/verification/extension-motion-check.log`. The owner selected Pieces, first applied to production extension rows: 40 aggregate progress cells below the row content, settled completed cells and a gentle active pulse. Paused/reduced-motion indicators stay still; detected/queued/saved rows hide the lane. The CSS build and single actual-popup download/pause/saved lifecycle case passed. Desktop initially retained A+B; the subsequent owner request and verified desktop change are recorded below.

Independent hover playback on the exact Thor source exposed a missing request context: its media host returned 404 for fragments without the captured Origin. The popup now opens a short-lived worker session that restores only that Origin for this extension's GET/XHR requests to the exact media origin. Rules are removed on hover exit or popup closure, and stale sessions expire. This requires `declarativeNetRequestWithHostAccess` and a full extension reload. The bounded real-source check passed with actual muted middle-scene looping, ten successful media requests, zero failed media requests, zero API writes or jobs created, and cleanup verified on exit and closure. Evidence: `work/verification/source-origin-preview.log`.

### Toast, pause-percentage and menu-position corrections

Normal desktop notifications referenced obsolete, undefined theme variables, leaving their background and Undo button transparent. The shared toaster now uses the actual dark tokens, a compact raised surface, and an offset above the footer. The focused cancellation/Undo browser check passed and the renderer hot-loaded the change. Evidence: `work/verification/cancel-toast-check.log`.

FFmpeg emits `progress=end` when interrupted as well as when finished. Native progress no longer interprets that marker alone as 99%; measured output time stays authoritative. A real FFmpeg interruption regression passed, including playable-partial validation and correct paused text/fill. Evidence: `work/verification/native-pause-progress.log`. A fresh queue check found two active downloads; the owner explicitly selected Restart now. The desktop was then restarted cleanly to load the fix, and API health/queue restoration were confirmed.

The extension quality menu no longer increases the popup's minimum height. It overlays the current bounds, scrolls internally when needed, and focuses without scrolling the page. One actual-extension browser case passed, checking stable popup/body/row/thumbnail/title/metadata/footer bounds and a working 720p selection. Closing and reopening the popup loads this popup-only change.

### Matching Pieces, pasted-page resolution and popup recovery

The owner extended the selected **Pieces** direction to desktop. Both surfaces now use 40 cells representing aggregate download progress, settled muted-green completed cells and a gentle 1.9-second amber pulse on the current cell. The desktop's 7px lane spans the row beneath the thumbnail, text and actions, bringing active rows to approximately 98px while keeping waiting and saved rows compact. Paused/problem and reduced-motion indicators remain still. This replaces the earlier A+B background wash and glowing edge. Real hover/focus previews, duration, Saved badges and the detailed `SegmentHeatmap` remain intact.

The single existing **approved Workbench component gallery** case passed once in **4.5 seconds**. It checked 820px and 640px layouts, cell counts derived from actual aggregate progress, paused/reduced-motion states, accessible percentage text, actual moving video previews, saved details, and the separate piece-map canvas. Evidence: the updated case in [desktop-updater.spec.js](../../tests/e2e/desktop-updater.spec.js). The renderer change applies through HMR; no desktop restart was performed for it.

Pasted-page inspection now resolves the video's title and playable media choices before submission, so the quality choice and eventual job can carry the real title and source-page identity. A bounded check of the owner's exact Cinejoy page resolved **Thor: Love and Thunder** and its real **1080p / 720p** variants in **8.1 seconds**, with **no job created**. This is a page-resolution check, not another full movie download. Evidence: [media-page-resolver.log](../../work/verification/media-page-resolver.log). The desktop browser → real API → queued-job check also passed, preserving the title, resolved source URL, selected 720p variant and observed request headers; an unsupported page displays guidance without creating a job. Evidence: [desktop-paste.test.js](../../tests/desktop-paste.test.js) and [desktop-paste.log](../../work/verification/desktop-paste.log). Public bridge responses continue to omit request headers; only authenticated desktop inspection returns sanitized request context for submission.

The extension re-download failure came from looking up an existing mapped job through `GET /api/jobs/:id`, which rejects extension clients with 403. The lookup now uses the authorized `GET /v1/queue` response and finds the mapped ID there. A missing or cancelled job permits a fresh submission; a valid existing job remains reusable. Focused coverage is in [extension-redownload.test.js](../../tests/extension-redownload.test.js).

Non-YouTube generic Open Graph artwork is rejected as a video-poster fallback. A usable frame obtained from actual hover playback is retained with the detection in `chrome.storage.session`, allowing the popup to reopen with that verified video frame. Supplied YouTube artwork remains preserved. The focused poster-persistence check passed; evidence: [popup-poster-persistence.log](../../work/verification/popup-poster-persistence.log).

The owner confirmed the extension reload and Cinejoy page refresh. With no active downloads, the desktop restarted cleanly to load pasted-page resolution and title propagation; API health returned successfully and all 18 retained queue entries remained present. Evidence: `work/verification/desktop-paste-update.log`. The popup now prepares missing visible posters automatically on open, one bounded hidden frame extraction at a time, without playing the probe. The same real HLS case passed for a nonblack frame at 35%, no-hover preparation, prompt cleanup, session persistence, later hover playback and stable quality-menu selection. Evidence: `work/verification/popup-automatic-poster.log`. These popup-only changes load on close/reopen. The quality control has a distinct dark fill and orange chevron; its negative left margin has been removed to keep both 6px side paddings and rounded corners visible. One 400px browser check passed with quality, 5.1 GB and duration all fitting, unchanged bounds on menu open, and working 720p selection. Evidence: `work/verification/quality-padding.log` and `work/verification/quality-padding-balanced.png`. Closing and reopening the popup loads the rebuilt CSS.

A real pasted Cinejoy attempt then exposed an unavailable-subtitle selection: the owner’s English preference was forwarded even though this HLS manifest had no subtitle rendition. Desktop default selection now requests that language only when it is offered. The affected browser-to-API check passed with English preferences and an HLS manifest without subtitles; selection becomes `none`. The exact Cinejoy link then passed private inspection → authenticated job creation → real partial download with subtitles `none`: 17,039,408 bytes, 19 of 1,781 pieces, and positive measured progress. The isolated test cancelled the download and removed its temporary queue, window and files; evidence: `work/verification/cinejoy-paste-partial-download.log`. The owner’s failed attempt had since been cancelled, so it was left stopped rather than restarted. New pasted attempts use the corrected selection through the already-loaded renderer.

### Expanded folder section and three layout studies

The full download directory now appears directly in Saving to / Saved in, wrapping within one clickable button. Pointer hover highlights it; clicking or keyboard activation opens the known folder. Full path is no longer repeated in Technical details, and the section disappears when no filename or raw error remains. The redundant saved-folder icon is removed. Electron resolves a history or job identity to a known existing directory; renderer-provided paths are not accepted.

Three interactive options are available at [expanded-details](prototypes/expanded-details/index.html): Streamlined (compact), Grouped (roomier sections), and Pieces first (activity first). They share real Sintel hover video, progress/state controls, simulated folder/action feedback, and full-width Pieces. They are design alternatives awaiting the owner’s choice, not three different production layouts.

One coordinated check passed for the real isolated Electron location button/IPC route (including hover, click, Enter, complete visible path and rejection of arbitrary paths), all three browser prototypes, 640px wrapping, real video playback, saved/paused states and gallery tabs. Evidence: `tests/expanded-details.test.js`, `work/verification/expanded-details.log`, and screenshots in `work/verification/expanded-details/`. The owner’s downloads were idle, so the desktop was restarted to load the folder IPC update.

The owner selected **A · Streamlined**. Production expanded rows now use its compact facts with grouped actions on the right, a full-width dark folder band with a chevron and stacked label/path, and the existing full-width piece map. Narrow windows wrap facts to two columns and keep complete paths visible. The affected Workbench browser case passed at 820px and 640px, including action placement, folder wrapping, real previews, reduced motion and saved/error states. Evidence: `work/verification/streamlined-desktop.log`. The renderer applies this change through hot reload; no download restart was needed.

The Streamlined fidelity correction removes Technical details entirely from active and saved rows. Raw failure diagnostics remain inline only when present. The panel now follows A’s insets, fact columns, text colors, icon sizes and responsive spacing, while retaining genuine piece telemetry. The single affected gallery check passed, including saved and error states; its corrected screenshot was visually reviewed. Evidence: `work/verification/streamlined-no-technical.log`. The renderer applies these changes without restarting downloads.

The desktop and popup headers now use the original `vidsnag-logo-title.png` artwork instead of recreating the brand with a separate icon and text. The popup keeps its video count independently right-aligned; its header and footer have distinct dark surfaces and soft inward shadows, with visible footer hover feedback. No worker or backend change is required.

The single coordinated branding browser check passed: both original artwork images decode, the desktop fits at 640px, popup count and sections do not overlap, and Settings/No video? controls open correctly. Both screenshots were visually reviewed. Evidence: `work/verification/header-branding.log`, `desktop-full-logo.png`, and `extension-full-logo-sections.png`. Desktop updates through hot reload; closing and reopening the popup loads the extension HTML/CSS changes.

### Matching darker chrome and row hover

Both desktop and extension now use charcoal header/footer surfaces (`#0c0e11`), lighter video rows (`#171a1f`), and the same hover surface (`#1c2026`). Hover fades in a warm left-side wash and expands a slim amber edge accent behind the row content. The thumbnails remain unobscured, Pieces keeps its existing progress behavior, and reduced motion disables the new transitions.

One coordinated browser check passed for both surfaces: identical rendered colors/effects, stable row and thumbnail positions, real hover-preview playback, cleared hover on leave, and reduced-motion behavior. Both screenshots were visually reviewed. Evidence: `work/verification/matched-surfaces.log`, `desktop-warm-hover.png`, and `extension-warm-hover.png`. Desktop applies through hot reload; close and reopen the extension popup to load its rebuilt CSS.

### UI refresh: A · Refined

The owner chose A · Refined from `docs/design/prototypes/ui-refresh/`. This supersedes the 144 × 81 popup thumbnail and vertical dividers above: the popup now uses 128 × 72 thumbnails in 96px rows, a two-line title and dot separators. Desktop saved rows show a plain green check and the quality; the Pieces map uses the row lane's palette; an open row has a slim orange edge; folder paths use `~` and emphasise the final folder; the empty paste field shows a paste-shortcut hint. Lint, desktop typecheck, build, token check and the desktop-gallery and extension-bridge browser specs passed.

Row hover: after three prototype rounds the owner chose Focus mono. Both apps now dim other rows to 45% greyscale and give the active row a solid orange edge, replacing the warm wash and glowing edge. The desktop-gallery and extension-bridge browser specs passed, and hover was checked by screenshot on both real surfaces.

Edge follow-up: the 2px open-row edge and 3px hover edge stacked visibly on a hovered open row. The owner chose Grey when open with the Grow animation from `prototypes/ui-refresh/edge.html`: desktop now draws one 3px edge per item (grey while open, orange while active) and both apps grow the edge from its middle with a 300ms dim.

Surfaces: the owner chose Lines, Steel · Dark and Orange line bars from `prototypes/ui-refresh/surface.html`. Both apps now share the hue-215 token set, visible row dividers on one flat surface, and shadowless bars with an orange fading line under the header. Lint, typecheck, build, token check and the desktop-gallery and extension-bridge browser specs passed twice.

The owner then moved the palette one step darker to Steel · Very dark (8% row lightness); every surface token shifted by the same 1.5%.

Progress motion: the owner chose Spark from `prototypes/ui-refresh/studies.html`. Both apps fill the current Pieces cell with real progress and flash each newly finished cell once; sparks are skipped on mount, on jumps of more than three cells, when paused and under reduced motion.

Download button: the owner chose Outline + breathing glow. The popup Download icon button is now outlined with a breathing glow and fills on hover or focus; size, label, tooltip and the press spinner are unchanged.

Expanded section: the owner chose the inspector card with the orange Instrument chart and Ceiling + halo. Desktop details now render a folder-header card with facts, a live in-memory speed backdrop for downloads that report speed, the Pieces map and labelled footer actions. The desktop gallery spec was updated to assert the card structure (header, facts, footer order; labelled actions; chart present only for the live download) in place of the Streamlined geometry.

Owner picks applied: the popup Download hover uses the Liquid fill (fixes the square rising edge); the desktop card shows Connection dots with the speed and no peak; user-facing "Pieces" is renamed **Segments** in the desktop details label, unavailable message, legend label and map tooltips.

Motion: details now open and close with the owner-selected Drawer slide (kept mounted until the close finishes), and the list tabs use Follow hover (pointer-chasing highlight, sliding orange selection line). Title fix: the popup no longer appends `S04E09` when the page title already names the same episode with separators such as `S4:E9`; covered by a new title-inference test.

Metadata, 2026-09-20: the owner selected **Solid badge**, **Inset tiles**, and **Quality first** from `prototypes/ui-refresh/metadata.html`. Desktop details use inset fact tiles; desktop and extension quality labels share tier formatting and silver badges alongside exact resolution, with quality-first saved metadata. Extension duration stays outside the thumbnail. Synced the extension's generated shared module and rebuilt CSS, resolving the intermediate `rows.formatQualityBadge is not a function` error. Desktop typecheck and the focused desktop/extension browser case passed; evidence: `work/verification/selected-metadata/`. The global personal `design-variations` skill was created and passed its skill validator.

Thumbnails, 2026-09-20: the owner selected **Three dots** and **Flush full height** from `prototypes/ui-refresh/thumbnails.html` for desktop and extension. The selected layout uses a 128px-wide thumbnail flush with the row's left, top, and bottom, with minimum row heights of 84px on desktop and 96px in the popup. Active progress runs under the text/actions only; the thumbnail spans the entire row beside it. A neutral three-dot placeholder replaces stripes until an image is available, with reduced-motion handling. The study opens on this selection and retains the original baseline for comparison. Focused implementation verification is coordinated with the production changes.
