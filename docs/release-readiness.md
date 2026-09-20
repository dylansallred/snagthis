# Release and PR readiness

Reviewed 2026-09-20. This records code preparation and remaining release requirements; it is not a claim that a public release or Store approval has happened.

## What belongs in the PR

Keep the product source, shared contracts and generated extension copies, tests, lockfile, notices, and design studies. The studies are working references for the accepted interface, including the startup animation. Include the new runtime modules and assets alongside their callers; they are not disposable files just because Git currently lists them as untracked.

The cleanup removes 16 unreferenced scaffold/legacy source files and three unused dependency declarations (`next-themes`, `cross-env`, and the engine's duplicate `unzipper` dependency). The API's actively used subtitle services and its `unzipper` dependency remain. Original logo assets and credited sample media stay available to development previews. Production desktop builds substitute an empty gallery module so those sample movies and posters do not ship.

Do not commit generated installers, extension ZIPs, build directories, downloaded media, dependency directories, local verification output, notarization output, release staging, credentials, or signing material. `.gitignore` includes the concrete generated paths used by this repository. The extension package is built from an explicit runtime file list, rather than whatever happens to be in its working directory.

Updater fixes preserve downloaded updates, handle background download failures, and protect active downloads before installation. Shutdown also waits for an in-flight library scan and its final write, then closes incoming preview responses so an open video socket cannot prevent the app from quitting. Direct-file detection preserves an observed video MIME type when a page scan can only report an unknown type.

Before committing, review `git diff` and the untracked list together. Keep `package-lock.json` with dependency changes. Do not use an indiscriminate cleanup/reset command on a workspace that also contains local downloads or verification evidence.

## Release paths

- **Desktop:** follow [the release guide](release-guide.md). A matching `vX.Y.Z` tag prepares a verified draft in this repository. Signed installers, updater ZIP/EXE files, metadata and corresponding source must describe the same version and validated artifacts. A maintainer publishes the completed draft manually.
- **Extension-only GitHub releases:** use an `extension-vX.Y.Z` tag when only Chrome changes. The workflow prepares a separate extension ZIP draft with its source commit and checksums; GitHub provides tagged source archives. This runs CI without producing desktop installers or publishing to the Chrome Web Store. Keep it marked prerelease and not latest so desktop update discovery remains on a desktop release.
- **Chrome:** [Chrome Web Store is the primary distribution path](extension-release.md). Users receive Chrome-managed extension updates after approval/publication. A GitHub ZIP or a future landing page is the fallback; an unpacked installation needs manual updating and must not be advertised as automatically updating.
- **Browser-only downloads:** this PR includes native Chrome downloads for detected standalone MP4/WebM files, without desktop pairing. Chrome owns the transfer and saved file; the popup provides progress, pause/resume, retry and Show in folder. Streams, separate tracks and processing continue through desktop. See [the research and remaining phases](research/chrome-only-downloads.md).

## External requirements still open

Read-only GitHub inspection found `dylansallred/vidsnag` is private, with no published releases. Access to repository variables and branch-protection details was denied to the current token, so those settings were not verified or changed. Draft preparation now ends before publication; a private-repository required-reviewer environment is no longer a prerequisite.

The owner clarified that this repository is private **during testing** and will become public at launch. The same repository will host source, desktop downloads, update metadata, and extension ZIPs. No separate distribution repository is needed. An Apple Developer account already exists; its signing and notarization credentials have not yet been configured or verified for the workflow.

1. Make this repository public when ready to launch, then manually publish its reviewed desktop draft as latest. The updater stays on `dylansallred/vidsnag`. Private GitHub artifacts are suitable for collaborators testing manual installs; anonymous automatic updates cannot read a private feed or a draft. Never embed a private GitHub token in an installer or extension.
2. Configure and verify the existing Apple account's signing/notarization credentials and Windows signing credentials. Signed installer builds remain blocked without the required credentials. Review and publish completed drafts manually.
3. Prepare and review the exact corresponding-source packet for bundled tools, including the required version/commit and source metadata. License notices alone do not replace this step.
4. Create the Chrome Web Store listing and complete its privacy/permission disclosures and review. Store approval is not guaranteed. Publish a ZIP with clear manual-install/update instructions if using the fallback.
5. Test an actual signed upgrade from the previous public desktop version to the new version on each supported platform. Confirm the new version launches, settings/queue remain, the extension reconnects, and active downloads are protected. A mocked updater test or fresh installer smoke test cannot establish all of this.

No tag, release, Store upload, repository-visibility change, signing credential, or user installation was created or modified by this preparation.

## Verification scope

Local verification used Node **22.23.2**. After the final workflow changes, one coordinated `npm run verify` pass succeeded with **206/206 tests**, lint, TypeScript, both production builds, and token parity. Workflow YAML and release shell syntax also passed. The extension-only packaging command produced a ZIP with a verified SHA256 in ignored `release-assets/extension-only/`. These are local preparation artifacts, not a tagged or published release.

| Check | Result |
| --- | --- |
| ESLint and desktop TypeScript | Passed; changed JavaScript/test files also passed focused lint after fixes. |
| Unit/media suite | Final PR preparation pass: 206/206. Earlier verification exposed the history-scan shutdown race described above; its regression is included in the passing suite. |
| Production builds and token parity | Passed. The desktop build excludes development sample movies/posters. |
| Selected browser/Electron checks | All 16 selected cases passed across the initial pass and focused corrections. Includes actual pairing → selected HLS quality → playable desktop file, previews, popup states, extension-update guidance and native Chrome downloads. |
| Real Chrome download | Passed with desktop offline: pause/resume, continued bytes through an actual worker stop/restart, restored row, real 403/retry, safe persistent metadata and HLS desktop guidance. Saved MP4 verified with FFprobe and a matching source SHA256. |
| Extension archive | Built successfully: 31 runtime/license files, 305,499 bytes. Packaging tests verify archive contents, determinism and excluded development/local files. |

PR CI exposed an additional shutdown deadlock after successful download assertions: Electron waited for API shutdown while a preview response waited for its window to close. An authenticated partial-response regression reproduced the failure. After the fix, all three progress-pipeline regressions and both affected browser/Electron cases (real pairing/download and onboarding) passed, along with focused lint. The onboarding test now expects the approved Chrome-only download guidance.

The initial Chrome test found the unknown-MIME detection bug; its corrected native lifecycle fixture uses actual Chrome worker events rather than Playwright handle identity. Earlier browser evidence is in ignored `work/verification/release-readiness/` and `work/verification/browser-downloads/`; final local PR verification is in `work/verification/pr-ready/verify.log`. CI installs Chromium before renderer tests on every OS and prepares Linux display/sandbox dependencies before verification.

The focused updater checks exercise production state transitions without installing an update. Release checks validate metadata/artifact contracts; the release workflow still owns actual signatures and installed-artifact checks. Native Chrome redirect/authentication coverage, full browser restart and Store-update behavior were not established by the local download test. The external requirements above remain open.
