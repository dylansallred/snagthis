# Security

Do not post secret tokens, cookies, signed media URLs or private video titles in a public issue. Use GitHub's private vulnerability reporting for this repository once enabled by the repository owner.

The desktop bridge binds to loopback. Private HTTP and WebSocket access requires a token: the desktop window has its own, and each paired extension gets a separate token bound to its `chrome-extension://` origin, stored only as a hash and revocable on its own. A public health response exposes only the information needed to discover and pair the app. One-click pairing requests accept only extension origins, are approved only in the desktop window after the user compares four server-chosen digits, expire after two minutes, are limited to three per five minutes, and a second concurrent request cancels both. Pairing codes expire and are rate limited.

Saved files and credentials have different lifetimes: removing a history entry must not delete the file, and removing a file must use an explicit operating-system Trash action. Completed files are not automatically deleted because of age.

Release artifacts must be built and validated before publishing. Signing credentials, GitHub tokens, multimedia build sources and dependency notices are release-owner responsibilities. Never ship a build marked `nonfree` by FFmpeg.
