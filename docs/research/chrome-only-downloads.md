# Chrome-only downloads for VidSnag

Research date: **2026-09-20**. Primary documentation was checked on that date; several underlying pages describe older API versions. The owner-approved direct-file phase is implemented in this PR and passed local verification described below. This does not establish public-release readiness or measured browser performance. The streaming-engine phases remain proposals.

## Recommendation

**This PR makes desktop optional for eligible standalone HTTP(S) MP4/WebM downloads.** Chrome provides a download manager API; VidSnag does not need to fetch an entire MP4 into JavaScript memory to save it. There is no resolution-based reason to require desktop for a direct 4K file. Retain desktop as the current path for assembled streams, separate tracks, conversion and the existing local library. [Chrome downloads API](https://developer.chrome.com/docs/extensions/reference/api/downloads)

**Browser-only HLS is technically viable, but it is another download engine, not a replacement of one API call.** Build a bounded, streaming VOD implementation after the direct-file MVP. Do not move full movies through the stock ffmpeg.wasm in-memory workflow. Its own FAQ currently documents a 2 GB input ceiling; that is a limitation of that documented implementation, not a universal Chrome download limit. [ffmpeg.wasm architecture](https://ffmpegwasm.netlify.app/docs/overview/), [ffmpeg.wasm FAQ](https://ffmpegwasm.netlify.app/docs/faq/)

For the recently observed MP4-trailer/HLS-movie combination, the trailer is the likely direct-file candidate. The actual HLS movie would still use desktop in phase 1. Classify each selected source, rather than treating every “1080p” entry alike.

## Architecture baseline and current PR boundary

- Before this PR, the [extension manifest](../../apps/extension/manifest.json) declared MV3, network observation, host access and declarative request rules but no `downloads` permission. This PR adds Chrome-managed downloads; it does not need offscreen processing, full-file Blobs or WASM for that path.
- Before this PR, [service-worker.js](../../apps/extension/service-worker.js) sent every download through the paired `/v1/jobs` bridge, and [popup.js](../../apps/extension/popup.js) expected desktop jobs. The new direct-file backend uses Chrome download identities and state. Eligible files default to Chrome whether desktop is paired or not; **Download with desktop** remains an explicit contextual action. HLS, DASH, YouTube/page extraction and track/format processing keep the desktop route.
- [JobProcessor.js](../../packages/downloader-engine/src/core/JobProcessor.js) uses Node streams/files, native FFmpeg and yt-dlp. [HlsNativeDownload.js](../../packages/downloader-engine/src/core/HlsNativeDownload.js) selects native handling for encryption, maps, byte ranges and discontinuities; it rejects live HLS and DRM-marked playlists. [MediaSelection.js](../../packages/downloader-engine/src/core/MediaSelection.js) resolves quality and audio/subtitle renditions. DASH/page sources currently route through yt-dlp; this is not universal DASH coverage.
- [NativePieceSpool.js](../../packages/downloader-engine/src/core/NativePieceSpool.js) provides bounded disk pieces and retries. [VideoConverter.js](../../packages/downloader-engine/src/core/VideoConverter.js) handles native remuxing, compatibility work and subtitles. Those dependencies cannot run unchanged in an extension.
- [source-preview.js](../../apps/extension/popup/source-preview.js) already fetches bounded footage for playback previews. A playback buffer and its `blob:` URL are not an exported movie. That code is not a full download/mux pipeline.
- [MediaRequest.js](../../packages/downloader-engine/src/core/MediaRequest.js) keeps sensitive headers on their credential origin, including across redirects; the native proxy exposes only registered resources. Preserve this behavior in any browser backend. Captured extension headers currently live in trusted session storage, not a durable credential archive.

## Capability matrix

The first two rows describe this PR’s direct-file implementation. “Possible” in the remaining rows is a future engineering assessment, not a shipped browser feature. Existing desktop capabilities are source-dependent.

| Source or feature | Chrome-only feasibility | Current PR / future scope |
|---|---|---|
| Standalone HTTP(S) MP4/WebM, already containing the wanted tracks | Straightforward file save; no video decode or remux required | This PR: Chrome |
| Direct 4K/8K or multi-GB file | Same transfer mechanism; disk, server and browser constraints matter, not the quality label | This PR when the source is an eligible standalone MP4/WebM; no artificial resolution gate |
| Direct audio file or subtitle file | Ordinary file save; a separate subtitle stays separate | Excluded from this PR; possible future addition |
| HLS VOD, ordinary MPEG-TS segments | Possible: parse, order, fetch and package segments; raw TS concatenation alone is not a general MP4 exporter | Phase 2: narrow codec/container subset; desktop today |
| HLS VOD, fMP4/CMAF | Possible: preserve initialization data, track IDs and timestamps; handle discontinuities/ranges explicitly | Extend phase 2 after simple VOD |
| HLS AES-128 with an authorized, accessible identity key | Possible with browser cryptography and correct per-segment IV/key handling; encryption alone does not imply DRM | Later phase 2; desktop already has native handling |
| HLS separate audio, alternate languages | Possible, but requires track alignment and multiplexing into one output | Desktop first; explicit later browser scope |
| Static, unprotected DASH | Possible; requires its own MPD/segment/timeline and track assembly logic | Later phase; existing desktop extractor path first |
| Subtitle merging/embedding | Sidecar text is easy; timestamp merging and container embedding require more processing | Desktop processing now; browser sidecars/embedding remain future work |
| Remux without changing codecs | Possible in a streaming JS/WASM muxer; substantially different from re-encoding | Desktop now; validated browser combinations remain future work |
| Transcoding, unsupported codecs, compatibility conversion | Technically possible for some formats; CPU, codec availability and memory become significant | Desktop recommended |
| Long/large assembled movies | Possible with incremental disk output; whole-file buffers/WASM copies are unsuitable | Desktop until streaming browser path is validated |
| Live recording | Possible in principle, but needs playlist refresh, missing-window handling, stop/finalize and storage management | Out of scope; current desktop HLS also rejects live |
| DRM-protected media | Playback authorization is not a general file-export capability | Unsupported; never present desktop as a DRM unlock |

HLS defines TS, fMP4 initialization, WebVTT and AES-128 segment encryption; implementations must preserve those semantics. AES-CBC is available through Web Crypto. These support the feasibility assessment, not a guarantee for every manifest. [HLS RFC 8216](https://www.rfc-editor.org/rfc/rfc8216.html), [Web Crypto AES-CBC](https://www.w3.org/TR/webcrypto/#aes-cbc)

DASH representations have initialization/media segments and independent timing; multiple periods can change tracks or codecs. [DASH-IF timing model](https://dashif.org/Guidelines-TimingModel/), [DASH-IF multi-period guidance](https://dashif.org/dash.js/pages/usage/multiperiod.html)

For DRM, EME interacts with content-decryption systems and permits protected media to be unavailable to ordinary web APIs. VidSnag should continue to decline it. Current HLS detection conservatively also rejects SAMPLE-AES/non-identity key formats; do not advertise all such sources as supported merely because AES exists in the browser. [W3C Encrypted Media Extensions](https://www.w3.org/TR/encrypted-media/)

## Lifecycle, disk and memory

**Direct-file path:** let Chrome own the transfer. Closing the popup or the extension worker going idle must not be treated as cancelling a browser-managed download. Store the returned download ID, reconcile it when UI/worker restarts, and expose resume only when the browser reports it can resume. Do not promise continuation after Chrome exits; the API includes shutdown/crash interruption states. [Chrome downloads API](https://developer.chrome.com/docs/extensions/reference/api/downloads)

**Custom stream path:** do not keep a movie-processing loop solely in the MV3 service worker. Chrome normally terminates it after 30 seconds idle, a single event exceeding five minutes, or a fetch response taking over 30 seconds to arrive. These worker rules are not a five-minute limit on Chrome-managed downloads. Persist recoverable job state; treat restarts as routine. [Service-worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)

A visible extension manager page plus a dedicated worker is the clearest first HLS implementation. An offscreen document is another supported host for justified Blob/worker work: it requires a bundled HTML page, only exposes `chrome.runtime` among extension APIs, and is limited to one open document per extension/profile. Non-audio reasons do not impose the audio reason’s 30-second timeout, but that is not crash/restart durability. Do not use silent audio as a keepalive. [Offscreen API](https://developer.chrome.com/docs/extensions/reference/api/offscreen)

For custom assembly, stream to a user-approved `FileSystemWritableFileStream`, or stage bounded pieces in OPFS and export the finished file. Obtain a save handle during a user gesture before lengthy preparation. `seek()` supports output-container finalization without retaining the whole movie. Permission can be revoked; check it again when reopening a job. Persistent grants exist in newer Chrome, so “always loses permission when closed” is not an accurate universal rule. [File System Access](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access), [Persistent file permissions](https://developer.chrome.com/blog/persistent-permissions-for-the-file-system-access-api)

OPFS is private origin storage, not the user's Downloads folder. Account for staged pieces, final output and temporary copies, and clean them after cancellation/completion. Quota and eviction matter; extensions can request `unlimitedStorage` or storage persistence where justified, but neither creates free physical disk or unlimited RAM. Avoid persisting media bytes in `chrome.storage`. [OPFS](https://web.dev/articles/origin-private-file-system), [Extension storage and cookies](https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies)

## Network access and sign-in

Host permissions let extension contexts make cross-origin requests; ordinary content scripts remain subject to page-origin CORS. A manifest on one host may reference video, audio, keys and redirects on other hosts. Each must have an authorized request path. Permission to fetch does not override expired URLs, server authentication or server-side rate limits. [Extension network requests](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests)

Chrome's download API includes applicable hostname cookies and accepts extra headers restricted to those allowed by XHR. It is not a verbatim replay of the player's request. `Cookie`, `Origin` and `Referer` are forbidden ordinary Fetch header names. Cookie partitioning, SameSite and browser settings can make an extension request differ from an embedded player. Do not request the `cookies` permission merely to use ordinary authenticated downloads. [Downloads headers/cookies](https://developer.chrome.com/docs/extensions/reference/api/downloads), [Fetch header rules](https://fetch.spec.whatwg.org/#forbidden-request-header), [Extension cookie behavior](https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies)

VidSnag already has declarative request-rule machinery for previews. Any future expansion of browser request-header handling should reuse its source-scoping principles only after testing browser-download requests: narrow temporary rules to the intended requests, avoid persistent secrets/global header overrides, and remove them on completion or cancellation. Session rules disappear on browser shutdown or extension update. Normal MV3 extensions cannot depend on blocking `webRequest` handlers; changing an `Origin` header also does not change the request's true initiator. [Declarative Net Request](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest), [webRequest constraints](https://developer.chrome.com/docs/extensions/reference/api/webRequest)

## Speed: what we can honestly promise

For a direct file, browser-only saving should be evaluated as an ordinary network-to-disk transfer. There is no evidence here for “desktop is always faster,” a fixed Chrome speed cap, or a fixed percentage difference. Server throttling, network conditions, connection reuse and disk performance can dominate. Saving unchanged bytes also does not become a codec-processing task because the file is 4K.

For segmented VOD, bounded concurrent requests can help either backend when the server allows it; extra requests can also trigger throttling. VidSnag already uses bounded native piece concurrency. A browser implementation needs backpressure and retry controls before increasing parallelism. Measure **fetch time, assembly time and time until a usable saved file** separately; downloaded bytes are not yet a finalized playable file.

ffmpeg.wasm's published conversion example is much slower than native FFmpeg, but it uses an older Chrome/core build and measures a specific transcode. It is not evidence that direct Chrome downloads, or stream-copy remuxing, are 12–25 times slower. Multi-thread WASM also increases resource use. [Published ffmpeg.wasm benchmark](https://ffmpegwasm.netlify.app/docs/performance/), [ffmpeg.wasm FAQ](https://ffmpegwasm.netlify.app/docs/faq/)

WebCodecs may use the browser's codec pipeline for supported conversions, but it does not eliminate the need to mux encoded chunks into a file. It is unnecessary for saving an already suitable direct video. [Chrome WebCodecs guidance](https://developer.chrome.com/docs/web-platform/best-practices/webcodecs)

## Chrome Web Store versus technical capability

The Store does not categorically prohibit video downloaders; its policies list them among products that may be available but not featured. However, Developer Agreement §4.4.1 prohibits unauthorized streaming-media downloads, infringement and knowing violations of third-party terms. A desktop handoff is not a way around that distribution requirement. Market supported, authorized use cases and review specific site integrations before making site-support claims. [Program Policies](https://developer.chrome.com/docs/webstore/program-policies/policies), [Developer Agreement](https://developer.chrome.com/docs/webstore/program-policies/terms)

Bundle executable JS and WASM with the MV3 extension. The ffmpeg.wasm documentation's CDN-loading example cannot simply be copied into a Store extension. WASM execution needs the appropriate extension CSP; multi-thread builds need compatible cross-origin isolation/SharedArrayBuffer support in the actual processing context. Include third-party codec/library license obligations in any dependency decision. [Remote hosted code](https://developer.chrome.com/docs/extensions/develop/migrate/remote-hosted-code), [Extension CSP](https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy), [Extension isolation](https://developer.chrome.com/docs/extensions/develop/concepts/cross-origin-isolation), [ffmpeg.wasm licensing](https://ffmpegwasm.netlify.app/docs/faq/)

Native messaging would still require a separately installed native host, so it changes the bridge rather than removing the desktop dependency. Do not mistake deprecated Chrome Apps `chrome.fileSystem` documentation for an MV3 extension API. [Native messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging), [Chrome Apps fileSystem API](https://developer.chrome.com/docs/apps/reference/fileSystem)

## Implementation scope and future feature tiers

### Phase 1 — direct-file implementation in this PR

The approved contract is:

1. **Eligibility:** observed standalone HTTP(S) MP4/WebM sources only. Exclude audio-only sources, subtitle/track requests, manifests, initialization resources, media fragments, MSE blobs and extraction/processing jobs. A filename suffix alone does not establish eligibility.
2. **Default action:** native `chrome.downloads` saves eligible files without desktop or pairing, even when desktop is connected. The contextual **Download with desktop** action preserves an explicit choice of the existing backend. HLS, DASH, YouTube/page extraction, remuxing and track processing remain desktop actions.
3. **Ownership and controls:** browser transfers persist across popup closure and extension-worker restart. Show progress, pause, resume when Chrome permits it, retry, and **Show in folder**. These files belong to Chrome Downloads; they do not become entries in desktop Saved. Closing Chrome itself is a separate interruption/recovery case.
4. **Resource use:** do not fetch an entire movie into extension memory, create a full-file Blob, or add a WASM conversion step. There is no invented quality gate or promised speed advantage. Keep source selection and backend identity explicit so retry cannot create simultaneous browser and desktop jobs.
5. **Privacy:** do not persist captured sensitive request headers or source URLs in VidSnag’s durable browser-download records. Chrome maintains its own download history; this constraint does not imply that browser history contains no URLs. Sensitive source context stays scoped to the active session, with no durable credential archive.
6. **Progress reconciliation:** use download state events and query current items while relevant progress UI is visible. `onChanged` excludes byte-progress updates; speed needs successive byte samples, with unknown size/ETA shown honestly. [Downloads events](https://developer.chrome.com/docs/extensions/reference/api/downloads#event-onChanged)

Local verification passed in an isolated Chrome profile with desktop offline and no pairing. The real-browser test downloads a 4,631,572-byte MP4, pauses/resumes it, closes the popup, stops the actual worker through Chrome DevTools, observes continued bytes and a fresh worker context, and recovers the saved row. FFprobe confirms 720p video, audio and ten seconds of duration; the saved bytes match the source SHA256. It also exercises an actual HTTP 403 followed by successful retry, the HLS desktop boundary, and persistent records without captured URLs/headers. Unit checks cover MP4/WebM qualification, conflicting MIME types, manifest components, ownership and unknown totals. These checks do not establish native-browser behavior for every redirect/authenticated server, multi-GB transfer, full browser restart or Store update. See [release readiness](../release-readiness.md) for the coordinated results and remaining external requirements.

### Phase 2 — proposed browser HLS VOD engine; not implemented by this PR

Start with unencrypted, finite, single-rendition H.264/AAC VOD and a streaming muxer; output one playable file without re-encoding. Add an explicit manager page, bounded fetch queue, incremental disk writer, abort/retry, durable progress and finalization. Reuse shared manifest parsing and selection rules, not Node filesystem/process code. Preserve topology checks before resuming.

Then expand deliberately to fMP4 initialization/ranges, discontinuities and identity AES-128. Separate audio, subtitle embedding and DASH add independent timeline/muxing cases; they are not free extensions of “download all segments.” Choosing and validating a maintained muxer is still open. Stock ffmpeg.wasm is a candidate for small, bounded conversions, not the default full-movie engine.

Cost drivers: media correctness across timestamps/containers; safe redirect/header scope; writable-handle and restart behavior; temporary-storage cleanup; varied manifests. No schedule estimate is justified without that implementation spike. Benchmark against the existing desktop engine with identical authorized fixtures and actual decoded output.

### User-facing tiers and copy

Use **capability tiers**, with any commercial pricing decided separately:

| Situation | Proposed text/action |
|---|---|
| Eligible direct MP4/WebM in this PR | **Download** — “Saves directly in Chrome. No desktop app needed.” |
| Explicit desktop choice for an eligible file | Contextual **Download with desktop** |
| Stream outside the browser implementation | **Use desktop app** — “This video needs stream assembly. VidSnag Desktop supports this download.” Show this only after checking desktop support. |
| Desktop enhancement | “Use VidSnag Desktop for more streaming formats, track selection, conversion and your local video library.” |
| Browser HLS introduced later | “Keep this download window open while VidSnag prepares your video.” Only promise background behavior after implementing it. |
| Known source/authentication problem | “This video link expired. Reopen the video page and try again.” Use the actual error category. |
| DRM or currently unsupported live source | “This video is not supported.” Explain the specific limitation in Details; do not advertise an upgrade that cannot fix it. |

Do not gate direct 4K files behind “Desktop required,” promise universal faster downloads, or say desktop unlocks every detected stream. The honest product promise is: **save supported files immediately in Chrome; add desktop when the requested processing needs it.**
