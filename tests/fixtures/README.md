# Generated video fixtures

`startFixtureServer()` generates one ten-second H.264/AAC test pattern with local FFmpeg and derives TS-HLS, fMP4, 1080/720/480 variants, separate audio, WebVTT and AES-128 renditions. It serves two loopback origins for iframe tests and removes its temporary media when closed. No downloaded movies, fake byte buffers or generated binary artifacts are committed.

Exports: `{ baseUrl, crossOriginUrl, directory, headers, requests, attempts, expireAfter(ms), close() }`.

Media routes:

- `/media/direct.mp4`, `/media/ts/index.m3u8`, `/media/fmp4/index.m3u8`, `/media/master.m3u8`, `/media/aes/index.m3u8`.
- `/redirect.m3u8` redirects to a playlist with relative segment URLs.
- `/cases/tiny/manifest` is a small, extensionless playlist with the correct content type.
- `/cases/{gated,expired,retry,broken,disguised,junk,throttled,live,drm}/index.m3u8`.
- `/cases/no-range/direct.mp4` ignores ranges; `/cases/throttled/direct.mp4` transfers about200KB/s.

`gated` requires all exported `headers` on every request. `expireAfter(0)` makes the expiry case return403. `retry` fails every seventh segment twice; `broken` always404s on the fifth. Disguised files contain actual video despite their names; junk files add an HTML prefix. AES-128 uses a deterministic test key, not a real credential. DRM is a synthetic unsupported manifest with no protected content.

Each file in `pages/` exercises an embedding technique; `player.js` supplies common controls. Call the actual Play button for `click.html`. `spa.html` provides `#navigate` to remove playback and change history without reloading. `external.html` is only for explicitly selected public developer test streams.

`engine.js` runs the production JobProcessor and ffprobe. A passing fixture means the saved file has real streams and expected duration/height, not merely that the right FFmpeg argument was assembled.
