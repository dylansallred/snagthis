const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createNativePieceSpool } = require('../packages/downloader-engine/src/core/NativePieceSpool');

const urls = (count) => Array.from({ length: count }, (_, index) => `https://fixture.invalid/${index}`);
const tick = () => new Promise((resolve) => setImmediate(resolve));

async function waitUntil(predicate) {
  const deadline = Date.now() + 2000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Spool did not reach the expected state.');
    await tick();
  }
}

async function fixture(t, options) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'vidsnag-spool-test-'));
  let spool;
  t.after(async () => {
    await spool?.close();
    await fs.rm(directory, { recursive: true, force: true });
  });
  spool = await createNativePieceSpool({ directory, ...options });
  return { spool, directory };
}

async function writePiece(filePath, context, body = Buffer.from('data')) {
  context.onContentLength(body.length);
  context.onBytes(body.length);
  await fs.writeFile(filePath, body);
  return { headers: { 'content-length': String(body.length) }, statusCode: 200, bytes: body.length };
}

test('native spool downloads concurrently but advances its window only after consumption', async (t) => {
  const segments = urls(6);
  const started = [];
  const { spool } = await fixture(t, {
    segments, concurrency: 2, lookahead: 3, maxSpoolBytes: 32, maxPieceBytes: 8,
    request: async (url, filePath, context) => {
      started.push(url);
      return writePiece(filePath, context);
    },
  });
  const first = await spool.get(segments[0]);
  await waitUntil(() => started.length === 3);
  assert.deepEqual(started, segments.slice(0, 3));
  assert.equal(path.extname(first.filePath), '.piece', 'only finalized files are exposed');
  assert.equal(await fs.readFile(first.filePath, 'utf8'), 'data');
  await spool.release(segments[0]);
  await waitUntil(() => started.length === 4);
  assert.equal(spool.stats().head, 1);
  await assert.rejects(spool.get(segments[0]), { code: 'SPOOL_PIECE_RELEASED' });
});

test('native spool defers failures behind new pieces without starving the missing head', async (t) => {
  const segments = urls(4);
  const started = [];
  let headAttempts = 0;
  const { spool } = await fixture(t, {
    segments, concurrency: 2, lookahead: 4, maxSpoolBytes: 12, maxPieceBytes: 4,
    maxAttempts: 3, retryDelayMs: 0,
    request: async (url, filePath, context) => {
      started.push(url);
      if (url === segments[0] && ++headAttempts < 3) {
        const error = new Error('Temporary fixture failure.');
        error.code = 'ETIMEDOUT';
        throw error;
      }
      return writePiece(filePath, context);
    },
  });
  const first = await spool.get(segments[0]);
  assert.equal(first.bytes, 4);
  assert.equal(headAttempts, 3);
  const firstRetry = started.indexOf(segments[0], 1);
  assert.ok(started.indexOf(segments[1]) < firstRetry);
  assert.ok(started.indexOf(segments[2]) < firstRetry);
  assert.ok(spool.stats().reservedBytes <= 12);
  await spool.release(segments[0]);
  await waitUntil(() => started.includes(segments[3]));
});

test('native spool reserves active disk space and releases known-size headroom', async (t) => {
  const segments = urls(4);
  const gates = new Map();
  const { spool } = await fixture(t, {
    segments, concurrency: 4, lookahead: 4, maxSpoolBytes: 24, maxPieceBytes: 8,
    request: async (url, filePath, context) => {
      context.onContentLength(4);
      context.onBytes(4);
      await new Promise((resolve) => gates.set(url, resolve));
      await fs.writeFile(filePath, 'data');
      return { statusCode: 200, bytes: 4 };
    },
  });
  await waitUntil(() => gates.size === 4);
  assert.equal(spool.stats().active, 4);
  assert.equal(spool.stats().reservedBytes, 16);
  for (const resolve of gates.values()) resolve();
  await Promise.all(segments.map((url) => spool.get(url)));
  assert.equal(spool.stats().bytes, 16);
  await Promise.all(segments.map((url) => spool.release(url)));
  assert.equal(spool.stats().reservedBytes, 0);
});

test('native spool keeps retry headroom while a small earlier piece is still being served', { timeout: 3000 }, async (t) => {
  const segments = urls(5);
  let headReady;
  const ready = new Promise((resolve) => { headReady = resolve; });
  let attempts = 0;
  const { spool } = await fixture(t, {
    segments, concurrency: 3, lookahead: 5, maxSpoolBytes: 13, maxPieceBytes: 4,
    maxAttempts: 2, retryDelayMs: 0,
    onState: (index, state) => { if (index === 0 && state.status === 'ready') headReady(); },
    request: async (url, filePath, context) => {
      if (url === segments[1] && ++attempts === 1) {
        await ready;
        throw new Error('Temporary fixture failure.');
      }
      return writePiece(filePath, context, Buffer.from(url === segments[0] ? 'a' : 'data'));
    },
  });
  await spool.get(segments[0]);
  // Do not release the small head yet. Later prefetches must still leave a
  // complete reservation for this failed piece's second attempt.
  const second = await spool.get(segments[1]);
  assert.equal(second.bytes, 4);
  assert.equal(attempts, 2);
  assert.ok(spool.stats().reservedBytes <= 13);
});

test('native spool rejects oversized pieces once and expires credentials without burning retries', async (t) => {
  for (const scenario of ['oversize', 'expired']) {
    await t.test(scenario, async (subtest) => {
      let attempts = 0;
      const { spool } = await fixture(subtest, {
        segments: urls(1), concurrency: 1, maxAttempts: 30, retryDelayMs: 0,
        maxSpoolBytes: 4, maxPieceBytes: 4,
        request: async (_url, _filePath, context) => {
          attempts += 1;
          if (scenario === 'oversize') context.onContentLength(5);
          const error = new Error('Fixture link expired.');
          error.code = 'LINK_EXPIRED';
          throw error;
        },
      });
      await assert.rejects(spool.get(urls(1)[0]), { code: scenario === 'oversize' ? 'SPOOL_PIECE_TOO_LARGE' : 'LINK_EXPIRED' });
      assert.equal(attempts, 1);
    });
  }
});

test('native spool reports aborted siblings as cancelled after one terminal source error', async (t) => {
  const segments = urls(2);
  const states = [];
  let siblingStarted = false;
  const { spool } = await fixture(t, {
    segments, concurrency: 2,
    onState: (index, state) => states.push({ index, ...state }),
    request: async (url, _filePath, { signal }) => {
      if (url === segments[0]) {
        await waitUntil(() => siblingStarted);
        const error = new Error('Fixture link expired.');
        error.code = 'LINK_EXPIRED';
        throw error;
      }
      siblingStarted = true;
      await new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    },
  });
  await assert.rejects(spool.get(segments[0]), { code: 'LINK_EXPIRED' });
  await spool.close();
  assert.equal(states.filter((state) => state.status === 'failed').length, 1);
  assert.ok(states.some((state) => state.index === 1 && state.status === 'cancelled' && state.code === 'ABORT_ERR'));
});

test('native spool stops at the finite attempt limit and cancellation removes only its directory', async (t) => {
  await t.test('attempt limit', async (subtest) => {
    let attempts = 0;
    const { spool } = await fixture(subtest, {
      segments: urls(1), maxAttempts: 2, retryDelayMs: 0,
      request: async () => { attempts += 1; throw new Error('Temporary fixture failure.'); },
    });
    await assert.rejects(spool.get(urls(1)[0]), /Temporary fixture failure/);
    assert.equal(attempts, 2);
  });
  await t.test('cancellation', async (subtest) => {
    const controller = new AbortController();
    let started = false;
    const { spool, directory } = await fixture(subtest, {
      segments: urls(1), signal: controller.signal,
      request: async (_url, _filePath, { signal }) => {
        started = true;
        await new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        });
      },
    });
    const unrelated = path.join(directory, 'keep.txt');
    await fs.writeFile(unrelated, 'keep');
    const waiting = assert.rejects(spool.get(urls(1)[0]), { code: 'ABORT_ERR' });
    await waitUntil(() => started);
    controller.abort();
    await waiting;
    await spool.close();
    assert.equal(await fs.readFile(unrelated, 'utf8'), 'keep');
    await assert.rejects(fs.stat(spool.stats().directory), { code: 'ENOENT' });
  });
});
