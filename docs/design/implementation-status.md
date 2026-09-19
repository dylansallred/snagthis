# Implementation and evidence — 2026-09-19

The approved **Workbench, simplified** interface is implemented in the new VidSnag repository. The owner selected **GPL-3.0-only**. The predecessor repository and its uncommitted files were preserved.

**Visual direction accepted, 2026-09-19:** after reviewing the implementation previews, the owner confirmed, “Yes, keep this direction.” Keep the current dark desktop and extension design as the baseline for further work.

## What changed

- Desktop: one searchable, paginated library; paste multiple links; real quality choices; thumbnail progress; one visible row action; inline details; keyboard navigation; five simple settings with Advanced.
- Chrome: rewritten popup and page detector; real posters and quality discovery; background-owned submission; live pause/resume/saved status; pairing, offline recovery, preview and source refresh.
- Safety and reliability: installation pairing and authenticated HTTP/WebSocket access; private queue persistence; scoped request credentials; explicit MP4 muxing; pause/finalization ownership fixes; saved files are never deleted by age. Removing a saved entry keeps the file unless the user explicitly chooses OS Trash.
- Media: direct MP4, TS/fMP4 HLS, AES-128, selected quality, separate audio/subtitles, audio-only output, early thumbnails and bounded compatibility probes. DRM and live recording are declined clearly.
- Project: clean module-by-module port, current contributor/privacy/security documentation, dependency updates, shared display contracts, CI, compatibility reporting and gated release tooling.

## Verification

Checks were coordinated locally using Node 22.23.2. Concrete failures were corrected and only affected checks rerun.

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

ETA now uses a time-based rate average instead of directly displaying each instantaneous estimate. Download stages reset their rate history. The owner selected **A+B: Leading edge + Soft sweep** for both desktop and popup row backgrounds, moved duration beside the title, and rejected text overlays on the video. Thumbnails keep an unobscured poster until a local silent ten-second clip is available, then loop only on hover/focus. Reduced motion retains the poster and static row fill. No source-network preview fetches are performed.

The coordinated run passed **76 of 77** cases initially. The remaining preview fixture placed its poster outside the managed downloads directory; moving that fixture asset into the supported location made the targeted preview test pass without weakening its assertions. All **77 cases** therefore passed across the initial run and targeted rerun. The tests cover deferred native-piece recovery producing a complete real MP4, permanent gaps and expired credentials refusing a saved file, bounded spool cleanup, and real ten-second H.264 previews with authenticated generation and signed range playback. TypeScript, ESLint and all **five affected desktop/extension browser scenarios** passed, including actual looping playback, keyboard focus, pause/blur cleanup and reduced motion. Evidence: `work/verification/progress-preview-native.log`, `preview-clip-rerun.log`, and `progress-preview-ui.log`.
