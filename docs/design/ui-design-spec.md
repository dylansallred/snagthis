# VidSnag UI design spec — "Workbench, simplified"

Status: approved direction, updated by the owner on 2026-09-19: clean hover/focus video thumbnails and **Pieces: downloading squares** beneath active rows in both the Chrome popup (`apps/extension`) and desktop (`apps/desktop`). Duration sits beside the desktop title and alongside quality/size in the narrower Chrome popup. Pieces supersedes the earlier **A+B: Leading edge + Soft sweep** treatment on both surfaces.
Later the same day the owner selected **A · Refined** from the [UI refresh studies](prototypes/ui-refresh/index.html): a 128 × 72 popup thumbnail with a two-line title and dot-separated metadata; a plain green check instead of a filled Saved badge, followed by quality; one Pieces palette for the row lane and the details map; a slim edge joining an open row to its (still distinct) details surface, grey at rest and orange while active; `~` for the home folder with the final folder emphasised; and a ⌘V hint in the empty paste field. After three rounds of [hover options](prototypes/ui-refresh/hover.html) the owner chose **Focus mono** for row hover and keyboard focus on both surfaces; it replaces the warm wash and glowing edge. From the [surface study](prototypes/ui-refresh/surface.html) the owner then chose **Lines** (one flat list surface with visible dividers), the **Steel** palette (hue 215, 22% saturation), first at Dark and then revised by the owner to **Very dark** (8% row lightness) and **Orange line** bars: darker header and footer without drop shadows, an orange-to-grey fading line under the header and a plain divider above the footer. These supersede the earlier charcoal values and the "soft inward shadows" wording below.
On 2026-09-20 the owner selected **Solid badge**, **Inset tiles**, and **Quality first** from the [text and quality study](prototypes/ui-refresh/metadata.html). Quality uses a small silver tier badge with dark text beside the exact resolution (SD / 480p, HD / 720p, FHD / 1080p, 4K / 2160p); absent or unrecognised quality never receives an inferred tier. Desktop detail facts sit in individual dark inset tiles. Saved metadata leads with quality, then size, then the green check and saved date/status; the popup keeps duration outside the thumbnail in the metadata area. These choices supersede the plain quality text, flat facts, and saved-first ordering below.
Later on 2026-09-20 the owner selected **Three dots** and **Flush full height** from the [thumbnail study](prototypes/ui-refresh/thumbnails.html). Both surfaces use a 128px-wide thumbnail flush with the row's left, top, and bottom edges. It spans the full row height, including the area beside active progress; the progress lane sits under the text and actions only. A neutral three-dot placeholder replaces the still stripes when no image is available. These choices supersede the inset thumbnail dimensions and full-width lane below.
Companion: [roadmap.md](roadmap.md). Interactive mock-ups: [mockups/main-screens.html](mockups/main-screens.html), [mockups/states.html](mockups/states.html) (open in a browser; sample data, nothing is downloaded).

| Popup | Desktop |
|---|---|
| ![popup](img/popup.png) | ![desktop](img/desktop.png) |

## 1. Principles

1. **One row, four things.** Every video is a row of: thumbnail, title, one quiet status line, one visible action. Nothing else is visible at rest.
2. **Keep the video clear.** Progress belongs in a compact lane beneath the text and actions, beside the full-height thumbnail. The thumbnail shows a full-colour poster or a silent loop on hover/focus; duration stays outside the image.
3. **Same row everywhere.** The popup and the desktop render the same row component with the same states and copy.
4. **Extras are one step away, never zero.** Quality/subtitles live in a menu; rename, remove, copy link, technical detail live in "⋯" / right-click; settings beyond five rows live under Advanced.
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
| Subtle text | `--color-foreground-subtle` | `hsl(20 5% 44%)` | placeholders, footer summary |
| Primary | `--color-primary` | `hsl(18 96% 44%)` | Download button, count badge |
| Primary hover / focus | `--color-primary-hover` | `hsl(20 96% 52%)` | button hover, focus ring |
| Attention | `--color-status-paused` | `hsl(44 84% 58%)` | the amber sentence |
| Success | `--color-status-completed` | `hsl(145 62% 46%)` | "Saved" in popup after finishing |
| Destructive | `--color-destructive` | `hsl(0 72% 56%)` | "Cancel download", "Move to Trash" text only |

Typography: Inter. Title 13.5px / 570 weight, single line, ellipsis. Status line 12px muted. Buttons 12.5px / 600. Duration chip 10.5px mono on `rgba(0,0,0,.72)`. No other mono text in default UI.

Radii: thumbnail 0px (flush with the row), buttons 7px, menus 9px, window 10px. Spacing unit 2px; no left, top, or bottom inset around the thumbnail. Keep a 12px gap to text, 14px at the row's right edge, and vertical padding on text/actions (desktop 10px; popup 12px).

Status colours `--color-status-queued/downloading/failed/cancelled` and all `--color-segment-*` remain defined but are only used inside the details panel.

## 3. The row

![row](img/row-downloading.png)

```
┌──────────┐  Title, one line, ellipsis                         [⋯ hover] [ action ]
│ thumb    │  Status line, one line, muted
└──────────┘
```

| Part | Popup (480px wide) | Desktop (min 640px, designed at 820px) |
|---|---|---|
| Thumbnail | 128px wide × full row height; flush left, top, and bottom; image crops to fill | same |
| Row height | minimum 96; grows with wrapped content and active progress | minimum 84; grows with wrapped content and active progress |
| Visible action | right-aligned, 30px icon button; Download uses the owner-selected **Outline + breathing glow** (orange outline whose glow swells and fades every 2.8s, filling solid orange with the owner-selected **Liquid** motion on hover or keyboard focus (an oversized, slowly turning rounded shape rises inside the clipped button, giving a wavy surface and no square edge); still under reduced motion and when disabled), with its tooltip and accessible label | right-aligned, 30px high |
| Duration | metadata line beside quality and size, separated by small round dots and consistent spacing; omit separators for missing values | beside the title |
| Hover extras | none (right-click menu) | "⋯" appears left of the action; saved rows also show folder |
| Divider | 1px `border-subtle` on top of every row except the first | same |

Rules:
- Exactly **one** visible action per row. If a state has no sensible action (e.g. "Finishing up…", "Waiting"), show none.
- Rows use `surface-row` against darker `surface-chrome` header/footer bars with soft inward shadows. Hover or keyboard interaction uses **Focus mono**: the active row changes to `surface-row-hover` and shows a solid 3px `primary-hover` left edge, while every other row (and any other open details panel) fades to 45% opacity in greyscale over 300ms. The edge uses the owner-selected **Grow** motion: it scales out from its middle in 300ms and eases away over 380ms. On desktop there is one edge per item, spanning the row and its open details: an open item shows it in neutral grey (**Grey when open**) and it turns orange while that row is active, so two edges never stack. See the [edge and animation study](prototypes/ui-refresh/edge.html). A desktop row whose ⋯ menu is open counts as active. Both apps use identical values and timing. Nothing is drawn over thumbnails, titles or controls, and they never move. The treatment fades away on leave and does not represent download progress. Desktop keyboard focus keeps its inset orange accent. Reduced motion disables its transitions.
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
| Paused by user | `queueStatus = paused` | `Paused at {pct}%` | full-colour poster/preview | Resume (play icon) | ⋯ |
| Needs the user | `failed` with recoverable cause | amber sentence (§3.3) | full-colour poster/preview | labelled button (bordered) | ⋯ |
| Saved | history item / `completed` | `Saved {when} · {size}` | full colour | Play (icon) | folder, ⋯ |
| Saved, file missing | file not on disk | amber `File was moved or deleted` | full colour | **Locate** (bordered) | ⋯: Remove from list |
| Popup, just finished | job completed while popup open | green `Saved` | full colour | **Play** (bordered) | — |

`cancelled` jobs are removed from the list immediately (toast: "Download cancelled · Undo" for 5 s). They never render as rows.

### 3.2 Formatting

| Value | Rule | Examples |
|---|---|---|
| `{pct}` | `Math.floor(progress)`; never show 100% (switch to Finishing) | `34%` |
| `{eta}` | from `etaSeconds`. `<60` → `under a minute left`; `<3600` → `{m} min left`; else `{h} hr {m} min left`; `null`/unknown → omit the ` · {eta}` part entirely | `5 min left` |
| `{size}` | 1 decimal for GB, integer for MB; unknown → `N/A`; estimates are prefixed `about` only inside menus/details | `182 MB`, `2.1 GB`, `N/A` |
| `{when}` | `today`, `yesterday`, weekday within 7 days, else `12 Sep` | `Saved today · 182 MB` |
| Duration chip | `m:ss` or `h:mm:ss`; hidden when unknown | `2:20:06` |
| Speed | never in rows. Total speed in desktop footer; per-job speed in details | `7.3 MB/s` |

### 3.3 Problem sentences

One sentence, amber, ends with a full stop only if it contains two clauses. One labelled button.

| Cause (map from `job.error` classification) | Sentence | Button |
|---|---|---|
| Source URL expired / 403 / 410 on manifest | `Link expired. Reopen the page to continue from {pct}%.` | Open page |
| Network unreachable / retries exhausted | `Connection lost at {pct}%` | Try again |
| Disk full / not writable | `Not enough space in {folder}` | Choose folder |
| Unsupported / DRM | `This video can't be downloaded` | Details |
| Output file missing | `File was moved or deleted` | Locate |
| Anything else | `Something went wrong at {pct}%` | Try again |

Raw error text is only shown in the details panel.

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
- Both surfaces use the selected **Pieces** treatment: 40 aggregate progress cells in a 7px-high lane beneath the text and actions only. The full-height thumbnail occupies the left column beside this lane, with no progress drawn beneath or over the image. Completed cells settle in muted green (`#80bfa6`). The owner-selected **Spark** motion: the current cell fills amber (`#f4c38a`) from the left with real progress while pulsing gently (1.9 seconds), and each cell finished while the row is on screen flashes white with a short burst of light (520ms). Opening a list or popup never replays sparks for earlier cells. The lane represents overall progress, not the actual number of media chunks. Paused/problem and reduced-motion states are still; detected, waiting and saved rows have no lane. Desktop uses an 8px gap above the lane to remain compact. The [four extension studies](prototypes/extension-motion/index.html) record the original motion direction; the thumbnail study supersedes their full-width lane geometry.
- The [earlier A+B motion comparison](prototypes/download-motion/index.html) remains a historical study. Its warm background fill, glowing edge and sweep are superseded on both surfaces; they are not current production requirements. The detailed desktop Pieces map continues to show actual segment telemetry separately.
- Do not put “Preview,” clip-length labels or other hover text over the video. Accessible labels may describe the preview without occupying video space.
- Saved desktop rows retain a small checkmark badge by their status, while their background remains quiet.
- Prefer a representative, nonblack frame from downloaded media over a page screenshot or generic site poster. Preserve YouTube's supplied artwork. Repair old saved-video posters when preparing their local previews. Poster updates must not reset download progress.
- Reject black candidate frames and sample another part of the available video. During downloading, retry as new local footage becomes available. If no usable frame exists yet, keep the existing poster or neutral placeholder instead of publishing a black replacement.

## 5. Popup (`apps/extension`)

Width 480px, per owner revision: quality, size, and feature-length duration fit on one metadata line. Max height 560px; the list scrolls, header and footer are fixed. Chrome controls the native popup window's outer corners.

```
┌ header ─ logo · "{n} videos on this page"                         ┐
│ [banner — only when the desktop app is unreachable]               │
│ rows…                                                             │
└ footer ─ ⚙ · "No video?"                     "Open VidSnag" (n)  ┘
```

| Element | Spec |
|---|---|
| Brand and surfaces | Use the existing full VidSnag logo artwork, 112×22px, instead of a mark with separately typeset text. The popup count sits independently at right. Header and footer use `surface-chrome` with soft inward shadows to separate them from lighter video rows; no outer borders. Desktop matches the same treatment. |
| Header text | `No videos yet` / `1 video on this page` / `{n} videos on this page`. No connection indicator when healthy. |
| Row order | Longest known duration first, shorter videos below; unknown durations last. Equal durations keep their discovery order. |
| Footer left | Settings (gear icon, opens the settings sheet §8), `No video?` (opens help: the empty-state text + link to troubleshooting). |
| Footer right | `Open VidSnag` → `POST /v1/app/focus`. Orange count badge = jobs currently downloading or waiting (from `GET /v1/queue`). Hidden when 0. |
| Removed from today's popup | "Bridge" pill, "Detected Media" heading, refresh icon (auto-refresh on open), "Clear Media" button (replaced by per-row Hide in right-click; list resets on navigation), API host:port text, type/resolution pills, hostname + content-type row, Stream button (moved to right-click → "Preview"). |

### 5.1 Download flow

1. Click **Download** → button shows a spinner for the POST (`/v1/jobs`), max 300ms before optimistic switch.
2. Row switches to Downloading: status `0%`, row progress begins while the thumbnail stays clear. No toast.
3. Popup keeps the mapping `mediaItemId → jobId` in `chrome.storage.session` so reopening the popup shows the same row in its live state.
4. Progress comes from polling `GET /v1/queue` every 1s while the popup is open (WebSocket is unnecessary for a short-lived popup).
5. On completion: green `Saved` + **Play** (opens the file via the desktop app). On reopen after completion the row returns to Detected only if the page is reloaded.

Closing the popup never affects the download.

### 5.2 Quality menu

![quality](img/state-quality-menu.png)

- Trigger: a compact borderless dark button in the status line (`1080p ⌄`), with brighter text, an orange chevron, and distinct hover/open feedback. Rotate the chevron and expose `aria-expanded` while open. Keep its width stable so size and duration do not shift. Shown only when more than one real variant was discovered; otherwise plain text (`720p`) or nothing.
- Default selection: user's Preferred quality setting (default "Best"), falling back to the highest available.
- Items: one per discovered variant, highest first: label `{height}p`, right-aligned size. Dropdown items use resolution text only (such as `1080p` or `720p`), without tier badges; keep the main-row quality badge. Label bitrate × duration ÷ 8 estimates with `about`; show `N/A` in the row and menu when neither a total nor an estimate is available. Playlist response bytes are never the video size. `Audio only` last, only if an audio rendition exists.
- Second group `Subtitles`, only if subtitle renditions exist: languages, then `None`.
- Menu is a fixed overlay anchored under the status line when space allows, 250px wide, fitted inside the existing popup bounds. Opening it must not resize the popup or move the row, thumbnail, title or footer; scroll the menu internally when needed. Initial and restored focus must not scroll the page. Keyboard: ↑/↓, Enter, Esc; `role="menu"` with `menuitemradio`.
- Duplicate detections (master playlist + its variant playlists, same video as HLS and MP4) must collapse into **one row**; the alternatives become menu items. Collapse only when the variant URL is listed in the master playlist, or duration and page match exactly; never on filename similarity alone. Escape hatch: right-click a row → `Show all detected streams` expands the collapsed items as separate rows for that page visit.
- Duration, resolution, and artwork belong to the matching media source. Switching a page player from a trailer to a movie must keep their detections separate and preserve each source's metadata; parsed media-playlist duration is authoritative. Keep each known source duration visible beside size in the popup metadata, including when size is `N/A`, so trailers and full videos remain distinguishable.

### 5.3 Popup thumbnails

Order: supplied YouTube artwork → usable current or verified preview frame → `<video poster>` → placeholder. Generic non-YouTube `og:image` / `twitter:image` artwork is not used as a video-poster fallback. The content script rejects black/blank frames and silently falls back when the canvas is tainted; it must not seek or alter page playback. Captured frames are ≤ 20 KB JPEG data URLs (208×116). A verified frame from the popup's own short source preview is retained with its detection in `chrome.storage.session`, so reopening the popup can reuse it without requiring a desktop job. Preserve supplied YouTube artwork.

If a visible popup row has no usable poster, start one bounded frame extraction on popup open without waiting for hover. Use the existing middle-of-video sampling and black-frame fallback, stop after obtaining a usable frame, and retain it with that detection. Work one row at a time; stop when the popup closes or becomes hidden, and give hover playback priority. Do not automatically loop or alter playback on the source page.

Prepare a representative poster before popup opening when the source page has already decoded a usable frame between 35% and 80% of its duration. Capture once for that source and page visit, through the existing detection/session metadata; this must not seek, start playback, or fetch media. Opening frames are not treated as representative scene posters. Keep offsets from a partial direct-file prefix distinct from offsets in the full source, so a temporary opening excerpt cannot override later middle-of-video selection.

### 5.4 Popup states

On opening, use one short content fade with a 4px settle; Chrome owns the outer popup window. Show cached detections immediately. Until the initial page scan has committed its detections, show a compact one-row "Looking for videos…" stage and "Checking this page…" count instead of briefly showing an empty list. Discovery runs independently of desktop health checks. Reveal newly arriving rows once, without replaying entrance motion on progress updates. Empty and failed scans end the busy state and offer a retry. Reduced motion removes the entrance animations.

| State | Spec |
|---|---|
| Nothing found ![empty](img/state-empty.png) | Icon tile, `Press play on the video`, `VidSnag spots a video once it starts playing. Start it, then open this again.`, bordered **Check again**. |
| Desktop app unreachable ![offline](img/state-offline.png) | Amber banner under the header: `VidSnag isn't open, so downloads can't start.` + primary **Open VidSnag** (new `vidsnag://open` protocol handler — does not exist yet, roadmap M2; if the health check still fails after 3s, swap the button to `Get the app`). Rows at 45% opacity, not clickable. Footer right becomes `Don't have the app? Get it`. Poll `/v1/health` every 2s; on success remove the banner without reload. |
| Extension/app version mismatch | Same banner pattern: `Update VidSnag to keep downloading.` + **Update**. |

## 6. Desktop (`apps/desktop`)

One window, one list. Minimum 640 × 480; designed at 820 wide.

Use the same original full VidSnag logo artwork in the desktop header at 112×22px; do not recreate its lettering with UI text. Both desktop and extension retain the original artwork with a subtle, alpha-clipped white shimmer on logo hover (one 1.4-second pass, no repeating loop). Reduced motion disables the shimmer.

Owner-selected desktop startup: **Arrow leads**, **Center → header**, **Natural pace**. On each renderer launch, the original orange arrow moves right and uncovers the lettering immediately behind it, then tilts 6° / −2° and settles. The reveal and settle take 1.2s; a 150ms pause precedes an 850ms shimmer clipped to the original artwork, followed by a shortened 400ms still hold. The full logo then moves into its actual header position over 500ms as the app appears (3.1s total). Initialization continues underneath. Play once, respect reduced motion, and allow input to dismiss the entrance. Reopening menus, changing tabs, and queue updates do not replay it. The extension keeps its existing popup entrance and hover shimmer.

```
┌ top bar ─ ●●● logo [ Paste a video link            ] All · Downloading · Saved   🔍 ┐
│ rows (unified: active + waiting + problems + saved)                                  │
└ footer ─ "2 downloading · 7.3 MB/s"                                        📁   ⚙   ┘
```

| Element | Spec |
|---|---|
| Navigation | The Navbar with Queue / History / Settings is **removed**. Queue and History merge into one list; Settings becomes a sheet (§8). |
| Identity | Show the logo and `VidSnag` together. The native window uses its own title bar, so the content header must not reserve a second blank area for Mac window buttons. |
| Paste field | Always visible. Placeholder `Paste a video link`. ⌘V anywhere in the window with a URL on the clipboard focuses and fills it. Enter inspects the link. While resolving: inline spinner + `Checking link…`. A single link with quality/audio/subtitle choices shows the resolved video title and real available choices before Download creates a job. Preserve the resolved title and source-page identity in the submitted job. After creation the field clears and the row appears at the top of its group; on inspection failure show the amber sentence beneath the field for 5s and create no job. Multiple URLs (newline-separated) create multiple rows. |
| Tabs | `All`, `Downloading` (downloading + waiting + paused + needs-the-user), `Saved`. No counts. Owner-selected **Follow hover**: a soft neutral highlight glides between tabs under the pointer, and a 2px orange line slides to the selected tab (no filled pill). Reduced motion moves both instantly. |
| Search | Icon button → expands over the tabs into a text field; filters titles across the **whole** library (server-side, fixes the 200-item cap). Esc closes. |
| Ordering in `All` | 1) needs-the-user, 2) downloading, 3) paused, 4) waiting (queue order), 5) saved, newest first. No section headers. Waiting rows are drag-reorderable (existing `/api/queue/:id/move`). |
| Footer left | Healthy: `{n} downloading · {total speed}`; idle: `Saving to {folder}`. Browser connection is not shown when healthy. If the extension has never connected: `Add VidSnag to Chrome` link. |
| Footer right | Open save folder, Settings. |
| Removed | QueueSummaryBar, QueueSettingsBar (→ Settings ▸ Advanced), QueueToolbar bulk buttons (→ footer ⋯ menu: Pause all, Resume all), per-row speed, inline SegmentHeatmap, HistoryToolbar incl. **Clear History** (replaced by per-row Remove; see §9). The owner's later revision adds a compact Saved check badge beside the status. |

### 6.1 First launch

![first](img/state-first-launch.png)

Paste field gets a primary-colour border. Centre: icon tile, `Download your first video`, `Paste a link above, or play a video in Chrome and click the VidSnag icon in the toolbar.`, primary **Add VidSnag to Chrome** (hidden once the extension has connected at least once). An empty `Downloading` or `Saved` tab shows one muted line only (`Nothing downloading` / `No saved videos yet`).

## 7. Details panel (desktop)

![details](img/state-details.png)

Owner-selected **Drawer** motion: the details slide out from under their row over about 0.34s while the rows below move down, and slide back the same way when closed or when another row opens; reduced motion opens and closes instantly. Opens in place under the row (row and panel share `background-hover`); one open at a time; toggled by row click, "⋯" → Details, or Space/Enter on a focused row.

| Fact | Example |
|---|---|
| Quality | `1080p · English audio · English subtitles` |
| Size | `714 MB / ~2.1 GB · 4.1 MB/s`; use an exact total when known, otherwise mark the estimate; show Total unknown until enough data is available |
| Connections (unsaved downloads) | `6 of 16 active`. Show measured active requests, not the configured limit as a claimed count. If the external downloader does not report the count, say so and show its limit. |
| From | hostname |
| Saving to / Saved in | full directory path, wrapping as needed; the whole section opens that folder on click or keyboard activation, with clear hover feedback |

Arrange the main facts horizontally with responsive wrapping on a distinct dark surface. Show the full directory path directly in the clickable location section. There is no **Technical details** accordion; actual failure diagnostics appear inline only when present. Keep the **Pieces** map visible by default below the main details, spanning the panel width. Use the existing `SegmentHeatmap` with colours from `--color-segment-*`, a compact state legend and a caption such as `412 of 1210 · 2 retrying`. Hide the map for direct downloads and saved items; explain unavailable piece telemetry rather than showing all pieces as pending.

**Owner revision (inspector card):** after the [details studies](prototypes/ui-refresh/studies.html) the owner replaced Streamlined with an inset rounded card inside the details panel. Its header is the clickable folder location (`Saving to` / `Saved in` and the path on one line). Its body shows the facts and the Pieces map; while a download reports speed, the body leads with the current speed and the owner-selected **Connection dots** (one dot per allowed connection, active ones lit orange, above the `6 of 16 active` text; no peak speed), drops speed from the Size fact, and draws a decorative live speed chart behind the lower 60% of the body (orange line with a filled area and a live dot, no axis, numbers or grid; **Ceiling + halo**: the chart never rises into the facts row, and text over it carries a dark halo, with the Pieces count moved beside its label). The speed history is an in-memory renderer sample only; saved, waiting, paused and problem rows show the card without a chart. The footer holds labelled text actions (Copy link, Open page, Rename/Locate when relevant) with Cancel download or Remove set apart at the right. The Streamlined description below is retained as history.

**Folder hover revision (2026-09-20):** the owner selected **Soft reveal** for the whole location bar and **Open + settle** for its folder icon from the [folder and copy study](prototypes/ui-refresh/folder.html). Hover or keyboard focus reveals a quiet warm gradient from the left while the folder opens, turns warm yellow, and briefly lifts and settles. The arrow nudges right. Leaving the bar restores its rest state even when a mouse click retains focus. Reduced motion keeps the static hover feedback without the sweep or bounce. Folder clicks keep their existing open-folder behavior. For copy feedback the owner selected **Sheets snap**: the link changes to overlapping paper outlines, the front sheet slides into place, and the green “Copied” label confirms the action without a checkmark. The button keeps its width, repeated clicks replay the animation and restart the confirmation period, and reduced motion shows the final stack without movement.

**Retry marker revision (2026-09-20):** the owner selected **Outlined retries** from the [transfer study](prototypes/ui-refresh/transfer.html), keeping the current mint completed, amber downloading, yellow retrying, and grey pending colors. Retrying segments and their legend marker use a yellow outline with a dark centre so the state is distinct from filled downloading cells. The owner then selected the filled graph in its existing position with **#FA5D0E fill at 85% peak opacity**, fading vertically to transparent, and **#FF7566 line at 100% opacity**. The line glow and live dot follow that coral line color. Detailed segment cells use **25% opacity for pending**, **75% for outlined retries**, and **100% for downloading and completed**. The dark retry interior has the same opacity as its border, so the graph shows through the entire cell evenly. The legend stays fully visible. These values apply to the desktop details map; the aggregate row progress lane keeps its existing treatment.

Use the approved Streamlined layout: compact facts across the top with a dark group of action icons beside them, followed by the full-width folder band and Pieces grid. Align facts and location to the panel’s left inset, without a thumbnail-width gutter. At narrower widths, facts wrap into two columns. The location section itself opens the known folder for active and saved downloads. Keep Copy link, Open page and Cancel download (active) or Remove (saved) as compact icon buttons grouped beside the facts; do not duplicate Open folder as another icon. Every icon has an accessible label and tooltip; keep existing removal confirmations. Rename remains available for waiting/paused items.

Desktop context menus use a compact dark surface and soft shadow without an outer border. Destructive actions remain separated and labelled clearly.

## 8. Settings sheet

![settings](img/state-settings.png)

Same content and layout in both surfaces: a sheet over the popup; a 400px right-side sheet in the desktop. Five rows, then one collapsed `Advanced` line.

| Row | Control | Backing setting |
|---|---|---|
| Save videos to | path + **Change** | `DesktopSettings.outputDirectory` |
| Preferred quality | select: Best / 1080p / 720p / 480p | new `preferredQuality` |
| Subtitles | select: language list / None | new `subtitleLanguage` |
| Tell me when a download finishes | switch | new `notifyOnComplete` |
| Start VidSnag when I log in | switch | new `launchAtLogin` |
| **Advanced** (collapsed) | downloads at once (`queueMaxConcurrent`), connections per download (`downloadThreads`), start automatically (`queueAutoStart`), file naming, TMDB / SubDL keys, check for updates, diagnostics export | existing |

In the popup, rows that need the desktop app (folder picker) deep-link: **Change** → focuses the app with its settings sheet open.

**First connection clarity (2026-09-20):** keep **Chrome extension** visible at the top of desktop Settings, outside Advanced. Explain the three steps: show/copy a code in the desktop, open Chrome's Extensions → VidSnag → Connect, then paste and connect. **Show connection code** is explicit; never generate one merely by opening Settings. Display its actual remaining lifetime, **Copy code**, and **Get a new code** after expiry. Confirm successful connection on both surfaces. First launch has a separate **Already installed? Connect Chrome** path alongside installation; the unconnected footer opens this setup. The popup uses the same names and a direct **Open app settings** action, with clear incorrect/expired, offline, and retry guidance. Keep authentication and five-minute expiry unchanged.

New download folders use the resolved video/file name with readable spaces and safe filesystem characters. Reserve a separate folder for each download; existing names get ` (2)`, ` (3)` and subsequent suffixes. If extraction supplies a better title later, the new download's completed folder follows its final filename. Do not automatically rename older saved folders as part of this change.

## 9. Removing things (safety)

The unified list makes "remove" ambiguous, so it is explicit:

- Active/waiting row → `Cancel download` — confirms only if > 50% done.
- Saved row → `Remove…` opens a two-choice dialog: **Remove from list** (file stays) / **Move file to Trash** (Electron `shell.trashItem`, not `unlink`; new IPC, roadmap M0). Default focus on "Remove from list".
- There is no bulk "clear" in v1. `DELETE /api/history` (deletes all files today) must not be reachable from this UI.

## 10. Accessibility and input

- All icon-only buttons have `aria-label`; hover-only controls are also revealed on row `:focus-within`.
- Desktop keyboard focus uses a soft visible inset accent; mouse interactions do not leave an outline or focus glow behind. Preserve keyboard navigation and focus return when menus close.
- Keyboard (desktop): ↑/↓ move row focus; Space/Enter toggle details; `P` pause/resume; ⌘F search; ⌘V paste link; ⌘, settings; Delete → cancel/remove flow.
- Contrast: muted text on window surface ≥ 4.5:1 (current tokens pass); amber sentence ≥ 4.5:1.
- Amber/green are never the only signal: every coloured line also changes its words and its button.
- `prefers-reduced-motion`: no animated row fill, no glow, no slide-in and no automatic thumbnail playback.

## 11. Component map

| New | Replaces | Notes |
|---|---|---|
| `VideoRow` (`components/list/VideoRow.tsx`) | `ActiveDownloadCard`, `QueueJobCard`, `HistoryItemCard` | props below |
| `FillThumb` | thumbnail markup in all three | §4 |
| `VideoList` | `QueueView`, `HistoryView` | merges `useQueue` + `useHistory` into one ordered array of `RowModel` |
| `RowDetails` | segment section of `ActiveDownloadCard` | wraps existing `SegmentHeatmap` |
| `TopBar` | `Navbar`, `QueueToolbar`, `HistoryToolbar` | paste field, tabs, search |
| `SettingsSheet` | `SettingsView`, `QueueSettingsBar`, `DesktopSettingsCard` | `UpdaterCard` moves under Advanced |
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

Three interactive alternatives are in [expanded-details](prototypes/expanded-details/index.html): Streamlined, Grouped, and Pieces first. They preserve the dark Workbench style, real video previews, full-width Pieces, full visible folder path and icon actions. The owner selected A · Streamlined, now implemented in the desktop. Grouped and Pieces first remain comparison studies. Hover indicates folder clickability; it does not launch Finder.
