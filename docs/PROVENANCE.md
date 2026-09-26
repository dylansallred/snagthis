# Code and asset provenance

This clean repository began from the user's local M3u8-Downloader-chrome-plugin tree at `main` commit `268fbd8`, plus the reviewed, uncommitted connection/request-context changes. The original repository remains intact. License selected by the owner on 2026-09-19: GPL-3.0-only.

| Material | Evidence and treatment |
| --- | --- |
| Downloader engine/API, Electron integration, React primitives/hooks | Ported from the project repository, then amended for the approved roadmap. This records the supplied source; Git history is not independent proof of every contributor's rights. |
| Old media detector/content script | Legacy documentation identified FetchV/FetchTVPlugin ancestry, with no established upstream permission. These files are replaced for SnagThis based on browser API behavior and the approved requirements. The replacement is not represented as an independently audited legal clean-room process. |
| Extension popup title inference | Retained project-specific title/episode inference and its tests; relevant project history includes `7f77c71`, `ea42b6b`, `01d553f`. Visible popup rendering is rewritten. |
| Extension service worker/player | Project bridge/session/player integration appears in cutover commits `4d680f0` and `de668eb`, with later project changes. The new bridge is reviewed alongside the rewritten detector and shared contracts. |
| hls.js 1.5.20 | Third-party Apache-2.0 player library; bundled license at `apps/extension/vendor/hls.LICENSE.txt`. |
| Inter and Lucide | Dependency-provided assets under their own licenses, recorded in `THIRD_PARTY_NOTICES.md`. |
| SnagThis marks | Owner-supplied project branding from the predecessor repository. |
| Gallery footage | Licensed Blender Foundation film excerpts. Keep the clip-specific credits with the development gallery. |

## Publication boundary

The preliminary local port commits were reconstructed before pushing: inherited detector/content-script blobs were omitted from the port history, and only the rewritten versions enter the implementation commit. The untouched predecessor repository remains the archive of the original material. This removes the identified unverified files from the successor's published Git history; it is not a legal certification of every supplied contribution.

No Video DownloadHelper code was used. Product behavior and the approved SnagThis design are the implementation sources.
