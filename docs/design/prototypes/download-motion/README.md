# Download row motion study

Local UI prototype for the selected whole-row progress treatment: **A + B, leading edge with soft sweep**. The current design-spec thumbnail-progress instruction is superseded for this study by the owner's explicit request to move progress into the row background. The owner also explicitly requested no visible hover text or loop label over the thumbnail. Accessible preview labels remain. This prototype does not modify production components or the design specification.

From the repository root:

```sh
python3 -m http.server 4197 --bind 127.0.0.1
```

Open `http://127.0.0.1:4197/docs/design/prototypes/download-motion/`.

The shared slider and optional progress simulation drive the selected combined effect. Pause/Resume stays in sync between the desktop and extension examples. Hover or focus a thumbnail to loop its real video; click to keep it playing, then click again to stop. Reduce motion suppresses decorative animation and hover playback, while an explicit click can still play the clip. No visual text overlays appear over the thumbnail.

Media reuses the existing licensed eight-second Sintel excerpt and poster in `apps/extension/popup/media/`. The shown `0:08` describes this demo clip. The real download preview feature will use approximately ten-second excerpts. Credits remain in the source media folder. No user download files are copied or committed by this prototype.

All actions are local. The prototype does not call the downloader API, download media, or change product settings. Root owns the single coordinated verification pass; this subtask does not run tests or start a preview service.
