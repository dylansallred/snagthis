# Contributing

Use the pinned Node version and run `npm ci`. The approved product design is in `docs/design/`; changes should follow its quiet row layout and exact state language.

Keep changes focused. Preserve engine behavior unless a real-media fixture demonstrates why it must change. Shared display strings and state formatting belong in `packages/contracts`; the popup consumes build-time copies rather than maintaining its own variant.

Locally, tests that drive the real desktop app run it in the background: its window is transparent, never takes focus and stays out of the Dock and taskbar. Set `E2E_BACKGROUND=0` to watch it instead. CI shows the window normally.

Run `npm run verify` once for a completed change, plus the relevant browser/Electron checks when changing that surface. Investigate failures and rerun only the affected checks after a fix. Do not replace ffprobe assertions with argument-string tests for media correctness.

Use a branch and a pull request. Explain the user-visible change, relevant limitations and validation.

GitHub CI runs only when asked, to save Actions minutes. Add the `run-ci` label to a PR to run the full suite and browser tests on Linux, or `run-ci-all` to add macOS and Windows. Mac minutes cost 10 times as much as Linux on a private repository, so use `run-ci-all` for platform-sensitive changes such as paths, processes or packaging. Either label reruns on every push while it's on, so remove it once CI has passed. PRs that only change `docs/`, `site/` or Markdown skip the suite. You can also start it by hand with `gh workflow run ci.yml --ref <branch>` (add `-f platforms=all` for all three). Without a label, the required **CI gate** check passes without running the suite, so run `npm run verify` locally first. Release tags always run the full suite on all three platforms.

Keep approved design references, release guides and reusable technical decisions in `docs/`. Put superseded design experiments in `work/design/`, scratch research in `work/research/`, and one-off review reports in `work/reviews/`; `work/` is ignored by Git. Keep assets and fixtures required by the application, README or tests tracked.

For desktop UI previews, run `npm run dev:desktop` and open `http://127.0.0.1:5173/?gallery=1`; use `?gallery=states` or `?gallery=empty` for other states, and add `&details=1` or `&sheet=settings` for panels. Add `&update=<state>` (checking, uptodate, downloading, ready, blocked, installing, error, failed-install, updated, move) to preview the update chip, the `Updated to` toast and the Settings row (`&sheet=settings&section=about`); `&updatePopover=1` opens the chip's popover and `&updateNotes=1` the toast's What's new. Add `&organize=<state>` (folders, folder, drag, moveto, select, delete, sortmenu, grouped, failed, new) to preview Saved's folders with the Pixel worlds sample library, and `&saved=<state>` (rich, minimal, missing, loading) to open a saved video's details. For Chrome UI previews, serve the repository over loopback HTTP and open `apps/extension/popup.html?demo=default`; available modes are listed in [the extension guide](apps/extension/README.md). These previews use credited sample media without starting downloads or changing preferences.

Contributions must be compatible with GPL-3.0-only. Record third-party source and license information before adding code or assets.
