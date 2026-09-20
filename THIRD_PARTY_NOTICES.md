# Third-party notices

VidSnag is licensed GPL-3.0-only. Dependencies retain their own licenses; the project license does not replace them.

| Component | License / source | Distribution notes |
| --- | --- | --- |
| FFmpeg / FFprobe | [LGPL/GPL build-dependent](https://ffmpeg.org/legal.html) | Release bundles must identify the exact build and provide corresponding source and build configuration. GPL builds are permitted by VidSnag's license choice; no nonfree builds. |
| yt-dlp | [Unlicense, with differently licensed bundled components](https://github.com/yt-dlp/yt-dlp/blob/master/LICENSE) | Keep the release's bundled dependency notices; inspect the actual binary build. |
| hls.js | [Apache-2.0](https://github.com/video-dev/hls.js/blob/master/LICENSE) | Bundled player dependency; include the vendor license. |
| Electron | [MIT](https://github.com/electron/electron/blob/main/LICENSE) | Packaged Electron includes Chromium and other third-party notices; retain them. |
| React | [MIT](https://github.com/facebook/react/blob/main/LICENSE) | Retain installed dependency notice. |
| Radix UI | [MIT](https://github.com/radix-ui/primitives/blob/main/LICENSE) | Retain installed dependency notice. |
| Inter | [SIL Open Font License 1.1](https://github.com/rsms/inter/blob/master/LICENSE.txt) | License is copied alongside the extension font. |
| Lucide | [ISC](https://github.com/lucide-icons/lucide/blob/main/LICENSE) | Desktop library and extension settings icon; the extension includes `vendor/lucide.LICENSE.txt`. |
| Blender demo excerpts | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) | Development gallery only. Clip-specific attributions accompany gallery assets. |

Installed package license files are authoritative for their exact installed versions. The release pipeline must retain dependency notices and identify bundled multimedia tool sources before public binary distribution.
