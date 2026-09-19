# VidSnag for Chrome

The free extension finds videos on the current page and sends them to the local VidSnag desktop app. Downloads continue when the popup closes. This is a prerelease; installation currently uses Chrome's **Load unpacked** workflow.

1. From the repository root, run `npm run build:extension:css`. This also copies the shared row/playlist contracts and the bundled Inter font into the extension.
2. Open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select `apps/extension`.
3. Start VidSnag. In the app, open **Settings → Advanced → Connect Chrome** and get a connection code.
4. Open the extension, choose **Connect**, and enter that six-digit code. The extension remembers the resulting private local-app credential.
5. Play a video on a page, open VidSnag in the toolbar, and choose **Download**.

The 400px popup shows one video per row. Its thumbnail fills with colour as the download progresses. Pause, resume, and play are the only actions shown when relevant; quality selection appears only for real discovered variants. Right-click for rename, hide, preview, subtitles, and **Show all detected streams**. Settings has the same five preferences as the desktop app; folder changes and Advanced settings open the app.

Detection observes standard fetch/XHR responses, video elements, and Chrome's request events in every frame. HLS can be recognized by its filename, response type, or playlist body, including small and extensionless playlists. Raw video pieces are excluded. Master playlists collapse only explicitly referenced variants, or videos with identical known duration on the same page; filenames and timing alone never establish identity. Page navigation resets the list. YouTube watch-page metadata is sent as a page URL for the desktop's extractor.

Thumbnails use video metadata, posters, page images, or a frame from a readable video. Frame data is bounded to a 20 KB JPEG data URL. A neutral striped thumbnail appears when no image can be read. Unsupported or protected formats can be detected without being downloadable.

Media headers are retained only with the observed media URL in trusted `chrome.storage.session`; they are sent to the paired desktop only after a user starts a download. App credentials are stored in trusted `chrome.storage.local` and are never injected into pages. Navigation and tab closure clear page detections. The main page observer and isolated metadata collector have been rewritten around browser APIs; see the repository's provenance record for the inherited title helpers and bundled HLS player license.

The queue is polled once per second while the popup is open; health is checked every two seconds. If the app is closed, **Open VidSnag** uses its protocol handler and changes to **Get the app** if it remains unavailable. An expired link offers **Open page**; after recapture, right-click **Continue previous download** when one failed job belongs to that exact source page. The engine validates the refreshed media before reusing downloaded pieces.

Development previews render the real popup with credited open-film posters and isolated sample data: serve the repository over loopback HTTP, then open `apps/extension/popup.html?demo=default`. Other modes are `empty`, `offline`, `quality`, `settings`, `states`, `problem`, and `version`. Demo code never sends API writes. Unpacked fixture tests can choose a tab with `?tab=<id>` and a loopback API with `&apiBase=http://127.0.0.1:<port>`; remote API overrides are rejected.
