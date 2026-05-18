const fs = require('fs');
const path = require('path');
const logger = require('./logger');

const CHROMIUM_SINGLETON_FILES = new Set([
  'SingletonCookie',
  'SingletonLock',
  'SingletonSocket',
  'DevToolsActivePort'
]);

function cleanupStaleChromiumProfileLocks(rootPath) {
  if (!rootPath || !fs.existsSync(rootPath)) return [];

  const removed = [];
  walk(rootPath, (entryPath, entry) => {
    if (!CHROMIUM_SINGLETON_FILES.has(entry.name)) return;

    try {
      fs.rmSync(entryPath, { force: true, recursive: false });
      removed.push(entryPath);
    } catch (error) {
      logger.warn('Failed to remove stale Chromium profile lock', {
        path: entryPath,
        error
      });
    }
  });

  if (removed.length) {
    logger.info('Removed stale Chromium profile locks', {
      count: removed.length,
      files: removed.map((filePath) => path.relative(rootPath, filePath))
    });
  }

  return removed;
}

function isChromiumProfileLockError(error) {
  const message = String(error && error.message ? error.message : error);
  return message.includes('process_singleton')
    || message.includes('profile appears to be in use')
    || message.includes('SingletonLock')
    || message.includes('SingletonSocket');
}

function walk(directory, visitor) {
  let entries = [];

  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    logger.warn('Failed to inspect Chromium profile directory', {
      path: directory,
      error
    });
    return;
  }

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    visitor(entryPath, entry);

    if (entry.isDirectory()) {
      walk(entryPath, visitor);
    }
  }
}

module.exports = {
  cleanupStaleChromiumProfileLocks,
  isChromiumProfileLockError
};
