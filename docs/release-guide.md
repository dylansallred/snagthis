# Releasing SnagThis

Desktop and Chrome have separate update channels and version numbers. A desktop `vX.Y.Z` tag builds macOS Apple Silicon, macOS Intel, Windows x64, and a Chrome ZIP. An `extension-vX.Y.Z` tag prepares an extension-only release. Both workflows prepare **drafts in this repository**; a maintainer reviews and publishes them manually. The ZIP is not a Chrome Web Store publication. Follow [the Chrome release guide](extension-release.md) for the store and manual fallback.

## Readiness and prerequisites

The repository stays private during testing and will become public for launch. Source, installers, extension ZIPs, source packets, and update metadata all stay together in `dylansallred/snagthis`; no separate distribution repository is needed. Authorized collaborators can download private test artifacts through GitHub. Installed apps cannot anonymously read the private feed or drafts. Before public launch, make this repository public and publish a reviewed desktop release. Do not put a GitHub access token in the installed app. Neither workflow changes repository visibility or publishes a draft automatically.

The owner has an Apple Developer account and has configured the five Apple repository secrets below. Secret presence alone does not prove that the certificate, password, or notarization credentials work; use the signing check below before preparing a release.

The maintainer's final **Publish release** action is the publication approval. Draft preparation does not require GitHub Enterprise or a protected environment in the private repository. Repository secrets must be available to the desktop build job:

| Secret | Required use |
| --- | --- |
| `CSC_LINK` | Apple Developer ID Application signing certificate, supported electron-builder certificate input |
| `CSC_KEY_PASSWORD` | Password for that certificate |
| `APPLE_ID` | Apple developer account used for notarization |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password for that account |
| `APPLE_TEAM_ID` | Team that owns the signing identity |
| `AZURE_TENANT_ID` | Directory of the `snagthis-release-signing` app registration |
| `AZURE_CLIENT_ID` | That app registration's client ID |
| `AZURE_CLIENT_SECRET` | Its client secret (expires after two years; renew it in Microsoft Entra ID) |

Windows installers are signed through Azure Artifact Signing: account `snagthisvid` (resource group `snagthis-release`, East US) with the Public Trust certificate profile `snagthis`, backed by a completed individual identity validation that expires 20 September 2027 and must be renewed before then. The app registration holds only the *Artifact Signing Certificate Profile Signer* role on that account. `scripts/dist-windows-signed.sh` passes the account settings to electron-builder. Its publisher name, `Dylan Allred`, must match the validated identity; Windows displays it, and the updater rejects an update whose signer differs, so never change it between releases. Do not disable forced code signing to work around missing credentials. Keep a consistent signing identity across updates; macOS updates require signed applications, and the updater uses the ZIP alongside the installer. See [electron-builder's updater requirements](https://www.electron.build/docs/features/auto-update/) and [Electron code signing](https://www.electronjs.org/docs/latest/tutorial/code-signing).

Set the `CORRESPONDING_SOURCE_RUN_ID` repository variable to a successful **Prepare corresponding source** run for the exact release. This is required even if the source repository itself is public: bundled FFmpeg/ffprobe and yt-dlp builds need the reviewed source and build information identified below.

## Verify Windows signing before a release

Run **CI** manually with **Only build and verify an Azure-signed Windows installer (no release)**, or `gh workflow run ci.yml --ref workbench -f verify_windows_signing=true`. It signs with the Azure secrets, silently installs the exact installer, checks both signatures and runs a real packaged download. Test artifacts are kept for seven days; no tag or release is created.

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

### What is bundled and where its source comes from

| Binary | Platforms | Build | Licence | Complete source |
| --- | --- | --- | --- | --- |
| FFmpeg/ffprobe 9.0.1 | macOS arm64, x64 | [ffmpeg.martin-riedl.de](https://ffmpeg.martin-riedl.de), static, made by the provider's published [build script](https://git.martin-riedl.de/ffmpeg/build-script) at `f63b8aab` | GPLv3 (`--enable-gpl --enable-version3`, OpenSSL, x264, x265, zvbi, libvpx, aom, dav1d, SVT-AV1, rav1e, vvenc, libass, libbluray and others; no nonfree) | Build script, FFmpeg tarball and every library tarball at the versions the script pins. x264 is the exception: the script downloads x264 `master` and records no revision; the packet uses `0480cb05`, which was master from 2025-09-10 until after the builds. |
| FFmpeg/ffprobe n9.0.2 | Windows x64 | [BtbN/FFmpeg-Builds](https://github.com/BtbN/FFmpeg-Builds) `autobuild-2026-09-19-13-11`, `win64-gpl-9.0` | GPLv3 (about 80 statically linked libraries; `--disable-libfdk-aac`, no nonfree) | BtbN's scripts, pinned to one commit per dependency; the script runs BtbN's own download commands for every stage in that variant. |
| yt-dlp 2026.08.19 | macOS (universal2 `yt-dlp_macos`), Windows x64 (`yt-dlp.exe`) | Official PyInstaller release builds | Unlicense, plus Python and bundled packages (mutagen GPL-2.0+, certifi MPL-2.0, PyInstaller bootloader GPL-2.0 with exception, others permissive; see its `THIRD_PARTY_LICENSES.txt`) | yt-dlp at the tag commit, including its build workflow, and the source distributions of every hash-pinned package in its build requirements. |

**Compliance note.** The macOS builds have the weakest provenance. The provider builds them on its own machines and publishes only the build script. Its x264 revision is inferred rather than recorded, and its library tarballs are fetched without upstream checksums. Consider replacing them before public launch with an FFmpeg built by this repository's CI from pinned sources. SnagThis needs only `libx264` plus native codecs and TLS (SecureTransport on macOS, Schannel on Windows). That build would reduce the packet to FFmpeg, x264 and one build script, at the cost of maintaining that build and 10 to 20 CI minutes per architecture.

`fetch-yt-dlp.cjs` must pin the same yt-dlp version as `PINS.ytdlp` in `scripts/build-source-packet.cjs`. If the fetch script still downloads `latest`, the packet builder warns, and the release is covered only if `latest` still resolves to that version when the release builds. When any pin in `apps/desktop/scripts/fetch-*.cjs` changes, update `PINS` (and `MAC_LIBRARIES` if the macOS build script's set of libraries changes). The script refuses to run while `fetch-ffmpeg.cjs` no longer contains the pinned URLs and checksums.

### 1. Build the packet

Requirements: Node from `.nvmrc`, `git`, `curl`, `xz`, and Docker. Docker runs BtbN's amd64 base image; on Apple Silicon it runs under emulation, and the script sends tar extractions to the image's `bsdtar` to work around an emulation bug. Expect about 7 GB of disk use (cache plus staging) and 20 to 30 minutes on the first run. For v2.0.44 the archive was 1.3 GB: about 0.94 GB of Windows stage sources, 0.30 GB of macOS sources, 36 MB of SnagThis and 28 MB of yt-dlp. To stay under 2 GiB, the Windows stage archives are repacked without their `.git` metadata, except for the few stages whose build uses Git. Everything goes under `work/source-packet/` (gitignored), and downloads are cached in `work/source-packet/cache/` for reruns.

1. Wait for the desktop release run for `vX.Y.Z` to finish its platform jobs. Download its `release-*` artifacts, which contain `release-verification-darwin-arm64.json`, `release-verification-darwin-x64.json` and `release-verification-win32-x64.json`, for example with `gh run download <release-run-id> --pattern 'release-*' --dir work/release-reports`.
2. From a checkout that has the tag:

   ```sh
   node scripts/build-source-packet.cjs --tag vX.Y.Z --reports work/release-reports
   ```

   The script does the following:
   - archives the tagged SnagThis commit (`git archive`)
   - fetches each bundled binary's sources as described above, verifying the checksums that upstream publishes (PyPI and yt-dlp's pinned hashes, OpenSSL's `.sha256`, and the tag and commit identities)
   - checks the macOS provider's `versions.txt` against the build script's pins
   - extracts licence files and writes `BUILD-INSTRUCTIONS.md`, per-component `BUILD.md` files and `SOURCES.sha256`
   - writes `work/source-packet/release-source/snagthis-corresponding-source.tar.xz` and `corresponding-source.json`
   - runs `scripts/verify-corresponding-source.cjs`. With `--reports`, this includes the exact per-platform tool-version check that draft preparation repeats.

   Without `--reports`, the version lines come from `PINS`; use that only for rehearsals. `--ref <commit>` builds from a commit other than the tag, also for rehearsals only. `--platforms darwin-arm64,darwin-x64` limits a rehearsal to some platforms, but a release packet must cover all three.
3. Review the result:
   - Read `BUILD-INSTRUCTIONS.md` and each `BUILD.md`.
   - Check that every tool's `components` in `corresponding-source.json` lists the build scripts and libraries.
   - Optionally verify the FFmpeg tarball signatures (`gpg --verify ffmpeg-*.asc` with FFmpeg's release key `FCF986EA15E6E293A5644F10B4322F04D67658D8`).
   - Keep the archive under 2 GiB, which is the GitHub release asset limit and the most the verifier can read.

The script prints both SHA-256 values. You can recompute them with `shasum -a 256 FILE` on macOS or `sha256sum FILE` on Linux.

`corresponding-source.json` has this shape. Paths are inside the archive, and every tool lists all components it was built from:

```json
{
  "releaseTag": "vX.Y.Z",
  "sourceCommit": "40-character commit from the verification reports",
  "archiveSha256": "SHA-256 of snagthis-corresponding-source.tar.xz",
  "components": [
    { "id": "snagthis", "version": "X.Y.Z", "path": "snagthis", "licenseFile": "snagthis/LICENSE", "buildInstructions": "BUILD-INSTRUCTIONS.md" },
    { "id": "ffmpeg-mac", "version": "...", "path": "ffmpeg-macos", "licenseFile": "ffmpeg-macos/COPYING.GPLv3", "buildInstructions": "ffmpeg-macos/BUILD.md" }
  ],
  "builds": [
    { "platform": "darwin", "arch": "arm64", "tools": {
      "ffmpeg": { "version": "first line of report.ffmpeg.tools.ffmpeg.version", "components": ["ffmpeg-mac", "ffmpeg-mac-build-script", "ffmpeg-mac-x264"] },
      "ffprobe": { "version": "first line of report.ffmpeg.tools.ffprobe.version", "components": ["..."] },
      "yt-dlp": { "version": "report.ytdlp.version", "components": ["yt-dlp", "yt-dlp-python-deps"] }
    } }
  ]
}
```

### 2. Publish the archive and manifest for the workflow

**Prepare corresponding source** downloads both files anonymously over HTTPS, so draft assets and assets in this private repository do not work. Do not put tokens or pre-signed credentials in the URLs. Use a public location that you control, for example a public Cloudflare R2 bucket served from `https://source.snagthisvid.com/`:

```sh
aws s3 cp work/source-packet/release-source/snagthis-corresponding-source.tar.xz s3://BUCKET/vX.Y.Z/ --endpoint-url https://ACCOUNT.r2.cloudflarestorage.com
aws s3 cp work/source-packet/release-source/corresponding-source.json s3://BUCKET/vX.Y.Z/ --endpoint-url https://ACCOUNT.r2.cloudflarestorage.com
```

The `aws` CLI uses multipart upload for large files; `wrangler r2 object put` limits uploads to about 300 MB. Static assets on the website's Worker cannot hold a file this large. After the repository is public, a published pre-release in this repository (for example `source-vX.Y.Z`) also works. The release draft attaches the packet anyway, so the hosted copy only needs to stay up until the workflow has run. Keep it available for as long as you distribute the binaries, since that is how you meet the source-offer obligation.

### 3. Run the workflow and record its run ID

```sh
gh workflow run prepare-source-packet.yml --ref main \
  -f release_tag=vX.Y.Z \
  -f archive_url=https://source.snagthisvid.com/vX.Y.Z/snagthis-corresponding-source.tar.xz \
  -f archive_sha256=ARCHIVE_SHA256 \
  -f manifest_url=https://source.snagthisvid.com/vX.Y.Z/corresponding-source.json \
  -f manifest_sha256=MANIFEST_SHA256
gh run list --workflow prepare-source-packet.yml --limit 1 --json databaseId,status,conclusion
gh variable set CORRESPONDING_SOURCE_RUN_ID --body RUN_ID
```

The workflow runs only on `main`. It downloads exactly those inputs, verifies both hashes and the packet structure, and uploads the `snagthis-corresponding-source` artifact. It does not publish a release, and it does not replace the final binary/source match during draft preparation.

Set `CORRESPONDING_SOURCE_RUN_ID` to the ID of that successful run. If draft preparation already failed because the source packet was missing, rerun only that failed job after setting the variable. Desktop artifacts expire after 7 days and the source packet after 30 days. If required artifacts have expired, rebuild the unchanged tagged release before publication and recheck its source evidence.

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
