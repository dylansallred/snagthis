# Privacy

SnagThis has no required cloud account, telemetry service or paid tier. Video downloads and processing happen on your device.

The Chrome extension observes media requests and page video metadata so it can identify a video. This can include the page title, source URL, poster image and request context needed by a source server. It may need access inside embedded frames. Broad site permissions support that detection; they are not permission to bypass a login or DRM. SnagThis never captures, records, decrypts or saves DRM-protected (EME) media: it only notices that a page uses DRM so it can say so, and it does not read, record or screen-capture that video's frames.

The extension uses Chrome's `scripting` permission only to add its own detection scripts to a web page: to tabs that were already open when it was installed or updated, and to the current tab when you open the popup and that tab has no working detection script yet. It does not use the `tabs` permission. It uses `webNavigation` to tell which page and frame a request belongs to and when a page navigates, so detected videos are cleared when you leave a page.

Request headers are only taken from Chrome's own network events (`webRequest`), never from page scripts. The extension reads the headers of the page's media, `XMLHttpRequest`/`fetch` and Chrome "other"-type requests (not its documents, scripts, styles, images or fonts), which can include cookies, authorization and Referer headers, and holds each one in the extension's memory until that request's response arrives. It keeps them only for requests that turn out to be media, or that could be a playlist (text, image or generic binary replies to page scripts, kept in memory for a short time). Headers kept with a detected video are stored in Chrome's in-memory session storage for that tab, which is cleared when the tab closes or the browser exits. They are used for the extension's own preview of that video and are sent to the paired desktop app only when you send that video to it. The extension does not write them to disk.

When you preview a video in the extension, SnagThis uses `declarativeNetRequestWithHostAccess` to add a temporary rule that restores the Origin and Referer that the source page used, so the source server serves the preview. The rule applies only to the extension's own requests to that video's server from that tab, and is removed when the preview closes.

The extension uses Chrome's `downloads` permission to start and manage direct MP4 and WebM downloads you request. Chrome handles these transfers, so they can continue after the popup closes without the desktop app or pairing. These files and their download history belong to Chrome Downloads; they are not added to the desktop app's Saved library.

To restore those download rows, SnagThis stores Chrome download IDs and limited display metadata locally. It does not persist source URLs or request headers in its browser-download records. Chrome maintains its own download history, including source URLs and file locations, which you can manage in Chrome Downloads.

The desktop stores download state, preferences and a saved-file index locally. Its private bridge is paired with each browser's extension using a separate token, which either app can disconnect. Authentication headers and cookies must not be written into persisted queue files or support bundles. Diagnostics are redacted before export; users choose whether to share them.

For a YouTube download that requires sign-in, the desktop offers **Use Chrome sign-in**. After you confirm, yt-dlp reads the local Chrome cookie store and uses the matching YouTube session for that download attempt. This is off by default; the choice is not saved or reused for other downloads. SnagThis does not receive the cookie values from yt-dlp or include them in its library or diagnostics.

Requests to a source website, optional metadata providers, multimedia-tool download hosts and the configured update provider go directly to those services. Their own privacy terms apply. Optional metadata keys remain local and are omitted from exported diagnostics.

In the desktop library, removing a saved item from the list keeps the file. Moving it to Trash is a separate explicit action.

## Contact

Privacy questions, data requests and private security reports: [privacy@snagthisvid.com](mailto:privacy@snagthisvid.com). The website version of this policy is at [snagthisvid.com/privacy](https://snagthisvid.com/privacy).
