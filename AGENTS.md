# VidSnag contributor instructions

Implement the requested scope and follow `docs/design/ui-design-spec.md` and `docs/design/roadmap.md`. The approved direction is **Workbench, simplified**; rejected explorations are not a design source.

- Desktop: `apps/desktop/src` (React/TypeScript), `apps/desktop/electron` (main/preload).
- Chrome extension: `apps/extension`, with generated shared modules copied by `npm run sync:extension`.
- Local bridge: `packages/downloader-api`.
- Media engine: `packages/downloader-engine`.
- Shared display state, strings and parsers: `packages/contracts`.

Use the version in `.nvmrc`. `npm run verify` is the coordinated validation command; relevant browser/Electron checks use `npm run test:e2e`. Make one focused verification pass and rerun only when a concrete failure and subsequent fix justify it. Do not add speculative optimizations or repeated verification loops.

Keep one quiet row and one visible action at rest. Keep thumbnails unobscured for hover/focus video loops, with duration beside the title; progress belongs on the row background under the latest owner revision in the design spec. Keep dark token values identical across desktop and extension. Put technical detail behind Details or Advanced.

Never replace a real-media correctness assertion with a command-argument assertion. Never suppress an authentication check to make a test pass. Keep credentials out of persisted queue state and diagnostics. Saved-file removal must distinguish list removal from moving the file to Trash.

Do not publish releases or archive the predecessor repository as a side effect of ordinary development. Produce reviewable artifacts first.
