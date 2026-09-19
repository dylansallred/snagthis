# Contributing

Use the pinned Node version and run `npm ci`. The approved product design is in `docs/design/`; changes should follow its quiet row layout and exact state language.

Keep changes focused. Preserve engine behavior unless a real-media fixture demonstrates why it must change. Shared display strings and state formatting belong in `packages/contracts`; the popup consumes build-time copies rather than maintaining its own variant.

Run `npm run verify` once for a completed change, plus the relevant browser/Electron checks when changing that surface. Investigate failures and rerun only the affected checks after a fix. Do not replace ffprobe assertions with argument-string tests for media correctness.

Use a branch and a pull request. Explain the user-visible change, relevant limitations and validation. Do not commit generated videos, downloaded content, secrets, credentials, build artifacts or `node_modules`.

Contributions must be compatible with GPL-3.0-only. Record third-party source and license information before adding code or assets.
