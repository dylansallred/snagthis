# Chrome Web Store listing: SnagThis

Everything to paste into the Chrome Web Store developer dashboard, in the order the dashboard asks for it. Every claim here was checked against the store build of `apps/extension` (the ZIP from `npm run package:extension`, which sets `storeBuild: true`).

House rules for this listing and anything you add later:

- Never show or mention YouTube, or any other named video site, in text, images or notes.
- Don't suggest saving paid, protected or members-only content. DRM-protected video is always refused.
- Don't name a person. The publisher display name should be **SnagThis**.
- Don't link to GitHub. The repository is private until launch, so reviewers can't open it.

---

## 1. Package tab

Upload `snagthis-extension.zip` (see [README.md](README.md)). Chrome reads these two fields from `manifest.json`, and you can't edit them in the dashboard:

| Field | Value from the manifest | Limit |
| --- | --- | --- |
| Name | `SnagThis` | 75 characters (uses 8) |
| Summary | `Save MP4 and WebM videos in Chrome. Use the free SnagThis desktop app for streaming video and more options.` | 132 characters (uses 107) |

Both are accurate and fit the limits, so no change is needed. To change them, edit `apps/extension/manifest.json`, raise the version and upload a new ZIP. A possible alternative summary (106 characters): `Finds the videos on a page and saves MP4 and WebM files to Chrome Downloads. Free desktop app for streams.`

---

## 2. Store listing tab

### Description

Paste the text between the lines. It is plain text: the store doesn't render Markdown, so the bullets are typed characters.

---

SnagThis finds the videos on the page you're watching and saves them to your computer.

Open SnagThis from the Chrome toolbar and it lists each video on the page with its quality, size and length. Click download and the file is saved.

WORKS ON ITS OWN
• Saves direct MP4 and WebM video files with Chrome's own downloads, into your usual Downloads folder.
• No account, no sign-up and no extra software.
• Downloads keep going after you close the popup. Pause, resume or show the file in its folder from the popup or from Chrome Downloads.
• Pick one of five accent colours for the popup and toolbar icon.

MORE WITH THE FREE DESKTOP APP (Mac and Windows, optional)
• Streaming video (HLS and DASH) as well as single files.
• Choose the quality, audio track and subtitles when a site offers them.
• Keeps a library of everything you've saved.
• Connecting takes one click: match the four digits in both apps and choose Allow.
Get the app at https://snagthisvid.com

PRIVATE BY DESIGN
• SnagThis has no server. Nothing you browse or save is ever sent to us.
• No analytics, no tracking, no ads.
• What the extension notices on a page stays in your browser. It only goes to your own SnagThis desktop app, on your own computer, when you ask for a download.
• Full details: https://snagthisvid.com/privacy

GOOD TO KNOW
• SnagThis is for videos you own or have permission to save. Please respect each site's terms and each creator's rights.
• Videos protected with DRM can't be saved. SnagThis tells you when a video is protected, and never records, decrypts or unlocks it.
• Some sites only let a video play inside their own player. SnagThis tells you when that's the case.
• SnagThis is free and open source (GPL-3.0).

Help and troubleshooting: https://snagthisvid.com/help
Questions: privacy@snagthisvid.com

Chrome is a trademark of Google LLC. SnagThis is not affiliated with or endorsed by Google.

---

Each statement above can be checked in the build:

| Claim | Where |
| --- | --- |
| Direct MP4/WebM through Chrome Downloads | `js/browser-downloads.js` (`directExtension`, `downloads.download` with `saveAs: false`) |
| Pause, resume, cancel, show in folder | `js/browser-downloads.js` `action()` |
| Five accents on popup and toolbar icon | `shared/accents.js`, `js/accent-icon.js` |
| Streams, tracks and subtitles need the desktop app | `processingRequested()` and the manifest check route these to the desktop; see also the table on snagthisvid.com/help |
| One-click pairing with four digits | `service-worker.js` pairing flow; popup "Match in SnagThis" |
| No remote server | The only non-page network destination in the code is `http://127.0.0.1:49732` (the local desktop app) |
| DRM refused | `content.js` only observes that encryption is in use; `DRM_MESSAGE` in `service-worker.js` |

### Category

**Tools** (under Productivity). If the dashboard doesn't offer it, use **Functionality & UI**.

### Language

**English**. If the list requires a region, choose English (United States). The copy uses British spelling ("colour"), which is fine for any English listing.

### Graphic assets

| Slot | File | Notes |
| --- | --- | --- |
| Store icon (128×128) | `apps/extension/img/icon-128.png` | Already meets Google's guidance: 96×96 artwork centred in 16 px of transparent padding (alpha bounding box is 16,16 to 112,112). Upload it as it is. |
| Screenshots (1280×800) | `images/1-finds-videos.png` … `images/5-your-colour.png` | Upload in number order. All are 8-bit RGB PNGs with no alpha. |
| Small promo tile (440×280) | `images/promo-small-440x280.png` | Required for the listing. |
| Marquee promo tile (1400×560) | `images/promo-marquee-1400x560.png` | Optional. Only shown if Google features the item. |
| Promo video | Leave empty | |

What each screenshot shows:

1. **Finds the videos on the page.** The popup listing three original clips with quality, size and length. (The two rows with progress bars are desktop downloads.)
2. **Saves MP4 and WebM to Chrome Downloads.** The real store build after saving a clip with Chrome alone, with no desktop app installed ("Saved in Chrome", "Show in folder").
3. **Pick the quality and subtitles.** The quality and subtitle menu, captioned as a desktop app feature.
4. **Pairs with the desktop app in one click.** The four-digit pairing screen.
5. **Make it your colour.** The Appearance settings with the violet accent.

Screenshots 1 and 3 to 5 use the popup's built-in sample data (`popup/demo.js`, `videos.example` addresses). Screenshot 2 comes from the packaged store build loaded in Chromium. `scripts/capture-store-assets.cjs` regenerates all seven images.

### Additional fields

| Field | Value |
| --- | --- |
| Official URL | `https://snagthisvid.com`. To pick it from the list, verify the domain in Google Search Console with the publisher account. Otherwise leave it on "None". |
| Homepage URL | `https://snagthisvid.com` |
| Support URL | `https://snagthisvid.com/help` |
| Mature content | No |

---

## 3. Privacy practices tab

### Single purpose

> SnagThis finds the video files and streams on the web page the user is viewing and saves the ones the user chooses. Direct MP4 and WebM files are saved with Chrome's downloads. When the user has connected the optional SnagThis desktop app on the same computer, other formats are handed to it. Every permission supports finding, previewing and saving the videos the user picks.

### Permission justifications

Paste one per field. Each one was checked against the store build.

**downloads**

> Saves the direct MP4 and WebM files the user picks with Chrome's own download manager (chrome.downloads.download, with saveAs off and conflictAction "uniquify"). It also shows progress and lets the user pause, resume, cancel, or show the saved file in its folder from the popup (downloads.search, pause, resume, cancel, show, and the onChanged/onErased events). The extension never opens downloaded files and does not bypass Chrome's download safety checks.

**scripting**

> Adds SnagThis's own bundled detection scripts (js/media-detector.js and js/content.js, the same files declared as content scripts) to tabs that were already open when the extension was installed or updated, and to the current tab when the user opens the popup and detection isn't running there. Without it, users would have to reload every open tab. No code is injected except these packaged files.

**storage**

> chrome.storage.local keeps the pairing key for the user's own desktop app, the user's preferences (quality, subtitles, notifications, accent colour), and references to downloads started with Chrome (download ID and display details only, no source URLs or request headers). chrome.storage.session keeps the videos detected on each tab in memory while the tab is open. It is cleared when the tab closes or the browser exits. Both areas are limited to trusted extension contexts.

**webRequest**

> Many players load video through media or fetch/XHR requests that page scripts don't expose, so the extension watches the page's media, XMLHttpRequest and "other" requests (not documents, scripts, styles, images or fonts) to see which responses are video files or streaming playlists. It reads request headers for those requests (including Cookie, Authorization and Referer with extraHeaders), because many video servers only respond to the same context. The extension never blocks or modifies these requests. Headers are held in memory and dropped when the response is not media. For media, they stay in memory-only session storage for that tab, and are sent only to the user's own desktop app on 127.0.0.1, when the user asks it to download that video.

**webNavigation**

> Tells which page and frame a detected video belongs to (webNavigation.getFrame), and when the page navigates (onCommitted, onHistoryStateUpdated), so each tab's list of videos is cleared when the user leaves the page and is never mixed with a prerendered page.

**declarativeNetRequestWithHostAccess**

> When the user previews a video in the popup, the extension adds a temporary session rule that sets the Origin and Referer the source page used. The rule only applies to the extension's own GET requests (initiatorDomains is the extension's ID) to that video's server from that tab. It is removed as soon as the preview closes. No rules are declared in the manifest, and page requests are never modified.

**Host permission justification** (`http://*/*`, `https://*/*`, `http://127.0.0.1:49732/*`)

> Videos can be on any website and inside embedded frames from other domains, such as a video CDN, so detection has to run on all http and https pages. Access to all sites lets the content scripts read the page's video elements and title, lets webRequest see media requests on the site and its CDNs, lets the popup show the current tab's address and title (so the "tabs" permission isn't needed), and lets the popup fetch a short preview from the video's own server. This access is used only to find and save the videos the user picks. It is not used to read other page content, bypass logins or paywalls, or get around DRM. http://127.0.0.1:49732 is the local address of the optional SnagThis desktop app on the user's own computer. Apart from requests to the video's own site, it is the only destination the extension contacts. It is also covered by http://*/* and is listed separately so this is clear.

### Remote code

**No, I am not using remote code.**

> All JavaScript is in the package: the extension's own scripts, the vendored hls.js (vendor/hls.min.js, used only to play previews in the popup) and Lucide icons drawn inline. No script is loaded from a URL, and nothing uses eval or new Function. The extension fetches media data (video files, HLS/DASH playlists and segments) and talks to the local desktop app's JSON API on 127.0.0.1. None of this is executed as code.

### Data usage

Tick these four. The extension handles this data only on the user's device (the browser and the user's own desktop app on 127.0.0.1). Nothing goes to a developer server, because there isn't one. Google asks you to declare data an extension handles, not only data sent to a server, so disclosing it is the safe choice. It also matches the privacy policy, which describes each item.

| Data type | Tick? | What SnagThis reads |
| --- | --- | --- |
| Personally identifiable information | No | Doesn't read names, emails, addresses or IDs |
| Health information | No | |
| Financial and payment information | No | |
| **Authentication information** | **Yes** | Request headers of media requests can include cookies and Authorization. They are kept in memory for that tab and sent only to the user's own desktop app with a download the user starts. |
| Personal communications | No | |
| Location | No | IP and region are not read |
| **Web history** | **Yes** | The current page's URL and title, stored with detected videos for that tab until it closes. Chrome's download history records the source URL of files saved with Chrome. |
| **User activity** | **Yes** | "Network monitoring": the extension watches the page's media and fetch/XHR requests with webRequest. It does not log clicks, keystrokes or scrolling. |
| **Website content** | **Yes** | Video and playlist URLs, posters, durations, qualities, track and subtitle lists on the page, plus a short video preview when the user asks for one. |

Owner decision: "User activity" is the one judgement call. Google's example for it is "network monitoring", which is what the webRequest listener does, so ticking it is the conservative, consistent choice. Leaving it unticked is defensible but invites a reviewer question.

### Certifications (tick all three)

- [x] I do not sell or transfer user data to third parties, outside of the approved use cases.
- [x] I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- [x] I do not use or transfer user data to determine creditworthiness or for lending purposes.

All three are true. The privacy policy states them in its "Chrome Web Store Limited Use" section.

### Privacy policy URL

`https://snagthisvid.com/privacy`

---

## 4. Distribution tab

| Field | Recommendation |
| --- | --- |
| Payments | Free (no in-app purchases) |
| Visibility | First submission: **Private**, with a trusted tester list (your own Google account and a few testers), or **Unlisted**. Confirm that store installs update, pair and download correctly. Then switch to **Public** and announce it. |
| Publishing | Untick "publish automatically after approval" (deferred publishing), so you choose the moment it goes live. |
| Regions | All regions |

Unlisted is the simplest way to test with anyone who has the link. Private limits installs to named testers. Either way, the item ID is the same one you use when it goes public.

---

## 5. Test instructions tab (reviewer notes)

**Username / password:** leave empty. No account is needed.

**Additional instructions** (paste as is):

> SnagThis lists the videos on the current page and saves the one the user picks. Everything below works with the extension alone. No account, sign-in or other software is needed.
>
> Test page: https://snagthisvid.com/test/ has two short original clips we made ourselves: an MP4 (star-courier.mp4, 0.7 MB) and a WebM (sky-hop.webm, 0.35 MB). The direct file links are on the page.
>
> 1. Open https://snagthisvid.com/test/ and press play on the first clip.
> 2. Pin SnagThis from the Extensions (puzzle) menu and click its toolbar icon. The popup says "2 videos on this page" and lists a 720p and a 360p clip, with size and length. The yellow note "Save supported files in Chrome. Connect SnagThis for streams and more." is expected when the desktop app isn't installed.
> 3. Click the download (arrow) button on a row. Chrome saves the file to the default Downloads folder, and it appears in chrome://downloads. The row changes to "Saved in Chrome" with "Show in folder".
> 4. Optional: open the gear icon for Settings. Under Appearance, choosing an accent recolours the popup and the toolbar icon. "No video?" shows troubleshooting tips.
>
> If a page was already open before you installed the extension, SnagThis adds its detection when you open the popup. You can also reload the page.
>
> On some sites, this build lists the video muted with "SnagThis doesn't save videos from this site" and offers no action. That is intended: nothing is downloaded or handed to the desktop app there.
>
> What needs the optional desktop app: streaming formats (HLS/DASH), choosing audio tracks or subtitles, and the "Connect" button. Connect needs the SnagThis desktop app running on the same computer. The extension talks only to that app, at http://127.0.0.1:49732, and brings it forward with its snagthis:// link. You don't need it to test the direct MP4/WebM path above.
>
> Data: SnagThis has no server. Detected videos and their request headers stay in memory for that tab (chrome.storage.session). They are sent only to the user's own desktop app on 127.0.0.1, and only when the user asks it to download a video. The extension never modifies page requests. Its only declarativeNetRequest rule is a temporary session rule for its own preview requests. DRM-protected video is detected only to tell the user it can't be saved. It is never recorded or decrypted. Privacy policy: https://snagthisvid.com/privacy
>
> Contact: privacy@snagthisvid.com

**If the test page isn't live yet**, replace the test-page paragraph and step 1 with:

> Open https://snagthisvid.com/ and press play on the demo video. The popup lists one 360p clip that can be saved with Chrome.

(Both pages were checked with the packaged store build: the test page lists two videos, and the home page lists one 360p MP4.)

---

## 6. Account tab (publisher profile)

| Field | Value |
| --- | --- |
| Publisher display name | SnagThis |
| Contact email | privacy@snagthisvid.com (it must be verified) |
| Trader / non-trader | SnagThis is free and earns nothing, so "non-trader" usually applies. Check this against your own situation. |

Don't enter a personal name anywhere Google shows publicly.
