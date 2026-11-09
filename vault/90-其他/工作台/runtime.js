// Shared executable lookup for Obsidian's desktop process (which may have a short PATH).
const fs = require('fs');
const path = require('path');
const os = require('os');
const {spawnSync} = require('child_process');

function settings() {
  const file = path.join(__dirname, 'runtime-config.json');
  if (!fs.existsSync(file)) return {};
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { throw new Error('runtime-config.json 格式有误，请检查 JSON。'); }
}
function environment(python = '') {
  return {...process.env, PATH: [...new Set([
    python ? path.dirname(python) : '',
    path.join(os.homedir(), '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin',
    ...(process.env.PATH || '').split(path.delimiter), '/usr/bin', '/bin'
  ].filter(Boolean))].join(path.delimiter), PYTHONUNBUFFERED: '1', PYTHONDONTWRITEBYTECODE: '1'};
}
function executable(kind) {
  const explicit = process.env['PWB_' + kind.toUpperCase() + '_COMMAND'] || settings()[kind + '_command'];
  const candidates = explicit ? [explicit] : kind === 'python'
    ? ['python3', 'python3.13', 'python3.12', 'python3.11'] : ['codex'];
  for (const candidate of candidates) {
    const command = candidate.startsWith('~/') ? path.join(os.homedir(), candidate.slice(2)) : candidate;
    const files = command.includes(path.sep) ? [command] : environment().PATH.split(path.delimiter).map(dir => path.join(dir, command));
    for (const file of files) {
      try {
        fs.accessSync(file, fs.constants.X_OK);
        if (kind === 'python') {
          const probe = spawnSync(file, ['-c', 'import sys; sys.exit(sys.version_info < (3, 11))'], {timeout: 5000, env: environment()});
          if (probe.status !== 0) continue;
        }
        return file;
      } catch { /* Try the next installed executable. */ }
    }
  }
  throw new Error(kind === 'python'
    ? '未找到 Python 3.11+。请在 runtime-config.json 中设置 python_command。'
    : '未找到 Codex CLI。请安装并登录，或设置 codex_command。');
}
module.exports = {settings, environment, executable};
