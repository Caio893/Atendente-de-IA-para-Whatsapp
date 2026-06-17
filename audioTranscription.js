const { execFile } = require('child_process');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const logger = require('./logger');

const DEFAULT_TIMEOUT_MS = 120000;
const DEFAULT_MAX_AUDIO_BYTES = 10 * 1024 * 1024;
const DEFAULT_MAX_TRANSCRIPT_CHARS = 4000;
const DEFAULT_WHISPER_THREADS = 1;
const DEFAULT_FFMPEG_THREADS = 1;
const DEFAULT_MAX_CONCURRENCY = 1;
const DEFAULT_MAX_QUEUE = 3;
const DEFAULT_WHISPER_BINARY_PATH = path.join(
  process.cwd(),
  'bin',
  process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli'
);
const DEFAULT_WHISPER_MODEL_PATH = path.join(process.cwd(), 'models', 'ggml-tiny.bin');
const transcriptionSlots = {
  active: 0,
  waiting: []
};

function getAudioTranscriptionConfig() {
  return {
    enabled: process.env.AUDIO_TRANSCRIPTION_ENABLED !== 'false',
    whisperBinaryPath: process.env.WHISPER_CPP_BIN || DEFAULT_WHISPER_BINARY_PATH,
    whisperModelPath: process.env.WHISPER_MODEL_PATH || DEFAULT_WHISPER_MODEL_PATH,
    whisperLanguage: process.env.WHISPER_LANGUAGE || 'pt',
    ffmpegPath: process.env.FFMPEG_PATH || 'ffmpeg',
    timeoutMs: parsePositiveInteger(process.env.AUDIO_TRANSCRIPTION_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
    maxAudioBytes: parsePositiveInteger(process.env.MAX_AUDIO_TRANSCRIPTION_BYTES, DEFAULT_MAX_AUDIO_BYTES),
    maxTranscriptChars: parsePositiveInteger(process.env.MAX_AUDIO_TRANSCRIPTION_CHARS, DEFAULT_MAX_TRANSCRIPT_CHARS),
    whisperThreads: parsePositiveInteger(process.env.WHISPER_THREADS, DEFAULT_WHISPER_THREADS),
    ffmpegThreads: parsePositiveInteger(process.env.FFMPEG_THREADS, DEFAULT_FFMPEG_THREADS),
    maxConcurrency: parsePositiveInteger(process.env.AUDIO_TRANSCRIPTION_MAX_CONCURRENCY, DEFAULT_MAX_CONCURRENCY),
    maxQueue: parsePositiveInteger(process.env.AUDIO_TRANSCRIPTION_MAX_QUEUE, DEFAULT_MAX_QUEUE)
  };
}

function getAudioTranscriptionInfo() {
  const config = getAudioTranscriptionConfig();

  return {
    enabled: config.enabled,
    configured: isAudioTranscriptionConfigured(config),
    provider: 'whisper.cpp',
    whisperBinaryPath: config.whisperBinaryPath,
    whisperModelPath: config.whisperModelPath,
    whisperLanguage: config.whisperLanguage,
    ffmpegPath: config.ffmpegPath,
    timeoutMs: config.timeoutMs,
    maxAudioBytes: config.maxAudioBytes,
    maxTranscriptChars: config.maxTranscriptChars,
    whisperThreads: config.whisperThreads,
    ffmpegThreads: config.ffmpegThreads,
    maxConcurrency: config.maxConcurrency,
    maxQueue: config.maxQueue,
    activeJobs: transcriptionSlots.active,
    queuedJobs: transcriptionSlots.waiting.length
  };
}

function isAudioTranscriptionConfigured(config = getAudioTranscriptionConfig()) {
  return Boolean(
    config.enabled
      && pathLooksAvailable(config.whisperBinaryPath, { allowPathLookup: true })
      && pathLooksAvailable(config.whisperModelPath)
  );
}

async function transcribeWhatsAppAudio(message, options = {}) {
  const config = {
    ...getAudioTranscriptionConfig(),
    ...options
  };

  if (!config.enabled) {
    return { ok: false, skipped: true, reason: 'disabled', text: '' };
  }

  if (!isAudioTranscriptionConfigured(config)) {
    return { ok: false, skipped: true, reason: 'not_configured', text: '' };
  }

  if (!message || typeof message.downloadMedia !== 'function') {
    return { ok: false, skipped: false, reason: 'missing_media_downloader', text: '' };
  }

  return await runWithTranscriptionSlot(config, () => transcribeWhatsAppAudioWithSlot(message, config));
}

async function transcribeWhatsAppAudioWithSlot(message, config) {
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'whatsapp-audio-'));

  try {
    const media = await withTimeout(message.downloadMedia(), config.timeoutMs, 'message.downloadMedia(audio)');
    if (!media || !media.data) {
      return { ok: false, skipped: false, reason: 'empty_media', text: '' };
    }

    const audioBuffer = Buffer.from(media.data, 'base64');
    if (!audioBuffer.length) {
      return { ok: false, skipped: false, reason: 'empty_audio', text: '' };
    }

    if (audioBuffer.length > config.maxAudioBytes) {
      return { ok: false, skipped: false, reason: 'audio_too_large', text: '' };
    }

    const inputPath = path.join(tempDir, `input${extensionFromMimeType(media.mimetype)}`);
    const wavPath = path.join(tempDir, 'audio.wav');
    const transcriptBasePath = path.join(tempDir, 'transcript');
    const transcriptPath = `${transcriptBasePath}.txt`;

    await fsp.writeFile(inputPath, audioBuffer);
    await convertAudioToWav(inputPath, wavPath, config);
    const whisperOutput = await runWhisper(wavPath, transcriptBasePath, config);
    const fileTranscript = await readTextFileIfExists(transcriptPath);
    const transcript = cleanTranscript(fileTranscript || whisperOutput, config.maxTranscriptChars);

    if (!transcript) {
      return { ok: false, skipped: false, reason: 'empty_transcript', text: '' };
    }

    return {
      ok: true,
      skipped: false,
      reason: '',
      text: transcript
    };
  } catch (error) {
    logger.warn('Audio transcription failed', { error });
    return {
      ok: false,
      skipped: false,
      reason: 'transcription_failed',
      text: ''
    };
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true }).catch((error) => {
      logger.debug('Failed to remove temporary audio transcription directory', {
        tempDir,
        error
      });
    });
  }
}

async function convertAudioToWav(inputPath, wavPath, config) {
  await execFileWithTimeout(config.ffmpegPath, [
    '-y',
    '-nostdin',
    '-hide_banner',
    '-loglevel',
    'error',
    '-threads',
    String(config.ffmpegThreads),
    '-i',
    inputPath,
    '-ar',
    '16000',
    '-ac',
    '1',
    '-c:a',
    'pcm_s16le',
    wavPath
  ], config.timeoutMs, 'ffmpeg');
}

async function runWhisper(wavPath, transcriptBasePath, config) {
  const args = [
    '-m',
    config.whisperModelPath,
    '-f',
    wavPath,
    '-l',
    config.whisperLanguage,
    '-t',
    String(config.whisperThreads),
    '-otxt',
    '-of',
    transcriptBasePath,
    '-nt',
    '-np'
  ];

  return await execFileWithTimeout(config.whisperBinaryPath, args, config.timeoutMs, 'whisper.cpp');
}

async function runWithTranscriptionSlot(config, task) {
  const maxConcurrency = Math.max(1, config.maxConcurrency);
  const maxQueue = Math.max(1, config.maxQueue);

  if (transcriptionSlots.active >= maxConcurrency && transcriptionSlots.waiting.length >= maxQueue) {
    logger.warn('Audio transcription queue is full', {
      activeJobs: transcriptionSlots.active,
      queuedJobs: transcriptionSlots.waiting.length,
      maxConcurrency,
      maxQueue
    });
    return { ok: false, skipped: false, reason: 'transcription_queue_full', text: '' };
  }

  await acquireTranscriptionSlot(maxConcurrency);

  try {
    return await task();
  } finally {
    releaseTranscriptionSlot();
  }
}

function acquireTranscriptionSlot(maxConcurrency) {
  if (transcriptionSlots.waiting.length === 0 && transcriptionSlots.active < maxConcurrency) {
    transcriptionSlots.active += 1;
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    transcriptionSlots.waiting.push(resolve);
  });
}

function releaseTranscriptionSlot() {
  transcriptionSlots.active = Math.max(0, transcriptionSlots.active - 1);

  const next = transcriptionSlots.waiting.shift();
  if (!next) return;

  transcriptionSlots.active += 1;
  next();
}

function execFileWithTimeout(command, args, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    execFile(command, args, {
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024,
      windowsHide: true
    }, (error, stdout, stderr) => {
      if (error) {
        error.message = `${label} failed: ${error.message}`;
        error.stderr = stderr;
        reject(error);
        return;
      }

      resolve(String(stdout || ''));
    });
  });
}

function withTimeout(promise, timeoutMs, label) {
  let timer = null;

  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => {
    clearTimeout(timer);
  });
}

async function readTextFileIfExists(filePath) {
  if (!fs.existsSync(filePath)) return '';
  return await fsp.readFile(filePath, 'utf8');
}

function cleanTranscript(value, maxChars) {
  const withoutWhisperLogs = String(value || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !isWhisperLogLine(line))
    .map((line) => line.replace(/^\[[^\]]+\]\s*/, '').trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  return withoutWhisperLogs.slice(0, maxChars).trim();
}

function isWhisperLogLine(line) {
  return /^whisper_/i.test(line)
    || /^main:/i.test(line)
    || /^system_info:/i.test(line)
    || /^sampling:/i.test(line);
}

function extensionFromMimeType(mimeType = '') {
  const normalized = String(mimeType || '').toLowerCase();
  if (normalized.includes('ogg')) return '.ogg';
  if (normalized.includes('opus')) return '.opus';
  if (normalized.includes('mpeg') || normalized.includes('mp3')) return '.mp3';
  if (normalized.includes('mp4') || normalized.includes('m4a')) return '.m4a';
  if (normalized.includes('wav')) return '.wav';
  if (normalized.includes('webm')) return '.webm';
  return '.audio';
}

function pathLooksAvailable(value, { allowPathLookup = false } = {}) {
  const candidate = String(value || '').trim();
  if (!candidate) return false;

  if (allowPathLookup && !candidate.includes('/') && !candidate.includes('\\')) {
    return true;
  }

  return fs.existsSync(candidate);
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

module.exports = {
  getAudioTranscriptionConfig,
  getAudioTranscriptionInfo,
  isAudioTranscriptionConfigured,
  transcribeWhatsAppAudio
};
