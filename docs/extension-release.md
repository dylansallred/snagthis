# Chrome extension distribution and updates

Chrome Web Store is the intended distribution and automatic-update channel. Store approval and a public listing are not yet established. If approval is unavailable, the release ZIP can be distributed from this repository's GitHub Releases with manual installation instructions; a future landing page can link to that same artifact. This repository stays private during testing and will become public at launch. Private artifacts are available only to authorized collaborators.

## Build the reviewable package

Use the Node version in `.nvmrc`, install dependencies, then run:

```sh
npm ci
npm run package:extension
```

The output is `snagthis-extension.zip` at the repository root. This ZIP is the **store build**: the package script replaces `js/build-config.js` with `storeBuild: true` (the repository file keeps `false` for unpacked development copies, and packaging refuses any other shape). `scripts/package-extension.cjs` runs without a platform-specific `zip` command. Its explicit allowlist includes runtime scripts, compiled CSS, icons, the Inter font, GPL license, third-party notices, and vendor/font licenses. It excludes development movies, sample data, source styles, package metadata, logs, and arbitrary local files. Only the packaged popup HTML loses the demo script; repository previews remain available. Archive order, timestamps, and file modes are fixed, yielding identical bytes for identical inputs under the pinned Node toolchain.

The package step rejects missing runtime files, stale generated shared modules, and differing versions in `apps/extension/manifest.json` and `apps/extension/package.json`. `package:extension` first synchronizes contracts/fonts and rebuilds CSS. The manifest is at the ZIP root, as required by [Chrome's package preparation guide](https://developer.chrome.com/docs/webstore/prepare).

Extension versions have their own release cadence ([version numbers](versioning.md)). They do not have to match the desktop version or the private root workspace version. Increase both extension version fields together before uploading a new package to an existing listing. Chrome requires each uploaded version to exceed the previous one. [Updating a store item](https://developer.chrome.com/docs/webstore/update).

## Prepare an extension-only GitHub release

1. Increase the version in both `apps/extension/manifest.json` and `apps/extension/package.json`, and update the lockfile. Merge the reviewed change to `main` after CI passes.
2. From the clean, current `main` checkout, create and push an annotated `extension-vX.Y.Z` tag. For example, `git tag -a extension-v1.0.1 -m "SnagThis Chrome extension 1.0.1"`, then `git push origin refs/tags/extension-v1.0.1`. Pushing the tag starts the workflow.
3. The extension workflow checks the tag against both version fields and confirms it belongs to `main`, runs the existing cross-platform CI, and prepares the ZIP, exact source commit, and checksums in a GitHub release **draft**. GitHub's tag source archives include the extension source, build scripts, lockfile, and notices. It does not need Apple or Windows signing credentials.
4. Review the ZIP, source archives, checksums, and release notes. The tagged checkout builds with the packaging command above. Publish the draft manually when intended. **Keep extension-only releases marked prerelease and do not set them as Latest.** Those GitHub flags protect the desktop updater's stable release channel; they do not change the extension's manifest version or prevent submitting the ZIP to Chrome Web Store.

Drafts and private repository releases are available only to collaborators. Make the repository public before announcing public GitHub downloads. An existing release or draft is never overwritten; inspect and delete an incomplete unpublished draft before retrying. Desktop `vX.Y.Z` releases also include the Chrome ZIP, so an extension-only tag is needed only when releasing Chrome independently.

## Establish the store identity

The owner must supply or create the publisher account and the SnagThis store item. First upload the reviewed ZIP as a draft, complete the listing, privacy declarations, screenshots, support/privacy URLs, and reviewer instructions covering standalone direct MP4/WebM downloads and the optional paired desktop for streams/advanced features. Do not advertise a store link until the listing exists and is approved. Chrome supports submitting for review with publication deferred. [First publication](https://developer.chrome.com/docs/webstore/publish/).

Record the resulting extension/item ID and use that same item for future releases. If developers need an unpacked copy with the same ID, obtain the item's **public** key from the dashboard and configure its manifest `key` deliberately. No key or listing ID is invented by the package script. [Stable extension identity](https://developer.chrome.com/docs/extensions/reference/manifest/key).

No store credentials are needed to build the ZIP. Manual dashboard submission needs access to the owning publisher account with two-step verification. Future API automation additionally needs the publisher ID, extension/item ID, an enabled Chrome Web Store API project, and authorized OAuth credentials/refresh token or a configured service account. Keep credentials in the release secret store. The current repository workflow produces a reviewable ZIP; it does not upload or publish to Chrome Web Store. [Chrome Web Store API setup](https://developer.chrome.com/docs/webstore/using-api).

## Permissions and review material

The current Manifest V3 package declares:

| Access | Purpose in this build |
| --- | --- |
| `storage` | Trusted local pairing/preferences and Chrome-download references; temporary detected-media state. |
| `downloads` | Start, monitor, pause/resume, cancel, and reveal user-requested direct MP4/WebM downloads in Chrome. |
| `scripting` | Attach detection to pages that were already open when SnagThis was installed or updated, and to such a page when the popup opens on it. Otherwise those pages need a refresh. |
| `webRequest` | Observe media responses and their required request context. Headers are read only for media, fetch/XHR and plugin requests. |
| `webNavigation` | Reset detections when the source page changes. |
| `declarativeNetRequestWithHostAccess` | Temporarily restore observed Origin/Referer headers for bounded source previews. |
| HTTP/HTTPS hosts, including localhost | Detect embedded/CDN media and talk to the paired local desktop bridge. Host access also provides the current tab's URL and title, so the `tabs` permission is not requested. |

Request context (cookies, Origin, Referer, authorization) comes only from Chrome's own network events for the tab. Page scripts can report media URLs, but those are treated as untrusted hints: they never carry headers, and the popup prepares an automatic poster only for media Chrome observed.

### YouTube in the store build

The store build does not download YouTube videos and does not hand YouTube pages to the desktop app. A YouTube watch page is still listed, with the note “Paste this link into the SnagThis desktop app” and a **Copy link** action; no Download, **Download with desktop**, or **Continue previous download** entry appears, and the service worker rejects any YouTube download or source-refresh request in this build. Unpacked development builds (the repository folder) keep the full YouTube behaviour. Reviewer note for the store submission: “This extension does not download from YouTube. On YouTube pages it only shows the video title and lets the user copy the page link; downloads of standalone MP4/WebM files use Chrome's own downloads API, and streams use the separately installed desktop app.”

Explain these uses and the local-only handling of sensitive headers in the store declarations. Chrome-only downloads use the native downloads API; SnagThis does not bypass Chrome safety prompts, request `downloads.open`, or load a browser transcoder. Captured headers are not replayed on this path; a site requiring them can refuse the browser transfer, with an explicit desktop option available. Streams and processing use the desktop path. Runtime JavaScript, hls.js, and icons/fonts are bundled; the ZIP contains their applicable notices. The desktop downloader and its media tools are distributed separately. Reviewers should use the repository's privacy and provenance documents and the tested desktop connection-code flow. Store approval remains Google's decision. [Native downloads API and permission](https://developer.chrome.com/docs/extensions/reference/api/downloads).

The manifest supports Chrome 112+. Discovery keeps parsed playlist component URLs in `storage.session`; a supported long signed playlist can exceed Chrome 111's 1 MiB quota. Chrome 112 provides the 10 MiB quota this implementation needs. The minimum version prevents installation or updates on Chrome 111; those users must update Chrome first. Session storage remains bounded by Chrome's quota across tabs. [Storage limits](https://developer.chrome.com/docs/extensions/reference/api/storage).

## Deliver and apply updates

Upload a new ZIP to the **existing** store item, review changed listing/privacy/permission declarations, and submit it for review. A reviewed package can be staged before publication; adding permissions may require users to accept new access. The GitHub desktop release can carry the extension ZIP independently and does not constitute a store update. [Store update process](https://developer.chrome.com/docs/webstore/update).

For a store-installed extension, Chrome checks for updates at startup and periodically. Installation waits until extension components are idle; an open popup or active worker can delay it. Users can close the popup and use `chrome://extensions` → Developer mode → **Update** to request a check. SnagThis does not force-reload the user's extension or promise an immediate update. No custom `update_url` is required for the intended store path. [Chrome update lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/extensions-update-lifecycle).

For developer builds or the GitHub ZIP fallback, keep the unpacked files in one stable folder. Replace that folder's contents with the new release, open `chrome://extensions`, and choose **Reload** on the existing SnagThis installation. Refresh the video page as well, because already-open pages still have the previous content scripts. Do not remove/reinstall or move the folder as an update procedure. An unpacked ZIP does not receive Chrome Web Store automatic updates. [Unpacked installation and reload behavior](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world).

## Pairing, detected media, and existing jobs

| Data | Update behavior |
| --- | --- |
| Pairing token and preferences | Kept in trusted `chrome.storage.local`; a same-ID update/reload preserves them. Uninstalling or switching extension identity requires pairing again. |
| Detected URLs, request headers, prepared posters, and desktop tab/job mappings | Temporary `chrome.storage.session`; Chrome clears them on update/reload/browser restart. Refresh the source page to detect again. |
| Native Chrome downloads | Chrome owns transfers/history/files. SnagThis retains local download references/display metadata and hashes of source URLs, never captured headers or signed source URLs in those persistent records. Popup/worker closure does not stop Chrome transfers; same-ID updates retain references. |
| Desktop downloads and saved history | Owned by the desktop app, not the extension popup. Updating the extension does not delete or stop these desktop jobs. Existing desktop tab-to-job mappings are not restored after session storage resets. |

This retention follows Chrome's [local/session storage lifecycle](https://developer.chrome.com/docs/extensions/reference/api/storage) and the current worker implementation. Do not persist captured headers to restore old page state. The desktop also persists its pairing credential and approved extension origin in its protected local data directory.

The bridge currently supports protocol `1` and extension versions starting at `1.0.0`; these are defined in `packages/contracts/src/index.js`. Health checks and HTTP 426 responses keep incompatible clients from starting downloads. The popup now identifies whether the desktop or Chrome extension needs updating and provides the appropriate instructions. Roll out a compatible store extension before increasing the desktop's minimum extension version, since store review and client uptake are not instantaneous.
