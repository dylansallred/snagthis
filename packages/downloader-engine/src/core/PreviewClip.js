const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');

// Keep opening excerpts distinct so complete files can replace them with a
// representative scene. Versioning also retires permanently early v1 clips.
const PREVIEW_CLIP_SUFFIX = '.cover-v2.mp4';
const INTERIM_PREVIEW_CLIP_SUFFIX = '.opening-v2.mp4';
const isCurrentPreviewClipPath = (candidate, { allowInterim = false } = {}) => typeof candidate === 'string'
  && (allowInterim ? /^[a-f0-9]{32}\.(?:cover|opening)-v2\.mp4$/i : /^[a-f0-9]{32}\.cover-v2\.mp4$/i).test(path.basename(candidate));

function runTool(executable, args, timeoutMs, signal, binary = false) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('Preview generation stopped'));
    const child = spawn(executable, args, { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
    let output = '';
    const chunks = [];
    let bytes = 0;
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
    const abort = () => child.kill('SIGKILL');
    signal?.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', (chunk) => {
      if (binary) { if (bytes + chunk.length <= 65536) { chunks.push(chunk); bytes += chunk.length; } }
      else if (output.length < 65536) output += chunk.toString();
    });
    child.once('error', (error) => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(error); });
    child.once('close', (code) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (code === 0 && !timedOut) resolve(binary ? Buffer.concat(chunks) : output);
      else reject(new Error(timedOut ? 'Preview generation timed out' : 'This local file could not produce a preview'));
    });
  });
}

function localInputArgs(inputPath) {
  return ['-protocol_whitelist', 'file,pipe,crypto', ...(/\.m3u8$/i.test(inputPath)
    ? ['-f', 'hls', '-allowed_extensions', 'ALL', '-allowed_segment_extensions', 'ALL', '-extension_picky', '0'] : [])];
}

function localSeekArgs(source, offsetSeconds) {
  // Seeking an HLS demuxer to a fragment boundary can discard the preceding
  // fragment even when its frames cover the requested timestamp. These local
  // preview windows are <=30 seconds, so decode then seek for exact coverage.
  const input = [...localInputArgs(source), '-i', source];
  return /\.m3u8$/i.test(source) ? [...input, '-ss', String(offsetSeconds)]
    : ['-ss', String(offsetSeconds), ...input];
}

async function inspectLocalVideo(inputPath, outputPath, { FFMPEG_PATH, FFPROBE_PATH, signal }) {
  if (!FFMPEG_PATH || !FFPROBE_PATH || !path.isAbsolute(inputPath || '') || !path.isAbsolute(outputPath || '')) {
    throw new Error('Preview generation requires local files and media tools');
  }
  const source = await fs.realpath(inputPath);
  if (!(await fs.stat(source)).isFile() || path.resolve(outputPath) === source) throw new Error('Invalid local preview source');
  const probe = JSON.parse(await runTool(FFPROBE_PATH, [
    '-v', 'error', ...localInputArgs(source), '-select_streams', 'v:0',
    '-show_entries', 'stream=codec_type:format=duration', '-of', 'json', source,
  ], 8000, signal));
  if (!probe.streams?.some((stream) => stream.codec_type === 'video')) throw new Error('This file has no video preview');
  const duration = Number(probe.format?.duration);
  return { source, duration };
}

/** Generate a bounded, silent browser preview from usable local media. */
async function generatePreviewClip(inputPath, outputPath, { FFMPEG_PATH, FFPROBE_PATH, signal, offsetSeconds: requestedOffset } = {}) {
  const { source, duration } = await inspectLocalVideo(inputPath, outputPath, { FFMPEG_PATH, FFPROBE_PATH, signal });
  return encodePreviewClip({ source, duration }, outputPath, { FFMPEG_PATH, signal, offsetSeconds: requestedOffset });
}

async function encodePreviewClip({ source, duration }, outputPath, { FFMPEG_PATH, signal, offsetSeconds: requestedOffset }) {
  const offsetSeconds = Number.isFinite(requestedOffset) ? Math.max(0, Math.min(requestedOffset, Math.max(0, (duration || 10) - 0.1)))
    : Number.isFinite(duration) && duration > 20 ? duration * 0.35 : 0;
  const durationSeconds = Number.isFinite(duration) && duration > 0 ? Math.min(10, duration - offsetSeconds) : 10;
  await fs.mkdir(path.dirname(outputPath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${outputPath}.part`;
  try {
    await runTool(FFMPEG_PATH, [
      '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
      ...localSeekArgs(source, offsetSeconds),
      '-t', String(durationSeconds), '-map', '0:v:0', '-an', '-sn', '-dn',
      '-vf', 'fps=12,scale=320:180:force_original_aspect_ratio=increase:force_divisible_by=2,crop=320:180',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-profile:v', 'baseline',
      '-pix_fmt', 'yuv420p', '-threads', '1', '-movflags', '+faststart', '-f', 'mp4', temporaryPath,
    ], 30000, signal);
    if (!(await fs.stat(temporaryPath)).size) throw new Error('The preview is empty');
    await fs.chmod(temporaryPath, 0o600);
    await fs.rename(temporaryPath, outputPath);
    return { path: outputPath, durationSeconds, offsetSeconds };
  } catch (error) {
    await fs.rm(temporaryPath, { force: true });
    throw error;
  }
}

/** Pick an actual scene instead of an opening black frame or a page screenshot. */
async function generateRepresentativePoster(inputPath, outputPath, options = {}) {
  const inspected = await inspectLocalVideo(inputPath, outputPath, options);
  return selectPoster(inspected, outputPath, options);
}

async function selectPoster({ source, duration }, outputPath, { FFMPEG_PATH, signal, candidateOffsetsSeconds, interim = false }) {
  const fractions = duration > 30 ? [0.35, 0.5, 0.25, 0.65, 0.2, 0.8, 0.1, 0.9, 0.03, 0.97] : [0.35, 0.6, 0.8, 0.1, 0.95];
  const availableOffsets = Array.isArray(candidateOffsetsSeconds) ? candidateOffsetsSeconds
    : interim ? [Math.min(30, duration * 0.35), 45, 60]
    : Number.isFinite(duration) && duration > 0 ? fractions.map(fraction => Math.max(0, Math.min(duration - 0.1, duration * fraction))) : [2, 5, 8];
  const offsets = [...new Set(availableOffsets.filter(offset => Number.isFinite(offset) && offset >= 0 && (!duration || offset < duration)))];
  await fs.mkdir(path.dirname(outputPath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${outputPath}.part`;
  try {
    for (const offsetSeconds of offsets) {
      let frame;
      try {
        // Produce the candidate JPEG and its small diagnostic frame from one
        // source decode. A rejected image remains private and is overwritten.
        frame = await runTool(FFMPEG_PATH, [
          '-nostdin', '-hide_banner', '-loglevel', 'error', '-y', ...localSeekArgs(source, offsetSeconds),
          '-map', '0:v:0', '-frames:v', '1', '-vf', 'scale=320:180:force_original_aspect_ratio=increase,crop=320:180',
          '-q:v', '3', '-f', 'image2', temporaryPath,
          ...(/\.m3u8$/i.test(source) ? ['-ss', String(offsetSeconds)] : []),
          '-map', '0:v:0', '-frames:v', '1', '-vf', 'scale=64:36,format=gray', '-f', 'rawvideo', 'pipe:1',
        ], 8000, signal, true);
      } catch (error) { if (signal?.aborted) throw error; continue; }
      if (frame.length !== 64 * 36) continue;
      const average = frame.reduce((sum, value) => sum + value, 0) / frame.length;
      const variance = frame.reduce((sum, value) => sum + (value - average) ** 2, 0) / frame.length;
      if (average <= 22 || average >= 240 || variance <= 36) continue;
      await fs.chmod(temporaryPath, 0o600);
      await fs.rename(temporaryPath, outputPath);
      return { path: outputPath, offsetSeconds };
    }
    const error = new Error('The available video frames are too dark or blank for a useful poster.');
    error.code = 'NO_USABLE_POSTER';
    throw error;
  } finally {
    await fs.rm(temporaryPath, { force: true });
  }
}

/** One source probe and one poster decode shared by both derived assets. */
async function generatePreviewAssets(inputPath, clipPath, posterPath, options = {}) {
  const inspected = await inspectLocalVideo(inputPath, clipPath, options);
  if (!path.isAbsolute(posterPath || '') || path.resolve(posterPath) === inspected.source || path.resolve(posterPath) === path.resolve(clipPath)) {
    throw new Error('Invalid local preview poster path');
  }
  const poster = await selectPoster(inspected, posterPath, options);
  const clip = await encodePreviewClip(inspected, clipPath, { ...options, offsetSeconds: poster.offsetSeconds });
  return { poster, clip };
}

module.exports = { generatePreviewClip, generateRepresentativePoster, generatePreviewAssets, PREVIEW_CLIP_SUFFIX, INTERIM_PREVIEW_CLIP_SUFFIX, isCurrentPreviewClipPath };
