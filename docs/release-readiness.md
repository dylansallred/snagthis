# Release and PR readiness

Reviewed 2026-09-20. Application-code verification covers cleanup commit `d0012d1`; this documentation update does not change application behavior. Completed preparation is separate from the launch requirements below. No public release or Store approval is claimed.

## Completed code and repository preparation

Keep the product source, shared contracts and generated extension copies, tests, lockfile, notices, approved design references, and studies still used as references or test fixtures, including the startup animation. Superseded download/extension motion studies and old review reports are local archives under ignored `work/`. Include the new runtime modules and assets alongside their callers; they are not disposable files just because Git currently lists them as untracked.

The cleanup removes 16 unreferenced scaffold/legacy source files and three unused dependency declarations (`next-themes`, `cross-env`, and the engine's duplicate `unzipper` dependency). The API's actively used subtitle services and its `unzipper` dependency remain. Original logo assets and credited sample media stay available to development previews. Production desktop builds substitute an empty gallery module so those sample movies and posters do not ship.

The follow-up cleanup also removes unused desktop helpers and UI wrappers, six unused contracts adapters, a duplicate build icon, and unused `class-variance-authority`, `eslint-plugin-react`, and direct `@eslint/js` dependency declarations. Historical implementation notes, superseded mock-ups/screenshots, and rejected logo variations are preserved locally under ignored `work/`. The original artwork, selected design references, and media required by tests remain tracked.

Do not commit generated installers, extension ZIPs, build directories, downloaded media, dependency directories, local verification output, notarization output, release staging, credentials, or signing material. `.gitignore` includes the concrete generated paths used by this repository. The extension package is built from an explicit runtime file list, rather than whatever happens to be in its working directory.

Updater fixes preserve downloaded updates, handle background download failures, and protect active downloads before installation. Shutdown also waits for an in-flight library scan and its final write, then closes incoming preview responses so an open video socket cannot prevent the app from quitting. Direct-file detection preserves an observed video MIME type when a page scan can only report an unknown type.

Before committing, review `git diff` and the untracked list together. Keep `package-lock.json` with dependency changes. Do not use an indiscriminate cleanup/reset command on a workspace that also contains local downloads or verification evidence.

## Release paths

- **Desktop:** follow [the release guide](release-guide.md). A matching `vX.Y.Z` tag prepares a verified draft in this repository. Signed installers, updater ZIP/EXE files, metadata and corresponding source must describe the same version and validated artifacts. A maintainer publishes the completed draft manually.
- **Extension-only GitHub releases:** use an `extension-vX.Y.Z` tag when only Chrome changes. The workflow prepares a separate extension ZIP draft with its source commit and checksums; GitHub provides tagged source archives. This runs CI without producing desktop installers or publishing to the Chrome Web Store. Keep it marked prerelease and not latest so desktop update discovery remains on a desktop release.
- **Chrome:** [Chrome Web Store is the primary distribution path](extension-release.md). Users receive Chrome-managed extension updates after approval/publication. A GitHub ZIP or a future landing page is the fallback; an unpacked installation needs manual updating and must not be advertised as automatically updating.
- **Browser-only downloads:** this PR includes native Chrome downloads for detected standalone MP4/WebM files, without desktop pairing. Chrome owns the transfer and saved file; the popup provides progress, pause/resume, retry and Show in folder. Streams, separate tracks and processing continue through desktop. See [the research and remaining phases](research/chrome-only-downloads.md).

Desktop direct-file resume currently restarts the transfer; segmented downloads retain compatible pieces. Recovery from an expired link requires choosing **Continue previous download** after recapturing the source, followed by engine compatibility checks. Chrome's native download resume is separate from the desktop path.

## Completed verification

The latest coordinated application-code check ran with Node **22.23.2**: `npm run verify` passed **207/207 tests**, ESLint, desktop TypeScript, both production builds, and desktop/extension token parity. This is the cleanup verification for `d0012d1`, recorded locally in ignored `work/verification/cleanup-verify.log`. These documentation edits do not imply a new application test run.

| Check | Completed evidence |
| --- | --- |
| ESLint and desktop TypeScript | Passed in the latest coordinated check. |
| Unit/integration/media suite | **207/207 passed**, with no failures or skips; includes the history-scan and preview-response shutdown regressions. |
| Production builds and token parity | Passed. Desktop production builds exclude development sample movies/posters. |
| README and documentation assets | Animated desktop/extension previews visually reviewed; the cleanup's documentation-link and ignore-rule check passed. |

### Earlier validation retained as evidence

These checks were performed during implementation and release preparation; they were not rerun for this documentation pass.

- Browser/Electron lifecycle checks covered actual pairing, selected HLS quality through a playable saved file, previews, popup states, extension-update guidance, and native Chrome downloads. Earlier selected runs passed 16 cases across the initial pass and focused corrections; the subsequent Linux CI run at `99a31e7` passed all 24 browser/Electron cases.
- A real Chrome download passed with desktop offline, including pause/resume, continued bytes through worker stop/restart, restored state, 403/retry handling, safe persisted metadata, and HLS desktop guidance. FFprobe and the source SHA256 verified the saved MP4.
- Extension packaging produced 31 runtime/license files (305,499 bytes at that preparation run), with a verified SHA256. Packaging tests cover contents, determinism, and excluded development/local files.
- Workflow YAML and release shell syntax checks passed during workflow preparation. CI installs Chromium before renderer tests on every OS and prepares Linux display/sandbox dependencies before verification.

Earlier local evidence is under ignored `work/verification/release-readiness/`, `work/verification/browser-downloads/`, and `work/verification/pr-ready/`. Historical counts and archive sizes describe those runs, not a newly built release.

## Remaining launch requirements

Read-only GitHub inspection found `dylansallred/vidsnag` is private, with no published releases. Access to repository variables and branch-protection details was denied to the current token, so those settings were not verified or changed. Draft preparation now ends before publication; a private-repository required-reviewer environment is no longer a prerequisite.

The owner clarified that this repository is private **during testing** and will become public at launch. The same repository will host source, desktop downloads, update metadata, and extension ZIPs. No separate distribution repository is needed. The five Apple signing/notarization repository secrets are configured. Their presence is confirmed; a successful [manual signing check](release-guide.md#verify-apple-signing-before-a-release) is required to establish that they work.

1. Make this repository public when ready to launch, then manually publish its reviewed desktop draft as latest. The updater stays on `dylansallred/vidsnag`. Private GitHub artifacts are suitable for collaborators testing manual installs; anonymous automatic updates cannot read a private feed or a draft. Never embed a private GitHub token in an installer or extension.
2. Configure and verify the existing Apple account's signing/notarization credentials and Windows signing credentials. Signed installer builds remain blocked without the required credentials. Review and publish completed drafts manually.
3. Prepare and review the exact corresponding-source packet for bundled tools, including the required version/commit and source metadata. License notices alone do not replace this step.
4. Create the Chrome Web Store listing and complete its privacy/permission disclosures and review. Store approval is not guaranteed. Publish a ZIP with clear manual-install/update instructions if using the fallback.
5. Test an actual signed upgrade on each supported platform. For the initial release, establish a signed baseline build and upgrade it to the release candidate; for later releases, start from the previous public version. Confirm the new version launches, settings/queue remain, the extension reconnects, and active downloads are protected. A mocked updater test or fresh installer smoke test cannot establish all of this.

No tag, release, Store upload, repository-visibility change, signing credential, or user installation was created or modified by this preparation.

## Validation limits

Updater tests exercise production state transitions without installing a signed update. Release tests validate metadata/artifact contracts; actual signatures and installed-artifact checks belong to the release workflow. Native Chrome redirect/authentication coverage, a full browser restart, and Store-update behavior were not established by the local download test. Passing development checks does not complete the launch requirements above.
