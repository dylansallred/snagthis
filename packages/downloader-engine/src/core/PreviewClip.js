const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');

function runTool(executable, args, timeoutMs, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('Preview generation stopped'));
    const child = spawn(executable, args, { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
    let output = '';
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
    const abort = () => child.kill('SIGKILL');
    signal?.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', (chunk) => { if (output.length < 65536) output += chunk.toString(); });
    child.once('error', (error) => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(error); });
    child.once('close', (code) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (code === 0 && !timedOut) resolve(output);
      else reject(new Error(timedOut ? 'Preview generation timed out' : 'This local file could not produce a preview'));
    });
  });
}

/** Generate a bounded, silent browser preview from a completed local video. */
async function generatePreviewClip(inputPath, outputPath, { FFMPEG_PATH, FFPROBE_PATH, signal } = {}) {
  if (!FFMPEG_PATH || !FFPROBE_PATH || !path.isAbsolute(inputPath || '') || !path.isAbsolute(outputPath || '')) {
    throw new Error('Preview generation requires local files and media tools');
  }
  const source = await fs.realpath(inputPath);
  if (!(await fs.stat(source)).isFile() || path.resolve(outputPath) === source) throw new Error('Invalid local preview source');
  const probe = JSON.parse(await runTool(FFPROBE_PATH, [
    '-v', 'error', '-protocol_whitelist', 'file,pipe', '-select_streams', 'v:0',
    '-show_entries', 'stream=codec_type:format=duration', '-of', 'json', source,
  ], 8000, signal));
  if (!probe.streams?.some((stream) => stream.codec_type === 'video')) throw new Error('This file has no video preview');
  const duration = Number(probe.format?.duration);
  const durationSeconds = Number.isFinite(duration) && duration > 0 ? Math.min(10, duration) : 10;
  const offsetSeconds = Number.isFinite(duration) && duration > 20 ? Math.min(duration * 0.1, duration - durationSeconds) : 0;
  await fs.mkdir(path.dirname(outputPath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${outputPath}.part`;
  try {
    await runTool(FFMPEG_PATH, [
      '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
      '-ss', String(offsetSeconds), '-protocol_whitelist', 'file,pipe', '-i', source,
      '-t', String(durationSeconds), '-map', '0:v:0', '-an', '-sn', '-dn',
      '-vf', 'fps=12,scale=320:180:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=320:180:(ow-iw)/2:(oh-ih)/2',
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

module.exports = { generatePreviewClip };
