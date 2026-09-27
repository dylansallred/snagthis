# Release and PR readiness

Reviewed 2026-09-27 on branch `prerelease-fixes`. No public release, Store submission or repository-visibility change is claimed or was made.

## Current state

| Area | State |
| --- | --- |
| macOS signing | Done. Releases are signed with the Apple Developer ID and notarized; the release workflow verifies the signature and a packaged download before preparing a draft. |
| Windows signing | Done. Installers and the installed app are signed through Azure Artifact Signing (account `snagthisvid`, profile `snagthis`). The CI "Windows signing" run builds a signed installer and checks it with a real packaged download, without tagging or releasing. |
| Website | Live at [snagthisvid.com](https://snagthisvid.com), served as a Cloudflare Worker with static assets from `site/`. The privacy policy is at [snagthisvid.com/privacy](https://snagthisvid.com/privacy) and names privacy@snagthisvid.com. |
| Chrome Web Store build | YouTube-neutral. The packaged ZIP (`npm run package:extension`) lists YouTube pages with **Copy link** only; it offers no YouTube download or desktop hand-off, and the service worker refuses such requests. Unpacked development builds keep full YouTube behaviour. See [extension release](extension-release.md#youtube-in-the-store-build). |
| Bundled tools | FFmpeg/FFprobe are pinned and checksum-verified (`apps/desktop/scripts/fetch-ffmpeg.cjs`). yt-dlp is pinned to one release with the publisher's SHA-256 values in `apps/desktop/scripts/yt-dlp-release.json`; release verification fails if the packaged yt-dlp is a different version. |
| Pre-release fixes | The review findings that blocked release are fixed with regression tests: moves to another drive, native-HLS resume after a quality fallback, bundled tools when `chmod` is refused, child-process and scratch-folder cleanup, partial downloads kept when the queue cannot be restored, hidden resolver windows, the pairing-dialog keyboard gate, double Enter in the quality picker, the popup's per-frame page scan, the preview page's diagnostics log, a crash on a malformed redirect, and local paths in job errors. |

## Verification

Run with Node **22.23.2** on macOS arm64 at the tip of `prerelease-fixes`:

- `npm run verify`: ESLint, desktop TypeScript, **335/335** unit/integration/media tests (no skips), both production builds and design-token parity all passed. The yt-dlp tests use the pinned bundled binary (`npm run fetch:yt-dlp --workspace @m3u8/desktop`), as CI does.
- `npx playwright test`: **47/47** browser and Electron cases passed. One run had a single timing failure in `desktop-overlays.spec.js` ("closing Settings with Escape…") under full-suite load; that spec passed 15/15 on repeat and the full suite passed on rerun.

These are development checks. They do not install a signed update or exercise the Chrome Web Store.

## Release paths

- **Desktop:** follow [the release guide](release-guide.md). A matching `vX.Y.Z` tag prepares a verified draft in this repository with signed installers, updater files, metadata and corresponding source. A maintainer publishes the draft manually.
- **Extension-only GitHub releases:** an `extension-vX.Y.Z` tag prepares a separate prerelease draft with the extension ZIP, its source commit and checksums, without desktop installers. Keep it not-latest so desktop update discovery stays on desktop releases.
- **Chrome:** [the Chrome Web Store is the primary path](extension-release.md). A GitHub ZIP is the fallback and must not be advertised as updating automatically.

## Still open before launch

1. **Corresponding-source packet.** Prepare and review the exact source packet for the bundled tools: FFmpeg/FFprobe (per platform build) and yt-dlp at the pinned tag in `yt-dlp-release.json`, with the version/commit and source metadata that `scripts/verify-corresponding-source.cjs` checks. License notices alone do not replace this.
2. **Chrome Web Store listing.** Create the listing, complete the privacy and permission disclosures (the policy at snagthisvid.com/privacy), and submit the store ZIP for review. Approval is not guaranteed. After the store assigns the extension ID, add it to `STORE_EXTENSION_IDS` in `packages/downloader-api/src/utils/security.js`; until then the real extension is shown as "unrecognized" in the Connect Chrome dialog.
3. **Real Windows test.** Install the signed Windows build on a real Windows machine (not only CI) and run the main flows: pair Chrome, download HLS and a direct file, pause/resume, quit with an active download, open and locate saved files, and a save folder on another drive.
4. **Signed upgrade test.** On each supported platform, install a signed baseline build and upgrade it to the release candidate through the updater. Confirm the new version launches, settings and the queue remain, the extension reconnects, and active downloads are protected. Mocked updater tests and fresh-install smoke tests do not establish this.
5. **Make the repository public** when ready to launch, then publish the reviewed desktop draft as latest. The updater reads `dylansallred/snagthis`; anonymous automatic updates cannot read a private repository or a draft. Never embed a GitHub token in an installer or extension.

## Validation limits

Updater tests exercise production state transitions without installing a signed update. Release tests validate metadata and artifact contracts; actual signatures and installed-artifact checks run in the release workflow. Native Chrome redirect/authentication handling, a full browser restart and Store-update behaviour are not covered by the local tests. Passing development checks does not complete the launch items above.

Do not commit generated installers, extension ZIPs, build directories, downloaded media, dependency directories, local verification output, notarization output, release staging, credentials or signing material.
