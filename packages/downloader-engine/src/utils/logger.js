const winston = require('winston');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { redact } = require('./redact');

const isTest = process.env.NODE_ENV === 'test';
const disableFileLogs = process.env.DISABLE_FILE_LOGS === '1' || isTest;
const loggerLevel = process.env.LOG_LEVEL || (isTest ? 'error' : 'info');

function resolveLogDir() {
  if (process.env.LOG_DIR) {
    return process.env.LOG_DIR;
  }
  if (process.env.M3U8_DATA_DIR) {
    return path.join(process.env.M3U8_DATA_DIR, 'logs');
  }
  return path.join(process.cwd(), 'logs');
}

const logDir = resolveLogDir();

const transports = [
  new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.simple()
    )
  }),
];

let fileLoggingEnabled = !disableFileLogs;
if (fileLoggingEnabled) {
  try {
    fs.mkdirSync(logDir, { recursive: true });
  } catch (err) {
    fileLoggingEnabled = false;
    console.warn('File logging disabled: unable to initialize log directory', {
      logDir,
      error: err && err.message ? err.message : String(err),
      host: os.hostname(),
    });
  }
}

// Keep a bounded history: the newest file keeps its name (tailable) and older
// ones rotate out, so a long-running install cannot fill the profile disk.
const rotation = { maxsize: 5 * 1024 * 1024, maxFiles: 3, tailable: true };

if (fileLoggingEnabled) {
  transports.push(
    new winston.transports.File({
      filename: path.join(logDir, 'error.log'),
      level: 'error',
      ...rotation,
    }),
    new winston.transports.File({
      filename: path.join(logDir, 'combined.log'),
      ...rotation,
    })
  );
}

const logger = winston.createLogger({
  level: loggerLevel,
  format: winston.format.combine(
    // Media URLs carry signed query tokens; never write them to disk.
    winston.format((info) => Object.assign(info, redact(info)))(),
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'm3u8-downloader' },
  transports
});

module.exports = logger;
