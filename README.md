<p align="center">
  <img src="apps/extension/img/vidsnag-app-icon.png" alt="VidSnag" width="112">
</p>

<h1 align="center">VidSnag</h1>

<p align="center"><strong>Save supported web videos to your computer.</strong></p>

VidSnag is a free, open-source way to save supported web videos. Find a video in Chrome, choose the quality you want, and download it. Ordinary MP4 and WebM files can save through Chrome alone; the desktop app handles streams and extra video processing. Downloads keep going after you close the popup.

**Currently in development.** There is no public desktop installer or Chrome Web Store listing yet. You can [try it locally](#run-locally) today.

<table>
  <tr>
    <th width="65%">Your downloads, together</th>
    <th width="35%">A few clicks in Chrome</th>
  </tr>
  <tr>
    <td valign="top"><a href="docs/images/desktop.png"><img src="docs/images/desktop.png" alt="VidSnag desktop showing active downloads, a waiting video, and a saved video"></a></td>
    <td valign="top"><a href="docs/images/chrome-extension.png"><img src="docs/images/chrome-extension.png" alt="VidSnag Chrome popup showing detected videos, download progress, and quality details"></a></td>
  </tr>
</table>

Actual interfaces with sample download states. Films by the Blender Foundation; [media credits and licenses](apps/desktop/src/dev/media/CREDITS.md). Click either image for a closer look.

## From playing to saved

1. **Play a video** on a supported website, then open VidSnag in Chrome.
2. **Choose a quality** when the source offers alternatives. Available audio and subtitle choices appear with it.
3. **Choose Download.** Supported direct MP4 and WebM files go to **Chrome Downloads**, without pairing or opening the desktop app. Videos that need the desktop app appear in its **Saved** library when finished.

You can also paste a video link directly into the desktop app.

- **Clear progress:** see what is downloading, waiting, or ready to watch.
- **Download controls:** pause, resume, or retry when available.
- **Files you keep:** Chrome uses your usual download settings; the desktop app has its own save folder and library.
- **Simple cleanup:** in the desktop library, removing a video from the list keeps its file. Moving the file to Trash is a separate choice.

### When do I need the desktop app?

Chrome can save supported direct MP4 and WebM files on its own, whether or not you've paired the extension. These downloads stay in **Chrome Downloads** and are not added to the desktop library. To put a direct file in that library instead, right-click its row before downloading and choose **Download with desktop**.

HLS and DASH streams, YouTube page links, separate audio or subtitle tracks, and downloads that need video processing still use the desktop app. Keep it open for those downloads. Browser-only stream downloading is not available yet.

Use VidSnag for videos you own or have permission to save. Protected DRM videos and live recording are not supported. See the [compatibility notes](compat/COMPATIBILITY.md) for tested formats and sites.

## Connect Chrome to the desktop app

For downloads that use the desktop app, connect the two once after installing or [starting locally](#run-locally). Direct Chrome downloads do not need this step.

1. In the desktop app, open **Settings → Chrome extension → Show connection code**.
2. Choose **Copy code**, then open **Extensions → VidSnag** in Chrome and choose **Connect**.
3. Paste the six-digit code and choose **Connect**. You're ready to download.

Codes expire after five minutes. If yours expires, choose **Get a new code** in the desktop app. The connection stays saved on your device.

## Installation plans

The **Chrome Web Store** is the preferred release channel, alongside a desktop installer from this repository's GitHub Releases. Neither is published yet.

If a Web Store release is not available, the fallback is a GitHub release ZIP that you load into Chrome yourself. That method requires manual updates. See the [extension installation and release guide](docs/extension-release.md) for the process and current status.

## Your files stay yours

Downloads and video processing happen on your computer. VidSnag has no required account, telemetry service, paid tier, or artificial download quota.

The extension needs access to websites to find their videos and Chrome's downloads permission to save direct files. Downloads contact the source website directly; optional services and update checks have their own connections. Read the [privacy details](PRIVACY.md) for what the app observes and stores.

## Run locally

This is the current way to try the prerelease. You'll need Git, Node.js, and npm. Use the Node version pinned in `.nvmrc`.

From a checkout of this repository:

```sh
nvm install
nvm use
npm ci
npm run build:extension:css
```

Then open `chrome://extensions`, turn on **Developer mode**, choose **Load unpacked**, and select the repository's `apps/extension` folder. You can now try direct MP4 and WebM downloads in Chrome.

To use the desktop app too, install FFmpeg/FFprobe for video processing and optional yt-dlp for supported page-link downloads. Run `npm run dev`, then follow the [connection steps](#connect-chrome-to-the-desktop-app) above. For local development, make those tools available on your PATH, or set `FFMPEG_PATH`, `FFPROBE_PATH`, and `YTDLP_PATH`.

## Troubleshooting

- **No video found?** Start playback on the page, then open VidSnag again. Choose **No video?** in the popup for more help.
- **App not open?** The selected video needs the desktop app. Start it and, if prompted to connect, use a fresh code from **Settings → Chrome extension**. Direct Chrome downloads do not require it.
- **A download failed?** Check its message in the popup or **Chrome Downloads**. For desktop downloads, open **Details**. An expired link usually means reopening the source page and trying again.

For a bug report, include what you clicked and the error you saw. Review diagnostics before sharing them, and keep cookies, tokens, and private video links out of public issues. Report security concerns through [SECURITY.md](SECURITY.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development and verification, the [desktop release guide](docs/release-guide.md), and the [Chrome extension release guide](docs/extension-release.md) for packaging and distribution.

Licensed under [GPL-3.0-only](LICENSE). Third-party dependencies and sample media retain their own licenses; see [third-party notices](THIRD_PARTY_NOTICES.md).
