# Compatibility checks

Run `npm run compat` for generated local fixture pages. This installs the actual unpacked extension in an isolated Chromium profile, observes media detection and grouping, then runs the real engine and ffprobe. It does not use the user's browser, queue, cookies or download folder.

`npm run compat -- --site mux-bbb-480p` checks one permitted public source. `--external` runs the public seed list, serially; `--tag iframe` selects a technique; `--headed` shows the test browser. Public stream entries are exercised in a local test player; this does not assert their publisher's website works. Full files are opt-in with `--full`; normal runs request a 30-second engine probe. FFmpeg/FFprobe and Playwright Chromium must be installed.

`sites.yaml` uses JSON syntax, which is valid YAML, so the harness needs no YAML dependency. Each entry records permission evidence and source reachability separately from SnagThis results. Never change an unknown stage to passing without running it.

Raw, redacted results go to ignored `results/`. `COMPATIBILITY.md` includes stage results and a technique summary. `npm run compat -- --matrix-only` regenerates it from existing evidence without opening a browser. A public-site failure does not fail CI; local fixture failures do. A failure row without a linked issue explicitly says “not filed”.

Stages: page/player → detection → correct rows → variants → fetch context → bounded engine output → ffprobe verification → opt-in full download. Once a stage fails, subsequent stages remain unknown. An absent variant expectation is marked not applicable rather than passed.

For the compatibility workflow (started by hand): run `npm run compat -- --external`, upload `compat/results/` even on failure, and create a PR for `compat/COMPATIBILITY.md`. A protected GitHub environment can require manual approval before that job. Do not schedule full downloads. Credentials and private user source URLs must never be added to seeds or artifacts.

The local fixture server also serves live/DRM clean-decline cases, explicit header/cookie gating, expiring URLs, missing/retried segments, range/no-range direct files and throttled downloads. Those are asserted in `npm run test:media`; a supported-site table should not count correct unsupported-media rejection as a successful download.
