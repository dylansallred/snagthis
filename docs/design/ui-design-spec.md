# SnagThis UI design spec — "Workbench, simplified"

Status: **current approved interface**, reconciled with the owner's selections and implemented desktop/extension behavior on 2026-09-20. The current rules below take precedence over older alternatives in the prototype studies.

The baseline is **Workbench, simplified / A · Refined**, with **Soft focus** hover (§3), **Lines**, the **Steel · Very dark** palette, and **Orange line** header/footer treatment. Metadata uses **Solid badge**, **Inset tiles**, and **Quality first**. Thumbnails use **Three dots** and **Flush full height**. Settings use **Grouped cards**, and desktop details use the **inspector card** described in §7.

Interactive references: [UI refresh studies](prototypes/ui-refresh/index.html), [controls](prototypes/ui-refresh/controls.html), [metadata](prototypes/ui-refresh/metadata.html), and [thumbnails](prototypes/ui-refresh/thumbnails.html). They use sample data without starting downloads. The [roadmap](roadmap.md) records the historical migration plan; current release work is in [release readiness](../release-readiness.md). Superseded mock-ups are archived locally under `work/design/`.

| Popup | Desktop |
|---|---|
| ![Chrome extension](../images/chrome-extension.png) | ![Desktop app](../images/desktop.png) |

## 1. Principles

1. **One row, four things.** Every video is a row of: thumbnail, title, one quiet status line, one visible action. Nothing else is visible at rest.
2. **Keep the video clear.** Progress belongs in a compact lane beneath the text and actions, beside the full-height thumbnail. The thumbnail shows a full-colour poster or a silent loop on hover/focus; duration stays outside the image.
3. **Same row everywhere.** The popup and the desktop render the same row component with the same states and copy.
4. **Extras are one step away, never zero.** Quality/subtitles live in a menu; rename, remove, copy link, technical detail live in "⋯" / right-click; settings use named cards; desktop-only technical settings live under Advanced.
5. **Plain words.** No HLS / M3U8 / MP4 / thread / port in the default UI. The owner later chose **Segments** as the visible word for the download map (it replaces "Pieces" in all user-facing copy; older passages and class names that say Pieces refer to the same thing), and it appears only inside details.
6. **Silence when healthy.** Connection state, errors and counts only appear when they need the user. Problems are one amber sentence + one labelled button.
7. **Orange means interaction.** Primary actions, keyboard focus, and the owner's warm row-hover accent use orange. Actual download progress uses the selected Pieces colors.

How we got here: the first concepts (Ember/Focus/Cinema) were rejected as generic; a dense variant (A+) was "too much going on"; a middle variant was tried and the user preferred the simple one. When in doubt, remove.

## 2. Design tokens

Reuse the existing tokens in `apps/desktop/src/globals.css`; the extension's `src/input.css` must define the same names and values (single source of truth: copy the `@theme` block, do not fork values).

| Role | Token | Value today | Used for |
|---|---|---|---|
| Window surface | `--color-background-raised` | `hsl(215 22% 8%)` | popup body, desktop window |
| Row hover / open detail | `--color-background-hover` | `hsl(215 22% 10.5%)` | `.row:hover`, expanded detail |
| Control hover | `--color-background-active` | `hsl(215 22% 13.5%)` | icon button hover, menu item hover |
| Header/footer | `--color-surface-chrome` | `hsl(215 22% 4%)` | matching darker bars on desktop and extension |
| Video row | `--color-surface-row` | `hsl(215 22% 8%)` | row surface on both apps; equal to the window surface so the list is one flat plane |
| Video row hover | `--color-surface-row-hover` | `hsl(215 22% 11.5%)` | hover and keyboard interaction on both apps |
| Inset field | `--color-background` | `hsl(215 22% 3.5%)` | paste field |
| Divider | `--color-border-subtle` | `hsl(215 14% 15.5%)` | visible 1px line between rows, under the last row, and above the footer |
| Control border | `--color-border` | `hsl(215 15% 18%)` | labelled secondary button, settings values; desktop menus use a shadow without a border |
| Text | `--color-foreground` | `hsl(20 20% 93%)` | titles, values |
| Muted text | `--color-foreground-muted` | `hsl(20 6% 60%)` | status line, icon buttons |
| Subtle text | `--color-foreground-subtle` | `hsl(20 5% 52%)` | placeholders, footer summary (≥4.5:1 on raised surfaces) |
| Primary | `--color-primary` | `hsl(18 96% 40%)` | Download button, count badge (white labels 4.6:1) |
| Primary strong | `--color-primary-strong` | `hsl(18 96% 36%)` | hover/pressed fill for white-label buttons |
| Primary hover / focus | `--color-primary-hover` | `hsl(20 96% 52%)` | accents, outlines, indicators, focus ring; never behind white text |
| Attention | `--color-status-paused` | `hsl(44 84% 58%)` | the amber sentence |
| Success | `--color-status-completed` | `hsl(145 62% 46%)` | "Saved" in popup after finishing |
| Destructive | `--color-destructive` | `hsl(0 72% 56%)` | "Cancel download", "Move to Trash" text only |

Typography: Inter. Title 13.5px / 570 weight, with ellipsis or the popup's two-line title treatment. Status line 12px muted. Buttons 12.5px / 600. Duration is secondary text beside the desktop title or in popup metadata; never place it in a thumbnail chip.

Radii: thumbnail 0px (flush with the row), buttons 7px, menus 9px, window 10px. Spacing unit 2px; no left, top, or bottom inset around the thumbnail. Keep a 12px gap to text, 14px at the row's right edge, and vertical padding on text/actions (desktop 10px; popup 12px).

Status colours `--color-status-queued/downloading/failed/cancelled` and all `--color-segment-*` remain defined but are only used inside the details panel.

**Accent (owner revision 2026-09-26, [unique-look option 9](prototypes/unique-look/index.html)):** desktop Settings ▸ Appearance offers Orange (default), Cobalt, Violet, Mint and Magenta. The choice overrides `primary`, `primary-strong`, `primary-hover`, the focus ring, the header line, the logo's "THIS" and the pixel button's bevel shades at runtime on `<html>`, applied before first paint; the `@theme` values above stay orange so desktop/extension token parity holds. White labels stay ≥ 4.5:1 on every accent (Orange 5.04, Cobalt 5.55, Violet 6.28, Mint 4.76, Magenta 5.21 on `primary`). Chrome and buttons crossfade over 240ms; the pixel logo swaps instantly; instant under reduced motion. Progress, success green and amber problem colours never change. **Shared with Chrome (owner revision 2026-09-26):** the choice is a desktop setting (`settings.json` `accent` + `accentChangedAt`), exposed to the paired extension through `GET/POST /v1/settings` and on every `GET /v1/queue` poll (`appearance`), and pushed to the desktop window over IPC. The extension keeps its own copy in `chrome.storage.local` (mirrored to `localStorage` for first paint), offers the same five swatches in its settings sheet whether or not the app is connected, and reconciles on reconnect: the later change wins. The token map lives in `packages/contracts/src/accents.js` for both apps. The Chrome toolbar icon is drawn from the same pixel-button geometry per accent (orange uses the packaged PNGs), and the count badge uses the accent's `primary`.

## 3. The row

```
┌──────────┐  Title, one line, ellipsis                         [⋯ hover] [ action ]
│ thumb    │  Status line, one line, muted
└──────────┘
```

| Part | Popup (480px wide) | Desktop (min 640px, designed at 820px) |
|---|---|---|
| Thumbnail | 128px wide × full row height; flush left, top, and bottom; image crops to fill | same |
| Row height | minimum 96; grows with wrapped content and active progress | minimum 84; grows with wrapped content and active progress |
| Visible action | right-aligned, 30px icon button; Download uses the owner-selected **Outline + breathing glow** (orange outline whose glow swells and fades on a 2.8s cycle — only the first Download button when the popup opens breathes, twice, then rests; others are still — filling solid orange with the owner-selected **Liquid** motion on hover or keyboard focus (an oversized, slowly turning rounded shape rises inside the clipped button, giving a wavy surface and no square edge); still under reduced motion and when disabled), with its tooltip and accessible label | right-aligned, 30px high |
| Duration | metadata line beside quality and size, separated by small round dots and consistent spacing; omit separators for missing values; a separator never starts a line; problem rows show duration beside the title and their sentence may wrap to two lines | beside the title |
| Hover extras | "⋯" appears left of the action on hover or keyboard focus (same menu as right-click; arrow keys move, Escape returns focus) | "⋯" appears left of the action; saved rows also show folder |
| Divider | 1px `border-subtle` on top of every row except the first | same |

Rules:
- Exactly **one** visible action per row. If a state has no sensible action (e.g. "Finishing up…", "Waiting"), show none.
- Rows use `surface-row` against darker `surface-chrome` header/footer bars, with an orange-to-grey divider under the header and a plain divider above the footer. Hover or keyboard interaction uses **Soft focus** (owner revision 2026-09-26; replaces Focus mono): the active row changes to `surface-row-hover` and shows a solid 3px `primary-hover` left edge, while every other row (and any other open details panel) dims to 72% opacity, in colour, over 200ms ease-out. Rows that need attention (problem, missing) never dim, and a row whose ⋯ menu is open counts as active. The edge uses the owner-selected **Grow** motion: it scales out from its middle in 300ms and eases away over 380ms. On desktop there is one edge per item, spanning the row and its open details: an open item shows it in neutral grey (**Grey when open**) and it turns orange while that row is active, so two edges never stack. See the [edge and animation study](prototypes/ui-refresh/edge.html). A desktop row whose ⋯ menu is open counts as active. Both apps use identical values and timing. Nothing is drawn over thumbnails, titles or controls, and they never move. The treatment fades away on leave and does not represent download progress. Desktop keyboard focus keeps its inset orange accent. Reduced motion disables its transitions.
- Whole row is a click target on desktop: click toggles the details panel (§7). In the popup rows are not clickable.
- Right-click anywhere on a row opens the same menu as "⋯".

### 3.1 Row states — copy and action

`QueueJob` fields referenced are from `apps/desktop/src/types/queue.ts`.

| State | Condition | Status line | Thumbnail | Visible action | Hover / ⋯ |
|---|---|---|---|---|---|
| Detected (popup only) | media item not yet sent | `[1080p ⌄]  2.1 GB` (quality is a text-button, §5) | full colour | **Download** (primary) | right-click: Rename, Hide |
| Waiting | `queueStatus = queued` | `Waiting` or `Waiting · starts next` (first in queue) | full-colour poster/preview | none | ⋯: Start now, Move up, Remove |
| Downloading | `queueStatus = downloading`, not finalizing | `{pct}% · {eta}` | full-colour poster/preview | Pause (icon) | ⋯ |
| Finishing | downloading and `status` indicates remux/convert/verify | `Finishing up…` | full-colour poster/preview | none | ⋯ |
| Paused by user | `queueStatus = paused` | `Paused at {pct}%` | full-colour poster/preview | Resume (circle-play icon, tooltip `Resume download`) | ⋯ |
| Needs the user | `failed` with recoverable cause | amber sentence (§3.3) | full-colour poster/preview | labelled button (bordered) | ⋯ |
| Saved | desktop history item / `completed` | `[quality] · {size} · ✓ Saved {when}` (omit unavailable quality) | full colour | Play (icon) | folder, ⋯ |
| Saved, file missing | file not on disk | amber `File was moved or deleted` | full colour | **Locate** (bordered) | ⋯: Remove from list |
| Popup, desktop download finished | desktop job completed | green `Saved` | full colour | **Play** | — |
| Popup, Chrome download finished | browser job completed | `Saved in Chrome` | full colour | **Show in folder** | Chrome download details |

`cancelled` jobs leave the list at once, collapsing over 180ms (instant under reduced motion) (toast: "Download cancelled · Undo" for 5 s). They never render as rows.

### 3.2 Formatting

Quality uses the selected **Solid badge**: a silver tier label with dark text beside the exact resolution (SD / 480p, HD / 720p, FHD / 1080p, 4K / 2160p). Unknown or unrecognised resolutions never receive an inferred tier. Keep the badge on the main row; quality-dropdown items use resolution text only.

| Value | Rule | Examples |
|---|---|---|
| `{pct}` | `Math.floor(progress)`; never show 100% (switch to Finishing) | `34%` |
| `{eta}` | from `etaSeconds`. `<60` → `under a minute left`; `<3600` → `{m} min left`; else `{h} hr {m} min left`; `null`/unknown → omit the ` · {eta}` part entirely | `5 min left` |
| `{size}` | 1 decimal for GB, integer for MB; unknown → `N/A`; estimates are prefixed `about` only inside menus/details | `182 MB`, `2.1 GB`, `N/A` |
| `{when}` | `today`, `yesterday`, weekday within 7 days, else `12 Sep` | `Saved today · 182 MB` |
| Duration | `m:ss` or `h:mm:ss`; hidden when unknown | `2:20:06` |
| Speed | never in rows. Total speed in desktop footer; per-job speed in details | `7.3 MB/s` |

### 3.3 Problem sentences

One sentence, amber, ends with a full stop only if it contains two clauses. One labelled button.

| Cause (map from `job.error` classification) | Sentence | Button |
|---|---|---|
| Source URL expired / 403 / 410 on manifest | `Link expired. Reopen the page to continue from {pct}%.` | Open page (desktop; afterwards the status reads `Play the video in Chrome, then click SnagThis to continue from {pct}%.`) |
| (popup, same state) | `Link expired at {pct}%. Play the video, then click Download to continue.` | Download (continues the job) |
| Network unreachable / retries exhausted | `Connection lost at {pct}%` | Try again |
| Disk full / not writable | `Not enough space in {folder}` | Choose folder |
| Unsupported / DRM | `This video can't be downloaded` | Details |
| Output file missing | `File was moved or deleted` | Locate |
| Anything else | `Something went wrong at {pct}%` | Try again |

Raw error text is only shown in the details panel.

**Speed trace (owner revision 2026-09-26, [row-activity option 2](prototypes/row-activity/index.html)):** a collapsed downloading row shows a speed trace in the empty space of its text column — a miniature of the Details speed chart with its scale easing to the recent peak and a glowing head dot. Its width is fluid: it starts 16px after the longer of the title and status lines and runs to the row's action column (12px before More), spanning the height of both lines, so short titles get a long trace and long titles a short one; below 48px it hides. It never overlaps text, the thumbnail, the progress lane or controls. It starts at its left edge and grows rightward one fixed 6px step per sample; once the head reaches the right edge it stays pinned there and older samples scroll off the left. It appears from the second sample, because the line's start is the download's real start and needs no zero padding. When the text pushes into it, the trace shrinks at once with a little slack and only reclaims width after the text shrinks by more than 32px, so a ticking status line does not shift it. Paused rows freeze it grey at 60% opacity; finishing rows freeze it amber; a just-saved row turns it mint, then it fades with the lane. Rows without an action keep the button's width so trace ends align. It is hidden while Details is open or the row is being renamed, reuses the Details chart's samples, and carries a non-live label such as "Download speed 3.91 MB/s".

## 4. Video thumbnails and row progress

The owner replaced the original colour-fill thumbnail on 2026-09-19. Earlier screenshots and mock-ups record the previous design; they do not override this revision.

- Show one unobscured full-colour poster, or a silent real video excerpt. No grayscale mask, progress clipping, scan-line or duration badge belongs inside the thumbnail.
- Use the selected **Flush full height** layout: a 128px-wide, square-cornered thumbnail reaches the row's left, top, and bottom edges on both surfaces. Use `object-fit: cover`; the frame follows the whole row height, including the area beside progress, rather than imposing a 16:9 display box. Keep titles, duration, quality, and actions outside it.
- When no usable image is available, use **Three dots**: three small neutral dots pulse in sequence at the centre of a dark placeholder. This indicates thumbnail loading, never download progress. Keep the dots still under reduced motion; remove them when a real poster or preview is shown.
- A roughly ten-second clip loops only while the row is hovered or has keyboard focus. Stop when focus/pointer leaves, the page is hidden or the row is removed. Respect reduced motion by retaining the still poster.
- Put video duration beside the desktop title. In Chrome, move it to the quality-and-size line so long titles have more space; the Download action is an icon button.
- Retain the poster while a clip is unavailable, being generated or fails to play. On desktop, produce clips from already-downloaded footage; do not wait for the entire video. For long segmented videos, allow one interim excerpt around 30 seconds, then replace it once with the real 35%-of-video scene when those segments arrive. Sampling 35% of a short opening excerpt does not qualify as the representative scene. Completed files can repair legacy or interim previews on demand.
- The Chrome popup must provide its own thumbnail and hover/focus excerpt before a desktop job exists, including when the desktop is offline. Use a short, bounded preview from an observed playable source, favour low preview quality, and stop playback/loading when no longer needed. Reuse a ready desktop clip when available. This later owner clarification replaces the earlier assumption that all previews must wait for local desktop media.
- Generated desktop preview artifacts use 16:9 without added black padding; posters and clips both crop to fill the selected full-height display frame. Older padded preview artifacts regenerate on demand. Large direct-file extension previews may use later playable footage within a bounded prefix; they must verify the decoded frame rather than trust a seek timestamp or a truncated file's reported buffer duration. A smaller initial poster probe can fall back to the existing larger bounded read if decoding needs it. Source requests may restore the Origin and Referer captured for that media host, only during the preview.
- For seekable sources, choose a scene around 35% of the full duration; prefer alternatives at 50% and 25% before looking farther afield when frames are black. Do not cap long-video sampling at the opening minute. For short files, prefer a shorter useful excerpt over forcing the scene to time zero just to reserve ten seconds.
- A YouTube popup preview may capture the already-playing page video locally. Keep the supplied YouTube artwork; do not seek, play or pause the user's page to prepare a hover preview. Paused or uncapturable page video keeps its poster. No desktop job or new sign-in is required for this local capture.
- Drive row progress from actual `job.progress`, with the existing status sentence and accessible progress value. Pause motion while paused or waiting. Motion may indicate activity, but must never invent progress.
- Both surfaces use the selected **Pieces** treatment: 40 aggregate progress cells in a 7px-high lane beneath the text and actions only. The full-height thumbnail occupies the left column beside this lane, with no progress drawn beneath or over the image. Completed cells settle in muted green (`#80bfa6`). The owner-selected **Spark** motion: the current cell fills amber (`#f4c38a`) from the left with real progress while pulsing gently (1.9 seconds), and each cell finished while the row is on screen flashes white with a short burst of light (520ms). Opening a list or popup never replays sparks for earlier cells. At most one spark per 250ms; the current cell's fill eases over 400ms linear. Paused and problem lanes show finished cells in desaturated `#5f7f73` so they read differently from active ones. The lane represents overall progress, not the actual number of media chunks. Paused/problem and reduced-motion states are still; detected, waiting and saved rows have no lane. Desktop uses an 8px gap above the lane to remain compact. The earlier extension studies are archived locally; the thumbnail study supersedes their full-width lane geometry.
- The earlier A+B motion comparison is archived locally. Its warm background fill, glowing edge and sweep are superseded on both surfaces; they are not current production requirements. The detailed desktop Pieces map continues to show actual segment telemetry separately.
- Do not put “Preview,” clip-length labels or other hover text over the video. Accessible labels may describe the preview without occupying video space.
- Saved desktop rows retain a small checkmark badge by their status, while their background remains quiet.
- Prefer a representative, nonblack frame from downloaded media over a page screenshot or generic site poster. Preserve YouTube's supplied artwork. Repair old saved-video posters when preparing their local previews. Poster updates must not reset download progress.
- Reject black candidate frames and sample another part of the available video. During downloading, retry as new local footage becomes available. If no usable frame exists yet, keep the existing poster or neutral placeholder instead of publishing a black replacement.

- The speed trace advances one 6px step per 650ms sample: its head glides smoothly while the trace grows, and only once it is full does the line scroll smoothly beneath the pinned head. Its scale eases 6% per frame. Width changes from window resizes or text changes are observed with one shared ResizeObserver and redrawn once on the next animation frame, with no text measurement reads. Under reduced motion it updates only when a sample arrives, with no gliding, scrolling or glow. It does no work off screen, in a hidden window, or while its row is expanded.

## 5. Popup (`apps/extension`)

Width 480px, per owner revision: quality, size, and feature-length duration fit on one metadata line. Max height 560px; the list scrolls, header and footer are fixed. Chrome controls the native popup window's outer corners.

```
┌ header ─ logo · "{n} videos on this page"                         ┐
│ [banner — desktop connection or compatibility guidance, if needed] │
│ rows…                                                             │
└ footer ─ ⚙ · "No video?"                     "Open SnagThis" (n)  ┘
```

| Element | Spec |
|---|---|
| Brand and surfaces | Use the full SnagThis logo artwork instead of a mark with separately typeset text: the owner-approved pixel lockup (round 9: W5 · I3 · B4 · zover · A10, [prototype](prototypes/logo-rebrand/round9-pixel-wordmark-idle.html#W=w5&I=i3&B=b4&L=zover&launch=a10)) — `SNAGTHIS` in capitals from the Jersey 15 pixel face (SNAG white, THIS orange `#fa5d0e`), followed by the **Pixel bevel** play button. The button is the 16 × 16 stepped-corner orange tile lit from the top left (amber `#ffb238` edge, deep-orange `#bd3f00` edge) with a night `#0c0e11` stepped triangle and a one-pixel deep-orange shadow. One letter pixel equals one button pixel: 15-pixel capitals, a 16-pixel button one pixel taller than the capitals and centred on them, an 8-pixel gap. The artwork is pixel paths generated by `scripts/render-brand-assets.cjs` (no font ships), shown 120×22px with one logo pixel per CSS pixel. The popup count sits independently at right. The popup count sits independently at right. Header and footer use `surface-chrome`, an orange-to-grey line under the header, and a plain footer divider. Desktop matches the same treatment. |
| Header text | `No videos yet` / `1 video on this page` / `{n} videos on this page`. No connection indicator when healthy. |
| Row order | Longest known duration first, shorter videos below; unknown durations last. Equal durations keep their discovery order. |
| Footer left | Settings (gear icon, opens the settings sheet §8), `No video?` (opens help: the empty-state text plus `Some sites protect their videos. See troubleshooting.`, linked). |
| Footer right | `Open SnagThis` focuses the connected desktop app; when unpaired it opens connection setup, and when the app is unreachable it becomes `Don't have the app? Get it`. The orange count badge counts desktop downloading/waiting jobs only and is hidden at 0. |
| Removed from today's popup | "Bridge" pill, "Detected Media" heading, refresh icon (auto-refresh on open), "Clear Media" button (replaced by per-row Hide in right-click; list resets on navigation), API host:port text, type/resolution pills, hostname + content-type row, Stream button (moved to right-click → "Preview"). |

### 5.1 Download flow

1. Click **Download**. Supported standalone MP4/WebM files use Chrome's native downloader without desktop pairing. Streams, separate tracks, processing, and an explicit **Download with desktop** choice use the desktop app.
2. Show a starting state while submission is pending, then reflect the accepted download's real progress. Keep the thumbnail clear. If a source needs desktop and it is unavailable or unpaired, show **Use desktop app** guidance rather than starting a browser download.
3. The extension worker owns browser-download state and desktop job mappings, so closing and reopening the popup preserves the appropriate row. Refresh browser state from the worker and desktop state from `GET /v1/queue` while open; do not make browser state depend on desktop health.
4. Chrome completion shows **Saved in Chrome** with **Show in folder**. Chrome controls its save location, safety prompts, and resume support; these files are separate from the desktop library. Desktop completion shows **Saved** with **Play** through the app.
5. Show progress, pause/resume, retry, and errors according to the selected backend. When Chrome has no total size, show its downloading state without inventing a percentage.

Closing the popup never cancels either kind of download. Desktop downloads still require the desktop app to keep running.

### 5.2 Quality menu

- Trigger: a compact borderless dark button in the status line (`1080p ⌄`), with brighter text, an orange chevron, and distinct hover/open feedback. Rotate the chevron and expose `aria-expanded` while open. Keep its width stable so size and duration do not shift. Shown only when more than one real variant was discovered; otherwise plain text (`720p`) or nothing.
- Default selection: user's Preferred quality setting (default "Best"), falling back to the highest available.
- Items: one per discovered variant, highest first: label `{height}p`, right-aligned size. Dropdown items use resolution text only (such as `1080p` or `720p`), without tier badges; keep the main-row quality badge. Label bitrate × duration ÷ 8 estimates with `about`; show `N/A` in the row and menu when neither a total nor an estimate is available. Playlist response bytes are never the video size. `Audio only` last, only if an audio rendition exists.
- Group `Audio <N tracks>`, only if more than one separately downloadable audio rendition exists (owner-selected **Labels 2 · Plain language** and **Sample 3 · Hover to hear**, [audio-tracks](prototypes/audio-tracks/index.html)). A `Quality` title then heads the variants and the menu widens to 286px. Each track is a `menuitemradio`: bold title with tags, then one muted line. The DEFAULT rendition is selected by default; the trigger reads `1080p · {language or Track N}` while audio tracks exist.
  - **Labels** (shared by both surfaces, `packages/contracts/src/audioTracks.js`): the language's English name from `LANGUAGE` / DASH `lang` via `Intl.DisplayNames` (`hin` → Hindi, `es-419` → Spanish (Latin America)); `und`, `mul`, `zxx`, `mis`, `qaa–qtz` and codes returned unchanged are unknown. Keep `NAME` / DASH `label` only when it adds meaning (not `Track 2`, `Audio`, a copy of the code or of the language name). Tags: `5.1`, `7.1`, `Atmos` (JOC) chips only when channel layouts differ between tracks (`Stereo` then goes in the muted line); `AD` chip from `public.accessibility.describes-video` or DASH Role/Accessibility `description`; `Commentary` from DASH Role or the name; `Default` from `DEFAULT=YES` / Role `main`. Nothing known: title `Track N`, line `Unknown language` (`· Default`), and a note under the group: “This site doesn’t name its tracks. Rest on one to check.” Identical renditions repeated across `GROUP-ID`s collapse into one track; titles that still match get `· 2`.
  - **Choosing** sends the rendition identity (`selection.audioTrack`: language, name, channels and characteristics, not the URL or group) only when it differs from the DEFAULT; the engine resolves it within the chosen variant's audio group, so nameless tracks without `LANGUAGE` download correctly. DASH (yt-dlp) choices are offered only when every track has a distinct language and send `audioLang`. The popup asks the desktop's `/v1/health` `features` for `audio-track` before sending a choice.
  - **Hover to hear:** after the pointer or keyboard focus rests on a track for 500ms, fade in a 10-second sample from 25% into that rendition at moderate volume; a speaker glyph animates, the row tints and a 2px line shows progress. Only one sample plays. It stops on pointer leave or blur, choosing, the first Esc (the second closes the menu), closing the menu or popup, and when the popup is hidden. Space plays or stops the focused track; Enter chooses. Loading shows a stepped speaker; failure shows amber `Sample unavailable · you can still choose it` and the track stays choosable. Announce loading, playing, stopped and failed politely. Reduced motion removes the speaker animation and dwell line and moves progress in whole seconds; sound is unchanged. Popup samples load the audio playlist into an `<audio>` element with the vendored hls.js through the bounded source-preview loader and restored Origin/Referer session. Muxed-only sources show labels only.
- Second group `Subtitles`, only if subtitle renditions exist: languages, then `None`.
- Menu is a fixed overlay anchored under the status line when space allows, 250px wide, fitted inside the existing popup bounds. A short popup grows to at least 300px (max 560px) while a menu is open; the menu opens below its trigger, flips above only when it cannot fit, never covers the header and is never clipped. Rows, thumbnail, title and header do not move. Initial and restored focus must not scroll the page. Keyboard: ↑/↓, Enter, Esc; `role="menu"` with `menuitemradio`.
- Duplicate detections (master playlist + its variant playlists, same video as HLS and MP4) must collapse into **one row**; the alternatives become menu items. Collapse only when the variant URL is listed in the master playlist, or duration and page match exactly; never on filename similarity alone. Escape hatch: right-click a row → `Show all detected streams` expands the collapsed items as separate rows for that page visit.
- Duration, resolution, and artwork belong to the matching media source. Switching a page player from a trailer to a movie must keep their detections separate and preserve each source's metadata; parsed media-playlist duration is authoritative. Keep each known source duration visible beside size in the popup metadata, including when size is `N/A`, so trailers and full videos remain distinguishable.

### 5.3 Popup thumbnails

Order: supplied YouTube artwork → usable current or verified preview frame → `<video poster>` → placeholder. Generic non-YouTube `og:image` / `twitter:image` artwork is not used as a video-poster fallback. The content script rejects black/blank frames and silently falls back when the canvas is tainted; it must not seek or alter page playback. Captured frames are ≤ 20 KB JPEG data URLs (208×116). A verified frame from the popup's own short source preview is retained with its detection in `chrome.storage.session`, so reopening the popup can reuse it without requiring a desktop job. Preserve supplied YouTube artwork.

If a visible popup row has no usable poster, start one bounded frame extraction on popup open without waiting for hover. Use the existing middle-of-video sampling and black-frame fallback, stop after obtaining a usable frame, and retain it with that detection. Work one row at a time; stop when the popup closes or becomes hidden, and give hover playback priority. Do not automatically loop or alter playback on the source page.

Prepare a representative poster before popup opening when the source page has already decoded a usable frame between 35% and 80% of its duration. Capture once for that source and page visit, through the existing detection/session metadata; this must not seek, start playback, or fetch media. Opening frames are not treated as representative scene posters. Keep offsets from a partial direct-file prefix distinct from offsets in the full source, so a temporary opening excerpt cannot override later middle-of-video selection.

### 5.4 Popup states

On opening, use one short content fade with a 4px settle; Chrome owns the outer popup window. Show cached detections immediately. Until the initial page scan has committed its detections, show three skeleton rows (128px block + two bars, 1.6s linear shimmer, static under reduced motion) with a screen-reader-only "Looking for videos…" and "Checking this page…" count instead of briefly showing an empty list. Discovery runs independently of desktop health checks. Reveal newly arriving rows once, without replaying entrance motion on progress updates. Empty and failed scans end the busy state and offer a retry. Reduced motion removes the entrance animations.

| State | Spec |
|---|---|
| Nothing found | Pixel mascot (48px, waiting), `Press play on the video`, `SnagThis spots a video once it starts playing. Start it, then open this again.`, bordered **Check again**. |
| Desktop app unreachable | Banner: `Save supported files in Chrome. Open SnagThis for streams and more.` with **Open SnagThis**, using the implemented `snagthis://open` handler; if unreachable after 3s, offer **Get the app**. Continue checking health every 2s. Direct Chrome downloads remain available. Only actions needing an existing desktop job are disabled; detected streams can open **Use desktop app** guidance. |
| Desktop app reachable, not paired | Banner: `Save supported files in Chrome. Connect SnagThis for streams and more.` with **Connect**. Native Chrome downloads remain available. |
| Extension/app version mismatch | Identify the component needing an update: `Update the Chrome extension to use desktop downloads.` with **Update Chrome extension**, or `Update SnagThis to use desktop downloads.` with **Update**. Keep native Chrome downloads available. |

## 6. Desktop (`apps/desktop`)

One window, one list. Minimum 640 × 480; designed at 820 wide.

Use the same full SnagThis logo artwork in the desktop header at 120×22px; do not recreate its lettering with UI text. Owner-selected idle motion **I3 Shine on hover only**: in both apps the logo is still until the pointer enters it, then one cream shine sweeps left to right in pixel steps (0.9s), clipped to the artwork's alpha, at most once a second and never on a loop. Reduced motion disables the shine.

Owner-selected desktop startup: **A10 Type, then press**, **Center → header**. On the first launch only, the lockup appears centred at three times its header size on the chrome surface: after a 150ms pause an orange block cursor types `SNAGTHIS` one capital every 50ms, moves to where the button belongs, and disappears as the button pops in there (scale .25 → 1.14 → 1 over 260ms). 80ms later the button presses like hitting play (520ms: it sinks and shrinks slightly over a hard shadow while its lit and shaded bevel edges swap, then springs back). After a short hold (1.75s from launch) the whole logo moves onto its actual header artwork over 620ms, `cubic-bezier(.65,0,.2,1)`, while the backdrop fades and the app appears (about 2.4s total). Initialization continues underneath. Play once (`snagthis.startupSeen`), respect reduced motion (no overlay at all), never block the app, and let any key or click dismiss the entrance. Later launches fade and scale the finished logo into the header over 600ms, `cubic-bezier(.2,.8,.2,1)` (owner revision 2026-09-26). Reopening menus, changing tabs, and queue updates do not replay it. The extension keeps its existing popup entrance and the hover shine.

```
┌ top bar ─ ●●● logo [ Paste a video link            ] All · Downloading · Saved   🔍 ┐
│ rows (unified: active + waiting + problems + saved)                                  │
└ footer ─ "2 downloading · 7.3 MB/s"                                        📁   ⚙   ┘
```

| Element | Spec |
|---|---|
| Navigation | The Navbar with Queue / History / Settings is **removed**. Queue and History merge into one list; Settings becomes a sheet (§8). |
| Identity | Show the logo and `SnagThis` together. |
| Window title bar | Owner-selected **Unified header** ([title-bar](prototypes/title-bar/index.html) option 2): the dark top bar is the window's title bar; there is no separate system strip. **macOS:** `titleBarStyle: 'hiddenInset'` with the real traffic lights at `trafficLightPosition { x: 20, y: 20 }`, centred in the 53px bar; the header's left padding becomes 94px so the logo clears them with a 14px gap. In full screen (`enter-full-screen` / `leave-full-screen` → `window-fullscreen` class) the lights hide and the logo returns to 14px over 260ms (instant under reduced motion). **Windows/Linux:** `titleBarStyle: 'hidden'` with `titleBarOverlay { color: surface-chrome #080a0c, symbolColor: foreground-muted #9f9793, height: 52 }`, so the 1px accent line stays visible; the header reserves the caption buttons on the right with `env(titlebar-area-*)` (fallback 138px). Overlay colours are neutral and never follow the accent. **Drag:** the header background is `drag` (double-click zooms/maximises per the OS setting); the logo, paste field, tabs, search and every button are `no-drag`. Native behaviour is kept: traffic-light hover/Option-click/tiling menu, full screen, Windows Snap layouts, Alt+Space, and screen-reader access to the real window buttons. **Menus:** macOS keeps a standard application menu (app menu with Settings… ⌘,, File, Edit with undo/cut/copy/paste/select all, View with full screen plus reload and developer tools in development, Window). Windows and Linux have no menu bar; text-field shortcuts work natively. The window background is surface-chrome, so a slow or failed load never shows white. |
| Paste field | Always visible. Placeholder `Paste a video link`. ⌘V anywhere in the window with a URL on the clipboard focuses and fills it. Enter inspects the link. While resolving: inline spinner + `Checking link…`. A single link with quality/audio/subtitle choices shows the resolved video title and real available choices before Download creates a job; audio tracks use the §5.2 labels and hover-to-hear as a radio list (the picker widens to 312px), with samples cut by the local bridge (`POST /api/media/audio-sample`: bundled FFmpeg, the inspection's scoped request context, 10 s from 25% in, cached per track and deleted on exit); Esc first stops a sample, then closes. Preserve the resolved title and source-page identity in the submitted job. After creation the field clears and the row appears at the top of its group; on inspection failure show the amber sentence beneath the field for 5s and create no job. Multiple URLs (newline-separated) create multiple rows. |
| Tabs | `All`, `Downloading` (downloading + waiting + paused + needs-the-user), `Saved`. No counts. Owner-selected **Follow hover**: a soft neutral highlight glides between tabs under the pointer, and a 2px orange line slides to the selected tab (no filled pill). The selection line moves over 240ms without overshoot. Tabs and search are hidden until the library has a video. Reduced motion moves both instantly. |
| Search | Icon button → expands over the tabs into a text field; filters titles across the **whole** library (server-side, fixes the 200-item cap). Esc closes. |
| Ordering in `All` | 1) needs-the-user, 2) downloading, 3) paused, 4) waiting (queue order), 5) saved, newest first. No section headers. Waiting rows are drag-reorderable (existing `/api/queue/:id/move`). |
| Footer left | Healthy: `{n} downloading · {total speed}`; idle: `Saving to {folder}`. Browser connection is not shown when healthy. If the extension has never connected: `Add SnagThis to Chrome` link. |
| Footer right | Open save folder, Settings. |
| Removed | QueueSummaryBar, QueueSettingsBar (→ Settings ▸ Advanced), QueueToolbar bulk buttons (→ footer ⋯ menu: Pause all, Resume all), per-row speed, inline SegmentHeatmap, HistoryToolbar incl. **Clear History** (replaced by per-row Remove; see §9). The owner's later revision adds a compact Saved check badge beside the status. The footer ⋯ shows at rest when two or more downloads are active. |

### 6.1 First launch

Paste field gets a primary-colour border. Centre: icon tile, `Download your first video`, `Paste a link above, or play a video in Chrome and click the SnagThis icon in the toolbar.`, primary **Add SnagThis to Chrome** (hidden once the extension has connected at least once). The block sits at about 30% of the height with the three connection steps inline; **Already installed? Connect Chrome** is a muted link. An empty `Downloading` or `Saved` tab shows one muted line only (`Nothing downloading` / `No saved videos yet`).

**Unique-look additions (owner revision 2026-09-26, [unique-look](prototypes/unique-look/index.html) options 1, 2, 3, 6, 7):**
- **Pixel mascot:** empty lists show the pixel play button (64px; 48px on the Saved shelf) in place of the icon tile — waiting on first launch, dozing on `Nothing downloading`, on a shelf for `No saved videos yet`. It moves in hard steps and presses on hover; static under reduced motion.
- **Snag moment:** a download that finishes while the window is visible bursts 14 pixels from its action (600ms, 8 steps); a 16px button then arcs to the Saved tab (560ms), the tab bumps (240ms, 3 steps) and `+N` rises and fades (700ms). Completions within 2s share one arc. It never plays on load, refresh or search. Hidden windows and reduced motion get a 5px Saved dot until Saved is visited.
- **Pixel-grid chrome:** the header and footer carry a 4px dot grid (6% white), 1-in-3 scanlines and an accent glow behind the logo, as background layers only; text contrast is unchanged.
- **In the popup (owner revision 2026-09-26):** the mascot appears at 48px in the empty and failed-scan states and at 32px in the first loading skeleton; the header and footer carry the same pixel-grid chrome; downloading desktop rows show the speed trace after the title (Chrome-only downloads report no speed and show none); a download finished while the popup is open bursts pixels from its action and raises `+N` from **Open SnagThis** (desktop saves only), with a 5px dot there under reduced motion or when hidden. Drop to snag, the shelf and ⌘K stay desktop-only.
- **Drop to snag:** dragging a link (not a file or an internal row drag) onto the window shows the drop overlay where the pixel button catches it; a drop is submitted exactly like a paste and the result is announced. Ignored while Settings or a dialog is open.
- **Saved shelf:** a list ⇄ shelf toggle beside search on Saved, remembered. Shelf tiles use Soft focus and a 3px accent line under the 16:9 poster; Play and ⋯ sit beside the title, never over the poster. Arrow keys, Home/End move through the grid; Enter/Space plays (Locate when missing); Delete removes; Details returns to the list and opens that row. Views crossfade over 160ms (instant under reduced motion).

## 7. Details panel (desktop)

Owner-selected **Drawer** motion: the details slide out from under their row over about 0.34s while the rows below move down, and slide back the same way when closed or when another row opens; reduced motion opens and closes instantly. Opens in place under the row (row and panel share `background-hover`); one open at a time; toggled by row click, "⋯" → Details, or Space/Enter on a focused row.

| Fact | Example |
|---|---|
| Quality | `1080p · English audio · English subtitles` (audio uses the plain-language track label, such as `Track 3 audio` or `Hindi audio`) |
| Size | `714 MB / ~2.1 GB`; use an exact total when known, otherwise mark the estimate; show Total unknown until enough data is available. Active speed has its own readout. |
| Connections (unsaved downloads) | `6 of 16 active`. Show measured active requests, not the configured limit as a claimed count. If the external downloader does not report the count, say so and show its limit. |
| From | hostname |
| Saving to / Saved in | clickable card header; use `~` for the home folder and emphasise the final folder name. Keep the full path in the accessible title when visually truncated. |

Use the owner-selected **inspector card** from the [details studies](prototypes/ui-refresh/studies.html): one inset rounded card with a clickable folder header, a facts/chart body, and a footer of labelled actions. Align its contents to the panel inset without a thumbnail-width gutter. The earlier Streamlined layout is superseded.

- **Header:** `Saving to` / `Saved in` plus the location. The entire header opens the known folder.
- **Facts:** Quality, Size, and From occupy dark inset tiles, wrapping responsively. While downloading, lead with the current speed and **Connection dots**: active measured requests light orange above `6 of 16 active`; never substitute the configured limit for a measured count. Show unavailable telemetry honestly. No peak-speed readout.
- **Graph:** draw the live filled speed chart behind the lower body, beneath the facts (**Ceiling + halo**), with no axes, numbers, or grid. Text over the chart has a dark halo. History is an in-memory renderer sample; saved, waiting, paused, and problem rows show no chart. The chart appears after 8 samples and fades in over 400ms. The selected fill, line, and cell opacity values below are authoritative.
- **Segments:** show the real `SegmentHeatmap` below the facts, with a compact legend and count such as `412 of 1210 · 2 retrying`. Hide it for direct downloads and saved items; explain unavailable segment telemetry rather than representing every segment as pending. Failure diagnostics sit in a collapsed **Technical detail** disclosure. Expired rows offer a bordered **Use a new link** button.
- **Footer:** labelled **Copy link** and **Open page** actions, with **Rename** for waiting/paused items or **Locate** for missing files. Separate **Cancel download** or **Remove** at the right. The folder header already provides the folder action. Preserve accessible labels and existing removal confirmations.

**Folder hover revision (2026-09-20):** the owner selected **Soft reveal** for the whole location bar and **Open + settle** for its folder icon from the [folder and copy study](prototypes/ui-refresh/folder.html). Hover or keyboard focus reveals a quiet warm gradient from the left while the folder opens, turns warm yellow, and briefly lifts and settles. The arrow nudges right. Leaving the bar restores its rest state even when a mouse click retains focus. Reduced motion keeps the static hover feedback without the sweep or bounce. Folder clicks keep their existing open-folder behavior. For copy feedback the owner selected **Sheets snap**: the link changes to overlapping paper outlines, the front sheet slides into place, and the green “Copied” label confirms the action without a checkmark. The button keeps its width, repeated clicks replay the animation and restart the confirmation period, and reduced motion shows the final stack without movement.

**Retry marker revision (2026-09-20):** the owner selected **Outlined retries** from the [transfer study](prototypes/ui-refresh/transfer.html), keeping the current mint completed, amber downloading, yellow retrying, and grey pending colors. Retrying segments and their legend marker use a yellow outline with a dark centre so the state is distinct from filled downloading cells. The owner then selected the filled graph in its existing position with **#FA5D0E fill at 85% peak opacity**, fading vertically to transparent, and **#FF7566 line at 100% opacity**. The line glow and live dot follow that coral line color. Detailed segment cells use **25% opacity for pending**, **75% for outlined retries**, and **100% for downloading and completed**. The dark retry interior has the same opacity as its border, so the graph shows through the entire cell evenly. The legend stays fully visible. These values apply to the desktop details map; the aggregate row progress lane keeps its existing treatment.

Desktop and popup menus use a compact dark surface and soft shadow without an outer border. Destructive actions remain separated and labelled clearly.

## 8. Settings sheet

Use the owner-selected **Sidebar sections** layout ([settings-refresh option 2](prototypes/settings-refresh/index.html), 2026-09-26) with Grouped-cards rows. Desktop Settings is a 640px right-side sheet (full width below 640px): a 172px left rail (vertical tabs; arrow keys, Home/End) with **Chrome extension · Downloads · App · Appearance · Advanced · Updates & support** and the app version at its foot; the right pane shows one section's title, a one-line description and its card. Settings first opens on Downloads and reopens on the last section used in the session. Connect Chrome entry points and the extension's **Open app settings** land on Chrome extension. Chrome uses its popup sheet with the smaller browser-relevant set.

| Desktop section | Contents |
|---|---|
| Chrome extension | Pairing status and explicit connection-code controls. |
| Downloads | Save videos to (full path, **Change…**, **Open**), Preferred quality, Subtitles. |
| App | Completion notifications; Start SnagThis when I log in. |
| Appearance | **Accent colour**: five named swatches (radio group); see §2 Accent. |
| Advanced | Speed, File names (with Restore defaults), Online lookups. |
| Updates & support | Updates and Diagnostics. |

Settings save as they change and confirm each save with a brief inline green **Saved** beside the setting (also announced to screen readers). Opening a disclosure scrolls it near the top of the pane (instantly under reduced motion); number fields use −/+ steppers and show their 1–16 bounds and an amber message for invalid input; **Restore default speed and file names** never clears credentials. Typed values save on Enter, blur or closing the sheet; Esc first reverts an unsaved typed value, then closes.

Chrome has one **This browser** card containing Preferred quality, Subtitles, and Tell me when desktop downloads finish. These preference controls require a reachable, paired desktop app. An **Appearance** card below it holds the same **Accent colour** swatches as the desktop; it works without the app (see §2 Accent). Changes confirm with the same inline green **Saved**. A separate **Desktop folder, speed and more in SnagThis** link opens desktop Settings; do not add an empty Advanced accordion or a browser-side folder picker. Offer **Connect Chrome** when unpaired. Direct Chrome downloads still use Chrome's own download preferences.

**First connection clarity (2026-09-20):** keep **Chrome extension** as the first rail section of desktop Settings. Explain the three steps: show/copy a code in the desktop, open Chrome's Extensions → SnagThis → Connect, then paste and connect. **Show connection code** is explicit; the popup accepts pasted codes containing spaces or dashes and connects automatically at six digits; never generate one merely by opening Settings. Display its actual remaining lifetime, **Copy code**, and **Get a new code** after expiry. Confirm successful connection on both surfaces. First launch has a separate **Already installed? Connect Chrome** path alongside installation; the unconnected footer opens this setup. The popup uses the same names and a direct **Open app settings** action, with clear incorrect/expired, offline, and retry guidance. Keep authentication and five-minute expiry unchanged.

New download folders use the resolved video/file name with readable spaces and safe filesystem characters. Reserve a separate folder for each download; existing names get ` (2)`, ` (3)` and subsequent suffixes. If extraction supplies a better title later, the new download's completed folder follows its final filename. Do not automatically rename older saved folders as part of this change.

## 9. Removing things (safety)

The unified list makes "remove" ambiguous, so it is explicit:

- Active/waiting row → `Cancel download` — confirms only if > 50% done.
- Saved row → `Remove…` opens the owner-selected **Popover** confirmation with two choices: **Remove from list** (file stays) / **Move file to Trash** (Electron `shell.trashItem`, not `unlink`). Default focus on "Remove from list". The popover shows the video title on one line and a 6px caret pointing at the control that opened it.
- There is no bulk "clear" in v1. Bulk history deletion must not be exposed as an ambiguous file-removal action.

## 10. Accessibility and input

- All icon-only buttons have `aria-label`; hover-only controls are also revealed on row `:focus-within`.
- Keyboard row focus in both apps is a 3px inset `primary-hover` accent; Shift+F10 / the ContextMenu key opens the row menu; mouse interactions do not leave an outline or focus glow behind. Preserve keyboard navigation and focus return when menus close.
- Keyboard (desktop): ↑/↓ move row focus; Space/Enter toggle details; `P` pause/resume; ⌘F search; ⌘V paste link; ⌘, settings; Delete → cancel/remove flow.
- Contrast: muted and subtle text on window surfaces ≥ 4.5:1; white labels only on `primary`/`primary-strong` (≥ 4.5:1); amber sentence ≥ 4.5:1.
- Amber/green are never the only signal: every coloured line also changes its words and its button.
- `prefers-reduced-motion`: no animated row fill, no glow, no slide-in and no automatic thumbnail playback.
- Motion (both apps, owner revision 2026-09-26; each falls back as noted under reduced motion):
  - Menus fade and scale .97→1 from the trigger, 140ms in / 100ms out ease-out (reduced: 80ms fade).
  - Sheets slide 16px and fade, 220ms in `cubic-bezier(.2,.8,.2,1)` / 160ms out, with the scrim fading (reduced: fade only).
  - New rows fade and slide 6px while expanding, 220ms; removed rows collapse and fade, 180ms ease-in; reorders and moves to Saved glide 280ms (desktop). Only genuinely new rows animate — never on first render, filtering, paging or progress updates, and not when more than three rows change at once (reduced: instant).
  - A finished download draws its check in 360ms once; the desktop lane fades out over 400ms with a single 6% green tint pulse (reduced: static check).
  - Logo: first-launch Type, then press and later-launch 600ms settle (desktop, §6); one hover shine at most once a second (both apps). Reduced: no startup overlay and no shine.
  - Loading shows three skeleton rows with a 1.6s linear shimmer (reduced: static); thumbnails crossfade to the poster in 150ms.

- ⌘K / Ctrl K (or the footer **⌘K Commands** hint) opens the terminal-styled command palette: commands (paste or download from clipboard, pause/resume all, open save folder, search, shelf/list, tabs, Settings sections, accents) and videos (jump to row); a typed URL becomes **Snag this link**. ↑/↓ move, Enter runs, Esc closes and returns focus; dialog + combobox over listbox. It does not open over Settings or a confirmation. Motion as for menus; reduced motion: 80ms fade and a still cursor.

## 11. Component map

| Current component | Replaced legacy component | Notes |
|---|---|---|
| `VideoRow` (`components/list/VideoRow.tsx`) | `ActiveDownloadCard`, `QueueJobCard`, `HistoryItemCard` | props below |
| `FillThumb` | thumbnail markup in all three | §4 |
| `VideoList` | `QueueView`, `HistoryView` | uses `useLibrary` and shared row models for the unified list |
| `RowDetails` | segment section of `ActiveDownloadCard` | wraps existing `SegmentHeatmap` |
| `TopBar` | `Navbar`, `QueueToolbar`, `HistoryToolbar` | paste field, tabs, search |
| `SettingsSheet` | `SettingsView`, `QueueSettingsBar`, `DesktopSettingsCard` | Grouped cards; desktop update controls live under Advanced |
| popup `renderRow()` | the ~400-line body of `renderMedia()` in `popup.js` | title inference helpers stay untouched |

```ts
type RowState = 'detected' | 'waiting' | 'downloading' | 'finishing' | 'paused' | 'attention' | 'saved' | 'missing';

interface RowModel {
  key: string;                 // jobId or history id
  state: RowState;
  title: string;
  thumbnailUrl: string | null;
  durationSeconds: number | null;
  progress: number;            // 0–100, meaningful for downloading/finishing/paused/attention
  statusLine: string;          // already formatted per §3.1–3.3
  tone: 'muted' | 'attention' | 'success';
  action: null | { kind: 'download' | 'pause' | 'resume' | 'play'; } | { kind: 'labelled'; label: string; onClick(): void };
}
```

`toRowModel(job | historyItem)` is a pure function with unit tests for every line in §3.1–3.3; both the React app and the popup import the same formatting module (`packages/contracts` is the natural home).

## 12. Out of scope for this design

Light theme; tray/menu-bar mode; collections/folders in the library; multi-select and bulk actions; in-app video player redesign; localisation of the new strings (keep them in one module so `_locales` can follow).

### Expanded-row design studies

The [expanded-details](prototypes/expanded-details/index.html) alternatives—Streamlined, Grouped, and Pieces first—are historical comparison studies and retained test fixtures. The initial Streamlined choice was superseded by the inspector card in §7. Use that current section for product changes; these earlier previews do not override it.
