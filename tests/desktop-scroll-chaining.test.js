const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

test('overscroll-behavior is scoped to scroll containers rather than universal * selector', () => {
  const desktopCss = fs.readFileSync(path.join(ROOT, 'apps/desktop/src/globals.css'), 'utf8');
  const extensionCss = fs.readFileSync(path.join(ROOT, 'apps/extension/src/input.css'), 'utf8');

  // Applying overscroll-behavior: none to `*` hits overflow: hidden rows (like .video-row),
  // which are scroll containers in Chromium and trap wheel/trackpad scroll chaining.
  assert.doesNotMatch(desktopCss, /\*\s*\{[^}]*overscroll-behavior\s*:/);
  assert.doesNotMatch(extensionCss, /\*\s*\{[^}]*overscroll-behavior\s*:/);

  assert.match(desktopCss, /\.workbench-content[^{]*\{[^}]*overscroll-behavior\s*:\s*none/);
  assert.match(extensionCss, /\.video-list[^{]*\{[^}]*overscroll-behavior\s*:\s*none/);
});
