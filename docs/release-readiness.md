# Release and PR readiness

Reviewed 2026-09-27 on `main`. The first release is desktop `v1.0.0` with extension `1.0.0`; see [version numbers](versioning.md). No public release, Store submission or repository-visibility change is claimed or was made.

## Current state

| Area | State |
| --- | --- |
| macOS signing | Done. Releases are signed with the Apple Developer ID and notarized; the release workflow verifies the signature and a packaged download before preparing a draft. |
| Windows signing | Done. Installers and the installed app are signed through Azure Artifact Signing (account `snagthisvid`, profile `snagthis`). The CI "Windows signing" run builds a signed installer and checks it with a real packaged download, without tagging or releasing. |
| Website | Live at [snagthisvid.com](https://snagthisvid.com), served as a Cloudflare Worker with static assets from `site/`. The privacy policy is at [snagthisvid.com/privacy](https://snagthisvid.com/privacy) and names privacy@snagthisvid.com. |
| Chrome Web Store build | YouTube-neutral. The packaged ZIP (`npm run package:extension`) lists YouTube pages, muted, with “SnagThis doesn't save videos from this site” and no action; it offers no YouTube download, link copy or desktop hand-off, and the service worker refuses such requests. Unpacked development builds keep full YouTube behaviour. See [extension release](extension-release.md#youtube-in-the-store-build). |
| Bundled tools | FFmpeg/FFprobe are pinned and checksum-verified (`apps/desktop/scripts/fetch-ffmpeg.cjs`). yt-dlp is pinned to one release with the publisher's SHA-256 values in `apps/desktop/scripts/yt-dlp-release.json`; release verification fails if the packaged yt-dlp is a different version. |
| Pre-release fixes | The review findings that blocked release are fixed with regression tests: moves to another drive, native-HLS resume after a quality fallback, bundled tools when `chmod` is refused, child-process and scratch-folder cleanup, partial downloads kept when the queue cannot be restored, hidden resolver windows, the pairing-dialog keyboard gate, double Enter in the quality picker, the popup's per-frame page scan, the preview page's diagnostics log, a crash on a malformed redirect, and local paths in job errors. |

## Verification

Run with Node **24.21.0** on macOS arm64 on `main`:

- `npm run verify`: ESLint, desktop TypeScript, **343/343** unit/integration/media tests (no skips), both production builds and design-token parity all passed. The yt-dlp tests use the pinned bundled binary (`npm run fetch:yt-dlp --workspace @m3u8/desktop`), as CI does.
- `npx playwright test`: **47/47** browser and Electron cases passed. One run had a single timing failure in `desktop-overlays.spec.js` ("closing Settings with Escape…") under full-suite load; that spec passed 15/15 on repeat and the full suite passed on rerun.

These are development checks. They do not install a signed update or exercise the Chrome Web Store.

## Release paths

- **Desktop:** follow [the release guide](release-guide.md). A matching `vX.Y.Z` tag prepares a verified draft in this repository with signed installers, updater files, metadata and corresponding source. A maintainer publishes the draft manually.
- **Extension-only GitHub releases:** an `extension-vX.Y.Z` tag prepares a separate prerelease draft with the extension ZIP, its source commit and checksums, without desktop installers. Keep it not-latest so desktop update discovery stays on desktop releases.
- **Chrome:** [the Chrome Web Store is the primary path](extension-release.md). A GitHub ZIP is the fallback and must not be advertised as updating automatically.

## Still open before launch

1. **Corresponding-source packet.** `scripts/build-source-packet.cjs` builds it (see [the release guide](release-guide.md#prepare-the-corresponding-source-packet)), but the packet must be built for the exact tagged commit, hosted at a public HTTPS URL, and fed through the **Prepare corresponding source** workflow. `CORRESPONDING_SOURCE_RUN_ID` must then name that run. The host is ready: the Cloudflare R2 bucket `snagthis-source`, served at https://source.snagthisvid.com/.
2. **Chrome Web Store item and ID.** Create the store item before tagging the first desktop release, and add its ID to `STORE_EXTENSION_IDS` in `packages/downloader-api/src/utils/security.js`. Until a desktop release contains the ID, store installs show as "unrecognized" in the Connect Chrome dialog. Then complete the privacy and permission disclosures and submit the ZIP. Approval is not guaranteed.
3. **Signing checks on `main`.** Rerun the macOS (arm64 and x64) and Windows signing checks on current `main`. The Windows check now also confirms the signer's name matches the `publisherName` that installed copies use to accept future updates.
4. **Real Windows test.** Done 2026-09-27 on Windows 11 on ARM (a UTM VM running the x64 build under emulation), with the signed build from `main`: no SmartScreen warning, silent install into `Programs\SnagThis` with Publisher SnagThis, clean uninstall, the packaged download smoke (10 s 1080p HLS with audio, checked with ffprobe) on the first launch after a fresh install, Chrome pairing, and direct and desktop downloads from the test page. Still worth doing on a real x64 Windows PC when one is available.
5. **Signed upgrade test.** On each supported platform, install a signed baseline build and upgrade it to the next version through the updater. Confirm the new version launches, settings and the queue remain, the extension reconnects, and active downloads are protected. Mocked updater tests and fresh-install smoke tests do not establish this.
6. **Update experience on signed builds.** The header chip, the update sheet (direction C, with **Install when downloads finish**) and the Settings summary row are built and tested in the gallery and with a mocked updater. They still need a pass on real signed builds as part of the upgrade test above.
7. **Make the repository public** when ready to launch, then publish the reviewed desktop draft as latest after replacing the "What's new" placeholder. The updater and the site's download links read `dylansallred/snagthis`; anonymous automatic updates cannot read a private repository or a draft. Never embed a GitHub token in an installer or extension.

## Validation limits

Updater tests exercise production state transitions without installing a signed update. Release tests validate metadata and artifact contracts; actual signatures and installed-artifact checks run in the release workflow. Native Chrome redirect/authentication handling, a full browser restart and Store-update behaviour are not covered by the local tests. Passing development checks does not complete the launch items above.

Do not commit generated installers, extension ZIPs, build directories, downloaded media, dependency directories, local verification output, notarization output, release staging, credentials or signing material.
