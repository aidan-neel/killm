'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const BEGIN = '# >>> killm block (do not edit between markers) >>>';
const END = '# <<< killm block <<<';
const SINK4 = '0.0.0.0';
const SINK6 = '::1';

/**
 * Absolute path to the OS hosts file.
 * @returns {string}
 */
function hostsPath() {
  if (process.platform === 'win32') {
    const root = process.env.SystemRoot || 'C:\\Windows';
    return path.join(root, 'System32', 'drivers', 'etc', 'hosts');
  }
  return '/etc/hosts';
}

/**
 * Read the current hosts file as text. Returns '' if it does not exist.
 * @returns {string}
 */
function readHosts() {
  try {
    return fs.readFileSync(hostsPath(), 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return '';
    throw err;
  }
}

/**
 * Strip any existing killm-managed block from hosts text.
 * @param {string} text
 * @returns {string}
 */
function stripBlock(text) {
  const begin = text.indexOf(BEGIN);
  if (begin === -1) return text;
  const end = text.indexOf(END, begin);
  if (end === -1) {
    // Malformed (begin without end): drop everything from the marker on.
    return text.slice(0, begin).replace(/\n+$/, '\n');
  }
  const before = text.slice(0, begin);
  const after = text.slice(end + END.length);
  return (before.replace(/\n+$/, '\n') + after.replace(/^\n+/, '')).replace(/\n{3,}/g, '\n\n');
}

/**
 * Build the killm block text for the given hostnames.
 * @param {string[]} hosts
 * @param {{until?: Date}} [opts]
 * @returns {string}
 */
function buildBlock(hosts, opts = {}) {
  const lines = [BEGIN];
  lines.push(`# added by killm at ${new Date().toISOString()}`);
  if (opts.until) {
    lines.push(`# auto-removed at ${opts.until.toISOString()} (or when killm exits)`);
  }
  for (const h of hosts) {
    lines.push(`${SINK4}\t${h}`);
    lines.push(`${SINK4}\twww.${h}`.replace('www.www.', 'www.'));
    lines.push(`${SINK6}\t${h}`);
  }
  lines.push(END);
  return lines.join('\n');
}

/**
 * Atomically write hosts text by writing to a temp file then renaming.
 * Falls back to a direct write if rename across devices fails.
 * @param {string} text
 */
function writeHosts(text) {
  const target = hostsPath();
  const normalized = text.endsWith('\n') ? text : text + '\n';
  const tmp = path.join(os.tmpdir(), `killm-hosts-${process.pid}-${Date.now()}.tmp`);
  fs.writeFileSync(tmp, normalized, { mode: 0o644 });
  try {
    fs.renameSync(tmp, target);
  } catch (err) {
    if (err.code === 'EXDEV') {
      // Temp dir is on a different filesystem; write in place instead.
      fs.writeFileSync(target, normalized, { mode: 0o644 });
      fs.unlinkSync(tmp);
    } else {
      try { fs.unlinkSync(tmp); } catch (_) { /* ignore */ }
      throw err;
    }
  }
}

/**
 * Apply a block for the given hostnames. Removes any prior killm block first
 * so repeated runs stay idempotent.
 * @param {string[]} hosts
 * @param {{until?: Date}} [opts]
 */
function applyBlock(hosts, opts = {}) {
  const current = stripBlock(readHosts());
  const base = current.replace(/\n+$/, '');
  const next = (base ? base + '\n\n' : '') + buildBlock(hosts, opts) + '\n';
  writeHosts(next);
}

/**
 * Remove the killm block from the hosts file. No-op if absent.
 * @returns {boolean} whether a block was present and removed
 */
function removeBlock() {
  const current = readHosts();
  if (!current.includes(BEGIN)) return false;
  writeHosts(stripBlock(current));
  return true;
}

/**
 * Whether a killm block is currently present.
 * @returns {boolean}
 */
function isBlocked() {
  return readHosts().includes(BEGIN);
}

/**
 * Best-effort DNS cache flush so the new hosts entries take effect immediately.
 * Silently ignores failures — the block still works, it may just take a moment.
 * @returns {Promise<void>}
 */
function flushDns() {
  const run = (cmd, args) =>
    new Promise((resolve) => {
      execFile(cmd, args, () => resolve());
    });

  if (process.platform === 'darwin') {
    return run('dscacheutil', ['-flushcache']).then(() =>
      run('killall', ['-HUP', 'mDNSResponder'])
    );
  }
  if (process.platform === 'win32') {
    return run('ipconfig', ['/flushdns']);
  }
  // Linux: try the common resolvers; whichever exists wins, the rest no-op.
  return run('resolvectl', ['flush-caches'])
    .then(() => run('systemd-resolve', ['--flush-caches']))
    .then(() => run('systemctl', ['restart', 'nscd']));
}

/**
 * True when the process likely has the privileges needed to edit the hosts
 * file (root on POSIX). On Windows we can't cheaply tell, so assume yes and
 * let the write surface EPERM/EACCES if not.
 * @returns {boolean}
 */
function hasPrivileges() {
  if (process.platform === 'win32') return true;
  return typeof process.getuid === 'function' && process.getuid() === 0;
}

module.exports = {
  hostsPath,
  readHosts,
  applyBlock,
  removeBlock,
  isBlocked,
  flushDns,
  hasPrivileges,
  stripBlock,
  buildBlock,
  BEGIN,
  END,
};
