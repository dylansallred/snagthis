#!/usr/bin/env node
// Renders the four "Pixel worlds" sample clips procedurally (no external assets).
//
//   node generate.mjs                 # render every clip + poster
//   node generate.mjs neon ocean      # render some clips
//   node generate.mjs neon --frames 0,90,359   # dump preview PNGs to ./frames/
//
// Each frame is drawn into a 320 × 180 RGB buffer by src/<scene>.mjs, streamed to
// ffmpeg as raw video and scaled 4× nearest-neighbour to 1280 × 720 (crisp pixels).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Frame, W, H, FPS } from './src/lib.mjs';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const FFMPEG = process.env.FFMPEG || '/opt/homebrew/bin/ffmpeg';
const SCENES = ['neon', 'ocean', 'space', 'hop'];

const args = process.argv.slice(2);
const fi = args.indexOf('--frames');
const frameList = fi >= 0 ? args.splice(fi, 2)[1].split(',').map(Number) : null;
const ids = args.length ? args : SCENES;

function ff(argv, input) {
  const proc = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...argv], { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise((resolve, reject) => proc.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`)))));
  if (input) proc.stdin.end(input);
  return { stdin: proc.stdin, done };
}
const RAW_IN = ['-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${W}x${H}`, '-r', String(FPS), '-i', '-'];
const UPSCALE = ['-vf', 'scale=1280:720:flags=neighbor'];

function renderFrame(scene, f) {
  const fr = new Frame();
  scene.render(fr, f);
  return Buffer.from(fr.d.buffer);
}

// Two-pass x264 to a per-clip bitrate so every clip lands under ~800 KB. Deblocking and
// psy-rd are off: they soften or spend bits on the hard 4 × 4 pixel edges.
async function encodeClip(scene) {
  const out = path.join(DIR, `${scene.id}.mp4`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pixel-worlds-'));
  const raw = path.join(tmp, 'frames.rgb');
  const fd = fs.openSync(raw, 'w');
  for (let f = 0; f < scene.frames; f++) fs.writeSync(fd, renderFrame(scene, f));
  fs.closeSync(fd);
  const x264 = ['-c:v', 'libx264', '-preset', 'veryslow', '-b:v', `${scene.kbps ?? 600}k`,
    '-x264-params', 'keyint=300:min-keyint=30:bframes=8:ref=8:no-deblock=1:psy-rd=0.0,0.0', '-pix_fmt', 'yuv420p'];
  const input = [...RAW_IN.slice(0, -1), raw, ...UPSCALE];
  const log = path.join(tmp, 'x264');
  await ff([...input, ...x264, '-pass', '1', '-passlogfile', log, '-an', '-f', 'mp4', '/dev/null']).done;
  await ff([...input, ...x264, '-pass', '2', '-passlogfile', log, '-movflags', '+faststart', '-an', out]).done;
  fs.rmSync(tmp, { recursive: true, force: true });
  // Poster: the same pixels, as a 1280 × 720 JPEG under 80 KB.
  const poster = path.join(DIR, `${scene.id}.jpg`);
  const still = renderFrame(scene, scene.poster);
  for (const q of [3, 4, 5, 6, 8, 10, 12]) {
    await ff([...RAW_IN, ...UPSCALE, '-frames:v', '1', '-q:v', String(q), poster], still).done;
    if (fs.statSync(poster).size <= 80 * 1024) break;
  }
  const kb = (p) => (fs.statSync(p).size / 1024).toFixed(0);
  console.log(`${scene.id}: ${scene.frames / FPS}s  mp4 ${kb(out)} KB  poster ${kb(poster)} KB`);
}

for (const id of ids) {
  if (!SCENES.includes(id)) throw new Error(`unknown scene ${id}`);
  const scene = (await import(`./src/${id}.mjs`)).default;
  scene.setup?.();
  if (frameList) {
    fs.mkdirSync(path.join(DIR, 'frames'), { recursive: true });
    for (const f of frameList) {
      await ff([...RAW_IN, ...UPSCALE, '-frames:v', '1', path.join(DIR, 'frames', `${id}-${String(f).padStart(3, '0')}.png`)], renderFrame(scene, f)).done;
    }
    console.log(`${id}: wrote frames ${frameList.join(',')}`);
  } else {
    await encodeClip(scene);
  }
}
