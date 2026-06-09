import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import * as hosts from '../src/hosts.js';

const BASE = '127.0.0.1\tlocalhost\n::1\tlocalhost\n';

let tmpDir: string;
let tmpHosts: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'killm-test-'));
  tmpHosts = path.join(tmpDir, 'hosts');
  fs.writeFileSync(tmpHosts, BASE);
  process.env.KILLM_HOSTS_PATH = tmpHosts;
});

afterEach(() => {
  delete process.env.KILLM_HOSTS_PATH;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---- pure text manipulation ---------------------------------------------

test('buildBlock + stripBlock are inverse', () => {
  const block = hosts.buildBlock(['claude.ai', 'chatgpt.com']);
  const combined = BASE + '\n' + block + '\n';
  assert.ok(combined.includes('0.0.0.0\tclaude.ai'));
  assert.ok(combined.includes('::1\tclaude.ai'));
  assert.ok(combined.includes('0.0.0.0\tchatgpt.com'));
  const stripped = hosts.stripBlock(combined);
  assert.ok(!stripped.includes(hosts.BEGIN));
  assert.ok(!stripped.includes(hosts.END));
  assert.ok(!stripped.includes('claude.ai'));
  assert.ok(stripped.includes('localhost'), 'must preserve pre-existing entries');
});

test('buildBlock adds www. variants without doubling', () => {
  const block = hosts.buildBlock(['claude.ai', 'www.perplexity.ai']);
  assert.ok(block.includes('0.0.0.0\twww.claude.ai'));
  assert.ok(!block.includes('www.www.'), 'must not produce www.www. entries');
});

test('buildBlock records the until timestamp', () => {
  const until = new Date('2026-01-02T03:04:05.000Z');
  const block = hosts.buildBlock(['claude.ai'], { until });
  assert.ok(block.includes('2026-01-02T03:04:05.000Z'));
});

test('stripBlock: no-op when no block present', () => {
  assert.strictEqual(hosts.stripBlock(BASE), BASE);
});

test('stripBlock: handles malformed block (begin, no end)', () => {
  const broken = BASE + hosts.BEGIN + '\n0.0.0.0\tclaude.ai\n';
  const stripped = hosts.stripBlock(broken);
  assert.ok(!stripped.includes('claude.ai'));
  assert.ok(stripped.includes('localhost'));
});

// ---- real file operations (against the temp hosts file) -----------------

test('hostsPath honors KILLM_HOSTS_PATH override', () => {
  assert.strictEqual(hosts.hostsPath(), tmpHosts);
});

test('applyBlock writes entries and removeBlock restores the original', () => {
  hosts.applyBlock(['claude.ai', 'api.openai.com']);
  const during = fs.readFileSync(tmpHosts, 'utf8');
  assert.ok(during.includes('0.0.0.0\tclaude.ai'));
  assert.ok(during.includes('0.0.0.0\tapi.openai.com'));
  assert.ok(during.includes('127.0.0.1\tlocalhost'), 'original entries preserved');
  assert.strictEqual(hosts.isBlocked(), true);

  const removed = hosts.removeBlock();
  assert.strictEqual(removed, true);
  const after = fs.readFileSync(tmpHosts, 'utf8');
  assert.ok(!after.includes('claude.ai'));
  assert.ok(!after.includes(hosts.BEGIN));
  assert.ok(after.includes('127.0.0.1\tlocalhost'));
  assert.strictEqual(hosts.isBlocked(), false);
});

test('applyBlock is idempotent across repeated runs', () => {
  hosts.applyBlock(['claude.ai']);
  hosts.applyBlock(['chatgpt.com']);
  const during = fs.readFileSync(tmpHosts, 'utf8');
  assert.ok(!during.includes('claude.ai'), 'second apply replaces the first block');
  assert.ok(during.includes('chatgpt.com'));
  assert.strictEqual(during.split(hosts.BEGIN).length - 1, 1, 'exactly one block');

  hosts.removeBlock();
  assert.ok(!fs.readFileSync(tmpHosts, 'utf8').includes(hosts.BEGIN));
});

test('removeBlock is a no-op when nothing is blocked', () => {
  assert.strictEqual(hosts.removeBlock(), false);
  assert.strictEqual(fs.readFileSync(tmpHosts, 'utf8'), BASE);
});

test('applyBlock works when the hosts file does not exist', () => {
  fs.unlinkSync(tmpHosts);
  hosts.applyBlock(['claude.ai']);
  const during = fs.readFileSync(tmpHosts, 'utf8');
  assert.ok(during.includes('0.0.0.0\tclaude.ai'));
  hosts.removeBlock();
});

test('hasPrivileges is true under the test override', () => {
  assert.strictEqual(hosts.hasPrivileges(), true);
});

// ---- expiry tracking and stranded-block healing --------------------------

test('blockExpiry: reads the expiry written by applyBlock', () => {
  const until = new Date(Date.now() + 60_000);
  hosts.applyBlock(['claude.ai'], { until });
  const expiry = hosts.blockExpiry();
  assert.ok(expiry !== null);
  assert.strictEqual(expiry.toISOString(), until.toISOString());
});

test('blockExpiry: null when no block or no marker', () => {
  assert.strictEqual(hosts.blockExpiry(), null);
  hosts.applyBlock(['claude.ai']); // no until -> no marker (like killm <= 1.0.2)
  assert.strictEqual(hosts.blockExpiry(), null);
});

test('blockExpiry: null for a corrupted timestamp', () => {
  const block = hosts.buildBlock(['claude.ai']);
  fs.writeFileSync(
    tmpHosts,
    BASE + block.replace(hosts.END, `${hosts.EXPIRES_PREFIX}garbage\n${hosts.END}`) + '\n'
  );
  assert.strictEqual(hosts.blockExpiry(), null);
});

test('clearExpiredBlock: removes a block whose time has passed', () => {
  hosts.applyBlock(['claude.ai'], { until: new Date(Date.now() - 1000) });
  assert.strictEqual(hosts.clearExpiredBlock(), true);
  assert.strictEqual(hosts.isBlocked(), false);
  assert.ok(fs.readFileSync(tmpHosts, 'utf8').includes('localhost'));
});

test('clearExpiredBlock: leaves a still-active block alone', () => {
  hosts.applyBlock(['claude.ai'], { until: new Date(Date.now() + 60_000) });
  assert.strictEqual(hosts.clearExpiredBlock(), false);
  assert.strictEqual(hosts.isBlocked(), true);
});

test('clearExpiredBlock: leaves a marker-less block alone (cannot judge age)', () => {
  hosts.applyBlock(['claude.ai']);
  assert.strictEqual(hosts.clearExpiredBlock(), false);
  assert.strictEqual(hosts.isBlocked(), true);
});

test('clearExpiredBlock: no-op without a block', () => {
  assert.strictEqual(hosts.clearExpiredBlock(), false);
});

// ---- WSL detection -------------------------------------------------------

test('isWsl: detects a Microsoft kernel string (Linux only)', (t) => {
  if (process.platform !== 'linux') {
    t.skip('isWsl is always false off Linux');
    return;
  }
  const procVersion = path.join(tmpDir, 'proc-version');
  fs.writeFileSync(
    procVersion,
    'Linux version 5.15.167.4-microsoft-standard-WSL2 (root@build) #1 SMP\n'
  );
  assert.strictEqual(hosts.isWsl(procVersion), true);
});

test('isWsl: false on a regular kernel', (t) => {
  if (process.platform !== 'linux') {
    t.skip('isWsl is always false off Linux');
    return;
  }
  const procVersion = path.join(tmpDir, 'proc-version');
  fs.writeFileSync(procVersion, 'Linux version 6.8.0-45-generic (buildd@host) #45-Ubuntu SMP\n');
  assert.strictEqual(hosts.isWsl(procVersion), false);
});

test('isWsl: false when the file is unreadable', () => {
  assert.strictEqual(hosts.isWsl(path.join(tmpDir, 'does-not-exist')), false);
});
