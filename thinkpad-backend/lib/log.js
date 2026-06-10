'use strict';
/**
 * Shared file+stdout logger for crons. One line format everywhere:
 *   [ISO-timestamp] message
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const BASE_DIR = path.join(os.homedir(), 'manicbot-backend');

function createLogger(name, { dir = path.join(BASE_DIR, 'logs'), stdout = true } = {}) {
  const file = path.join(dir, `${name}.log`);
  function log(msg) {
    const line = `[${new Date().toISOString()}] ${msg}\n`;
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.appendFileSync(file, line);
    } catch { /* a full disk must not kill the cron itself */ }
    if (stdout) process.stdout.write(line);
  }
  return { log, file };
}

module.exports = { createLogger, BASE_DIR };
