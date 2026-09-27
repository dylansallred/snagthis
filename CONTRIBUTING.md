# Contributing

Use the pinned Node version and run `npm ci`. The approved product design is in `docs/design/`; changes should follow its quiet row layout and exact state language.

Keep changes focused. Preserve engine behavior unless a real-media fixture demonstrates why it must change. Shared display strings and state formatting belong in `packages/contracts`; the popup consumes build-time copies rather than maintaining its own variant.

Run `npm run verify` once for a completed change, plus the relevant browser/Electron checks when changing that surface. Investigate failures and rerun only the affected checks after a fix. Do not replace ffprobe assertions with argument-string tests for media correctness.

Use a branch and a pull request. Explain the user-visible change, relevant limitations and validation. Do not commit generated videos, downloaded content, secrets, credentials, build artifacts or `node_modules`.

Keep approved design references, release guides and reusable technical decisions in `docs/`. Put superseded design experiments in `work/design/`, scratch research in `work/research/`, and one-off review reports in `work/reviews/`; `work/` is ignored by Git. Keep assets and fixtures required by the application, README or tests tracked.

For desktop UI previews, run `npm run dev:desktop` and open `http://127.0.0.1:5173/?gallery=1`; use `?gallery=states` or `?gallery=empty` for other states, and add `&details=1` or `&sheet=settings` for panels. For Chrome UI previews, serve the repository over loopback HTTP and open `apps/extension/popup.html?demo=default`; available modes are listed in [the extension guide](apps/extension/README.md). These previews use credited sample media without starting downloads or changing preferences.

Contributions must be compatible with GPL-3.0-only. Record third-party source and license information before adding code or assets.
