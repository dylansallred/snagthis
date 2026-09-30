# Third-party notices

SnagThis is licensed GPL-3.0-only. Dependencies retain their own licenses; the project license does not replace them.

| Component | License / source | Distribution notes |
| --- | --- | --- |
| FFmpeg / FFprobe | [LGPL/GPL build-dependent](https://ffmpeg.org/legal.html) | Release bundles must identify the exact build and provide corresponding source and build configuration. GPL builds are permitted by SnagThis's license choice; no nonfree builds. |
| yt-dlp | [Unlicense, with differently licensed bundled components](https://github.com/yt-dlp/yt-dlp/blob/master/LICENSE) | The desktop bundles the release pinned in `apps/desktop/scripts/yt-dlp-release.json`, checked against the publisher's SHA2-256SUMS; source is the matching tag. Keep the release's bundled dependency notices. |
| hls.js | [Apache-2.0](https://github.com/video-dev/hls.js/blob/master/LICENSE) | Bundled player dependency; include the vendor license. |
| Electron | [MIT](https://github.com/electron/electron/blob/main/LICENSE) | Packaged Electron includes Chromium and other third-party notices; retain them. |
| React | [MIT](https://github.com/facebook/react/blob/main/LICENSE) | Retain installed dependency notice. |
| Radix UI | [MIT](https://github.com/radix-ui/primitives/blob/main/LICENSE) | Retain installed dependency notice. |
| Inter | [SIL Open Font License 1.1](https://github.com/rsms/inter/blob/master/LICENSE.txt) | License is copied alongside the extension font. |
| Jersey 15 | [SIL Open Font License 1.1](https://github.com/google/fonts/tree/main/ofl/jersey15) | The logo lettering is artwork drawn from this face by `scripts/render-brand-assets.cjs`. The desktop update chip and notes ship a Latin subset (`apps/desktop/src/assets/fonts/jersey15-latin.woff2`) with its license alongside; the website and the Chrome extension's preview player (`apps/extension/fonts/jersey15-latin.woff2`) ship the same subset. |
| Lucide | [ISC](https://github.com/lucide-icons/lucide/blob/main/LICENSE) | Desktop library and extension settings icon; the extension includes `vendor/lucide.LICENSE.txt`. |

Installed package license files are authoritative for their exact installed versions. The release pipeline must retain dependency notices and identify bundled multimedia tool sources before public binary distribution.
