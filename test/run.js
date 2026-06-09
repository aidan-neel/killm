'use strict';

// Tiny dependency-free test runner. Run with `npm test` or `node test/run.js`.

const assert = require('assert');

const { parseDuration, formatDuration } = require('../src/duration');
const { resolveTargets, AGENTS, WEB } = require('../src/targets');
const { parseArgs } = require('../src/cli');
const hosts = require('../src/hosts');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    process.stdout.write(`  ok   ${name}\n`);
  } catch (e) {
    failed++;
    process.stdout.write(`  FAIL ${name}\n       ${e.message}\n`);
  }
}

// ---- duration ----------------------------------------------------------

test('parseDuration: single units', () => {
  assert.strictEqual(parseDuration('90s'), 90 * 1000);
  assert.strictEqual(parseDuration('30m'), 30 * 60 * 1000);
  assert.strictEqual(parseDuration('1h'), 60 * 60 * 1000);
  assert.strictEqual(parseDuration('2d'), 2 * 24 * 60 * 60 * 1000);
});

test('parseDuration: combined units', () => {
  assert.strictEqual(parseDuration('1h30m'), (60 + 30) * 60 * 1000);
  assert.strictEqual(parseDuration('1d12h'), (36) * 60 * 60 * 1000);
});

test('parseDuration: bare number is minutes', () => {
  assert.strictEqual(parseDuration('45'), 45 * 60 * 1000);
});

test('parseDuration: rejects junk', () => {
  assert.throws(() => parseDuration('abc'));
  assert.throws(() => parseDuration('1h!'));
  assert.throws(() => parseDuration(''));
  assert.throws(() => parseDuration('0s'));
});

test('formatDuration: round trips compactly', () => {
  assert.strictEqual(formatDuration(parseDuration('1h30m')), '1h 30m');
  assert.strictEqual(formatDuration(parseDuration('90s')), '1m 30s');
  assert.strictEqual(formatDuration(0), '0s');
});

// ---- targets -----------------------------------------------------------

test('resolveTargets: agents excludes chat sites', () => {
  const t = resolveTargets({ agents: true });
  assert.ok(t.includes('api.anthropic.com'));
  assert.ok(t.includes('api.openai.com'));
  assert.ok(!t.includes('claude.ai'), 'claude.ai must stay reachable under --agents');
  assert.ok(!t.includes('chatgpt.com'), 'chatgpt.com must stay reachable under --agents');
});

test('resolveTargets: web excludes API endpoints', () => {
  const t = resolveTargets({ web: true });
  assert.ok(t.includes('claude.ai'));
  assert.ok(t.includes('chatgpt.com'));
  assert.ok(!t.includes('api.anthropic.com'), 'api.anthropic.com must stay reachable under --web');
});

test('resolveTargets: all is the union', () => {
  const t = resolveTargets({ all: true });
  for (const h of AGENTS) assert.ok(t.includes(h), `missing agent host ${h}`);
  for (const h of WEB) assert.ok(t.includes(h), `missing web host ${h}`);
});

test('resolveTargets: de-duplicated and sorted', () => {
  const t = resolveTargets({ agents: true, web: true, all: true });
  assert.deepStrictEqual(t, Array.from(new Set(t)).sort());
});

// ---- cli ---------------------------------------------------------------

test('parseArgs: "for 1h --agents"', () => {
  const p = parseArgs(['for', '1h', '--agents']);
  assert.strictEqual(p.command, 'run');
  assert.strictEqual(p.durationMs, 60 * 60 * 1000);
  assert.strictEqual(p.scope.agents, true);
  assert.strictEqual(p.scope.web, false);
});

test('parseArgs: combined scopes from the example', () => {
  const p = parseArgs(['for', '1h', '--agents', '--web', '--all']);
  assert.strictEqual(p.scope.agents, true);
  assert.strictEqual(p.scope.web, true);
  assert.strictEqual(p.scope.all, true);
});

test('parseArgs: bare duration without "for"', () => {
  const p = parseArgs(['30m', '--web']);
  assert.strictEqual(p.command, 'run');
  assert.strictEqual(p.durationMs, 30 * 60 * 1000);
});

test('parseArgs: defaults to --all when no scope', () => {
  const p = parseArgs(['1h']);
  assert.strictEqual(p.scope.all, true);
});

test('parseArgs: missing duration is an error', () => {
  const p = parseArgs(['--agents']);
  assert.strictEqual(p.command, 'help');
  assert.ok(p.error);
});

test('parseArgs: --restore / --status / --list / --help / --version', () => {
  assert.strictEqual(parseArgs(['--restore']).command, 'restore');
  assert.strictEqual(parseArgs(['--status']).command, 'status');
  assert.strictEqual(parseArgs(['--list', '--web']).command, 'list');
  assert.strictEqual(parseArgs(['--help']).command, 'help');
  assert.strictEqual(parseArgs(['--version']).command, 'version');
});

test('parseArgs: unknown option errors', () => {
  const p = parseArgs(['1h', '--bogus']);
  assert.strictEqual(p.command, 'help');
  assert.ok(p.error);
});

// ---- hosts text manipulation (pure, no filesystem) ---------------------

test('hosts.buildBlock + stripBlock are inverse', () => {
  const base = '127.0.0.1\tlocalhost\n::1\tlocalhost\n';
  const block = hosts.buildBlock(['claude.ai', 'chatgpt.com']);
  const combined = base + '\n' + block + '\n';
  assert.ok(combined.includes('0.0.0.0\tclaude.ai'));
  assert.ok(combined.includes('0.0.0.0\tchatgpt.com'));
  const stripped = hosts.stripBlock(combined);
  assert.ok(!stripped.includes(hosts.BEGIN));
  assert.ok(!stripped.includes('claude.ai'));
  assert.ok(stripped.includes('localhost'), 'must preserve pre-existing entries');
});

test('hosts.stripBlock: handles missing block', () => {
  const base = '127.0.0.1\tlocalhost\n';
  assert.strictEqual(hosts.stripBlock(base), base);
});

test('hosts.stripBlock: handles malformed (begin, no end)', () => {
  const broken = '127.0.0.1\tlocalhost\n' + hosts.BEGIN + '\n0.0.0.0\tclaude.ai\n';
  const stripped = hosts.stripBlock(broken);
  assert.ok(!stripped.includes('claude.ai'));
  assert.ok(stripped.includes('localhost'));
});

// ---- summary -----------------------------------------------------------

process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
