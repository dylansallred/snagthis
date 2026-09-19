const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'apps/extension/shared');
fs.mkdirSync(output, { recursive: true });
for (const name of ['strings.js', 'rows.js', 'hls.js', 'selection.js']) {
  fs.copyFileSync(path.join(root, 'packages/contracts/src', name), path.join(output, name));
}
const fonts = path.join(root, 'apps/extension/fonts');
fs.mkdirSync(fonts, { recursive: true });
fs.copyFileSync(path.join(root, 'node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2'), path.join(fonts, 'inter-latin.woff2'));
fs.copyFileSync(path.join(root, 'node_modules/@fontsource-variable/inter/LICENSE'), path.join(fonts, 'LICENSE'));
console.log('Extension uses the shared row model, strings, playlist parser and selection contract.');
