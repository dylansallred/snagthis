const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
function tokens(file) {
  const text = fs.readFileSync(path.join(root, file), 'utf8');
  const block = text.match(/@theme\s*\{([\s\S]*?)\n\}/);
  if (!block) throw new Error(`Missing @theme block: ${file}`);
  return Object.fromEntries([...block[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(m => [m[1], m[2].trim()]));
}
const desktop = tokens('apps/desktop/src/globals.css');
const extension = tokens('apps/extension/src/input.css');
for (const key of new Set([...Object.keys(desktop), ...Object.keys(extension)])) {
  if (desktop[key] !== extension[key]) throw new Error(`Design token mismatch: ${key}`);
}
console.log('Desktop and extension design tokens match.');
