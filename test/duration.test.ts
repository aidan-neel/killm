import { test } from 'node:test';
import assert from 'node:assert';

import { parseDuration, formatDuration } from '../src/duration.js';

test('parseDuration: single units', () => {
  assert.strictEqual(parseDuration('90s'), 90 * 1000);
  assert.strictEqual(parseDuration('30m'), 30 * 60 * 1000);
  assert.strictEqual(parseDuration('1h'), 60 * 60 * 1000);
  assert.strictEqual(parseDuration('2d'), 2 * 24 * 60 * 60 * 1000);
});

test('parseDuration: combined units', () => {
  assert.strictEqual(parseDuration('1h30m'), (60 + 30) * 60 * 1000);
  assert.strictEqual(parseDuration('1d12h'), 36 * 60 * 60 * 1000);
  assert.strictEqual(parseDuration('1h30m15s'), (90 * 60 + 15) * 1000);
});

test('parseDuration: bare number is minutes', () => {
  assert.strictEqual(parseDuration('45'), 45 * 60 * 1000);
  assert.strictEqual(parseDuration('1'), 60 * 1000);
});

test('parseDuration: tolerates whitespace and case', () => {
  assert.strictEqual(parseDuration(' 1H '), 60 * 60 * 1000);
  assert.strictEqual(parseDuration('1h 30m'), (60 + 30) * 60 * 1000);
});

test('parseDuration: rejects junk', () => {
  assert.throws(() => parseDuration('abc'));
  assert.throws(() => parseDuration('1h!'));
  assert.throws(() => parseDuration('h'));
  assert.throws(() => parseDuration(''));
  assert.throws(() => parseDuration('   '));
  assert.throws(() => parseDuration(null));
  assert.throws(() => parseDuration(undefined));
});

test('parseDuration: rejects zero', () => {
  assert.throws(() => parseDuration('0s'));
  assert.throws(() => parseDuration('0'));
  assert.throws(() => parseDuration('0h0m'));
});

test('formatDuration: compact human output', () => {
  assert.strictEqual(formatDuration(parseDuration('1h30m')), '1h 30m');
  assert.strictEqual(formatDuration(parseDuration('90s')), '1m 30s');
  assert.strictEqual(formatDuration(parseDuration('2d')), '2d');
  assert.strictEqual(formatDuration(parseDuration('1d1h1m1s')), '1d 1h 1m 1s');
});

test('formatDuration: edge cases', () => {
  assert.strictEqual(formatDuration(0), '0s');
  assert.strictEqual(formatDuration(-5), '0s');
  assert.strictEqual(formatDuration(499), '0s'); // rounds to nearest second
  assert.strictEqual(formatDuration(500), '1s');
});
