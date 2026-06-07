const { exec } = require("child_process");
const { promisify } = require("util");
const fs = require("fs");

const config = require("../config.js");

let _execAsync = null;
function getExecAsync() {
  if (!_execAsync) _execAsync = promisify(exec);
  return _execAsync;
}

async function sh(command, timeout = 15000) {
  try {
    const fn = getExecAsync();
    const { stdout, stderr } = await fn(command, { timeout, env: config.ENV });
    return (stdout + stderr).trim() || "(нет вывода)";
  } catch (e) {
    return `Ошибка (exit ${e.code}): ${(e.stderr || e.message).slice(0, 300)}`;
  }
}

function timestamp() {
  return Date.now();
}

module.exports = {
  sh,
  getExecAsync,
  execAsync: (...args) => getExecAsync()(...args),
  timestamp,
  fs,
};
