'use strict';

const readline = require('readline');

const { parseArgs, HELP, VERSION } = require('./cli');
const { resolveTargets } = require('./targets');
const { formatDuration } = require('./duration');
const hosts = require('./hosts');

// Minimal ANSI styling that degrades to plain text when not a TTY.
const tty = process.stdout.isTTY;
const c = {
  bold: (s) => (tty ? `\x1b[1m${s}\x1b[0m` : s),
  dim: (s) => (tty ? `\x1b[2m${s}\x1b[0m` : s),
  red: (s) => (tty ? `\x1b[31m${s}\x1b[0m` : s),
  green: (s) => (tty ? `\x1b[32m${s}\x1b[0m` : s),
  yellow: (s) => (tty ? `\x1b[33m${s}\x1b[0m` : s),
  cyan: (s) => (tty ? `\x1b[36m${s}\x1b[0m` : s),
};

function out(msg = '') {
  process.stdout.write(msg + '\n');
}
function err(msg = '') {
  process.stderr.write(msg + '\n');
}

function scopeLabel(scope) {
  if (scope.all) return 'everything (agents + web)';
  const parts = [];
  if (scope.agents) parts.push('agentic coding + APIs');
  if (scope.web) parts.push('chat websites');
  return parts.join(' + ') || 'nothing';
}

function privilegeHint() {
  if (process.platform === 'win32') {
    return 'Run this from an Administrator terminal (right-click > Run as administrator).';
  }
  return 'Re-run with sudo, e.g.  sudo npx killm for 1h --agents';
}

async function confirm(question) {
  if (!process.stdin.isTTY) return true; // non-interactive: assume yes
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await new Promise((resolve) => rl.question(question, resolve));
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

/**
 * Render a single-line live countdown that rewrites in place on a TTY.
 */
function makeCountdown(endTime) {
  return function render() {
    const remaining = Math.max(0, endTime - Date.now());
    const text = `  ${c.cyan('⛔ blocked')} — ${c.bold(formatDuration(remaining))} remaining   ${c.dim('(Ctrl+C to lift early)')}`;
    if (tty) {
      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);
      process.stdout.write(text);
    }
  };
}

async function runBlock(parsed) {
  const targets = resolveTargets(parsed.scope);

  out();
  out(`${c.bold('killm')} ${c.dim('v' + VERSION)}`);
  out(`  scope:    ${c.bold(scopeLabel(parsed.scope))}`);
  out(`  duration: ${c.bold(formatDuration(parsed.durationMs))}`);
  out(`  hosts:    ${c.dim(hosts.hostsPath())}`);
  out(`  blocking ${c.bold(String(targets.length))} hostnames`);
  out();

  if (parsed.dryRun) {
    out(c.yellow('  --dry-run: no changes made. Hostnames that would be blocked:'));
    for (const h of targets) out('    ' + h);
    out();
    return 0;
  }

  if (!hosts.hasPrivileges()) {
    err(c.red('  ✗ killm needs elevated privileges to edit the hosts file.'));
    err('    ' + privilegeHint());
    return 1;
  }

  if (!parsed.yes) {
    const ok = await confirm(
      `  Block ${scopeLabel(parsed.scope)} for ${formatDuration(parsed.durationMs)}? [y/N] `
    );
    if (!ok) {
      out(c.dim('  cancelled.'));
      return 0;
    }
  }

  const endTime = Date.now() + parsed.durationMs;
  const until = new Date(endTime);

  try {
    hosts.applyBlock(targets, { until });
  } catch (e) {
    if (e.code === 'EACCES' || e.code === 'EPERM') {
      err(c.red('  ✗ permission denied writing the hosts file.'));
      err('    ' + privilegeHint());
      return 1;
    }
    err(c.red('  ✗ failed to apply block: ' + e.message));
    return 1;
  }

  await hosts.flushDns();
  out(c.green(`  ✓ block active until ${until.toLocaleTimeString()}`));
  out();

  let timer = null;
  let ticker = null;
  let restored = false;

  // Restore exactly once, no matter how we leave (timer, Ctrl+C, kill).
  const restore = (reason) => {
    if (restored) return;
    restored = true;
    if (timer) clearTimeout(timer);
    if (ticker) clearInterval(ticker);
    try {
      const removed = hosts.removeBlock();
      hosts.flushDns(); // fire and forget on the way out
      if (tty) {
        readline.clearLine(process.stdout, 0);
        readline.cursorTo(process.stdout, 0);
      }
      if (removed) {
        out(c.green(`  ✓ block lifted (${reason}). Access restored.`));
      } else {
        out(c.dim(`  block already lifted (${reason}).`));
      }
    } catch (e) {
      err(c.red(`  ✗ could not restore hosts file automatically: ${e.message}`));
      err(c.red('    Run "sudo npx killm --restore" to clean up.'));
    }
  };

  const render = makeCountdown(endTime);
  render();
  ticker = tty ? setInterval(render, 1000) : null;

  // Last-ditch synchronous cleanup if the event loop is torn down unexpectedly.
  process.once('exit', () => {
    if (!restored) {
      try { hosts.removeBlock(); } catch (_) { /* ignore */ }
    }
  });

  await new Promise((resolve) => {
    timer = setTimeout(() => {
      restore('time elapsed');
      resolve();
    }, parsed.durationMs);

    const onSignal = (label) => {
      restore(label);
      resolve();
    };
    process.once('SIGINT', () => onSignal('interrupted'));
    process.once('SIGTERM', () => onSignal('terminated'));
  });

  return 0;
}

/**
 * Program entry point.
 * @param {string[]} argv  process.argv.slice(2)
 * @returns {Promise<number>} exit code
 */
async function main(argv) {
  const parsed = parseArgs(argv);

  if (parsed.error) {
    err(c.red('error: ' + parsed.error));
    err('');
    err('Run "killm --help" for usage.');
    return 2;
  }

  switch (parsed.command) {
    case 'help':
      out(HELP);
      return 0;

    case 'version':
      out(VERSION);
      return 0;

    case 'status': {
      if (hosts.isBlocked()) {
        out(c.yellow('killm: a block is currently ACTIVE.'));
        out(c.dim('Run "killm --restore" to lift it.'));
      } else {
        out(c.green('killm: no block active.'));
      }
      return 0;
    }

    case 'list': {
      const targets = resolveTargets(parsed.scope);
      out(`# ${scopeLabel(parsed.scope)} — ${targets.length} hostnames`);
      for (const h of targets) out(h);
      return 0;
    }

    case 'restore': {
      if (!hosts.hasPrivileges()) {
        err(c.red('killm: needs elevated privileges to edit the hosts file.'));
        err('  ' + privilegeHint());
        return 1;
      }
      try {
        const removed = hosts.removeBlock();
        await hosts.flushDns();
        out(removed ? c.green('killm: block lifted. Access restored.') : c.dim('killm: no block was active.'));
        return 0;
      } catch (e) {
        err(c.red('killm: failed to restore hosts file: ' + e.message));
        return 1;
      }
    }

    case 'run':
    default:
      return runBlock(parsed);
  }
}

module.exports = { main };
