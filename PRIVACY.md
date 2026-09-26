# Privacy

SnagThis has no required cloud account, telemetry service or paid tier. Video downloads and processing happen on your device.

The Chrome extension observes media requests and page video metadata so it can identify a video. This can include the page title, source URL, poster image and request context needed by a source server. It may need access inside embedded frames. Broad site permissions support that detection; they are not permission to bypass a login or DRM.

The extension uses Chrome's `scripting` permission only to add its own detection script to tabs that were already open when it was installed or updated, so those pages can be checked without a refresh. It does not use the `tabs` permission. Request headers are only taken from Chrome's own network events, never from page scripts, and are captured only for media and data requests.

The extension uses Chrome's `downloads` permission to start and manage direct MP4 and WebM downloads you request. Chrome handles these transfers, so they can continue after the popup closes without the desktop app or pairing. These files and their download history belong to Chrome Downloads; they are not added to the desktop app's Saved library.

To restore those download rows, SnagThis stores Chrome download IDs and limited display metadata locally. It does not persist source URLs or request headers in its browser-download records. Chrome maintains its own download history, including source URLs and file locations, which you can manage in Chrome Downloads.

The desktop stores download state, preferences and a saved-file index locally. Its private bridge is paired with each browser's extension using a separate token, which either app can disconnect. Authentication headers and cookies must not be written into persisted queue files or support bundles. Diagnostics are redacted before export; users choose whether to share them.

For a YouTube download that requires sign-in, the desktop offers **Use Chrome sign-in**. After you confirm, yt-dlp reads the local Chrome cookie store and uses the matching YouTube session for that download attempt. This is off by default; the choice is not saved or reused for other downloads. SnagThis does not receive the cookie values from yt-dlp or include them in its library or diagnostics.

Requests to a source website, optional metadata providers, multimedia-tool download hosts and the configured update provider go directly to those services. Their own privacy terms apply. Optional metadata keys remain local and are omitted from exported diagnostics.

In the desktop library, removing a saved item from the list keeps the file. Moving it to Trash is a separate explicit action.
