import { test } from 'node:test';
import assert from 'node:assert';

import { parseArgs } from '../src/cli.js';

test('"for 1h --agents" runs with agents scope', () => {
  const p = parseArgs(['for', '1h', '--agents']);
  assert.strictEqual(p.command, 'run');
  assert.strictEqual(p.durationMs, 60 * 60 * 1000);
  assert.deepStrictEqual(p.scope, { agents: true, web: false, all: false });
});

test('combined scopes from the canonical example', () => {
  const p = parseArgs(['for', '1h', '--agents', '--web', '--all']);
  assert.strictEqual(p.command, 'run');
  assert.deepStrictEqual(p.scope, { agents: true, web: true, all: true });
});

test('bare duration without "for"', () => {
  const p = parseArgs(['30m', '--web']);
  assert.strictEqual(p.command, 'run');
  assert.strictEqual(p.durationMs, 30 * 60 * 1000);
  assert.strictEqual(p.scope.web, true);
});

test('defaults to --all when no scope given', () => {
  const p = parseArgs(['1h']);
  assert.strictEqual(p.scope.all, true);
});

test('flag order does not matter', () => {
  const a = parseArgs(['--agents', '1h', '--yes']);
  assert.strictEqual(a.command, 'run');
  assert.strictEqual(a.durationMs, 60 * 60 * 1000);
  assert.strictEqual(a.yes, true);
});

test('--dry-run and --yes are captured', () => {
  const p = parseArgs(['1h', '--dry-run', '-y']);
  assert.strictEqual(p.dryRun, true);
  assert.strictEqual(p.yes, true);
});

test('missing duration is an error', () => {
  const p = parseArgs(['--agents']);
  assert.strictEqual(p.command, 'help');
  assert.ok(p.error);
});

test('invalid duration is an error', () => {
  const p = parseArgs(['banana', '--web']);
  assert.strictEqual(p.command, 'help');
  assert.ok(p.error);
});

test('two positional args is an error', () => {
  const p = parseArgs(['1h', '2h']);
  assert.strictEqual(p.command, 'help');
  assert.ok(p.error);
});

test('unknown option is an error', () => {
  const p = parseArgs(['1h', '--bogus']);
  assert.strictEqual(p.command, 'help');
  assert.ok(p.error);
});

test('terminal sub-commands', () => {
  assert.strictEqual(parseArgs(['--restore']).command, 'restore');
  assert.strictEqual(parseArgs(['--unblock']).command, 'restore');
  assert.strictEqual(parseArgs(['--status']).command, 'status');
  assert.strictEqual(parseArgs(['--help']).command, 'help');
  assert.strictEqual(parseArgs(['-h']).command, 'help');
  assert.strictEqual(parseArgs(['--version']).command, 'version');
  assert.strictEqual(parseArgs(['-v']).command, 'version');
});

test('--list works without a duration and defaults to all', () => {
  const p = parseArgs(['--list']);
  assert.strictEqual(p.command, 'list');
  assert.strictEqual(p.scope.all, true);
});

test('--list respects an explicit scope', () => {
  const p = parseArgs(['--list', '--web']);
  assert.strictEqual(p.command, 'list');
  assert.strictEqual(p.scope.web, true);
  assert.strictEqual(p.scope.all, false);
});

test('empty argv asks for a duration', () => {
  const p = parseArgs([]);
  assert.strictEqual(p.command, 'help');
  assert.ok(p.error);
});
