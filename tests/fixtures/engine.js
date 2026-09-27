const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { runTool } = require('./server');

async function probeFile(filePath, ffprobePath = process.env.FFPROBE_PATH || 'ffprobe') {
  const raw = await runTool(ffprobePath, ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', filePath]);
  const probe = JSON.parse(raw);
  return {
    durationSeconds: Number(probe.format?.duration),
    format: probe.format?.format_name || '',
    height: probe.streams?.find((stream) => stream.codec_type === 'video')?.height || 0,
    hasAudio: probe.streams?.some((stream) => stream.codec_type === 'audio') || false,
    hasSubtitles: probe.streams?.some((stream) => stream.codec_type === 'subtitle') || false,
    streams: probe.streams || [],
  };
}

async function downloadMedia({ url, directory, mediaType = 'hls', headers = {}, selection, probe, verify = true, skipEarlyThumbnail = false, ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg', ffprobePath = process.env.FFPROBE_PATH || 'ffprobe' }) {
  process.env.DISABLE_FILE_LOGS = '1';
  const { createJobProcessor } = require('../../packages/downloader-engine/src/core/JobProcessor');
  const id = randomUUID();
  const output = path.join(directory, id);
  fs.mkdirSync(output, { recursive: true });
  const processor = createJobProcessor({
    downloadDir: directory,
    FFMPEG_PATH: ffmpegPath,
    FFPROBE_PATH: ffprobePath,
    fsPromises: fs.promises,
    DEFAULT_MAX_CONCURRENT: 3,
    DEFAULT_MAX_SEGMENT_ATTEMPTS: 3,
    getJobTempDirForUrl: (_url, jobId) => path.join(directory, `temp-fixture-${jobId}`),
  });
  const job = {
    id, url, mediaType, headers, selection, probe,
    title: 'Generated SnagThis fixture', status: 'pending', queueStatus: 'downloading',
    progress: 0, bytesDownloaded: 0, completedSegments: 0, failedSegments: [],
    filePath: path.join(output, mediaType === 'file' ? 'fixture.mp4' : 'fixture.ts'),
    storageDir: output, downloadName: 'fixture.ts', downloadNameMp4: 'fixture.mp4',
    skipThumbnailGeneration: true,
    earlyThumbnailAttempted: skipEarlyThumbnail,
  };
  const timer = setTimeout(() => { job.cancelled = true; job.childProcess?.kill('SIGTERM'); }, 60_000);
  try {
    await (mediaType === 'file' ? processor.runDirectJob(job) : processor.runJob(job));
  } finally { clearTimeout(timer); }
  if (job.status !== 'completed') throw Object.assign(new Error(job.error || `Download ended as ${job.status}`), { job });
  const filePath = job.mp4Path || job.filePath;
  return { job, filePath, metadata: verify ? await probeFile(filePath, ffprobePath) : null };
}

module.exports = { downloadMedia, probeFile };
