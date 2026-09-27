# Chrome Web Store submission kit

This folder has everything for the first SnagThis submission:

- `listing.md` is the text for each dashboard tab.
- `images/` has the screenshots and promo tiles.
- `test-page/` is a ready-made page for reviewers.

`scripts/capture-store-assets.cjs` regenerates the images.

## Before you submit

1. **Test page (done).** It lives in `site/test/` and is served at https://snagthisvid.com/test/. It follows the site's CSP and is marked `noindex`. `docs/store/test-page/` is the source copy.
2. **Test pairing on current stable Chrome.** Use a normal Chrome profile with the desktop app running. Load the ZIP's contents unpacked (or the repository folder), click **Connect**, match the digits and choose **Allow**, then save a stream through the desktop app. Newer Chrome versions can show a **Local Network Access** prompt the first time the extension contacts `127.0.0.1`. Check that it appears, that allowing it lets pairing finish, and that denying it produces a clear message. Reviewers who try the optional desktop path will see the same prompt.
3. **Decide how reviewers get the desktop app, if at all.** The site's download buttons point to GitHub Releases, which reviewers can't open while the repository is private. The reviewer notes say the desktop app is optional and not needed to test the extension. That's enough for review, but either make the download public first or leave it out.

## Build the ZIP

Use the Node version in `.nvmrc`, from the repository root:

```sh
npm ci
npm run package:extension
```

The output is `snagthis-extension.zip` in the repository root. It is the store build: YouTube downloads are turned off, the demo script is removed, and the file list is fixed. Its version is the one in `apps/extension/manifest.json` (currently 1.0.0).

## Submit

1. Open the [Chrome Web Store developer dashboard](https://chrome.google.com/webstore/devconsole). Sign in with the publisher account (two-step verification is required) and pay the one-time registration fee if asked.
2. **Account:** publisher name **SnagThis** and contact email **privacy@snagthisvid.com** (verify it). See `listing.md` section 6. Don't use a personal name.
3. **Add new item**, then upload `snagthis-extension.zip`. The dashboard creates the item and shows its **item ID**: 32 letters from a to p, also in the item's URL. Write it down.
4. **Store listing:** paste the description, then set category, language and URLs from `listing.md` section 2. Upload the images:
   - Store icon: `apps/extension/img/icon-128.png` (already compliant, with 96×96 artwork in transparent padding).
   - Screenshots, in order: `images/1-finds-videos.png`, `2-saves-to-chrome.png`, `3-quality-subtitles.png`, `4-pair-desktop.png`, `5-your-colour.png`.
   - Small promo tile: `images/promo-small-440x280.png`.
   - Marquee (optional): `images/promo-marquee-1400x560.png`.
5. **Privacy practices:** paste the single purpose statement, one justification per permission, the host permission justification and the remote code answer (No). Tick the data types and all three certifications. The privacy policy URL is `https://snagthisvid.com/privacy`. All of this is in `listing.md` section 3.
6. **Distribution:** Private (trusted testers) or Unlisted first, all regions, deferred publishing. See `listing.md` section 4.
7. **Test instructions:** paste the reviewer notes from `listing.md` section 5.
8. Click **Submit for review**. Items with access to all sites and `webRequest` often get a longer, in-depth review. Answer reviewer emails from the contact address.

## After the item exists

1. **Send the item ID.** Add the 32-character ID to `STORE_EXTENSION_IDS` in `packages/downloader-api/src/utils/security.js`, for example `Object.freeze(['abcdefghijklmnopabcdefghijklmnop'])`, and ship it in a desktop release. Until then, the desktop app shows a store-installed extension as unrecognised when it pairs. The ID is fixed from the first upload, so this can happen while the item is still in review.
2. After approval, install from the store, then check that the extension pairs, downloads and updates.
3. Switch visibility to **Public**, then paste the listing URL into `CHROME_STORE_URL` at the top of `site/main.js`. Until it is set, the site's "Add to Chrome" buttons are disabled and show "Coming soon"; once it is set, they link to the listing.
4. For each update, raise the version in both `apps/extension/manifest.json` and `apps/extension/package.json`, rebuild the ZIP, upload it to the **same** item, and update the privacy answers if permissions changed. See `docs/extension-release.md`.

## Regenerating the images

```sh
npm run build:extension:css   # only if apps/extension/popup.css is missing
node scripts/capture-store-assets.cjs
```

The script starts its own local server, captures the popup's demo modes, and builds and loads the store ZIP in Chromium to save a real clip through Chrome Downloads. It then composes the frames with the site's fonts and brand assets, and checks every file is the exact size and an 8-bit RGB PNG with no alpha. It needs Playwright's Chromium and the `unzip` command. Keep every image free of named video sites.
