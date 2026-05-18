const LEVELS = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

const configuredLevel = process.env.LOG_LEVEL || 'info';
const threshold = LEVELS[configuredLevel] || LEVELS.info;

function serializeError(error) {
  if (!error) return undefined;

  return {
    name: error.name,
    message: error.message,
    stack: error.stack
  };
}

function write(level, message, meta = {}) {
  if ((LEVELS[level] || LEVELS.info) < threshold) return;

  const record = {
    time: new Date().toISOString(),
    level,
    message,
    ...meta
  };

  if (record.error instanceof Error) {
    record.error = serializeError(record.error);
  }

  const line = JSON.stringify(record);
  if (level === 'error') {
    console.error(line);
    return;
  }

  console.log(line);
}

module.exports = {
  debug: (message, meta) => write('debug', message, meta),
  info: (message, meta) => write('info', message, meta),
  warn: (message, meta) => write('warn', message, meta),
  error: (message, meta) => write('error', message, meta)
};
