const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');

// Runs main.js's window-drag functions with a fake window, cursor and timers.
const source = fs.readFileSync(path.resolve(__dirname, '../apps/desktop/electron/main.js'), 'utf8').replace(/\r\n/g, '\n');
const start = source.indexOf('let windowDrag = null;');
const end = source.indexOf('\nfunction registerIpc()');

function fixture({ maximized = false, fullScreen = false } = {}) {
  const intervals = new Map(); const timeouts = new Map(); let id = 0;
  const cursor = { x: 500, y: 300 };
  const window = Object.assign(new EventEmitter(), {
    position: [400, 280], destroyed: false,
    isDestroyed() { return this.destroyed; }, isFullScreen: () => fullScreen, isMaximized: () => maximized,
    getPosition() { return [...this.position]; }, setPosition(x, y) { this.position = [x, y]; },
  });
  const sandbox = {
    screen: { getCursorScreenPoint: () => ({ ...cursor }) },
    setInterval(callback) { intervals.set(++id, callback); return id; }, clearInterval(key) { intervals.delete(key); },
    setTimeout(callback) { timeouts.set(++id, callback); return id; }, clearTimeout(key) { timeouts.delete(key); },
  };
  vm.createContext(sandbox);
  vm.runInContext(source.slice(start, end), sandbox);
  const tick = () => { for (const callback of [...intervals.values()]) callback(); };
  return { sandbox, window, cursor, tick, intervals, timeouts };
}

test('the window follows the cursor from where it was grabbed until the drag ends', () => {
  const f = fixture();
  assert.equal(f.sandbox.startWindowDrag(f.window).ok, true);
  f.cursor.x = 560; f.cursor.y = 340; f.tick();
  assert.deepEqual(f.window.position, [460, 320], 'the grab offset (100, 20) is kept');
  f.sandbox.stopWindowDrag();
  f.cursor.x = 900; f.tick();
  assert.deepEqual(f.window.position, [460, 320], 'no movement after release');
  assert.equal(f.intervals.size, 0);
  assert.equal(f.timeouts.size, 0);
});

test('a drag ends when the window loses focus or after the safety limit', () => {
  const f = fixture();
  f.sandbox.startWindowDrag(f.window);
  f.window.emit('blur');
  assert.equal(f.intervals.size, 0, 'blur stops following');
  f.sandbox.startWindowDrag(f.window);
  for (const callback of [...f.timeouts.values()]) callback();
  assert.equal(f.intervals.size, 0, 'the limit stops a drag whose release was lost');
});

test('maximized and full-screen windows are not dragged', () => {
  assert.equal(fixture({ maximized: true }).sandbox.startWindowDrag(fixture({ maximized: true }).window).ok, false);
  const f = fixture({ fullScreen: true });
  assert.equal(f.sandbox.startWindowDrag(f.window).ok, false);
  assert.equal(f.intervals.size, 0);
});
