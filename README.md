# VidSnag

A free, open-source Chrome extension and desktop app for saving supported web videos. The extension finds a video; the desktop app downloads it and keeps your files available after the popup closes.

The interface follows [Workbench, simplified](docs/design/ui-design-spec.md): a thumbnail, title, quiet status line and one action. The thumbnail fills with colour as the video downloads. Extra controls live in Details and Settings.

This repository is the clean successor to M3u8-Downloader-chrome-plugin. It is under active development; it is not a published Chrome Web Store or signed desktop release yet.

## Run locally

Use the Node version in `.nvmrc` and npm. FFmpeg and FFprobe are required for video processing; yt-dlp adds supported page-URL downloading.

```sh
nvm install
nvm use
npm ci
npm run build:extension:css
npm run dev
```

For local development, multimedia tools may be installed on your PATH or supplied through `FFMPEG_PATH`, `FFPROBE_PATH` and `YTDLP_PATH`. Release bundles use the dedicated fetch scripts and must pass artifact validation; a developer's Homebrew binaries are not a portable distribution.

Load the extension:

1. Open `chrome://extensions` and enable Developer mode.
2. Choose **Load unpacked** and select `apps/extension`.
3. Open VidSnag's Settings → Advanced to get a pairing code.
4. Enter that code in the extension when prompted. Pairing stays on your device.

Play a video on a page, open the extension, then choose **Download**. You can also paste one or more links into the desktop app. A quality menu appears only when actual alternatives have been discovered.

The default local connection uses port 49732. If an older copy of VidSnag is already running, quit that copy before starting this one. Development uses a separate profile from the installed legacy app.

## What is supported

- Direct video files and finite HLS videos, including master playlists, separate renditions and standard AES-128 streams where supported by the media tools.
- Requested quality, audio and subtitles when available from the source.
- Queue management, pause/resume, saved-file history and source-specific recovery messages.
- Safe removal: **Remove from list** keeps the file; **Move file to Trash** uses the operating system Trash.

Protected DRM streams and live recording are outside the project scope. Real-site compatibility changes over time; the [compatibility matrix](compat/COMPATIBILITY.md) distinguishes verified evidence from untested entries.

## Development

```sh
npm run verify             # lint, types, unit/integration/media tests, builds, token parity
npm run test:e2e           # browser and isolated Electron checks
npm run compat            # staged compatibility report; remote sites require opt-in
```

The desktop development gallery uses the actual UI components at `http://localhost:5173/?gallery`. Sample states are demonstrations; they do not create real downloads. Refer to the gallery's media credits for the open-film excerpts.

```
apps/desktop/              React renderer and Electron integration
apps/extension/            Chrome popup, service worker and page detector
packages/contracts/       Shared row formatting, strings, HLS parsing and validation
packages/downloader-api/  Authenticated local HTTP/WebSocket bridge and history
packages/downloader-engine/ Download, retry, remux and verification
tests/fixtures/           Generated media and local test pages
compat/                  Staged site checks and evidence
docs/design/             Approved design, roadmap and implementation status
```

See [CONTRIBUTING](CONTRIBUTING.md), [PRIVACY](PRIVACY.md), [SECURITY](SECURITY.md), [provenance](docs/PROVENANCE.md) and [third-party notices](THIRD_PARTY_NOTICES.md).

## Troubleshooting

- **No video found:** press play on the page, then open VidSnag again. Use **No video?** for the detection checklist.
- **App not open:** start the desktop app. If prompted, enter a fresh code from Settings → Advanced in the extension.
- **Link expired:** reopen the source page so the site can issue a fresh link. VidSnag reuses completed pieces only when the refreshed playlist is compatible.
- **Not enough space:** choose a different save folder or free space, then retry.
- **File was moved or deleted:** use **Locate** to reconnect its list entry with the file.
- **App cannot start its local connection:** check that another VidSnag copy is not already using the local port.

For bug reports, describe what you clicked and the plain-language error. Review the redacted diagnostics before sharing; never paste raw cookies, tokens or private source URLs into a public issue.

## License

GPL-3.0-only. No paid tiers, artificial download quotas or required cloud account. Third-party dependencies retain their licenses.
