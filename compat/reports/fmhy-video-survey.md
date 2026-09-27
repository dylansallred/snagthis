# FMHY video-site compatibility survey (2026-09-26)

Scope: 49 entries sampled from the streaming sections of https://fmhy.net/video (stream aggregators, P-Stream forks, dedicated/multi-server, anime, drama, cartoon, free-with-ads, video platforms, live TV/sports, public domain), plus the owner-reported `cinejoy.pk/watch/tv/287620/1/6`.

Method (`node compat/fmhy-survey.js`; sites in `compat/fmhy-video-sites.json`; raw evidence in the git-ignored `compat/results/fmhy/`):

- Isolated headless Chromium profile with the real unpacked extension. Popups/new windows closed, downloads refused, `window.open` stubbed, about 2 minutes per site. No challenge was solved and no login was used.
- Detection means the extension's own `GET_TAB_MEDIA` result, plus a network log with request headers. EME and MSE use were recorded by instrumentation.
- Probe: the engine's `requestMediaWithRedirects` + `buildHlsRequestHeaders` fetched the master, each variant/audio playlist, its init, the first segment (≤128 KB) and a middle segment (≤16 KB).
- Bounded engine run: `JobProcessor` with `probe: { seconds: 8 }` on the default (highest) quality. When that failed, the run was repeated on the variant the page's player had loaded. Output was checked with ffprobe and then deleted.
- `yt-dlp --simulate -J` comparison.

"Inconclusive" means the harness did not get a player to start: a server picker, an SPA route or a live event was missing. It is not a product result.

## Headline

| Outcome | Sites |
|---|---|
| Player reached and media loaded | 23 |
| – detected by the extension | 22 / 23 (all cross-origin iframe embeds detected, with the right Referer) |
| – bounded download OK on default quality | 14 |
| – OK only on a lower / player-chosen variant | 2 (cinejoy, pstream) |
| – download fails | 4 (cineby, 9anime, arte, wikimedia-transient) |
| – live, correctly declined | 2 (pluto, rutube) |
| – not detected (in-memory playlist) | 1 (bingebang) |
| Blocked: anti-bot / anti-automation | 10 (Turnstile ×5 incl. primewire links, devtools-detection → about:blank ×4, rate-limit page ×1) |
| DRM / app-only | 2 (xumo, fawesome) |
| False positive only (ad creative / chat sound) | 2 (anizone, daddylive) |
| Inconclusive (harness didn't reach playback) | 12 |

yt-dlp generic/site extractors worked on only 4 of these pages: Wikimedia, Rutube, ArteTV and MegaCartoons (generic). None of the pirate aggregators work in yt-dlp, so the extension's network capture is the only viable path for them.

## Per-site table

| Site | Player / host family | Media type | Detected | Probe result | Failure reason | Fix idea |
|---|---|---|---|---|---|---|
| cinejoy | own hls.js; CF-worker CDN `lit.cheaptruckrepairs.cc`, fMP4 as `.html` | HLS 2160 HEVC-HDR/1080/720/360 + 4 alt audio | yes | 2160: init 502, seg1 502 → fail at 0%; 1080: OK (8.1 s, h264 1080p + aac) | Dead objects on CDN for 2160p (54/123 segs), 360p (66/123), audio Track 2-4 (55/70/90 of 198) | Pick player-loaded variant; auto-fallback on persistent 5xx |
| cineby | own player, `kratos.cineby.gdn` proxy | HLS as `blob:` from POST `/api/stream/m3u8` | yes (wrong URL) | GET replay → 400 `Provide either 'url' or 'm3u8Text'` | Manifest only exists as blob / POST response | Manifest snapshot from blob/POST |
| popwatch | same-origin `/api/proxy` | HLS 1080/720 TS | yes | OK 1080p | — | — |
| pstream | P-Stream proxy → videasy/valhalla upstream | HLS fMP4 2160–360 + 2 audio | yes (2 rows) | 2160: CDN 403 when `Origin: https://pstream.cfd` (200 without) → ffmpeg exits 0, engine `ENOENT` rename; 1080 via other proxy OK | Engine synthesizes/forwards page Origin; mid-segment 503s | Don't synthesize Origin; 403 header-fallback; surface upstream error |
| kdesa | P-Stream fork `/api/m3u8-proxy` | HLS 800/534/266 TS | yes (12 rows) | OK 800p | Over-count: every tried source is a row; variants duplicated | Collapse by duration; dedupe variants |
| streamingunity | `vixcloud.co` iframe, rotating `*.boats`, `.html` segs | HLS AES-128 720/480 + Italian/English | yes (iframe) | OK | — | — |
| soapgo | embed → `proxy.youwantsee.shop` | MP4 720p | yes (iframe) | OK | — | — |
| vidbox | `cloudorchestranova.com` iframe | HLS 800/534/266 | yes (iframe) | OK | — | — |
| flyflix | `cinesrc.st` iframe, fMP4 as `.jpg/.png` | HLS 1080/720 + 2 audio | yes (iframe) | OK | — | — |
| tvids | `play.xpass.top` JW Player iframe, `.html` segs | HLS 718/360 | yes (iframe) | OK | — | — |
| justanime | `workers.dev` proxy | HLS 1080/720/360 | yes | OK | — | — |
| animeparadise | `stream.animeparadise.moe` | HLS 1080/720/360 | yes | OK | — | — |
| dramahood | `player.dramavideo.se` iframe | HLS 720/360 | yes (iframe) | OK | — | — |
| megacartoons | direct file | MP4 480p | yes | OK | — | — |
| odysee | `player.odycdn.com` | MP4 1080p | yes | OK | — | — |
| videa | direct file | WebM 480p | yes | OK | — | — |
| popcornflix | FAST, futuretodayinc CDN | HLS, no RESOLUTION | yes | OK (1080p) | Qualities unlabeled | Label from bandwidth/probe |
| arte | Akamai CMAF | HLS single-file `EXT-X-BYTERANGE`, HEVC+AVC | yes | Engine stalls at last byte-range piece (75 % for 8 s, 99 % for 6 s); plain ffmpeg 5 s; yt-dlp OK | Scoped-proxy BYTERANGE path; defaults to HEVC | Fix proxy range path; codec tie-break |
| 9anime | `abyssplayer.com` (Abyss/Hydrax) | SW-synthesized `storage.googleapis.com/...mp4#mp4/chunk` | yes (unusable) | 403 `UserProjectAccountProblem` → "expired" | URL only valid inside the player's Service Worker | Detect SW-served media; honest "unsupported" |
| wikimedia | upload.wikimedia.org | WebM transcodes | yes (5 rows) | 429 `Retry-After: 1` → immediate fail | No Retry-After handling; one row per transcode | Honor 429/503; group transcodes |
| rutube | hls.js | live HLS, redundant CDN variants | yes | `SELECTION_UNAVAILABLE` (then live) | Re-signed child URLs + duplicate heights | Dedupe redundant variants as failover |
| pluto | FAST SSAI | live HLS AES-128 | yes | declined as live | — (by design) | — |
| bingebang | own hls.js custom loader | HLS, segs as `image/jpeg` | **no** | — | Encrypted sources JSON; playlist never on network | hls.js level introspection |
| anizone | — | a-ads 728×90 webm | ad only | "downloads" a 2.5 s banner | Ad creative offered | Filter tiny/short/ad-frame media |
| daddylive | live iframe chain | chatango MP3 | junk only | ffmpeg `map 0:v:0` error | Notification sound offered | Ignore short audio; audio-only path |
| spacedom, onionplay, ridomovies, rumble | — | — | no | — | Cloudflare Turnstile | out of scope |
| primewire | link index | YouTube trailer | trailer | — | Host links behind Turnstile | out of scope |
| movish, hivex, rivestream, cinemaos | own players (rivestream→valhalla HLS, cinemaos→DASH seen) | — | no | — | Page self-navigates to about:blank under automation (headed too) | manual re-test |
| kuroanime | — | — | no | — | Site rate-limit page | out of scope |
| xumo | FAST | EME (`com.apple.fps` requested) | no | — | DRM | out of scope |
| fawesome | FAST | — | no | — | app-only; yt-dlp: DRM | out of scope |
| chillflix, mapple, lookmovie, zencine, cinego, watchseries, kisskh, aniwaves, filmzie, fsharetv, streameast, thetvapp | various | — | no | — | Harness did not start playback | manual check |

## Cinejoy (`/watch/tv/287620/1/6`) in detail

Master `lit.cheaptruckrepairs.cc/playlist/<id>.m3u8` (Cloudflare, `server: cloudflare`, `cf-cache-status: BYPASS`), captured by the extension with `Referer: https://cinejoy.pk/`, `Origin: https://cinejoy.pk`, and the browser UA; no cookies.

Audio renditions, all `TYPE=AUDIO,GROUP-ID="audio",AUTOSELECT=YES`, **no LANGUAGE, no CHANNELS**:

| NAME | DEFAULT | init `mdhd` language | channels (init) | segment status |
|---|---|---|---|---|
| Track 1 | YES | und | 2 | 198/198 OK |
| Track 2 | NO | und | 2 | 55 of 198 → 502 |
| Track 3 | NO | und | 2 | 90 of 198 → 502 |
| Track 4 | NO | und | 2 | 70 of 198 → 502 |

Variants: every one uses `AUDIO="audio"`. 2160p is `hvc1.2.4.L150.B0`, `VIDEO-RANGE=PQ`, 20 Mb/s. 1080p is avc1, 6 Mb/s, and carries a non-standard `DEFAULT=YES` on `EXT-X-STREAM-INF`. 720p and 360p are avc1. Segments are fMP4 served as `text/html` with a `.html` extension.

Root cause of "Media request failed with status 502" at 0%:

1. The popup's `chooseVariant` and the engine default to the highest variant, 2160p.
2. On that CDN, 2160p's init segment, segment 1 and 53 other segments deterministically return `502 text/plain "origin unavailable"`. This was stable over 4 rounds spaced 5 s apart and over several minutes.
3. The same URLs return the same 502 with no headers, with the engine's headers, sequentially, and from a real browser `fetch()` on cinejoy.pk. It is not a Referer/Origin/cookie, token-expiry, base-URL or concurrency problem: 16 parallel 1080p requests were all 200.
4. The site's own player never requests 2160p. It loaded 720p and 1080p plus Track 1, so the site "works".
5. The engine probe reproduced the exact message in 0.6–1.4 s with 3 attempts. With the app default of 30 attempts and backoff capped at 8 s, a dead piece is retried for about 3.5 minutes before failing at 0%.
6. 360p fails later, from segment 16. Tracks 2–4 fail mid-file.

Current surfacing: the working-tree `packages/contracts/src/audioTracks.js` `describeAudioTracks` renders these as "Track 1 · Unknown language · Default", "Track 2 · Unknown language", and so on. The popup `showQuality` audio section and desktop `QualityPicker` use it, so the names are surfaced. No language or channel data exists anywhere in this stream to improve on that.

## Failure categories (ranked by sites affected)

1. Player needs interaction or the harness couldn't route (12, inconclusive). Many aggregators start playback only after a server pick. Detection itself worked everywhere a player actually loaded.
2. Anti-bot / anti-automation (10). Turnstile, devtools-detection blanking and a rate-limit page. Out of scope. The devtools blanking probably does not affect real users.
3. Default quality / variant handling (5):
   - cinejoy and pstream: the default variant is dead or blocked.
   - rutube, arte and kdesa: duplicate same-height variants (redundant CDNs, HEVC/AVC pairs, merged masters).
4. Detection noise and over-count (4): anizone ad banner, daddylive chat sound, kdesa 12 rows, wikimedia 5 rows.
5. Playlist not replayable by URL (3):
   - cineby: blob/POST.
   - bingebang: in-memory custom loader.
   - 9anime: Service-Worker-synthesized URL.
6. Engine transport defects (3):
   - pstream: Origin injection gives 403, then a misleading `ENOENT`.
   - wikimedia: 429 without Retry-After handling.
   - arte: BYTERANGE proxy stall.
7. Live (2, by design). DRM or app-only (2).

## Generic fixes, in priority order

1. Choose a working quality and fall back automatically.
   - Mark variants whose child playlist the page player loaded. `collapseDetections` already sees them in `mediaPlaylists`; add `variant.observed = true`.
   - Default `apps/extension/popup/model.js` `chooseVariant` and the desktop picker to the highest observed variant. Use the codec-compatible highest only when nothing was observed.
   - In `packages/downloader-engine/src/core/MediaSelection.js` `resolveHlsSelection` / `JobProcessor` native path: when the init segment or the first pieces of the selected rendition fail with 5xx (or 403 after header fallback) at 0 %, restart on the next variant and record it.
   - In `NativePieceSpool`, treat a repeated identical 5xx body (e.g. "origin unavailable") as permanent after a few attempts instead of 30.
2. Header policy (`HlsNativeDownload.buildHlsRequestHeaders`, `MediaRequest.scopeMediaHeaders`).
   - Stop synthesizing `Origin` from `sourcePageUrl`. Browsers only send Origin on CORS requests, and the captured headers already contain it when it was sent.
   - On 403 from a host the browser never contacted, retry once without Origin and then without Referer.
   - Classify segment 403/5xx as "this quality/source is unavailable", not "link expired" (`packages/contracts/src/rows.js` `classifyProblem`).
3. Honor `Retry-After` on 429/503 in `sniffMedia`, `fetchText`, the spool `request` and the proxy, then retry. Evidence: Wikimedia `429, Retry-After: 1`.
4. Manifest snapshots for non-replayable playlists.
   - In `apps/extension/js/media-detector.js`, stop discarding `blob:` responses (`absolute()`), record the request method, and emit `manifestText` when the body is `#EXTM3U`.
   - Let the engine start from the captured text when the root URL is a blob or non-GET, with segment URIs resolved against the proxy URL.
   - Optionally read `hls.levels[i].details.fragments` from exposed hls.js instances for in-memory custom loaders (bingebang).
5. Variant dedupe and ordering in `collapseDetections` and `resolveHlsSelection`.
   - Dedupe by (height, bandwidth, codecs, audio group).
   - Keep attribute-identical entries as redundant failover URLs (rutube).
   - Match the selection by attributes when child URLs are re-signed.
   - Break equal-height ties toward avc1 over hev1/hvc1/HDR unless the user chose otherwise (arte, cinejoy).
6. Service-Worker-served media (Abyss/Hydrax, common on anime/drama hosts).
   - In `content.js`, flag rows whose `PerformanceResourceTiming.workerStart > 0`, or use CDP `fromServiceWorker` on desktop.
   - Show "plays only inside its web player" instead of offering a download that fails as "expired".
7. Desktop page resolver (`apps/desktop/electron/mediaPageResolver.js`).
   - The resolver enables CDP `Network` on the top target only, which misses cross-origin iframe players. In the equivalent Chromium test on flyflix, the page-target CDP saw 0 playlists and all-targets saw 4. Nearly every aggregator here uses such iframes.
   - Use `Target.setAutoAttach({ autoAttach: true, flatten: true })` and handle per-session Network events, or pick candidates from `session.webRequest.onCompleted` and fetch the body.
   - Also try one click on the largest iframe/video.
8. Noise filtering (`service-worker.js` `storeMedia` / `collapseDetections`).
   - Drop audio-only files under ~10 s and video creatives under ~10 s from ad frames.
   - Collapse rows with equal duration from multiple proxies/sources (P-Stream).
   - Group Wikimedia-style transcodes of one title.
9. Engine robustness.
   - Fix the scoped-proxy `EXT-X-BYTERANGE` stall (arte CMAF).
   - When ffmpeg exits 0 without creating `.part`, fail with `proxy.lastError` instead of `ENOENT`.

## After fixes (2026-09-26, same harness)

Re-run: `node compat/fmhy-survey.js --site cinejoy,pstream,cineby,arte,rutube,kdesa,anizone,flyflix,wikimedia,9anime,daddylive,bingebang --no-ytdlp`. The engine probe now starts on the product default (`packages/contracts` `defaultVariant`: highest rendition the page player loaded, AVC before HEVC/HDR at equal height) and sends a captured playlist snapshot when there is one. Probes stayed at 5–8 s; no full episode was downloaded.

| Site | Before | After |
|---|---|---|
| cinejoy | 2160p default, 502 at 0 % | Default 1080p (player loaded 1080/720) OK in 1.4 s. With 2160p forced: falls back to 1080p in 1.6 s, job reports `2160 → 1080`. |
| pstream | 2160p: CDN 403, then `ENOENT` | Default 1080p (observed) OK: h264 1080p + aac. Origin is no longer invented, and a 403 gets one retry with fewer headers. A clean FFmpeg exit with no output now reports the upstream error. |
| cineby | GET replay of POST playlist → 400 | Snapshot captured from the POST response; engine starts from it → h264 1080p + aac in 1.1 s. |
| arte | stalled at the last byte-range piece (60 s timeout) | h264 1080p + aac in 5–6 s. Byte-range pieces are served as separate relay resources; FFmpeg 9 had been requesting "piece to end of file". Defaults to AVC. |
| rutube | `SELECTION_UNAVAILABLE` (6 variants) | 3 variants (identical CDN copies are now failover URLs). Correctly declined as live. |
| kdesa | 12 rows | 7 rows: the three feature-length sources (8884–8888 s) merge. The remaining rows are short partial playlists with other durations. |
| wikimedia | 5 rows; 429 → immediate fail | 1 row (transcodes grouped). In the survey the engine still hit 429, because the page and the probe burst past the budget of 2 Retry-After waits per request. An isolated re-probe completed (vp9 480p + opus). |
| anizone | 2.5 s a-ads banner offered | Hidden as an ad creative (0 rows). |
| daddylive | chatango notification MP3 offered | Hidden as a short audio clip (0 rows). |
| flyflix | OK | OK (1080p observed and default). |
| 9anime | SW-synthesized URL → 403 "expired" | Unchanged. The popup's Service-Worker detection (`workerStart > 0`) did not flag this row in headless Chromium, so the honest message is not shown. |
| bingebang | not detected | Unchanged. hls.js level introspection was not implemented. |

Fixture reproductions of each failure are in `tests/site-compat-engine.test.js`: dead 5xx rendition with fallback, audio-track retention and fast permanent failure; failover copy; Origin-sensitive CDN; 403 reduced-header retry; Retry-After; POST snapshot; single-file BYTERANGE with FFmpeg 9; FFmpeg exiting 0 without output. Contract and model behaviour is covered in `tests/hls-variants.test.js`, `tests/row-model.test.js` and `tests/native-piece-spool.test.js`. Extension capture and filtering is in `tests/extension-site-compat.test.js`, and the desktop resolver in `tests/media-page-resolver.test.js`.
