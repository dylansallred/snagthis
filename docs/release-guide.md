# Releasing VidSnag

Desktop and Chrome have separate update channels and version numbers. A desktop `vX.Y.Z` tag builds macOS Apple Silicon, macOS Intel, Windows x64, and a Chrome ZIP. An `extension-vX.Y.Z` tag prepares an extension-only release. Both workflows prepare **drafts in this repository**; a maintainer reviews and publishes them manually. The ZIP is not a Chrome Web Store publication. Follow [the Chrome release guide](extension-release.md) for the store and manual fallback.

## Readiness and prerequisites

The repository stays private during testing and will become public for launch. Source, installers, extension ZIPs, source packets, and update metadata all stay together in `dylansallred/vidsnag`; no separate distribution repository is needed. Authorized collaborators can download private test artifacts through GitHub. Installed apps cannot anonymously read the private feed or drafts. Before public launch, make this repository public and publish a reviewed desktop release. Do not put a GitHub access token in the installed app. Neither workflow changes repository visibility or publishes a draft automatically.

The owner has an Apple Developer account and has configured the five Apple repository secrets below. Secret presence alone does not prove that the certificate, password, or notarization credentials work; use the signing check below before preparing a release.

The maintainer's final **Publish release** action is the publication approval. Draft preparation does not require GitHub Enterprise or a protected environment in the private repository. Repository secrets must be available to the desktop build job:

| Secret | Required use |
| --- | --- |
| `CSC_LINK` | Apple Developer ID Application signing certificate, supported electron-builder certificate input |
| `CSC_KEY_PASSWORD` | Password for that certificate |
| `APPLE_ID` | Apple developer account used for notarization |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password for that account |
| `APPLE_TEAM_ID` | Team that owns the signing identity |
| `WIN_CSC_LINK` | Windows code-signing certificate compatible with electron-builder's certificate-file workflow |
| `WIN_CSC_KEY_PASSWORD` | Password for that certificate |

The current Windows path expects a usable signing certificate file. A hardware-only certificate or cloud signing service needs its own signing integration before this workflow can use it. Do not disable forced code signing to work around missing credentials. Keep a consistent signing identity across updates; macOS updates require signed applications, and the updater uses the ZIP alongside the installer. See [electron-builder's updater requirements](https://www.electron.build/docs/features/auto-update/) and [Electron code signing](https://www.electronjs.org/docs/latest/tutorial/code-signing).

Set the `CORRESPONDING_SOURCE_RUN_ID` repository variable to a successful **Prepare corresponding source** run for the exact release. This is required even if the source repository itself is public: bundled FFmpeg/ffprobe and yt-dlp builds need the reviewed source and build information identified below.

## Verify Apple signing before a release

Run **CI** manually on the branch to test, selecting **Only build and verify a signed, notarized macOS installer (no release)**. Choose `arm64` for Apple Silicon or `x64` for Intel. Both use the same Apple certificate and notarization credentials. From the CLI:

```sh
gh workflow run ci.yml --ref workbench -f verify_macos_signing=true -f macos_arch=arm64
gh workflow run ci.yml --ref workbench -f verify_macos_signing=true -f macos_arch=x64
```

This mode uses the repository's Apple secrets to sign and notarize the app, DMG, and update ZIP on a native runner for the selected architecture, then checks Gatekeeper acceptance and runs real packaged downloads. It retains verified private test artifacts for seven days without creating a tag or release. It runs only the signing job; ordinary PR CI still runs the full validation matrix. The desktop release workflow always builds both Mac architectures. Windows signing and a real installed version-to-version upgrade need their separate release checks. GitHub's manual dispatch must be available for the workflow before it can be started.

## Prepare a release PR

1. Use Node from `.nvmrc`: `nvm install && nvm use`, then `npm ci`.
2. Bump the desktop version with `npm version X.Y.Z --workspace @m3u8/desktop --no-git-tag-version`. Commit both the desktop manifest and lockfile. The root private workspace and internal packages do not need the same version. Bump the extension separately when its packaged files change.
3. Include the intended code, notices, and user-facing release notes in a PR to `main`. Keep the installer identity (`appId`), product name, signing identity, user-data location, and updater repository stable. Changing them is a migration, not an ordinary release.
4. Let the coordinated CI run pass on Linux, macOS and Windows. The release workflow repeats those checks for the exact tagged commit. Do not claim a local development run proves signed installers or a public update feed work.
5. Merge the reviewed PR. From a clean, current checkout of `origin/main`, run `npm run release:tag -- X.Y.Z` when you intend to start the release. **This command runs verification, creates an annotated tag, and pushes the tag.** It refuses a dirty tree, a version mismatch, a different branch, an out-of-date `main`, or an existing tag.

Only stable `vX.Y.Z` desktop tags are supported by this workflow. Use a version greater than every published stable release. The workflow also verifies that the tag points to a commit on `main`; a published tag's installers are never overwritten by a rerun.

## Prepare the corresponding-source packet

The automated gate checks identity and coverage; a human reviewer must still check completeness. It cannot infer which third-party sources and build scripts are missing from an archive. Follow the [FFmpeg redistribution checklist](https://ffmpeg.org/legal.html) and the notices for the exact bundled builds.

The desktop jobs stage `release-verification-darwin-arm64.json`, `release-verification-darwin-x64.json`, and `release-verification-win32-x64.json`. Download those artifacts from the release run. They contain the exact executable versions, FFmpeg configuration, upstream build/source references, and hashes. Preserve all dependency sources and build instructions needed to reproduce those actual builds, including linked GPL dependencies; an FFmpeg source URL alone is not the complete packet.

Build `vidsnag-corresponding-source.tar.xz` containing the exact tagged VidSnag source plus those dependency sources, licenses, and reproducible build instructions. Do not include signing certificates, tokens, private media, or user data. Next to it create `corresponding-source.json` with this structure (replace every example value and include every actual source component):

```json
{
  "releaseTag": "vX.Y.Z",
  "sourceCommit": "40-character Git commit from the verification reports",
  "archiveSha256": "SHA256 of vidsnag-corresponding-source.tar.xz",
  "components": [
    { "id": "vidsnag", "version": "X.Y.Z", "path": "vidsnag", "licenseFile": "vidsnag/LICENSE", "buildInstructions": "vidsnag/BUILD.md" },
    { "id": "ffmpeg-mac", "version": "exact revision", "path": "ffmpeg-mac", "licenseFile": "ffmpeg-mac/COPYING.GPLv3", "buildInstructions": "ffmpeg-mac/BUILD.md" },
    { "id": "ffmpeg-win", "version": "exact revision", "path": "ffmpeg-win", "licenseFile": "ffmpeg-win/COPYING.GPLv3", "buildInstructions": "ffmpeg-win/BUILD.md" },
    { "id": "yt-dlp", "version": "exact revision", "path": "yt-dlp", "licenseFile": "yt-dlp/LICENSE", "buildInstructions": "yt-dlp/BUILD.md" }
  ],
  "builds": [
    { "platform": "darwin", "arch": "arm64", "tools": {
      "ffmpeg": { "version": "first line of report.ffmpeg.tools.ffmpeg.version", "components": ["ffmpeg-mac"] },
      "ffprobe": { "version": "first line of report.ffmpeg.tools.ffprobe.version", "components": ["ffmpeg-mac"] },
      "yt-dlp": { "version": "report.ytdlp.version", "components": ["yt-dlp"] }
    } },
    { "platform": "darwin", "arch": "x64", "tools": {
      "ffmpeg": { "version": "first line from this architecture's report", "components": ["ffmpeg-mac"] },
      "ffprobe": { "version": "first line from this architecture's report", "components": ["ffmpeg-mac"] },
      "yt-dlp": { "version": "this architecture's report.ytdlp.version", "components": ["yt-dlp"] }
    } },
    { "platform": "win32", "arch": "x64", "tools": {
      "ffmpeg": { "version": "first line from the Windows report", "components": ["ffmpeg-win"] },
      "ffprobe": { "version": "first line from the Windows report", "components": ["ffmpeg-win"] },
      "yt-dlp": { "version": "Windows report.ytdlp.version", "components": ["yt-dlp"] }
    } }
  ]
}
```

Paths refer to files inside the archive. Each tool's `components` list must also include its relevant linked dependencies/build scripts. Add component records as needed; the example is a schema example, not a complete source bundle.

Calculate both SHA256 values (`shasum -a 256 FILE` on macOS; `sha256sum FILE` on Linux). Make the reviewed archive and manifest available at HTTPS URLs without embedding credentials in workflow inputs. In Actions, run **Prepare corresponding source** on `main`, providing the exact tag, both URLs, and both expected hashes. It downloads only those inputs, verifies the hashes and packet structure, and uploads the named `vidsnag-corresponding-source` artifact. This workflow does not publish a release and does not substitute for final binary/source matching.

Set `CORRESPONDING_SOURCE_RUN_ID` to that completed run's numeric ID. If draft preparation already failed for a missing source packet, rerun only that failed job after setting the variable. Desktop artifacts expire after 7 days; the source packet expires after 30 days. If required artifacts have expired, rebuild the unchanged tagged release before publication and recheck its source evidence.

## What the release workflow checks and publishes

The macOS arm64 and x64 jobs independently sign/notarize the app, build a DMG and ZIP, and notarize/staple the exact DMG. They mount/copy the installer, verify its signature and Gatekeeper acceptance, then run a real local HLS download through the packaged app and packaged tools. They also extract the exact update ZIP, verify the app inside, and run the same real download smoke test. Windows silently installs the exact NSIS installer in a temporary directory, verifies both installer and installed executable signatures, and runs the real download smoke test.

These checks use isolated temporary profiles and local media fixtures. The produced report binds the installer/update ZIP and blockmap hashes to the release tag, source commit, application version, OS and architecture. Local fixture tests of the assembly code do not replace these platform-specific gates.

Draft preparation verifies increasing version numbers, downloads the reviewed source packet, and assembles only the allowed release assets. It requires both Mac architectures and Windows x64. It merges their `latest-mac.yml` entries so the updater can select the correct ZIP; the legacy fallback points to Intel. It verifies Windows `latest.yml`, every update payload's SHA512/size, and each signed-artifact report's SHA256. Final DMG hashes are refreshed after stapling. Build debug/effective-config files are excluded.

The complete set is attached to a draft for review:

- Apple Silicon DMG, ZIP and ZIP blockmap; Intel DMG, ZIP and ZIP blockmap.
- Windows NSIS EXE and blockmap.
- `latest-mac.yml` and `latest.yml` for update discovery.
- The Chrome submission ZIP, corresponding-source archive/manifest, verification reports, license/notices and `SHA256SUMS.txt`.

After reviewing the artifacts, source packet, and release notes, publish the desktop draft as the latest stable release. Make the repository public first when distributing to public users. Keep extension-only releases out of the desktop latest channel. The workflow never clicks Publish for you.

The installed desktop checks its packaged GitHub feed; Settings offers a manual update check. It downloads an available update, then requires **Restart & install** to install it. Keep the public metadata, ZIPs/EXE and blockmaps together; the DMG alone cannot provide macOS updates. Do not delete the previous stable release's payloads/blockmaps needed for differential download fallback.

Before the first public launch, qualify a real signed N → N+1 update on macOS Apple Silicon, macOS Intel and Windows x64, using an isolated test installation/profile and the intended public feed. Confirm discovery, downloading, restart, the new installed version, settings/pairing retention, and saved-file retention. This cannot be truthfully completed without signed releases and reachable hosting. The automated installer smoke check proves packaged media behavior; it does not perform this end-to-end public-feed upgrade.

## Failure, retry and rollback

- **A build, signature, notarization or media smoke check fails:** no release publishes. Fix the cause. Credential/service failures can be rerun for an unpublished tag; code changes require a new commit and version/tag.
- **A source gate fails:** prepare the exact source packet/configuration and rerun the failed draft job. Inspect all reports before publishing.
- **A draft upload is interrupted:** inspect and delete only the incomplete unpublished draft, then rerun draft preparation. The workflow refuses to overwrite existing releases or drafts. Nothing is discoverable as the new stable update until the maintainer publishes the complete draft.
- **A published release has a defect:** ship a fix with a higher version. Never retag, replace published installers, reuse the version, or lower the version to force a rollback. Already-installed newer clients will not normally accept an older version.
- **An urgent distribution stop is needed:** an authorized maintainer can withdraw the defective release/update feed and restore the previous stable release for people who have not upgraded. This does not undo installed updates. Tell affected users what happened and provide the higher-version fix. Preserve corresponding source and required notices for binaries already distributed.
- **Chrome review is delayed or rejected:** desktop can remain independently available; use the documented manual ZIP fallback while correcting the store submission. An unpacked install does not acquire Chrome Web Store auto-updates by itself.

No release, tag, signing secret, repository visibility, store submission, or real installed update was changed as part of preparing these workflows.
