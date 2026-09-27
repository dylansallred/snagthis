// Original chiptune loops for the Pixel worlds clips: square-wave lead, triangle bass and
// noise drums, synthesised here so we own them outright. Each loop lasts exactly one clip
// (10 s). Rendering two passes and keeping the second makes note tails wrap across the seam.
//   node src/soundtrack.mjs out-dir   → writes <clip>.wav for every clip below
import fs from 'node:fs';
import path from 'node:path';

const RATE = 44100;
const LOOP = 10; // seconds, the clip length

// Semitones from A4 (440 Hz). 0 = rest.
const hz = (semi) => 440 * 2 ** (semi / 12);
const CLIPS = {
  // 120 bpm: 20 beats. Driving minor arpeggios for the rainy night drive.
  'neon-rain': { bpm: 120, key: -9, lead: [0, 3, 7, 10, 12, 10, 7, 3, -2, 2, 5, 9, 10, 9, 5, 2, -4, 0, 3, 7], bass: [0, 0, -2, -4, -5], leadWave: 0.25, hats: true },
  // 96 bpm: 16 beats. Slow, warm major melody for the sunset sail.
  'ember-tide': { bpm: 96, key: -5, lead: [4, 7, 12, 11, 9, 7, 4, 2, 0, 2, 4, 7, 5, 4, 2, 0], bass: [0, -5, -3, -7], leadWave: 0.5, hats: false },
  // 150 bpm: 25 beats. Fast arcade run.
  'star-courier': { bpm: 150, key: -2, lead: [0, 12, 7, 12, 3, 15, 10, 15, 5, 17, 12, 17, 7, 19, 14, 19, 0, 12, 7, 12, 3, 15, 10, 15, 12], bass: [0, 0, 3, 5, 7], leadWave: 0.125, hats: true },
  // 132 bpm: 22 beats. Bouncy major hop.
  'sky-hop': { bpm: 132, key: 3, lead: [0, 4, 7, 12, 7, 4, 5, 9, 12, 17, 12, 9, 7, 11, 14, 19, 14, 11, 12, 7, 4, 0], bass: [0, 5, 7, 0], leadWave: 0.25, hats: true },
};

function square(phase, duty) { return (phase % 1) < duty ? 1 : -1; }
function triangle(phase) { const p = phase % 1; return 4 * Math.abs(p - 0.5) - 1; }

function render(spec) {
  const total = LOOP * 2 * RATE;
  const out = new Float32Array(total);
  const beat = 60 / spec.bpm;
  const beats = Math.round(LOOP / beat);
  let noise = 12345;
  const rand = () => { noise = (noise * 1103515245 + 12345) & 0x7fffffff; return noise / 0x3fffffff - 1; };
  const note = (start, length, freq, gain, voice) => {
    const s0 = Math.floor(start * RATE); const n = Math.floor(length * RATE);
    for (let i = 0; i < n && s0 + i < total; i += 1) {
      const t = i / RATE; const env = Math.min(1, t / 0.005) * Math.exp(-t * (voice === 'bass' ? 3 : 6));
      const phase = freq * t;
      out[s0 + i] += gain * env * (voice === 'bass' ? triangle(phase) : square(phase, spec.leadWave));
    }
  };
  const drum = (start, kind) => {
    const s0 = Math.floor(start * RATE); const n = Math.floor((kind === 'kick' ? 0.18 : 0.04) * RATE);
    for (let i = 0; i < n && s0 + i < total; i += 1) {
      const t = i / RATE;
      out[s0 + i] += kind === 'kick'
        ? 0.5 * Math.exp(-t * 18) * Math.sin(2 * Math.PI * (120 - 400 * t) * t)
        : 0.12 * Math.exp(-t * 90) * rand();
    }
  };
  for (let pass = 0; pass < 2; pass += 1) {
    const offset = pass * LOOP;
    for (let b = 0; b < beats; b += 1) {
      const at = offset + b * beat;
      const lead = spec.lead[b % spec.lead.length];
      note(at, beat * 0.9, hz(spec.key + lead + 12), 0.16, 'lead');
      note(at + beat / 2, beat * 0.4, hz(spec.key + lead + 19), 0.06, 'lead'); // off-beat sparkle
      const bass = spec.bass[Math.floor(b / 4) % spec.bass.length];
      note(at, beat * 0.95, hz(spec.key + bass - 24), 0.3, 'bass');
      if (b % 2 === 0) drum(at, 'kick');
      if (spec.hats) { drum(at + beat / 2, 'hat'); }
    }
  }
  return out.subarray(LOOP * RATE, 2 * LOOP * RATE); // the second pass: tails wrap into the start
}

function wav(samples) {
  const data = Buffer.alloc(samples.length * 2);
  let peak = 0; for (const v of samples) peak = Math.max(peak, Math.abs(v));
  const scale = peak ? 0.7 / peak : 1; // leave headroom; the clips should stay quiet
  samples.forEach((v, i) => data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v * scale)) * 32767), i * 2));
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + data.length, 4); header.write('WAVE', 8);
  header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(RATE, 24); header.writeUInt32LE(RATE * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

const dir = process.argv[2] || '.';
fs.mkdirSync(dir, { recursive: true });
for (const [name, spec] of Object.entries(CLIPS)) {
  fs.writeFileSync(path.join(dir, `${name}.wav`), wav(render(spec)));
  console.log(`wrote ${name}.wav`);
}
