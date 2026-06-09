import { test } from 'node:test';
import assert from 'node:assert';

import { resolveTargets, AGENTS, WEB } from '../src/targets.js';

test('agents scope excludes chat sites', () => {
  const t = resolveTargets({ agents: true });
  assert.ok(t.includes('api.anthropic.com'));
  assert.ok(t.includes('api.openai.com'));
  assert.ok(!t.includes('claude.ai'), 'claude.ai must stay reachable under --agents');
  assert.ok(!t.includes('chatgpt.com'), 'chatgpt.com must stay reachable under --agents');
});

test('web scope excludes API endpoints', () => {
  const t = resolveTargets({ web: true });
  assert.ok(t.includes('claude.ai'));
  assert.ok(t.includes('chatgpt.com'));
  assert.ok(!t.includes('api.anthropic.com'), 'api.anthropic.com must stay reachable under --web');
  assert.ok(!t.includes('api.openai.com'), 'api.openai.com must stay reachable under --web');
});

test('all scope is the union of agents and web', () => {
  const t = resolveTargets({ all: true });
  for (const h of AGENTS) assert.ok(t.includes(h), `missing agent host ${h}`);
  for (const h of WEB) assert.ok(t.includes(h), `missing web host ${h}`);
  assert.strictEqual(t.length, new Set([...AGENTS, ...WEB]).size);
});

test('agents + web equals all', () => {
  assert.deepStrictEqual(
    resolveTargets({ agents: true, web: true }),
    resolveTargets({ all: true })
  );
});

test('empty scope blocks nothing', () => {
  assert.deepStrictEqual(resolveTargets({}), []);
});

test('result is de-duplicated and sorted', () => {
  const t = resolveTargets({ agents: true, web: true, all: true });
  assert.deepStrictEqual(t, Array.from(new Set(t)).sort());
});

test('lists contain no duplicates or empty entries', () => {
  for (const list of [AGENTS, WEB]) {
    assert.strictEqual(list.length, new Set(list).size, 'duplicate hostname in list');
    for (const h of list) {
      assert.ok(typeof h === 'string' && h.length > 0);
      assert.ok(!/\s/.test(h), `hostname contains whitespace: "${h}"`);
      assert.ok(!h.includes('/'), `hostname contains a path: "${h}"`);
    }
  }
});

test('agents and web lists do not overlap', () => {
  const overlap = AGENTS.filter((h) => WEB.includes(h));
  assert.deepStrictEqual(overlap, [], 'a host in both lists defeats the scope split');
});
