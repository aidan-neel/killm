import readline from 'node:readline';

import { parseArgs, HELP, VERSION, type ParsedArgs } from './cli.js';
import { resolveTargets, type Scope } from './targets.js';
import { formatDuration } from './duration.js';
import * as hosts from './hosts.js';

// Minimal ANSI styling that degrades to plain text when not a TTY.
const tty = process.stdout.isTTY === true;
const c = {
  bold: (s: string) => (tty ? `\x1b[1m${s}\x1b[0m` : s),
  dim: (s: string) => (tty ? `\x1b[2m${s}\x1b[0m` : s),
  red: (s: string) => (tty ? `\x1b[31m${s}\x1b[0m` : s),
  green: (s: string) => (tty ? `\x1b[32m${s}\x1b[0m` : s),
  yellow: (s: string) => (tty ? `\x1b[33m${s}\x1b[0m` : s),
  cyan: (s: string) => (tty ? `\x1b[36m${s}\x1b[0m` : s),
};

function out(msg = ''): void {
  process.stdout.write(msg + '\n');
}
function err(msg = ''): void {
  process.stderr.write(msg + '\n');
}

function errnoCode(e: unknown): string | undefined {
  return (e as NodeJS.ErrnoException)?.code;
}

function scopeLabel(scope: Scope): string {
  if (scope.all) return 'everything (agents + web)';
  const parts: string[] = [];
  if (scope.agents) parts.push('agentic coding + APIs');
  if (scope.web) parts.push('chat websites');
  return parts.join(' + ') || 'nothing';
}

function privilegeHint(): string {
  if (process.platform === 'win32') {
    return 'Run this from an Administrator terminal (right-click > Run as administrator).';
  }
  return 'Re-run with sudo, e.g.  sudo npx killm for 1h --agents';
}

async function confirm(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return true; // non-interactive: assume yes
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await new Promise<string>((resolve) => rl.question(question, resolve));
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

/**
 * Render a single-line live countdown that rewrites in place on a TTY.
 */
function makeCountdown(endTime: number): () => void {
  return function render(): void {
    const remaining = Math.max(0, endTime - Date.now());
    const text = `  ${c.cyan('⛔ blocked')} — ${c.bold(formatDuration(remaining))} remaining   ${c.dim('(Ctrl+C to lift early)')}`;
    if (tty) {
      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);
      process.stdout.write(text);
    }
  };
}

async function runBlock(parsed: ParsedArgs): Promise<number> {
  const durationMs = parsed.durationMs as number;
  const targets = resolveTargets(parsed.scope);

  out();
  out(`${c.bold('killm')} ${c.dim('v' + VERSION)}`);
  out(`  scope:    ${c.bold(scopeLabel(parsed.scope))}`);
  out(`  duration: ${c.bold(formatDuration(durationMs))}`);
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
      `  Block ${scopeLabel(parsed.scope)} for ${formatDuration(durationMs)}? [y/N] `
    );
    if (!ok) {
      out(c.dim('  cancelled.'));
      return 0;
    }
  }

  const endTime = Date.now() + durationMs;
  const until = new Date(endTime);

  try {
    hosts.applyBlock(targets, { until });
  } catch (e) {
    const code = errnoCode(e);
    if (code === 'EACCES' || code === 'EPERM') {
      err(c.red('  ✗ permission denied writing the hosts file.'));
      err('    ' + privilegeHint());
      return 1;
    }
    err(c.red('  ✗ failed to apply block: ' + (e as Error).message));
    return 1;
  }

  await hosts.flushDns();
  out(c.green(`  ✓ block active until ${until.toLocaleTimeString()}`));
  out();

  let timer: NodeJS.Timeout | null = null;
  let ticker: NodeJS.Timeout | null = null;
  let restored = false;

  // Restore exactly once, no matter how we leave (timer, Ctrl+C, kill).
  const restore = (reason: string): void => {
    if (restored) return;
    restored = true;
    if (timer) clearTimeout(timer);
    if (ticker) clearInterval(ticker);
    try {
      const removed = hosts.removeBlock();
      void hosts.flushDns(); // fire and forget on the way out
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
      err(c.red(`  ✗ could not restore hosts file automatically: ${(e as Error).message}`));
      err(c.red('    Run "sudo npx killm --restore" to clean up.'));
    }
  };

  const render = makeCountdown(endTime);
  render();
  ticker = tty ? setInterval(render, 1000) : null;

  // Last-ditch synchronous cleanup if the event loop is torn down unexpectedly.
  process.once('exit', () => {
    if (!restored) {
      try {
        hosts.removeBlock();
      } catch {
        /* ignore */
      }
    }
  });

  await new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      restore('time elapsed');
      resolve();
    }, durationMs);

    const onSignal = (label: string): void => {
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
 *
 * @param argv process.argv.slice(2)
 * @returns exit code
 */
export async function main(argv: string[]): Promise<number> {
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
        out(
          removed
            ? c.green('killm: block lifted. Access restored.')
            : c.dim('killm: no block was active.')
        );
        return 0;
      } catch (e) {
        err(c.red('killm: failed to restore hosts file: ' + (e as Error).message));
        return 1;
      }
    }

    case 'run':
      return runBlock(parsed);
  }
}
