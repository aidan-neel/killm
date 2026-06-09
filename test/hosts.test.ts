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
