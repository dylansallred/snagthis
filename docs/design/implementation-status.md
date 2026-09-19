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
