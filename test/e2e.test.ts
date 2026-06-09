import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { buildBlock } from '../src/hosts.js';
import { VERSION } from '../src/cli.js';

// Resolves to the compiled bin next to this compiled test file.
const BIN = fileURLToPath(new URL('../src/bin.js', import.meta.url));
const BASE = '127.0.0.1\tlocalhost\n';

let tmpDir: string;
let tmpHosts: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'killm-e2e-'));
  tmpHosts = path.join(tmpDir, 'hosts');
  fs.writeFileSync(tmpHosts, BASE);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function run(args: string[], { timeout = 30000 } = {}): Promise<RunResult> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [BIN, ...args],
      {
        timeout,
        env: { ...process.env, KILLM_HOSTS_PATH: tmpHosts },
      },
      (error, stdout, stderr) => {
        const code = error ? ((error as { code?: number | string }).code ?? 1) : 0;
        resolve({ code: typeof code === 'number' ? code : 1, stdout, stderr });
      }
    );
  });
}

test('--help prints usage and exits 0', async () => {
  const r = await run(['--help']);
  assert.strictEqual(r.code, 0);
  assert.match(r.stdout, /USAGE/);
  assert.match(r.stdout, /--agents/);
});

test('--version prints the package version', async () => {
  const r = await run(['--version']);
  assert.strictEqual(r.code, 0);
  assert.strictEqual(r.stdout.trim(), VERSION);
});

test('--list --agents prints API hosts but no chat sites', async () => {
  const r = await run(['--list', '--agents']);
  assert.strictEqual(r.code, 0);
  assert.match(r.stdout, /api\.anthropic\.com/);
  assert.ok(!/^claude\.ai$/m.test(r.stdout));
});

test('--status reports no block on a clean file', async () => {
  const r = await run(['--status']);
  assert.strictEqual(r.code, 0);
  assert.match(r.stdout, /no block active/);
});

test('--dry-run changes nothing', async () => {
  const r = await run(['for', '1h', '--all', '--dry-run']);
  assert.strictEqual(r.code, 0);
  assert.match(r.stdout, /dry-run/);
  assert.strictEqual(fs.readFileSync(tmpHosts, 'utf8'), BASE);
});

test('unknown option exits 2 with an error', async () => {
  const r = await run(['1h', '--bogus']);
  assert.strictEqual(r.code, 2);
  assert.match(r.stderr, /unknown option/);
});

test('missing duration exits 2 with an error', async () => {
  const r = await run(['--agents']);
  assert.strictEqual(r.code, 2);
  assert.match(r.stderr, /duration is required/);
});

test('full lifecycle: block applies, then auto-restores when time elapses', async () => {
  const r = await run(['1s', '--web', '--yes']);
  assert.strictEqual(r.code, 0);
  assert.match(r.stdout, /block active/);
  assert.match(r.stdout, /block lifted \(time elapsed\)/);
  const after = fs.readFileSync(tmpHosts, 'utf8');
  assert.ok(!after.includes('claude.ai'), 'block must be removed after expiry');
  assert.ok(after.includes('localhost'), 'original entries preserved');
});

test('--restore lifts a stranded block', async () => {
  // Simulate a crash that left a block behind.
  fs.writeFileSync(tmpHosts, BASE + '\n' + buildBlock(['claude.ai']) + '\n');

  const status = await run(['--status']);
  assert.match(status.stdout, /ACTIVE/);

  const r = await run(['--restore']);
  assert.strictEqual(r.code, 0);
  assert.match(r.stdout, /Access restored/);
  assert.ok(!fs.readFileSync(tmpHosts, 'utf8').includes('claude.ai'));
});

test('--restore is a friendly no-op when nothing is blocked', async () => {
  const r = await run(['--restore']);
  assert.strictEqual(r.code, 0);
  assert.match(r.stdout, /no block was active/);
});

test('--status auto-cleans an EXPIRED stranded block', async () => {
  // Simulate a hard kill: block with an expiry that has already passed.
  fs.writeFileSync(
    tmpHosts,
    BASE + '\n' + buildBlock(['claude.ai'], { until: new Date(Date.now() - 60_000) }) + '\n'
  );

  const r = await run(['--status']);
  assert.strictEqual(r.code, 0);
  assert.match(r.stdout, /no block active/);
  assert.match(r.stdout, /cleaned up an expired block/);
  assert.ok(!fs.readFileSync(tmpHosts, 'utf8').includes('claude.ai'));
});

test('--status reports the scheduled lift time of an active block', async () => {
  fs.writeFileSync(
    tmpHosts,
    BASE + '\n' + buildBlock(['claude.ai'], { until: new Date(Date.now() + 3_600_000) }) + '\n'
  );

  const r = await run(['--status']);
  assert.strictEqual(r.code, 0);
  assert.match(r.stdout, /ACTIVE/);
  assert.match(r.stdout, /Scheduled to lift at/);
  assert.ok(fs.readFileSync(tmpHosts, 'utf8').includes('claude.ai'), 'active block kept');
});

test('starting a new block heals an expired stranded one first', async () => {
  fs.writeFileSync(
    tmpHosts,
    BASE + '\n' + buildBlock(['poe.com'], { until: new Date(Date.now() - 60_000) }) + '\n'
  );

  const r = await run(['1s', '--web', '--yes']);
  assert.strictEqual(r.code, 0);
  assert.match(r.stdout, /cleaned up an expired block/);
  assert.match(r.stdout, /block lifted \(time elapsed\)/);
  assert.ok(!fs.readFileSync(tmpHosts, 'utf8').includes('poe.com'));
});

test('SIGHUP (terminal closed) lifts the block', { skip: process.platform === 'win32' }, () => {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [BIN, '60s', '--web', '--yes'], {
      env: { ...process.env, KILLM_HOSTS_PATH: tmpHosts },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let sent = false;
    child.stdout.on('data', (chunk: Buffer) => {
      if (!sent && chunk.toString().includes('block active')) {
        sent = true;
        // Give the run loop a beat to install its signal handlers.
        setTimeout(() => child.kill('SIGHUP'), 300);
      }
    });

    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('child did not exit after SIGHUP'));
    }, 15_000);

    child.on('exit', () => {
      clearTimeout(timeout);
      try {
        const after = fs.readFileSync(tmpHosts, 'utf8');
        assert.ok(!after.includes('claude.ai'), 'block must be removed on SIGHUP');
        assert.ok(after.includes('localhost'), 'original entries preserved');
        resolve();
      } catch (e) {
        reject(e as Error);
      }
    });
  });
});
