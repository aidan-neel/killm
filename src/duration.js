'use strict';

const UNITS = {
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
};

/**
 * Parse a human duration string into milliseconds.
 *
 * Accepts a single unit ("30m", "1h", "90s", "2d") or a combination
 * ("1h30m", "1d12h"). A bare number is treated as minutes ("45" -> 45m).
 *
 * @param {string} input
 * @returns {number} milliseconds
 * @throws {Error} when the string cannot be parsed
 */
function parseDuration(input) {
  if (input == null) throw new Error('no duration given');
  const raw = String(input).trim().toLowerCase();
  if (raw === '') throw new Error('empty duration');

  // Bare number -> minutes.
  if (/^\d+$/.test(raw)) {
    return Number(raw) * UNITS.m;
  }

  const re = /(\d+)\s*(d|h|m|s)/g;
  let total = 0;
  let matched = false;
  let consumed = 0;
  let match;

  while ((match = re.exec(raw)) !== null) {
    matched = true;
    consumed += match[0].length;
    total += Number(match[1]) * UNITS[match[2]];
  }

  // Reject leftover junk like "1h!" or "abc".
  if (!matched || consumed !== raw.replace(/\s/g, '').length) {
    throw new Error(`could not parse duration: "${input}"`);
  }
  if (total <= 0) throw new Error(`duration must be greater than zero: "${input}"`);

  return total;
}

/**
 * Format milliseconds back into a compact human string, e.g. "1h 30m 05s".
 *
 * @param {number} ms
 * @returns {string}
 */
function formatDuration(ms) {
  if (ms <= 0) return '0s';
  let remaining = Math.round(ms / 1000); // whole seconds

  const days = Math.floor(remaining / 86400);
  remaining %= 86400;
  const hours = Math.floor(remaining / 3600);
  remaining %= 3600;
  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;

  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  if (seconds || parts.length === 0) parts.push(`${seconds}s`);

  return parts.join(' ');
}

module.exports = { parseDuration, formatDuration, UNITS };
