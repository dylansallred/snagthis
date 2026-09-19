# Privacy

VidSnag has no required cloud account, telemetry service or paid tier. Video downloads and processing happen on your device.

The Chrome extension observes media requests and page video metadata so it can identify a video. This can include the page title, source URL, poster image and request context needed by a source server. It may need access inside embedded frames. Broad site permissions support that detection; they are not permission to bypass a login or DRM.

The desktop stores download state, preferences and a saved-file index locally. Its private bridge is paired with the extension using an installation-scoped token. Authentication headers and cookies must not be written into persisted queue files or support bundles. Diagnostics are redacted before export; users choose whether to share them.

Requests to a source website, optional metadata providers, multimedia-tool download hosts and the configured update provider go directly to those services. Their own privacy terms apply. Optional metadata keys remain local and are omitted from exported diagnostics.

Removing a saved item from the list keeps the file. Moving it to Trash is a separate explicit action.
