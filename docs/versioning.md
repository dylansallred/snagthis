# Version numbers

The desktop app and the Chrome extension have **separate version numbers**. They don't need to match. Compatibility between them comes from the bridge protocol, not from the version numbers.

## Why they aren't matched

- **They ship through different channels at different speeds.** A desktop release reaches users through the app's updater within hours. A new extension version goes through Chrome Web Store review, which can take days, and Chrome then updates it gradually.
- **Matching would force empty releases.** A desktop-only fix would need an extension upload with no changes, which means another store review for nothing. An extension-only fix would make every desktop user download a whole new app.
- **Chrome and the updater only ever go up.** Once either number is published it can't be reused or lowered. Two tracks that must stay equal would get stuck the first time one has to ship alone.

Users mostly see one number at a time: the desktop version is shown in Settings, and Chrome shows the extension's version on its extensions page. Release notes always name which part they cover.

## The two tracks

| | Desktop app | Chrome extension |
| --- | --- | --- |
| Version lives in | `apps/desktop/package.json` (and the lockfile) | `apps/extension/manifest.json` **and** `apps/extension/package.json` (and the lockfile), kept equal |
| Git tag | `vX.Y.Z` | `extension-vX.Y.Z` |
| Where users get it | GitHub Releases, then the in-app updater | Chrome Web Store (GitHub ZIP as a manual fallback) |
| Release guide | [release-guide.md](release-guide.md) | [extension-release.md](extension-release.md) |

The root `package.json` (`2.0.0`) and the internal packages under `packages/` are private workspace versions. They're never released and never need bumping.

Both tracks use plain `MAJOR.MINOR.PATCH` with no suffix. The desktop release workflow only accepts stable `vX.Y.Z` tags, and a Chrome manifest version can only contain digits and dots, so `1.2.0-beta` isn't allowed on either.

## When to bump what

Use [semantic versioning](https://semver.org), judged from the user's side:

- **PATCH** (`1.4.2` → `1.4.3`): bug fixes, copy changes, dependency and bundled-tool updates (FFmpeg, yt-dlp) with no visible change.
- **MINOR** (`1.4.3` → `1.5.0`): new features or noticeable behaviour changes that keep working with everything the user already has.
- **MAJOR** (`1.5.0` → `2.0.0`): a change the user has to act on, such as dropping an operating system or Chrome version, or requiring the other side to be updated (a new bridge protocol, below).

Bump only the part whose shipped files changed. Changes to `site/`, docs, tests or CI need no version bump at all.

## Keeping the two compatible

The extension and the desktop app talk over the local bridge. Compatibility is set in `packages/contracts/src/index.js`:

- `protocolVersion`, `minProtocolVersion` and `maxProtocolVersion`: the bridge protocol the desktop accepts. The extension sends its own in `X-Protocol-Version`.
- `minExtensionVersion`: the oldest extension the desktop will work with. Older extensions get HTTP 426, and the popup tells the user which side to update.

Rules:

1. **The desktop keeps accepting older extensions.** Store review and Chrome's gradual updates mean some users run an older extension for days after a release.
2. **Ship the extension first, then raise the desktop's minimum.** When a feature needs both sides, release the extension that supports it. Once most users have it, release a desktop that sets `minExtensionVersion` to that extension version.
3. **Change the protocol number only when the bridge changes incompatibly.** New optional fields don't count. A new protocol number is a MAJOR bump for whichever side needs it.
4. **When a release needs a matching version on the other side, say so** in both sets of release notes (for example: "Needs SnagThis desktop 1.3 or later").

## Rules that never change

- **Every release must be higher than the last published one** on its track. Never reuse, lower or retag a published version. To undo a bad release, ship a fix with a higher number.
- **An unpublished draft can be rebuilt** at the same version if signing or a service failed. Any code change needs a new version.
- **Desktop releases are the only GitHub releases marked Latest.** The updater and the site's download links read the latest release.
- **Keep extension GitHub releases rare,** and always mark them prerelease and not latest. The desktop updater reads release notes from GitHub's release feed, which only lists the 10 newest releases. If more than 9 extension releases come after the latest desktop release, that release drops out of the feed and desktop update checks fail. Once the extension is in the Chrome Web Store, publish extension ZIPs on GitHub only when there's a reason to.

## First public release

Both tracks launch at **`1.0.0`**: the first desktop tag is `v1.0.0` and the first extension version is `1.0.0`. The desktop app was `2.0.44` during development, carried over from the predecessor project. It was reset because nothing had been published, so no installed copy needs to update from it. The two versions will drift apart after launch, as described above.
